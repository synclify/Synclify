import { SOCKET_EVENTS } from "~types/socket"
import { Storage } from "@plasmohq/storage"
import { VIDEO_EVENTS } from "~types/video"
import { io } from "socket.io-client"
import { parseRooms } from "~utils/rooms"

console.log("loaded")

let room
let video: HTMLVideoElement
const storage = new Storage({ area: "local" })
const socket = io(
  process.env.NODE_ENV === "development"
    ? "http://localhost:3000"
    : process.env.PLASMO_PUBLIC_SOCKET_ENDPOINT
)

const getCookie = (cookie: string) => {
  // https://stackoverflow.com/a/19971550/934239
  return document.cookie.split(";").reduce(function (prev, c) {
    const arr = c.split("=")
    return arr[0].trim() === cookie ? arr[1] : prev
  }, undefined)
}

const tabId = getCookie("tab_id")
console.log(tabId)

storage.get("rooms").then((r) => {
  console.log("getting rooms: ", r)

  if (r) {
    const rooms = parseRooms(r)
    console.log(rooms)
    if (rooms[tabId]) {
      room = rooms[tabId]
      console.log("Joining room ", room)
      socket.emit(SOCKET_EVENTS.JOIN, room)
    }
  }
})

storage.watch({
  rooms: (r) => {
    const rooms = parseRooms(r.newValue)
    console.log(rooms)
    room = rooms[tabId]
    if (rooms[tabId]) {
      room = rooms[tabId]
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
  console.log("request: ", request)
  if (request.message === "detectVideo") {
    const videos = document.getElementsByTagName("video")
    if (videos.length === 0)
      sendResponse({ status: "error", message: "No videos found" })
    else {
      video = videos[0]
      Object.values(VIDEO_EVENTS).forEach((event) =>
        video.addEventListener(event, (e) => videoEventHandler(e))
      )
      sendResponse({ status: "success", message: "ok" })
    }
  }
  return true
})

const handleVideoDetectManually = (ev) => {
  video = ev.target.closest("video") as HTMLVideoElement
  console.log(video)
  if (video != null) {
    document.removeEventListener("click", handleVideoDetectManually)
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
    const time = Number.parseInt(currentTime)
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
        // this check avoids entering in a loop between the two clients, a better solution could be found
        if (Math.abs(video.currentTime - time) > 1 && !video.seeking)
          video.currentTime = time
    }
  }
)

export {}