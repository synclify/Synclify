import type { PlasmoMessaging } from "@plasmohq/messaging"
import browser from "webextension-polyfill"

const handler: PlasmoMessaging.MessageHandler = async (_req, res) => {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true })
  res.send(tabs[0].id)
}

export default handler
