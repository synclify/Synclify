import type { RoomsList } from "~utils/rooms"
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
        error: z.boolean().optional(),
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
        error: input.error,
        content: input.content,
        show: input.show
      })
    })
})

createChromeHandler({ router: appRouter })

browser.tabs.onRemoved.addListener((tabId) => {
  storage.get<RoomsList>("rooms").then((r) => {
    delete r[tabId]
    if (r) storage.set("rooms", r)
  })
})

export type AppRouter = typeof appRouter
