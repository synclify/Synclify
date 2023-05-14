import type { State } from "~types/state.type"
import { Storage } from "@plasmohq/storage"
import browser from "webextension-polyfill"

const storage = new Storage({ area: "local" })

browser.tabs.onRemoved.addListener((tabId) => {
  storage.get<State>("state").then((state) => {
    delete state[tabId]
    if (state) storage.set("state", state)
  })
})

browser.runtime.onInstalled.addListener(async (details) => {
  if (details.previousVersion !== browser.runtime.getManifest().version) {
    await storage.clear()
    browser.runtime.reload()
  }
})
