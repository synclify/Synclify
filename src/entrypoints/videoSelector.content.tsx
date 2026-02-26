import { defineContentScript } from "wxt/utils/define-content-script"
import { createIntegratedUi } from "wxt/utils/content-script-ui/integrated"
import ReactDOM from "react-dom/client"
import { useEffect, useState } from "react"
import browser from "webextension-polyfill"
import iconUrl from "~/assets/icon.png"

type VideoElement = {
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
  const [videos, setVideos] = useState<VideoElement[]>()

  useEffect(() => {
    const callback = (
      msg: {
        to: string
        videos: VideoElement[]
      },
      _sender: browser.Runtime.MessageSender,
      sendResponse: (response: unknown) => void
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
      className={`fixed right-0 flex flex-col overflow-y-auto rounded-l-2xl border-y border-l bg-opacity-20 bg-gradient-to-br from-orange-400 to-violet-900 p-3 backdrop-blur-xl transition duration-300 ${
        show
          ? "translate-x-0 opacity-100"
          : "translate-x-full select-none opacity-0"
      } `}>
      <div className="flex">
        <h1 className="text-xl font-bold">Choose a video to sync</h1>
        <img src={iconUrl} alt="Synclify icon" className="mr-2 h-6 w-6" />
      </div>
      {videos?.map((video, i) => (
        <div
          onClick={() => {
            browser.runtime.sendMessage({
              action: "inject",
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

export default defineContentScript({
  matches: ["<all_urls>"],

  main(ctx) {
    const ui = createIntegratedUi(ctx, {
      position: "inline",
      anchor: "body",
      onMount: (container) => {
        const root = ReactDOM.createRoot(container)
        root.render(<VideoSelector />)
        return root
      },
      onRemove: (root) => {
        root?.unmount()
      }
    })

    ui.mount()
  }
})
