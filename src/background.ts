import { deleteRoom, isInRoom, updateTab } from "~utils/rooms"

import { SOCKET_URL } from "~types/socket"
import { Storage } from "@plasmohq/storage"
import browser from "webextension-polyfill"
import { createChromeHandler } from "trpc-chrome/adapter"
import { initTRPC } from "@trpc/server"
import { z } from "zod"

const storage = new Storage({ area: "local" })

const t = initTRPC.create({
  isServer: false,
  allowOutsideOfServer: true
})

const appRouter = t.router({
  getTabId: t.procedure.query(async () => {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true })
    return tabs[0].id as number
  }),
  createRoom: t.procedure.query(async () => {
    const res = await fetch(`${SOCKET_URL}/create`)
    const code = await res.text()
    return code
  }),
  showToast: t.procedure
    .input(
      z.object({
        type: z.enum(["error", "success"]),
        content: z.string(),
        show: z.boolean()
      })
    )
    .query(async ({ input }) => {
      const id = (
        await browser.tabs.query({ active: true, currentWindow: true })
      )[0].id as number
      browser.tabs.sendMessage(id, {
        to: "toast",
        type: input.type,
        content: input.content,
        show: input.show
      })
    })
})

createChromeHandler({ router: appRouter })

browser.tabs.onRemoved.addListener((tabId) => {
  storage.get("rooms").then((r) => {
    if (r) storage.set("rooms", deleteRoom(r, tabId))
  })
})

const iframeCallback = (
  details: browser.WebRequest.OnSendHeadersDetailsType
) => {
  browser.tabs.query({ active: true, currentWindow: true }).then((tab) =>
    storage.get("rooms").then((r) => {
      if (tab[0].id && isInRoom(r, tab[0].id)) {
        browser.tabs
          .create({ url: details.url, openerTabId: tab[0].id })
          .then((newTab) => {
            if (r && newTab.openerTabId && newTab.id)
              storage.set("rooms", updateTab(newTab.openerTabId, newTab.id, r))
          })
        browser.webRequest.onSendHeaders.removeListener(iframeCallback)
      }
    })
  )
}

browser.webRequest.onSendHeaders.addListener(iframeCallback, {
  urls: ["<all_urls>"],
  types: ["sub_frame"]
})

export type AppRouter = typeof appRouter
