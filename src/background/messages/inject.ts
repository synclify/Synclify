import type { PlasmoMessaging } from "@plasmohq/messaging"
import browser from "webextension-polyfill"
import cs from "url:/src/content-script"

const handler: PlasmoMessaging.MessageHandler = async (_req, res) => {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true })
  const tabId = tabs[0].id

  const url = new URL(cs).pathname.split("/")
  const filename = url.pop() || url.pop()
  browser.scripting.executeScript({
    files: [filename],
    target: { tabId: tabId, allFrames: true }
  })

  res.send(null)
}

export default handler
