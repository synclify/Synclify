import { sendToBackground, type PlasmoMessaging } from "@plasmohq/messaging"
import browser from "webextension-polyfill"
import cs from "url:/src/content-script"
import { MESSAGE_STATUS, MESSAGE_TYPE } from "~types/messaging"

interface Video {
  src: string
  duration: number
  width: number
  height: number
  title: string
}

const handler: PlasmoMessaging.MessageHandler = async (req, res) => {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true })
  const tabId = tabs[0].id
  let frameIds: number[] = req.body ? req.body.frameIds : null
  if (!tabId) throw new Error("Tab id is undefined")

  if (!frameIds) {
    // get frames that contain a video
    const result = await browser.scripting.executeScript({
      func: () => {
        const videos = document.getElementsByTagName("video")

        return Array.from(videos).map((video) => {
          if (video.id === "") video.id = Math.random().toString(36).slice(2, 7)
          return {
            src:
              video.src === ""
                ? (
                    Array.from(video.children).find(
                      (child) => child.tagName === "SOURCE"
                    ) as HTMLSourceElement
                  ).src
                : video.src,
            duration: video.duration,
            width: video.videoWidth,
            height: video.videoHeight,
            title: document.title,
            id: video.id
          }
        })
      },
      target: { tabId: tabId, allFrames: true }
    })
    console.log(result)
    const videos = result.flatMap((injection) =>
      Array.from(injection.result as Video[]).map((video) => {
        return {
          ...video,
          frameId: injection.frameId
        }
      })
    )

    console.log(videos)

    if (videos.length > 1) {
      browser.tabs.sendMessage(tabId, {
        to: "videoSelector",
        videos: videos
      })
      res.send(MESSAGE_STATUS.SUCCESS)
      return
    } else if (videos.length === 0) {
      frameIds = [videos[0].frameId]
    } else {
      res.send(null)
      return
    }
  }
  const url = new URL(cs).pathname.split("/")
  const filename = url.pop() || (url.pop() as string)

  // inject content script only in frames that have video
  await browser.scripting.executeScript({
    files: [filename],
    target: { tabId: tabId, frameIds: frameIds }
  })

  browser.tabs.sendMessage(tabId, {
    type: MESSAGE_TYPE.INIT,
    videoId: req.body.videoId
  })

  res.send(MESSAGE_STATUS.SUCCESS)
  return
}

export default handler
