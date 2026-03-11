import { defineContentScript } from "wxt/utils/define-content-script"
import { createIntegratedUi } from "wxt/utils/content-script-ui/integrated"
import ReactDOM from "react-dom/client"
import { createPortal } from "react-dom"
import { useCallback, useEffect, useRef, useState } from "react"
import browser from "webextension-polyfill"
import { watchFullscreen } from "~/lib/fullscreen"

const PRESET_EMOJIS = ["\u{1F602}", "\u{1F62E}", "\u2764\uFE0F", "\u{1F525}", "\u{1F622}", "\u{1F44F}"]

const SYNCLIFY_WRAPPER = "data-synclify-player-wrapper"

const PLAYER_CONTAINER_SELECTORS = [
  `[${SYNCLIFY_WRAPPER}]`,
  ".html5-video-player",
  ".video-player",
  ".jw-wrapper",
  ".vjs-player",
  ".plyr",
  ".mejs__container",
  ".flowplayer",
  ".video-js",
  "[data-player]"
]

// Reference width at which scale = 1.0
const REF_WIDTH = 640

type FloatingEmoji = {
  id: number
  emoji: string
  x: number
  drift: number
}

let emojiIdCounter = 0

function findPlayerContainer(): HTMLElement | null {
  for (const sel of PLAYER_CONTAINER_SELECTORS) {
    const el = document.querySelector(sel) as HTMLElement | null
    if (el) return el
  }
  const video = document.querySelector(
    "[data-synclify-id]"
  ) as HTMLVideoElement | null
  if (video && video.parentElement && video.parentElement !== document.body) {
    const parentStyle = getComputedStyle(video.parentElement)
    if (
      parentStyle.position === "relative" ||
      parentStyle.position === "absolute"
    ) {
      return video.parentElement
    }
  }
  return null
}

function clamp(val: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, val))
}

function ReactionsApp() {
  const [visible, setVisible] = useState(false)
  const [settingEnabled, setSettingEnabled] = useState(true)
  const [floatingEmojis, setFloatingEmojis] = useState<FloatingEmoji[]>([])
  const [container, setContainer] = useState<HTMLElement | null>(null)
  const [scale, setScale] = useState(1)
  const timeoutsRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(
    new Map()
  )

  // Check if in a room
  useEffect(() => {
    const check = () => {
      browser.runtime
        .sendMessage({ action: "shouldInject" })
        .then((res: boolean) => setVisible(res))
    }
    check()
    const listener = (
      changes: Record<string, browser.Storage.StorageChange>
    ) => {
      if (changes.state) check()
    }
    browser.storage.onChanged.addListener(listener)
    return () => browser.storage.onChanged.removeListener(listener)
  }, [])

  // Read showReactions setting and watch for changes
  useEffect(() => {
    browser.storage.sync.get("settings").then((result) => {
      const settings = result.settings as
        | { showReactions?: boolean }
        | undefined
      if (settings?.showReactions === false) setSettingEnabled(false)
    })
    const listener = (
      changes: Record<string, browser.Storage.StorageChange>,
      area: string
    ) => {
      if (area === "sync" && changes.settings) {
        const newSettings = changes.settings.newValue as
          | { showReactions?: boolean }
          | undefined
        setSettingEnabled(newSettings?.showReactions !== false)
      }
    }
    browser.storage.onChanged.addListener(listener)
    return () => browser.storage.onChanged.removeListener(listener)
  }, [])

  // Find and track the player container
  useEffect(() => {
    if (!visible) {
      setContainer(null)
      return
    }

    const detect = () => setContainer(findPlayerContainer())

    detect()

    const interval = setInterval(detect, 1000)
    const observer = new MutationObserver(detect)
    observer.observe(document.body, { childList: true, subtree: true })

    return () => {
      clearInterval(interval)
      observer.disconnect()
    }
  }, [visible])

  // Track container size and compute scale
  useEffect(() => {
    if (!container) {
      setScale(1)
      return
    }

    const updateScale = () => {
      const w = container.offsetWidth || container.clientWidth
      if (w > 0) {
        const isFs = document.fullscreenElement != null
        const max = isFs ? 1.0 : 1.8
        setScale(clamp(w / REF_WIDTH, 0.5, max))
      }
    }

    updateScale()

    const ro = new ResizeObserver(updateScale)
    ro.observe(container)

    document.addEventListener("fullscreenchange", updateScale)

    return () => {
      ro.disconnect()
      document.removeEventListener("fullscreenchange", updateScale)
    }
  }, [container])

  // Listen for incoming reactions
  useEffect(() => {
    const handler = (
      msg: { to?: string; emoji?: string; nickname?: string },
      _sender: browser.Runtime.MessageSender,
      sendResponse: (r: unknown) => void
    ) => {
      if (msg.to === "reaction" && msg.emoji) {
        spawnEmoji(msg.emoji)
        sendResponse(null)
        return true
      }
    }
    browser.runtime.onMessage.addListener(handler)
    return () => browser.runtime.onMessage.removeListener(handler)
  }, [])

  const spawnEmoji = useCallback((emoji: string) => {
    const id = emojiIdCounter++
    const x = 10 + Math.random() * 80
    const drift = (Math.random() > 0.5 ? 1 : -1) * (20 + Math.random() * 30)
    setFloatingEmojis((prev) => [...prev, { id, emoji, x, drift }])
    const timeout = setTimeout(() => {
      setFloatingEmojis((prev) => prev.filter((e) => e.id !== id))
      timeoutsRef.current.delete(id)
    }, 2200)
    timeoutsRef.current.set(id, timeout)
  }, [])

  const sendReaction = useCallback((emoji: string) => {
    browser.runtime.sendMessage({
      action: "reaction",
      body: { emoji }
    })
  }, [])

  if (!visible || !settingEnabled) return null

  const inContainer = container !== null
  const s = inContainer ? scale : 1

  // Scaled values
  const emojiSize = Math.round(22 * s)
  const btnPadH = Math.round(6 * s)
  const btnPadV = Math.round(4 * s)
  const barGap = Math.round(4 * s)
  const barPadH = Math.round(10 * s)
  const barPadV = Math.round(6 * s)
  const barRadius = Math.round(24 * s)
  const barBottom = Math.round(68 * s)
  const floatSize = Math.round(36 * s)
  const floatBottom = Math.round(120 * s)
  const floatTravel = Math.round(200 * s)
  const btnRadius = Math.round(8 * s)

  const pickerBar = (
    <div
      style={{
        position: inContainer ? "absolute" : "fixed",
        bottom: barBottom,
        left: "50%",
        transform: "translateX(-50%)",
        display: "flex",
        gap: barGap,
        padding: `${barPadV}px ${barPadH}px`,
        borderRadius: barRadius,
        background: "rgba(12, 14, 20, 0.85)",
        backdropFilter: "blur(12px)",
        border: "1px solid rgba(255,255,255,0.08)",
        zIndex: 2147483645,
        boxShadow: "0 4px 16px rgba(0,0,0,0.3)"
      }}>
      {PRESET_EMOJIS.map((emoji) => (
        <button
          key={emoji}
          onClick={() => sendReaction(emoji)}
          style={{
            background: "none",
            border: "none",
            fontSize: emojiSize,
            cursor: "pointer",
            padding: `${btnPadV}px ${btnPadH}px`,
            borderRadius: btnRadius,
            transition: "background 0.15s, transform 0.15s",
            lineHeight: 1
          }}
          onMouseOver={(e) => {
            e.currentTarget.style.background = "rgba(255,255,255,0.1)"
            e.currentTarget.style.transform = "scale(1.2)"
          }}
          onMouseOut={(e) => {
            e.currentTarget.style.background = "none"
            e.currentTarget.style.transform = "scale(1)"
          }}>
          {emoji}
        </button>
      ))}
    </div>
  )

  const floatingEmojiElements = floatingEmojis.map((fe) => (
    <div key={fe.id}>
      <style>{`
        @keyframes synclify-emoji-${fe.id} {
          0% { opacity: 1; transform: translateY(0) translateX(0); }
          100% { opacity: 0; transform: translateY(-${floatTravel}px) translateX(${Math.round(fe.drift * s)}px); }
        }
      `}</style>
      <div
        style={{
          position: inContainer ? "absolute" : "fixed",
          left: `${fe.x}%`,
          bottom: floatBottom,
          fontSize: floatSize,
          pointerEvents: "none",
          zIndex: 2147483644,
          animation: `synclify-emoji-${fe.id} 2s ease-out forwards`
        }}>
        {fe.emoji}
      </div>
    </div>
  ))

  if (container) {
    return createPortal(
      <>
        {pickerBar}
        {floatingEmojiElements}
      </>,
      container
    )
  }

  return (
    <>
      {pickerBar}
      {floatingEmojiElements}
    </>
  )
}

export default defineContentScript({
  matches: ["<all_urls>"],

  main(ctx) {
    const ui = createIntegratedUi(ctx, {
      position: "overlay",
      anchor: "body",
      onMount: (container) => {
        const root = ReactDOM.createRoot(container)
        root.render(<ReactionsApp />)
        return root
      },
      onRemove: (root) => {
        root?.unmount()
      }
    })

    ui.mount()
    ctx.onInvalidated(watchFullscreen(ui.wrapper))
  }
})
