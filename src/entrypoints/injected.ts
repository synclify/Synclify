import { defineUnlistedScript } from "wxt/utils/define-unlisted-script"
import { MESSAGE_STATUS, MESSAGE_TYPE } from "~/types/messaging"
import type { ExtMessage } from "~/types/messaging"
import { SOCKET_EVENTS, SOCKET_URL } from "~/types/socket"
import type { State } from "~/types/state"
import { VIDEO_EVENTS } from "~/types/video"
import browser from "webextension-polyfill"
import { io } from "socket.io-client"
import { z } from "zod"
import {
  BrowserClient,
  captureMessage,
  defaultStackParser,
  getDefaultIntegrations,
  makeFetchTransport,
  Scope
} from "@sentry/browser"

declare global {
  interface Window {
    __synclifyInjected?: boolean
  }
}

export default defineUnlistedScript(() => {
  if (window.__synclifyInjected) return
  window.__synclifyInjected = true

  const integrations = getDefaultIntegrations({}).filter(
    (defaultIntegration) => {
      return !["BrowserApiErrors", "Breadcrumbs", "GlobalHandlers"].includes(
        defaultIntegration.name
      )
    }
  )

  const client = new BrowserClient({
    dsn: import.meta.env.WXT_SENTRY_DSN,
    tunnel: `${SOCKET_URL}/t`,
    transport: makeFetchTransport,
    stackParser: defaultStackParser,
    integrations: integrations
  })

  const scope = new Scope()
  scope.setClient(client)
  client.init()

  let tabId: number
  let roomCode: string
  let state: State
  let video: HTMLVideoElement | null | undefined
  let boundVideo: HTMLVideoElement | null = null
  let suppressEventsUntil = 0
  let joinedRoom: string | null = null
  let settings: { syncAudio: boolean } | undefined
  const SYNTHETIC_SUPPRESSION_MS = 150
  const suppressOutboundEvents = () => {
    suppressEventsUntil = Date.now() + SYNTHETIC_SUPPRESSION_MS
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
      scope.captureException(e)
      throw e
    }
    state = savedState

    const settingsResult = await browser.storage.sync.get("settings")
    settings = settingsResult.settings as { syncAudio: boolean } | undefined
    roomCode = state[tabId].roomId
    if (roomCode) {
      if (socket.disconnected) socket.connect()
      return getVideo(videoId)
    }
  }

  const videoEventHandler = (event: Event) => {
    if (roomCode) {
      socket.emit(
        SOCKET_EVENTS.VIDEO_EVENT,
        roomCode,
        event.type,
        video?.volume,
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
    video = videoId
      ? (document.querySelector(
          `[data-synclify-id="${videoId}"]`
        ) as HTMLVideoElement | null)
      : document.querySelector("video")
    if (!videoId) {
      captureMessage(
        "videoId is null, using first element returned by document.querySelector",
        "warning"
      )
    }

    if (video != null) {
      const newState = Object.assign(state ?? {}, {
        [tabId]: {
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
        body: { content: "Video detected" }
      })
      return { status: MESSAGE_STATUS.SUCCESS }
    }
    observer.observe(document, { subtree: true, childList: true })
    browser.runtime.sendMessage({
      action: "showToast",
      body: { error: true, content: "Video not found" }
    })
    captureMessage(`No video found in ${window.location.href}`, "info")
    return {
      status: MESSAGE_STATUS.ERROR,
      message: "Video not found"
    }
  }

  const joinRoom = () => {
    if (!roomCode) {
      const e = new Error("Invalid room code: " + roomCode)
      scope.captureException(e)
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
  })

  socket.on(SOCKET_EVENTS.FULL, (room) => {
    const e = new Error("Room is full: " + room)
    scope.captureException(e)
    throw e
  })

  socket.on("connect_error", () => {
    captureMessage("Socket connection error, allowing polling", "info")
    socket.io.opts.transports = ["polling", "websocket"]
  })

  socket.on(
    SOCKET_EVENTS.VIDEO_EVENT,
    (eventType: VIDEO_EVENTS, volumeValue: string, currentTime: string) => {
      if (video == null) {
        const e = new Error("Video is null in socket video event handler")
        scope.captureException(e)
        throw e
      }
      switch (eventType) {
        case VIDEO_EVENTS.PLAY:
          suppressOutboundEvents()
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
              scope.captureException(e)
            }
          })
          break
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
          const time = Number.parseFloat(currentTime)
          suppressOutboundEvents()
          video.currentTime = time
          break
        }
      }
    }
  )

  browser.runtime.onMessage.addListener((request: ExtMessage) => {
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
      default:
        return
    }
  })
})
