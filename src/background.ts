import { Storage } from "@plasmohq/storage"
import { createChromeHandler } from "trpc-chrome/adapter"
import { deleteRoom } from "~utils/rooms"
import { initTRPC } from "@trpc/server"

const storage = new Storage({ area: "local" })

const t = initTRPC.create({
  isServer: false,
  allowOutsideOfServer: true
})

const appRouter = t.router({
  getTabId: t.procedure.query(async () => {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
    return tabs[0].id
  })
})

export type AppRouter = typeof appRouter
console.log("loaded")
createChromeHandler({ router: appRouter /* 👈 */ })

chrome.tabs.onRemoved.addListener((tabId) => {
  storage.get("rooms").then((r) => {
    storage.set("rooms", deleteRoom(r, tabId))
  })
})
