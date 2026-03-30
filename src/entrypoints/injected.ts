import { defineUnlistedScript } from "wxt/utils/define-unlisted-script"
import { MESSAGE_STATUS, MESSAGE_TYPE } from "~/types/messaging"
import type { ExtMessage, ChatMessage } from "~/types/messaging"
import { SOCKET_EVENTS, SOCKET_URL } from "~/types/socket"
import type { State } from "~/types/state"
import { VIDEO_EVENTS } from "~/types/video"
import { findSiteVideo, detectStreamingSite } from "~/lib/video-detection"
import browser from "webextension-polyfill"
import { io } from "socket.io-client"
import { z } from "zod"
import { createPostHog } from "~/lib/posthog"

declare global {
  interface Window {
    __synclifyInjected?: boolean
  }
}

export default defineUnlistedScript(async () => {
  if (window.__synclifyInjected) return
  window.__synclifyInjected = true

  const posthog = await createPostHog("injected")

  let tabId: number
  let roomCode: string
  let state: State
  let video: HTMLVideoElement | null | undefined
  let boundVideo: HTMLVideoElement | null = null
  let suppressEventsUntil = 0
  let lastAppliedRemoteEventTimestamp = 0
  let joinedRoom: string | null = null
  let settings: { syncAudio: boolean } | undefined
  const SYNTHETIC_SUPPRESSION_MS = 400
  const suppressOutboundEvents = () => {
    suppressEventsUntil = Date.now() + SYNTHETIC_SUPPRESSION_MS
  }
  const markRemoteEventApplied = (serverTimestamp?: number) => {
    if (typeof serverTimestamp === "number") {
      lastAppliedRemoteEventTimestamp = Math.max(
        lastAppliedRemoteEventTimestamp,
        serverTimestamp
      )
    }
  }
  const isStaleRemoteEvent = (serverTimestamp?: number) => {
    return (
      typeof serverTimestamp === "number" &&
      serverTimestamp < lastAppliedRemoteEventTimestamp
    )
  }

  const socket = io(SOCKET_URL, {
    autoConnect: false,
    transports: ["websocket", "polling"]
  })

  const init = async (videoId: string) => {
    const tabIdResult = await browser.runtime.sendMessage({
      action: "getTabId"
    })
    tabId = tabIdResult as number
    const storageResult = await browser.storage.local.get("state")
    const savedState = storageResult.state as State | undefined

    if (savedState === undefined) {
      const e = new Error("Stored state is undefined")
      posthog.captureException(e)
      throw e
    }
    state = savedState

    const settingsResult = await browser.storage.sync.get("settings")
    settings = settingsResult.settings as { syncAudio: boolean } | undefined
    roomCode = state[tabId].roomId
    if (roomCode) {
      // Idempotent: reuse existing connection, just re-join and re-bind video
      if (socket.disconnected) socket.connect()
      else if (joinedRoom !== roomCode) {
        joinedRoom = null
        joinRoom()
      }
      return getVideo(videoId)
    }
  }

  const videoEventHandler = (event: Event) => {
    if (roomCode) {
      const volumeOrRate =
        event.type === VIDEO_EVENTS.RATECHANGE
          ? video?.playbackRate
          : video?.volume
      socket.emit(
        SOCKET_EVENTS.VIDEO_EVENT,
        roomCode,
        event.type,
        volumeOrRate,
        video?.currentTime
      )
    }
  }

  const checkVideoEvent = (event: Event) => {
    if (Date.now() < suppressEventsUntil) {
      event.stopImmediatePropagation()
    } else videoEventHandler(event)
  }

  const observer = new MutationObserver(() => {
    if (!video) getVideo()
  })

  const getVideo = (videoId?: string) => {
    // First try by synclify-id if provided
    if (videoId) {
      video = document.querySelector(
        `[data-synclify-id="${videoId}"]`
      ) as HTMLVideoElement | null
    }

    // If no videoId or element not found, use site-specific detection
    if (!video) {
      const site = detectStreamingSite()
      if (site !== "unknown") {
        video = findSiteVideo()
        if (video) {
          // Ensure it has a synclify-id for future lookups
          if (!video.dataset.synclifyId) {
            video.dataset.synclifyId = Math.random().toString(36).slice(2, 7)
          }
        }
      }
    }

    // Final fallback: first video on the page
    if (!video) {
      video = document.querySelector("video")
      posthog.capture("video_id_null_fallback", {
        message:
          "videoId is null, using first element returned by document.querySelector"
      })
    }

    if (video != null) {
      const newState = Object.assign(state ?? {}, {
        [tabId]: {
          ...state?.[tabId],
          roomId: roomCode,
          videoFound: true
        }
      })
      browser.storage.local.set({ state: newState })
      if (boundVideo) {
        for (const event of Object.values(VIDEO_EVENTS)) {
          boundVideo.removeEventListener(event, checkVideoEvent)
        }
      }
      boundVideo = video
      for (const event of Object.values(VIDEO_EVENTS)) {
        boundVideo.addEventListener(event, checkVideoEvent)
      }
      observer.disconnect()
      browser.runtime.sendMessage({
        action: "showToast",
        body: { content: "", messageKey: "videoDetected" }
      })
      return { status: MESSAGE_STATUS.SUCCESS }
    }
    observer.observe(document, { subtree: true, childList: true })
    browser.runtime.sendMessage({
      action: "showToast",
      body: { error: true, content: "", messageKey: "videoNotFound" }
    })
    posthog.capture("no_video_found", {
      message: `No video found in ${window.location.href}`
    })
    return {
      status: MESSAGE_STATUS.ERROR,
      messageKey: "videoNotFound"
    }
  }

  const joinRoom = () => {
    if (!roomCode) {
      const e = new Error("Invalid room code: " + roomCode)
      posthog.captureException(e)
      throw e
    }
    if (!socket.connected) return
    if (joinedRoom === roomCode) return
    socket.emit(SOCKET_EVENTS.JOIN, roomCode)
    joinedRoom = roomCode
  }

  socket.on("disconnect", () => {
    joinedRoom = null
  })

  socket.on("connect", () => {
    joinedRoom = null
    joinRoom()
    // Measure latency on connect and periodically
    measureLatency()
    const latencyInterval = setInterval(() => {
      if (socket.connected) measureLatency()
      else clearInterval(latencyInterval)
    }, 30000)
  })

  socket.on(SOCKET_EVENTS.FULL, (room) => {
    const e = new Error("Room is full: " + room)
    scope.captureException(e)
    throw e
  })

  socket.on("connect_error", () => {
    posthog.capture("socket_connection_error", {
      message: "Socket connection error, allowing polling"
    })
    socket.io.opts.transports = ["polling", "websocket"]
  })

  // --- Chat message handling ---
  socket.on(SOCKET_EVENTS.CHAT_MESSAGE, (message: ChatMessage) => {
    // Forward to chat content script via background relay
    browser.runtime.sendMessage({
      action: "forwardToChat",
      nickname: message.nickname,
      text: message.text,
      timestamp: message.timestamp
    })
  })

  // --- Reaction handling ---
  socket.on(
    SOCKET_EVENTS.REACTION,
    (data: { emoji: string; nickname: string }) => {
      // Forward to reactions content script via background relay
      browser.runtime.sendMessage({
        action: "forwardToReaction",
        emoji: data.emoji,
        nickname: data.nickname
      })
    }
  )

  // --- Latency compensation ---
  let estimatedClockOffsetMs = 0

  const measureLatency = async () => {
    const samples: Array<{ rtt: number; offset: number }> = []
    for (let i = 0; i < 5; i++) {
      const t0 = Date.now()
      const pong = await new Promise<{
        clientSendTs: number
        serverTs: number
      }>((resolve) => {
        socket.once(SOCKET_EVENTS.SYNC_PONG, resolve)
        socket.emit(SOCKET_EVENTS.SYNC_PING, { clientSendTs: t0 })
      })
      const t2 = Date.now()
      const rtt = t2 - t0
      const offset = pong.serverTs - t0 - rtt / 2
      samples.push({ rtt, offset })
    }
    // Discard highest and lowest RTT, average the rest
    samples.sort((a, b) => a.rtt - b.rtt)
    const trimmed = samples.slice(1, -1)
    estimatedClockOffsetMs =
      trimmed.reduce((s, v) => s + v.offset, 0) / trimmed.length
  }

  socket.on(
    SOCKET_EVENTS.VIDEO_EVENT,
    (
      eventType: VIDEO_EVENTS,
      volumeValue: string,
      currentTime: string,
      serverTimestamp?: number
    ) => {
      if (video == null) {
        const e = new Error("Video is null in socket video event handler")
        posthog.captureException(e)
        throw e
      }
      const shouldTrackTimelineEvent =
        eventType === VIDEO_EVENTS.PLAY ||
        eventType === VIDEO_EVENTS.PAUSE ||
        eventType === VIDEO_EVENTS.SEEKED

      if (shouldTrackTimelineEvent) {
        if (isStaleRemoteEvent(serverTimestamp)) return
        markRemoteEventApplied(serverTimestamp)
      }

      // Latency-compensated time adjustment
      const adjustTime = (rawTime: number): number => {
        if (!serverTimestamp) return rawTime
        const localEventTime = serverTimestamp - estimatedClockOffsetMs
        const elapsed = (Date.now() - localEventTime) / 1000
        return rawTime + elapsed
      }

      switch (eventType) {
        case VIDEO_EVENTS.PLAY: {
          suppressOutboundEvents()
          const adjustedTime = adjustTime(Number.parseFloat(currentTime))
          video.currentTime = adjustedTime
          video.play().catch((e) => {
            console.error(e)
            if (e.name === "NotAllowedError") {
              browser.runtime.sendMessage({
                action: "showToast",
                body: {
                  error: true,
                  content:
                    "Video is not allowed to play! Interact with the page first."
                }
              })
            } else {
              posthog.captureException(e)
            }
          })
          break
        }
        case VIDEO_EVENTS.PAUSE:
          suppressOutboundEvents()
          video.pause()
          break
        case VIDEO_EVENTS.VOLUMECHANGE:
          if (!settings?.syncAudio) break
          suppressOutboundEvents()
          video.volume = Number.parseFloat(volumeValue)
          break
        case VIDEO_EVENTS.SEEKED: {
          const adjustedTime = adjustTime(Number.parseFloat(currentTime))
          suppressOutboundEvents()
          video.currentTime = adjustedTime
          break
        }
        case VIDEO_EVENTS.RATECHANGE:
          suppressOutboundEvents()
          video.playbackRate = Number.parseFloat(volumeValue)
          break
      }
    }
  )

  browser.runtime.onMessage.addListener(
    (
      request: ExtMessage & {
        type: MESSAGE_TYPE
        text?: string
        emoji?: string
      }
    ) => {
      switch (request.type) {
        case MESSAGE_TYPE.INIT: {
          return init(request.videoId).then((res) => {
            return res
          })
        }
        case MESSAGE_TYPE.EXIT:
          for (const event of Object.values(VIDEO_EVENTS)) {
            boundVideo?.removeEventListener(event, checkVideoEvent)
          }
          socket.disconnect()
          joinedRoom = null
          observer.disconnect()
          video = null
          boundVideo = null
          return Promise.resolve({
            status: MESSAGE_STATUS.SUCCESS
          })
        case MESSAGE_TYPE.CHAT: {
          // Outbound chat message from content script via background
          const nickname = state?.[tabId]?.nickname || "Anonymous"
          const msg: ChatMessage = {
            nickname,
            text: request.text || "",
            timestamp: Date.now()
          }
          socket.emit(SOCKET_EVENTS.CHAT_MESSAGE, roomCode, msg)
          // Echo back to own chat UI via background relay
          browser.runtime.sendMessage({
            action: "forwardToChat",
            nickname: msg.nickname,
            text: msg.text,
            timestamp: msg.timestamp,
            self: true
          })
          return Promise.resolve(null)
        }
        case MESSAGE_TYPE.REACTION: {
          const nickname = state?.[tabId]?.nickname || "Anonymous"
          socket.emit(SOCKET_EVENTS.REACTION, roomCode, {
            emoji: request.emoji,
            nickname
          })
          // Echo back to own reaction UI via background relay
          browser.runtime.sendMessage({
            action: "forwardToReaction",
            emoji: request.emoji,
            nickname
          })
          return Promise.resolve(null)
        }
        default:
          return
      }
    }
  )
})
