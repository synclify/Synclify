import type { State } from "~types/state"
import { Storage } from "@plasmohq/storage"
import browser from "webextension-polyfill"
import * as Sentry from "@sentry/browser"
import { SOCKET_URL } from "~types/socket"

Sentry.init({
  dsn: process.env.PLASMO_PUBLIC_SENTRY_DSN,
  tunnel: `${SOCKET_URL}/t`
})

const storage = new Storage({ area: "local" })

browser.tabs.onRemoved.addListener((tabId) => {
  storage.get<State>("state").then((state) => {
    if (state === undefined)
      throw new Error(
        "State undefined in background worker tab closed callback"
      )
    delete state[tabId]
    storage.set("state", state)
  })
})

browser.runtime.onInstalled.addListener(async (details) => {
  if (details.previousVersion !== browser.runtime.getManifest().version) {
    await storage.clear()
    browser.runtime.reload()
  }
})
