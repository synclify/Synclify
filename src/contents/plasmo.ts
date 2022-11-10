import { Storage } from "@plasmohq/storage"
import { io } from "socket.io-client"

export {}

// TODO: create socket events and storage states types

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
      socket.emit("join", room)
    }
  }
})

socket.on("full", (room) => {
  // TODO: Handle full room
  console.log("Room " + room + " is full")
})

socket.on("join", (room) => {
  console.log("Making request to join room " + room)
})

socket.on("log", (array) => {
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
    // TODO: move allowed events in separate ts type
    ;["seeked", "play", "pause", "volumechange"].forEach((event) =>
      video.addEventListener(event, (e) => videoEventHandler(e))
    )

    document.removeEventListener("click", handleVideoDetect)
  }
}

const videoEventHandler = (event: Event) => {
  console.log(event)
  // consider throttle function if volumechange events impact performances
  socket.emit("videoEvent", room, event.type, video.volume, video.currentTime)
}

socket.on(
  "videoEvent",
  (eventType: string, volumeValue: string, currentTime: string) => {
    switch (eventType) {
      case "play":
        console.log("playing")
        video.play()
        break
      case "pause":
        video.pause()
        break
      case "volumechange":
        video.volume = Number.parseInt(volumeValue)
        break
      case "seeked":
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
