import { createChromeHandler } from "trpc-chrome/adapter"
import { initTRPC } from "@trpc/server"

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
