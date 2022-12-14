import { ChromeLinkOptions, chromeLink } from "trpc-chrome/link"
import { ExtMessage, MESSAGE_STATUS, MESSAGE_TYPE } from "~types/messaging"
import { SOCKET_EVENTS, SOCKET_URL } from "~types/socket"

import type { AppRouter } from "../background"
import PlasmoOverlay from "./toast"
import type { PlasmoRender } from "plasmo"
import { Storage } from "@plasmohq/storage"
import { VIDEO_EVENTS } from "~types/video"
import browser from "webextension-polyfill"
import { createRoot } from "react-dom/client"
import { createTRPCProxyClient } from "@trpc/client"
import { io } from "socket.io-client"
import { parseRooms } from "~utils/rooms"

const port = browser.runtime.connect(browser.runtime.id)

const chromeClient = createTRPCProxyClient<AppRouter>({
  links: [chromeLink({ port } as ChromeLinkOptions)]
})

let tabId: number
let roomCode: string | undefined
let video: HTMLVideoElement
const storage = new Storage({ area: "local" })
const socket = io(SOCKET_URL, {
  autoConnect: false,
  transports: ["websocket", "polling"]
})

export const init = async () => {
  tabId = await chromeClient.getTabId.query()
  const rooms: string | undefined = await storage.get("rooms")
  const r = parseRooms(rooms)
  roomCode = r?.[tabId]
  if (roomCode) {
    if (socket.disconnected) {
      socket.connect()
    }
    console.log("rendering")
    chromeClient.showToast.query({
      show: true,
      type: "success",
      content: "test"
    })

    return getVideo()
  }
}
console.log("loaded")

init()

const videoEventHandler = (event: Event) => {
  if (roomCode) {
    // consider throttle function if volumechange events impact performances
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

const getVideo = () => {
  const videos = document.getElementsByTagName("video")
  // TODO: Handle multiple videos
  video = videos[0]
  if (video) {
    Object.values(VIDEO_EVENTS).forEach((event) =>
      video.addEventListener(event, (e) => videoEventHandler(e))
    )
    observer.disconnect()
    return { status: MESSAGE_STATUS.SUCCESS }
  }
  const iframes = document.getElementsByTagName("iframe")
  if (iframes.length !== 0)
    return {
      status: MESSAGE_STATUS.ERROR,
      message: "Embedded video found, reload the page and press play"
    }
  observer.observe(document, { subtree: true, childList: true })
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
  // Promises used only to to adhere to the type of addListener
  switch (request.type) {
    case MESSAGE_TYPE.INIT:
      return Promise.resolve(init())
    case MESSAGE_TYPE.EXIT:
      // TODO: Remove event listeners
      socket.disconnect()
      return Promise.resolve({
        status: MESSAGE_STATUS.SUCCESS
      })
    case MESSAGE_TYPE.CHECK_VIDEO:
      if (video)
        return Promise.resolve({
          status: MESSAGE_STATUS.SUCCESS
        })
      return Promise.resolve({
        status: MESSAGE_STATUS.ERROR,
        message: "Video not found"
      })
    case MESSAGE_TYPE.DETECT_VIDEO: {
      const videos = document.getElementsByTagName("video")
      if (videos.length === 0)
        return Promise.resolve({
          status: MESSAGE_STATUS.ERROR,
          message: "No videos found"
        })
      video = videos[0]
      Object.values(VIDEO_EVENTS).forEach((event) =>
        video.addEventListener(event, (e) => videoEventHandler(e))
      )
      return Promise.resolve({
        status: MESSAGE_STATUS.SUCCESS
      })
    }
    default:
      return Promise.resolve({
        status: MESSAGE_STATUS.ERROR,
        message: `Unhandled request ${request}`
      })
  }
})

// To be used when automatic detection doesn't work
/*
const handleVideoDetectManually = (ev: Event) => {
  const target = ev.target as Element
  video = target.closest("video") as HTMLVideoElement
  if (video != null) {
    document.removeEventListener("click", handleVideoDetectManually)
  }
}
*/

socket.on(
  SOCKET_EVENTS.VIDEO_EVENT,
  (eventType: VIDEO_EVENTS, volumeValue: string, currentTime: string) => {
    const time = Number.parseInt(currentTime)
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
      case VIDEO_EVENTS.SEEKED:
        // this check avoids entering in a loop between the two clients, a better solution could be found
        if (Math.abs(video.currentTime - time) > 1 && !video.seeking)
          video.currentTime = time
    }
  }
)
