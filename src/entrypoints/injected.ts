import { defineUnlistedScript } from "wxt/utils/define-unlisted-script"
import { MESSAGE_STATUS, MESSAGE_TYPE } from "~/types/messaging"
import type { ExtMessage, ChatMessage } from "~/types/messaging"
import {
  type ControlMode,
  SOCKET_EVENTS,
  SOCKET_URL,
  type JoinRoomPayload,
  type LeaveRoomPayload,
  type RoomErrorPayload,
  type RoomState
} from "~/types/socket"
import type { State, TabState } from "~/types/state"
import { VIDEO_EVENTS } from "~/types/video"
import { findSiteVideo, detectStreamingSite } from "~/lib/video-detection"
import { debugRoomLog } from "~/lib/debug"
import browser from "webextension-polyfill"
import { io } from "socket.io-client"
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
  const TRACKED_MULTI_PARTICIPANT_ROOMS_STORAGE_KEY =
    "tracked_multi_participant_rooms"
  const MAX_TRACKED_MULTI_PARTICIPANT_ROOMS = 200

  function logRoomDebug(
    source: string,
    details?: {
      roomId?: string
      participantId?: string
      participantCount?: number
      participants?: Array<{ id: string; nickname: string; isHost: boolean }>
      extra?: Record<string, unknown>
    }
  ) {
    debugRoomLog("injected", {
      source,
      at: new Date().toISOString(),
      tabId,
      roomId: details?.roomId ?? roomCode,
      participantId: details?.participantId ?? state?.[tabId]?.participantId,
      participantCount: details?.participantCount,
      participants:
        details?.participants?.map((participant) => ({
          id: participant.id,
          nickname: participant.nickname,
          isHost: participant.isHost
        })) ?? state?.[tabId]?.participants,
      extra: details?.extra
    })
  }

  let tabId: number
  let roomCode: string
  let state: State
  let video: HTMLVideoElement | null | undefined
  let boundVideo: HTMLVideoElement | null = null
  let suppressEventsUntil = 0
  let lastAppliedRemoteEventTimestamp = 0
  let joinedRoom: string | null = null
  let activeRoomState: RoomState | null = null
  let pendingJoinPromise:
    | Promise<{ status: MESSAGE_STATUS; message?: string }>
    | null = null
  let pendingInitPromise:
    | Promise<{ status: MESSAGE_STATUS; message?: string; messageKey?: string }>
    | null = null
  let pendingConnectPromise: Promise<void> | null = null
  let connectRequestedByJoin = false
  let isExitingRoom = false
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

  const persistState = (nextState: State) => {
    const nextTabState = nextState?.[tabId]
    logRoomDebug("persistState", {
      roomId: nextTabState?.roomId,
      participantId: nextTabState?.participantId,
      participantCount: nextTabState?.participantCount,
      participants: nextTabState?.participants,
      extra: {
        isHost: nextTabState?.isHost,
        hostId: nextTabState?.hostId
      }
    })
    state = nextState
    return browser.storage.local.set({ state: nextState })
  }

  const readLatestState = async () => {
    const storageResult = await browser.storage.local.get("state")
    return (storageResult.state as State | undefined) ?? state ?? {}
  }

  const updateTabState = async (patch: Partial<TabState>) => {
    const latestState = await readLatestState()
    const nextState = Object.assign({}, latestState, {
      [tabId]: {
        ...latestState?.[tabId],
        ...patch
      }
    })
    return persistState(nextState)
  }

  const clearTabState = async () => {
    const latestState = await readLatestState()
    const nextState = { ...latestState }
    delete nextState[tabId]
    activeRoomState = null
    joinedRoom = null
    roomCode = ""
    return persistState(nextState)
  }

  const trackMultiParticipantRoom = async (nextRoomState: RoomState) => {
    const participantId = state?.[tabId]?.participantId

    if (!participantId || nextRoomState.participantCount <= 2) return

    const trackingKey = `${participantId}:${nextRoomState.roomId}`
    const storageResult = await browser.storage.local.get(
      TRACKED_MULTI_PARTICIPANT_ROOMS_STORAGE_KEY
    )
    const trackedRooms = Array.isArray(
      storageResult[TRACKED_MULTI_PARTICIPANT_ROOMS_STORAGE_KEY]
    )
      ? (storageResult[
          TRACKED_MULTI_PARTICIPANT_ROOMS_STORAGE_KEY
        ] as string[])
      : []

    if (trackedRooms.includes(trackingKey)) return

    posthog.capture("room_more_than_two_participants", {
      roomId: nextRoomState.roomId,
      participantCount: nextRoomState.participantCount,
      controlMode: nextRoomState.controlMode,
      isHost: nextRoomState.hostId === participantId
    })

    await browser.storage.local.set({
      [TRACKED_MULTI_PARTICIPANT_ROOMS_STORAGE_KEY]: [
        ...trackedRooms.slice(-(MAX_TRACKED_MULTI_PARTICIPANT_ROOMS - 1)),
        trackingKey
      ]
    })
  }

  const applyRoomState = async (nextRoomState: RoomState) => {
    const participantId = state?.[tabId]?.participantId
    logRoomDebug("applyRoomState", {
      roomId: nextRoomState.roomId,
      participantId,
      participantCount: nextRoomState.participantCount,
      participants: nextRoomState.participants,
      extra: {
        hostId: nextRoomState.hostId,
        maxParticipants: nextRoomState.maxParticipants
      }
    })
    activeRoomState = nextRoomState
    joinedRoom = nextRoomState.roomId
    await updateTabState({
      roomId: nextRoomState.roomId,
      participantId,
      controlMode: nextRoomState.controlMode,
      nickname: state?.[tabId]?.nickname ?? "Anonymous",
      participants: nextRoomState.participants,
      participantCount: nextRoomState.participantCount,
      hostId: nextRoomState.hostId,
      isHost: nextRoomState.hostId === participantId,
      maxParticipants: nextRoomState.maxParticipants
    })
    await trackMultiParticipantRoom(nextRoomState)
  }

  const ensureParticipantId = async () => {
    const existingParticipantId = state?.[tabId]?.participantId
    if (existingParticipantId) return existingParticipantId

    const participantId = crypto.randomUUID()
    await updateTabState({
      participantId
    })
    return participantId
  }

  const showRoomError = async (message: string) => {
    await browser.runtime.sendMessage({
      action: "showToast",
      body: {
        error: true,
        content: message
      }
    })
  }

  const socket = io(SOCKET_URL, {
    autoConnect: false,
    transports: ["websocket", "polling"]
  })

  const init = async (videoId: string) => {
    if (pendingInitPromise) {
      return pendingInitPromise
    }

    pendingInitPromise = (async () => {
    const tabIdResult = await browser.runtime.sendMessage({
      action: "getTabId"
    })
    tabId = tabIdResult as number
    const storageResult = await browser.storage.local.get("state")
    const savedState = storageResult.state as State | undefined

    state = savedState ?? {}

    const settingsResult = await browser.storage.sync.get("settings")
    settings = settingsResult.settings as { syncAudio: boolean } | undefined
    roomCode = state[tabId]?.roomId
    logRoomDebug("init", {
      roomId: roomCode,
      participantId: state?.[tabId]?.participantId,
      participantCount: state?.[tabId]?.participantCount,
      participants: state?.[tabId]?.participants,
      extra: {
        hasSavedState: !!savedState,
        hasActiveRoomState: !!activeRoomState
      }
    })
    if (!roomCode) {
      return {
        status: MESSAGE_STATUS.ERROR,
        message: "Missing room code."
      }
    }

    await ensureParticipantId()

    const videoResult = getVideo(videoId)
    if (videoResult.status !== MESSAGE_STATUS.SUCCESS) return videoResult

    return joinRoom()
    })()

    try {
      return await pendingInitPromise
    } finally {
      pendingInitPromise = null
    }
  }

  const videoEventHandler = (event: Event) => {
    const controlMode = state?.[tabId]?.controlMode ?? "shared"
    const canControlPlayback =
      controlMode === "shared" || state?.[tabId]?.isHost

    if (roomCode && canControlPlayback) {
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
      updateTabState({
        roomId: roomCode,
        videoFound: true
      }).catch((error) => {
        posthog.captureException(error as Error)
      })
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

  const ensureSocketConnected = async () => {
    if (socket.connected) return
    if (pendingConnectPromise) {
      return pendingConnectPromise
    }

    connectRequestedByJoin = true
    pendingConnectPromise = new Promise<void>((resolve, reject) => {
      const onConnect = () => {
        cleanup()
        resolve()
      }
      const onError = (error: Error) => {
        cleanup()
        reject(error)
      }
      const cleanup = () => {
        socket.off("connect", onConnect)
        socket.off("connect_error", onError)
        pendingConnectPromise = null
        connectRequestedByJoin = false
      }

      socket.on("connect", onConnect)
      socket.on("connect_error", onError)
      socket.connect()
    })

    return pendingConnectPromise
  }

  const joinRoom = async () => {
    if (pendingJoinPromise) {
      return pendingJoinPromise
    }
    if (!roomCode) {
      const e = new Error("Invalid room code: " + roomCode)
      posthog.captureException(e)
      throw e
    }
    await ensureSocketConnected()

    if (joinedRoom === roomCode && activeRoomState) {
      return { status: MESSAGE_STATUS.SUCCESS }
    }

    const nickname = state?.[tabId]?.nickname || "Anonymous"
    const participantId = await ensureParticipantId()
    const controlMode: ControlMode = state?.[tabId]?.controlMode ?? "shared"
    const payload: JoinRoomPayload = {
      roomId: roomCode,
      nickname,
      participantId,
      controlMode
    }
    logRoomDebug("joinRoom.emit", {
      roomId: roomCode,
      participantId,
      participantCount: state?.[tabId]?.participantCount,
      participants: state?.[tabId]?.participants,
      extra: {
        nickname,
        controlMode,
        socketConnected: socket.connected
      }
    })

    pendingJoinPromise = new Promise<{ status: MESSAGE_STATUS; message?: string }>(
      (resolve) => {
        const onJoined = async (nextRoomState: RoomState) => {
          if (nextRoomState.roomId !== roomCode) return
          logRoomDebug("roomJoined", {
            roomId: nextRoomState.roomId,
            participantId,
            participantCount: nextRoomState.participantCount,
            participants: nextRoomState.participants,
            extra: {
              hostId: nextRoomState.hostId
            }
          })
          cleanup()
          await applyRoomState(nextRoomState)
          resolve({ status: MESSAGE_STATUS.SUCCESS })
        }

        const onError = async (error: RoomErrorPayload) => {
          if (error.roomId && error.roomId !== roomCode) return
          cleanup()
          await clearTabState()
          await showRoomError(error.message)
          resolve({
            status: MESSAGE_STATUS.ERROR,
            message: error.message
          })
        }

        const cleanup = () => {
          socket.off(SOCKET_EVENTS.ROOM_JOINED, onJoined)
          socket.off(SOCKET_EVENTS.ROOM_ERROR, onError)
          pendingJoinPromise = null
        }

        socket.on(SOCKET_EVENTS.ROOM_JOINED, onJoined)
        socket.on(SOCKET_EVENTS.ROOM_ERROR, onError)
        socket.emit(SOCKET_EVENTS.JOIN, payload)
      }
    )
    return pendingJoinPromise
  }

  socket.on("disconnect", () => {
    logRoomDebug("disconnect", {
      extra: {
        isExitingRoom
      }
    })
    joinedRoom = null
    activeRoomState = null
    if (isExitingRoom) {
      isExitingRoom = false
      return
    }
    if (state?.[tabId]) {
      updateTabState({
        isHost: false
      }).catch(() => {})
    }
  })

  socket.on("connect", () => {
    logRoomDebug("connect", {
      extra: {
        connectRequestedByJoin,
        joinedRoom,
        hasActiveRoomState: !!activeRoomState
      }
    })
    // Measure latency on connect and periodically
    measureLatency()
    const latencyInterval = setInterval(() => {
      if (socket.connected) measureLatency()
      else clearInterval(latencyInterval)
    }, 30000)

    if (
      roomCode &&
      joinedRoom !== roomCode &&
      !pendingJoinPromise &&
      !connectRequestedByJoin
    ) {
      joinRoom().catch((error) => {
        posthog.captureException(error as Error)
      })
    }
  })

  socket.on(SOCKET_EVENTS.FULL, (room) => {
    const e = new Error("Room is full: " + room)
    posthog.captureException(e)
  })

  socket.on(SOCKET_EVENTS.ROOM_UPDATED, (nextRoomState: RoomState) => {
    if (nextRoomState.roomId !== roomCode) return
    logRoomDebug("roomUpdated", {
      roomId: nextRoomState.roomId,
      participantId: state?.[tabId]?.participantId,
      participantCount: nextRoomState.participantCount,
      participants: nextRoomState.participants,
      extra: {
        hostId: nextRoomState.hostId
      }
    })
    applyRoomState(nextRoomState).catch((error) => {
      posthog.captureException(error as Error)
    })
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
          isExitingRoom = true
          for (const event of Object.values(VIDEO_EVENTS)) {
            boundVideo?.removeEventListener(event, checkVideoEvent)
          }
          if (socket.connected && roomCode && state?.[tabId]?.participantId) {
            const leavePayload: LeaveRoomPayload = {
              roomId: roomCode,
              participantId: state[tabId].participantId as string
            }
            socket.emit(SOCKET_EVENTS.LEAVE, leavePayload)
          }
          clearTabState().catch(() => {})
          socket.disconnect()
          roomCode = ""
          joinedRoom = null
          activeRoomState = null
          pendingJoinPromise = null
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
