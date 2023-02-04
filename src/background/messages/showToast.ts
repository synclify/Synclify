import type { PlasmoMessaging } from "@plasmohq/messaging"
import browser from "webextension-polyfill"

const handler: PlasmoMessaging.MessageHandler = async (req, _res) => {
  const id = (
    await browser.tabs.query({ active: true, currentWindow: true })
  )[0].id as number
  browser.tabs.sendMessage(id, {
    to: "toast",
    error: req.body.error,
    content: req.body.content,
    show: req.body.show ?? true
  })
  console.log("Received message")
  _res.send(null)
}

export default handler
