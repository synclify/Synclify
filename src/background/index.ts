import type { RoomsList } from "~utils/rooms"
import { Storage } from "@plasmohq/storage"
import browser from "webextension-polyfill"

const storage = new Storage({ area: "local" })

browser.tabs.onRemoved.addListener((tabId) => {
  storage.get<RoomsList>("rooms").then((r) => {
    delete r[tabId]
    if (r) storage.set("rooms", r)
  })
})

browser.runtime.onInstalled.addListener((details) => {
  if (details.previousVersion !== browser.runtime.getManifest().version) {
    browser.storage.local.clear()
    browser.runtime.reload()
  }
})
