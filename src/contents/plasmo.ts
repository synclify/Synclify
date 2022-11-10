import { SOCKET_EVENTS } from "~types/socket"
import { Storage } from "@plasmohq/storage"
import { VIDEO_EVENTS } from "~types/video"
import { io } from "socket.io-client"

export {}

const storage = new Storage({ area: "session" })

const socket = io(
  process.env.NODE_ENV === "development"
    ? "http://localhost:3000"
    : process.env.PLASMO_PUBLIC_SOCKET_ENDPOINT
)

console.log("loaded")

let room: string
let video: HTMLVideoElement

storage.watch({
  room: (r) => {
    room = r.newValue
    if (room) {
      console.log("Joining room ", room)
      socket.emit(SOCKET_EVENTS.JOIN, room)
    }
  }
})

socket.on(SOCKET_EVENTS.FULL, (room) => {
  // TODO: Handle full room
  console.log("Room " + room + " is full")
})

socket.on(SOCKET_EVENTS.JOIN, (room) => {
  console.log("Making request to join room " + room)
})

socket.on(SOCKET_EVENTS.LOG, (array) => {
  console.log(...array)
})

chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
  console.log(
    sender.tab
      ? "from a content script:" + sender.tab.url
      : "from the extension"
  )
  console.log("request: ", request)
  if (request.message === "detectVideo") {
    document.addEventListener("click", handleVideoDetect)
    sendResponse({ message: "ok" })
    return true
  }
  sendResponse({ message: "bad" })
  return true
})

const handleVideoDetect = (ev) => {
  video = ev.target.closest("video") as HTMLVideoElement
  console.log(video)
  if (video != null) {
    Object.values(VIDEO_EVENTS).forEach((event) =>
      video.addEventListener(event, (e) => videoEventHandler(e))
    )

    document.removeEventListener("click", handleVideoDetect)
  }
}

const videoEventHandler = (event: Event) => {
  console.log(event)
  // consider throttle function if volumechange events impact performances
  socket.emit(
    SOCKET_EVENTS.VIDEO_EVENT,
    room,
    event.type,
    video.volume,
    video.currentTime
  )
}

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
        video.volume = Number.parseInt(volumeValue)
        break
      case VIDEO_EVENTS.SEEKED:
        video.currentTime = Number.parseInt(currentTime)
    }
  }
)

/*

function getXPathForElement(element: HTMLElement): string {
  const idx = (
    sib: { previousElementSibling; localName: any },
    name?: undefined
  ) =>
    sib
      ? idx(sib.previousElementSibling, name || sib.localName) +
        (sib.localName == name)
      : 1
  const segs = (elm) =>
    !elm || elm.nodeType !== 1
      ? [""]
      : elm.id && document.getElementById(elm.id) === elm
      ? [`id("${elm.id}")`]
      : [...segs(elm.parentNode), `${elm.localName.toLowerCase()}[${idx(elm)}]`]
  return segs(element).join("/")
}

function getElementByXPath(path: string) {
  return new XPathEvaluator().evaluate(
    path,
    document.documentElement,
    null,
    XPathResult.FIRST_ORDERED_NODE_TYPE,
    null
  ).singleNodeValue as HTMLElement
}
*/
