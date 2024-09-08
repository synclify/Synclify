import { type PlasmoMessaging } from "@plasmohq/messaging"
import browser from "webextension-polyfill"
import cs from "url:/src/content-script"
import { MESSAGE_STATUS, MESSAGE_TYPE } from "~types/messaging"

interface Video {
  src: string
  duration: number
  width: number
  height: number
  title: string
  id: string
}

export type RequestBody =
  | {
      frameIds: number[]
      videoId: string
    }
  | undefined

/**
 * Injects main logic into the given frameIds argument otherwise get frameIds with a content script
 */

const handler: PlasmoMessaging.MessageHandler<RequestBody> = async (
  req,
  res
) => {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true })
  const tabId = tabs[0].id
  console.warn(req.body)

  let frameIds = req.body ? req.body.frameIds : null
  let videoId = null
  if (!tabId) throw new Error("Tab id is undefined")

  if (!frameIds) {
    // get a list of videos from all frames in page
    const result = await browser.scripting.executeScript({
      func: () => {
        const videos = document.getElementsByTagName("video")

        return Array.from(videos).map((video) => {
          // skip empty videos
          if (video.src === "" && video.children.length === 0) return
          // assign id to videos
          if (
            video.dataset.synclifyId === "" ||
            video.dataset.synclifyId === undefined
          )
            video.dataset.synclifyId = Math.random().toString(36).slice(2, 7)
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
            id: video.dataset.synclifyId
          }
        })
      },
      target: { tabId: tabId, allFrames: true }
    })
    // filter out empty results and assign frameIds to each video
    const videos = result
      .filter((injection) => injection.result && injection.result.length != 0)
      .flatMap((injection) =>
        Array.from(injection.result as Video[])
          .filter((video) => video != null)
          .map((video) => {
            return {
              ...video,
              frameId: injection.frameId
            }
          })
      )

    // display video selector if multiple videos are found in page
    if (videos.length > 1) {
      browser.tabs.sendMessage(tabId, {
        to: "videoSelector",
        videos: videos
      })
      res.send({
        status: MESSAGE_STATUS.MULTIPLE_VIDEOS,
        message: "Multiple videos detected"
      })
      return
    } else if (videos.length === 1) {
      frameIds = [videos[0].frameId]
      videoId = videos[0].id
    } else {
      res.send(null)
      return
    }
  }

  const url = new URL(cs).pathname.split("/")
  const filename = url.pop() || (url.pop() as string)

  // inject main logic only in desired frames
  await browser.scripting.executeScript({
    files: [filename],
    target: { tabId: tabId, frameIds: frameIds }
  })

  browser.tabs.sendMessage(tabId, {
    type: MESSAGE_TYPE.INIT,
    videoId: req.body ? req.body.videoId : videoId
  })

  res.send({ status: MESSAGE_STATUS.SUCCESS })
  return
}

export default handler
