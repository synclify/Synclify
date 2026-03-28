import ReactDOM from "react-dom/client"
import { createPortal } from "react-dom"
import { useCallback, useEffect, useRef, useState } from "react"
import browser from "webextension-polyfill"
import { mountUi, runOnce, whenBodyReady } from "~/lib/runtime-ui"

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
  const [dismissed, setDismissed] = useState(false)
  const [floatingEmojis, setFloatingEmojis] = useState<FloatingEmoji[]>([])
  const [container, setContainer] = useState<HTMLElement | null>(null)
  const [scale, setScale] = useState(1)
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const isDragging = useRef(false)
  const dragStart = useRef<{ mx: number; my: number; ox: number; oy: number }>({ mx: 0, my: 0, ox: 0, oy: 0 })
  const barRef = useRef<HTMLDivElement>(null)
  const hasTrackedUsage = useRef(false)
  const timeoutsRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(
    new Map()
  )

  const trackReactionTelemetry = useCallback(() => {
    browser.runtime
      .sendMessage({
        action: "trackReactionTelemetry",
        body: { event: "reaction_used" }
      })
      .catch(() => {})
  }, [])

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

  const sendReaction = useCallback(
    async (emoji: string) => {
      try {
        await browser.runtime.sendMessage({
          action: "reaction",
          body: { emoji }
        })
        if (!hasTrackedUsage.current) {
          hasTrackedUsage.current = true
          trackReactionTelemetry()
        }
      } catch {}
    },
    [trackReactionTelemetry]
  )

  // Reset dismissed state when leaving/joining a room
  useEffect(() => {
    if (visible) setDismissed(false)
  }, [visible])

  // Drag handlers
  const onDragStart = useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    isDragging.current = true
    dragStart.current = { mx: e.clientX, my: e.clientY, ox: dragOffset.x, oy: dragOffset.y }
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }, [dragOffset])

  const onDragMove = useCallback((e: React.PointerEvent) => {
    if (!isDragging.current) return
    setDragOffset({
      x: dragStart.current.ox + (e.clientX - dragStart.current.mx),
      y: dragStart.current.oy + (e.clientY - dragStart.current.my)
    })
  }, [])

  const onDragEnd = useCallback(() => {
    isDragging.current = false
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

  const handleSize = Math.round(16 * s)
  const closeSize = Math.round(14 * s)

  const pickerBar = dismissed ? null : (
    <div
      ref={barRef}
      onPointerMove={onDragMove}
      onPointerUp={onDragEnd}
      style={{
        position: inContainer ? "absolute" : "fixed",
        bottom: barBottom,
        left: "50%",
        transform: `translateX(-50%) translate(${dragOffset.x}px, ${dragOffset.y}px)`,
        display: "flex",
        alignItems: "center",
        gap: barGap,
        padding: `${barPadV}px ${barPadH}px`,
        borderRadius: barRadius,
        background: "rgba(12, 14, 20, 0.85)",
        backdropFilter: "blur(12px)",
        border: "1px solid rgba(255,255,255,0.08)",
        zIndex: 2147483648,
        boxShadow: "0 4px 16px rgba(0,0,0,0.3)",
        pointerEvents: "auto",
        userSelect: "none"
      }}>
      {/* Drag handle */}
      <div
        onPointerDown={onDragStart}
        style={{
          cursor: isDragging.current ? "grabbing" : "grab",
          display: "flex",
          alignItems: "center",
          padding: `0 ${Math.round(2 * s)}px`,
          color: "rgba(255,255,255,0.35)",
          touchAction: "none"
        }}>
        <svg width={handleSize} height={handleSize} viewBox="0 0 16 16" fill="currentColor">
          <circle cx="5" cy="3" r="1.2" />
          <circle cx="11" cy="3" r="1.2" />
          <circle cx="5" cy="8" r="1.2" />
          <circle cx="11" cy="8" r="1.2" />
          <circle cx="5" cy="13" r="1.2" />
          <circle cx="11" cy="13" r="1.2" />
        </svg>
      </div>
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
      {/* Close button */}
      <button
        onClick={() => setDismissed(true)}
        style={{
          background: "none",
          border: "none",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          padding: `0 ${Math.round(2 * s)}px`,
          color: "rgba(255,255,255,0.35)",
          transition: "color 0.15s"
        }}
        onMouseOver={(e) => {
          e.currentTarget.style.color = "rgba(255,255,255,0.8)"
        }}
        onMouseOut={(e) => {
          e.currentTarget.style.color = "rgba(255,255,255,0.35)"
        }}>
        <svg width={closeSize} height={closeSize} viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <line x1="2" y1="2" x2="12" y2="12" />
          <line x1="12" y1="2" x2="2" y2="12" />
        </svg>
      </button>
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

export function initReactions(): void {
  if (!runOnce("reactions")) return

  whenBodyReady(() => {
    const { mountPoint } = mountUi({
      id: "synclify-reactions-root",
      watchFullscreenHost: true
    })
    const root = ReactDOM.createRoot(mountPoint)
    root.render(<ReactionsApp />)
  })
}
