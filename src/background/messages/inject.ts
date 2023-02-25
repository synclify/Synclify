import type { PlasmoMessaging } from "@plasmohq/messaging"
import browser from "webextension-polyfill"
import cs from "url:/src/content-script"

const handler: PlasmoMessaging.MessageHandler = async (_req, res) => {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true })
  const tabId = tabs[0].id
  // TODO: send error if tabId is undefined
  if (tabId) {
    // get frames that contain a video
    const result = await browser.scripting.executeScript({
      func: () => {
        return document.getElementsByTagName("video").length > 0
      },
      target: { tabId: tabId, allFrames: true }
    })

    const url = new URL(cs).pathname.split("/")
    const filename = url.pop() || (url.pop() as string)

    const frameIds = result
      .filter((injection) => injection.result)
      .map((injection) => injection.frameId)

    console.log(frameIds)
    // inject content script only in frames that have video
    await browser.scripting.executeScript({
      files: [filename],
      target: { tabId: tabId, frameIds: frameIds }
    })
  }
  res.send(null)
}

export default handler
