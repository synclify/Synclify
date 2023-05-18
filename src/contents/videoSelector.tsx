import { useEffect, useState } from "react"

import type { PlasmoGetStyle } from "plasmo"
import browser from "webextension-polyfill"
import icon from "data-base64:~assets/icon.png"
import { sendToBackground } from "@plasmohq/messaging"
import styleText from "data-text:../style.css"

export const getStyle: PlasmoGetStyle = () => {
  const style = document.createElement("style")
  style.textContent = styleText
  return style
}

type videoElement = {
  title: string
  duration: number
  src: string
  width: number
  height: number
  frameId: number
  id: string
}

const VideoSelector = () => {
  const [show, setShow] = useState(false)
  const [videos, setVideos] = useState<videoElement[]>()

  useEffect(() => {
    const callback = (
      msg: {
        to: string
        videos: videoElement[]
      },
      _sender,
      sendResponse
    ) => {
      if (msg.to === "videoSelector") {
        setShow(true)
        setVideos(msg.videos)
        sendResponse(null)
        return true
      }
    }
    browser.runtime.onMessage.addListener(callback)

    return () => {
      browser.runtime.onMessage.removeListener(callback)
    }
  }, [])

  return (
    <div
      className={`fixed right-0 flex  flex-col overflow-y-auto rounded-l-2xl border-y border-l bg-opacity-20 bg-gradient-to-br from-orange-400 to-violet-900 p-3  backdrop-blur-xl transition duration-300 ${
        show ? "translate-x-0 opacity-100" : "translate-x-full opacity-0"
      } `}>
      <div className="flex">
        <h1 className="text-xl font-bold">Choose a video to sync</h1>
        <img src={icon} alt="Synclify icon" className="mr-2 h-6 w-6" />
      </div>
      {videos?.map((video, i) => (
        <div
          onClick={() => {
            sendToBackground({
              name: "inject",
              body: { frameIds: [video.frameId], videoId: video.id }
            })
            setShow(false)
          }}
          key={i}
          className="mb-2 flex cursor-pointer flex-col items-center rounded-lg border border-gray-200 bg-white shadow hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-800 dark:hover:bg-gray-700 md:max-w-xl md:flex-row">
          <video
            className="h-96 w-full rounded-t-lg object-cover md:h-auto md:w-48 md:rounded-none md:rounded-l-lg"
            src={video.src}></video>

          <div className="flex flex-col justify-between p-4 leading-normal">
            <h5 className="mb-2 text-2xl font-bold tracking-tight text-gray-900 dark:text-white">
              {video.title}
            </h5>
            <p className="mb-3 font-normal text-gray-700 dark:text-gray-400">
              Duration: {video.duration ?? "unknown"} Resolution: {video.width}x
              {video.height}
            </p>
          </div>
        </div>
      ))}
    </div>
  )
}

export default VideoSelector
