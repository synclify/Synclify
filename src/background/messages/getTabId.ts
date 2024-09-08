import type { PlasmoMessaging } from "@plasmohq/messaging"
import browser from "webextension-polyfill"

const handler: PlasmoMessaging.MessageHandler = async (_req, res) => {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true })
  if (tabs.length === 0) throw new Error("No active tab found")
  res.send(tabs[0].id)
}

export default handler
