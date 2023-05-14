import { type ExtMessage, MESSAGE_STATUS, MESSAGE_TYPE } from "~types/messaging"
import { SOCKET_EVENTS, SOCKET_URL } from "~types/socket"

import type { State } from "~types/state"
import { Storage } from "@plasmohq/storage"
import { VIDEO_EVENTS } from "~types/video"
import browser from "webextension-polyfill"
import debounce from "lodash.debounce"
import { hasVideos, setState } from "~utils"
import { io } from "socket.io-client"
import { sendToBackground } from "@plasmohq/messaging"

const bootstrap = () => {
  let tabId: number
  let roomCode: string
  let state: State
  let video: HTMLVideoElement | null

  const storage = new Storage({ area: "local", allCopied: true })
  const socket = io(SOCKET_URL, {
    autoConnect: false,
    transports: ["websocket", "polling"]
  })

  const init = async (videoId: string) => {
    tabId = await sendToBackground({ name: "getTabId" })
    state = await storage.get<State>("state")
    roomCode = state?.[tabId].roomId
    if (roomCode) {
      if (socket.disconnected) socket.connect()
      return getVideo(videoId)
    }
  }
  console.log("Synclify: loaded")

  // init()

  const videoEventHandler = (event: Event) => {
    if (roomCode) {
      socket.emit(
        SOCKET_EVENTS.VIDEO_EVENT,
        roomCode,
        event.type,
        video.volume,
        video.currentTime
      )
    }
  }

  const observer = new MutationObserver(() => {
    if (!video) getVideo()
  })

  const getVideo = (videoId?: string) => {
    video = videoId
      ? (document.getElementById(videoId) as HTMLVideoElement)
      : document.getElementsByTagName("video")[0]

    if (video) {
      storage.set("state", setState(tabId, roomCode, state, true))
      Object.values(VIDEO_EVENTS).forEach((event) =>
        video?.addEventListener(
          event,
          debounce(videoEventHandler, 500, { leading: true, trailing: false })
        )
      )
      observer.disconnect()
      sendToBackground({
        name: "showToast",
        body: { content: "Video detected" }
      })
      return { status: MESSAGE_STATUS.SUCCESS }
    }
    observer.observe(document, { subtree: true, childList: true })
    sendToBackground({
      name: "showToast",
      body: { error: true, content: "Video not found" }
    })

    return {
      status: MESSAGE_STATUS.ERROR,
      message: "Video not found"
    }
  }

  const joinRoom = () => {
    socket.emit(SOCKET_EVENTS.JOIN, roomCode)
  }

  socket.on("reconnect", () => {
    if (roomCode) joinRoom()
  })

  socket.on("connect", () => {
    if (roomCode) joinRoom()
  })

  socket.on(SOCKET_EVENTS.FULL, (room) => {
    // TODO: Handle full room
  })

  socket.on("connect_error", () => {
    // revert to classic upgrade
    socket.io.opts.transports = ["polling", "websocket"]
  })

  browser.runtime.onMessage.addListener((request: ExtMessage) => {
    switch (request.type) {
      case MESSAGE_TYPE.INIT: {
        return init(request.videoId).then((res) => {
          return res
        })
      }
      case MESSAGE_TYPE.EXIT:
        // TODO: Remove event listeners
        socket.disconnect()
        video = null
        return Promise.resolve({
          status: MESSAGE_STATUS.SUCCESS
        })
      default:
        return
    }
  })

  socket.on(
    SOCKET_EVENTS.VIDEO_EVENT,
    (eventType: VIDEO_EVENTS, volumeValue: string, currentTime: string) => {
      switch (eventType) {
        case VIDEO_EVENTS.PLAY:
          video.play()
          break
        case VIDEO_EVENTS.PAUSE:
          video.pause()
          break
        case VIDEO_EVENTS.VOLUMECHANGE:
          video.volume = Number.parseFloat(volumeValue)
          break
        case VIDEO_EVENTS.SEEKED: {
          const time = Number.parseInt(currentTime)
          video.currentTime = time
          break
        }
      }
    }
  )
}

declare global {
  interface Window {
    synclify: boolean
  }
}

// check to avoid double loading
if (window.synclify !== true) {
  window.synclify = true

  if (hasVideos()) bootstrap()
}
