import { defineContentScript } from "wxt/utils/define-content-script"
import { createIntegratedUi } from "wxt/utils/content-script-ui/integrated"
import ReactDOM from "react-dom/client"
import { useCallback, useEffect, useRef, useState } from "react"
import browser from "webextension-polyfill"

const PRESET_EMOJIS = ["😂", "😮", "❤️", "🔥", "😢", "👏"]

type FloatingEmoji = {
  id: number
  emoji: string
  x: number
  drift: number
}

let emojiIdCounter = 0

function ReactionsApp() {
  const [visible, setVisible] = useState(false)
  const [floatingEmojis, setFloatingEmojis] = useState<FloatingEmoji[]>([])
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

  if (!visible) return null

  return (
    <>
      {/* Reaction picker bar */}
      <div
        style={{
          position: "fixed",
          bottom: 24,
          left: "50%",
          transform: "translateX(-50%)",
          display: "flex",
          gap: 4,
          padding: "6px 10px",
          borderRadius: 24,
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
              fontSize: 22,
              cursor: "pointer",
              padding: "4px 6px",
              borderRadius: 8,
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

      {/* Floating emoji animations */}
      {floatingEmojis.map((fe) => (
        <div key={fe.id}>
          <style>{`
            @keyframes synclify-emoji-${fe.id} {
              0% { opacity: 1; transform: translateY(0) translateX(0); }
              100% { opacity: 0; transform: translateY(-200px) translateX(${fe.drift}px); }
            }
          `}</style>
          <div
            style={{
              position: "fixed",
              left: `${fe.x}%`,
              bottom: 80,
              fontSize: 36,
              pointerEvents: "none",
              zIndex: 2147483644,
              animation: `synclify-emoji-${fe.id} 2s ease-out forwards`
            }}>
            {fe.emoji}
          </div>
        </div>
      ))}
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
  }
})
