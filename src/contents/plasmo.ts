import { Storage } from "@plasmohq/storage"
import { io } from "socket.io-client"

// TODO: create socket events and storage states types

const storage = new Storage({ area: "session" })

const socket = io(
  process.env.NODE_ENV === "development"
    ? "http://localhost:3000"
    : "socket-andreademasi.koyeb.app"
)

console.log("loaded")

let room: string

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
  console.log.apply(console, array)
})

socket.onAny((eventName, ...args) => {
  console.log("Event: ", eventName, ...args)
})

socket.on("message", (message) => {
  console.log("New message: " + message)
  let element = getElementByXPath(message)
  console.log("element is: ", element)
  element.click()
})

document.addEventListener("click", (ev) => {
  if (ev.isTrusted && room) {
    console.log(ev.target)
    let t = ev.target
    let path = getXPathForElement(t as HTMLElement)
    console.log(path)
    console.log(t === getElementByXPath(path))
    socket.emit("message", room, path)
  }
})

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

export {}
