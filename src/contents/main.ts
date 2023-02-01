import { ChromeLinkOptions, chromeLink } from "trpc-chrome/link"
import { ExtMessage, MESSAGE_STATUS, MESSAGE_TYPE } from "~types/messaging"
import { SOCKET_EVENTS, SOCKET_URL } from "~types/socket"

import type { AppRouter } from "../background"
import type { PlasmoContentScript } from "plasmo"
import type { RoomsList } from "~utils/rooms"
import { Storage } from "@plasmohq/storage"
import { VIDEO_EVENTS } from "~types/video"
import browser from "webextension-polyfill"
import { createTRPCProxyClient } from "@trpc/client"
import debounce from "lodash.debounce"
import { io } from "socket.io-client"

export const config: PlasmoContentScript = {
  matches: ["<all_urls>"],
  // eslint-disable-next-line camelcase
  all_frames: true
}

const checkVideosInPage = () => {
  return document.getElementsByTagName("video").length > 0
}
let hasVideos = checkVideosInPage()

const bootstrap = () => {
  let tabId: number
  let roomCode: string | undefined
  let video: HTMLVideoElement

  const storage = new Storage({ area: "local" })
  const socket = io(SOCKET_URL, {
    autoConnect: false,
    transports: ["websocket", "polling"]
  })
  const port = browser.runtime.connect(browser.runtime.id)

  const chromeClient = createTRPCProxyClient<AppRouter>({
    links: [chromeLink({ port } as ChromeLinkOptions)]
  })

  const init = async () => {
    tabId = await chromeClient.getTabId.query()
    const rooms = await storage.get<RoomsList>("rooms")
    roomCode = rooms?.[tabId]
    if (roomCode) {
      if (socket.disconnected) socket.connect()
      return getVideo()
    }
  }
  console.log("Synclify: loaded")

  init()

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
    hasVideos = checkVideosInPage()
    if (!video) getVideo()
  })

  const getVideo = () => {
    const videos = document.getElementsByTagName("video")
    // TODO: Handle multiple videos
    video = videos[0]
    if (video) {
      Object.values(VIDEO_EVENTS).forEach((event) =>
        video.addEventListener(
          event,
          debounce(videoEventHandler, 500, { leading: true, trailing: false })
        )
      )
      observer.disconnect()
      chromeClient.showToast.query({
        content: "Video detected"
      })
      return { status: MESSAGE_STATUS.SUCCESS }
    }
    observer.observe(document, { subtree: true, childList: true })
    chromeClient.showToast.query({
      error: true,
      content: "Video not found"
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
        return init().then((res) => {
          return res
        })
      }
      case MESSAGE_TYPE.EXIT:
        // TODO: Remove event listeners
        socket.disconnect()
        return Promise.resolve({
          status: MESSAGE_STATUS.SUCCESS
        })
      case MESSAGE_TYPE.CHECK_VIDEO:
        if (video) {
          return Promise.resolve({
            status: MESSAGE_STATUS.SUCCESS
          })
        }
        chromeClient.showToast.query({
          error: true,
          content: "Video not found"
        })
        return Promise.resolve({
          status: MESSAGE_STATUS.ERROR,
          message: "Video not found"
        })
      default:
        return
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

if (hasVideos) {
  bootstrap()
} else {
  const observer = new MutationObserver(() => {
    hasVideos = checkVideosInPage()
    if (hasVideos) {
      observer.disconnect()
      bootstrap()
    }
  })
  observer.observe(document, { subtree: true, childList: true })
}
