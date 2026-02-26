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

function formatDuration(seconds: number | null | undefined): string {
  if (!seconds || isNaN(seconds)) return "unknown"
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, "0")}`
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
      style={{
        position: "fixed",
        top: 0,
        right: 0,
        bottom: 0,
        zIndex: 2147483647,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        padding: "16px",
        pointerEvents: show ? "auto" : "none",
        fontFamily: "'DM Sans', system-ui, sans-serif",
        transition: "opacity 0.3s ease, transform 0.3s ease",
        opacity: show ? 1 : 0,
        transform: show ? "translateX(0)" : "translateX(16px)"
      }}>
      {/* Panel */}
      <div
        style={{
          background: "rgba(12, 14, 20, 0.92)",
          backdropFilter: "blur(24px)",
          border: "1px solid rgba(210, 160, 60, 0.15)",
          borderRadius: "16px",
          padding: "20px",
          maxHeight: "80vh",
          overflowY: "auto",
          maxWidth: "360px",
          boxShadow:
            "0 0 0 1px rgba(210,160,60,0.08), 0 24px 48px rgba(0,0,0,0.5)"
        }}>
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            marginBottom: "16px"
          }}>
          <img
            src={iconUrl}
            alt="Synclify"
            style={{ width: "22px", height: "22px" }}
          />
          <span
            style={{
              fontSize: "13px",
              fontWeight: 600,
              color: "rgba(210, 160, 60, 0.9)",
              letterSpacing: "0.05em"
            }}>
            Choose a video to sync
          </span>
        </div>

        {/* Video list */}
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {videos?.map((video, i) => (
            <div
              key={i}
              onClick={() => {
                browser.runtime.sendMessage({
                  action: "inject",
                  body: { frameIds: [video.frameId], videoId: video.id }
                })
                setShow(false)
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "12px",
                padding: "10px 12px",
                borderRadius: "10px",
                border: "1px solid rgba(255,255,255,0.06)",
                background: "rgba(255,255,255,0.03)",
                cursor: "pointer",
                transition: "background 0.15s ease, border-color 0.15s ease"
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.background = "rgba(210,160,60,0.08)"
                e.currentTarget.style.borderColor = "rgba(210,160,60,0.2)"
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.background = "rgba(255,255,255,0.03)"
                e.currentTarget.style.borderColor = "rgba(255,255,255,0.06)"
              }}>
              {/* Thumbnail */}
              <video
                src={video.src}
                style={{
                  width: "80px",
                  height: "50px",
                  objectFit: "cover",
                  borderRadius: "6px",
                  background: "#000",
                  flexShrink: 0
                }}
              />

              {/* Info */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <p
                  style={{
                    fontSize: "12px",
                    fontWeight: 500,
                    color: "rgba(255,255,255,0.85)",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    margin: 0,
                    lineHeight: 1.4
                  }}>
                  {video.title}
                </p>
                <p
                  style={{
                    fontSize: "11px",
                    color: "rgba(255,255,255,0.35)",
                    margin: "2px 0 0 0",
                    fontFamily: "'DM Mono', monospace",
                    lineHeight: 1.4
                  }}>
                  {formatDuration(video.duration)} &middot; {video.width}x
                  {video.height}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
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
