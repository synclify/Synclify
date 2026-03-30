import ReactDOM from "react-dom/client"
import { Toaster } from "~/components/ui/sonner"
import { toast } from "sonner"
import { useEffect } from "react"
import browser from "webextension-polyfill"
import type { MessageKey } from "~/lib/i18n"
import { t } from "~/lib/i18n"
import { mountUi, runOnce, whenBodyReady } from "~/lib/runtime-ui"

const ToastOverlay = () => {
  useEffect(() => {
    const callback = (
      msg: {
        to: string
        show: boolean
        content: string
        error: boolean
        messageKey?: MessageKey
      },
      _sender: browser.Runtime.MessageSender,
      sendResponse: (response: unknown) => void
    ) => {
      if (msg.to === "toast") {
        const content = msg.messageKey ? t(msg.messageKey) : msg.content
        if (msg.show) {
          if (msg.error) toast.error(content)
          else toast.success(content)
        } else toast.dismiss()
        sendResponse(null)
        return true
      }
    }
    browser.runtime.onMessage.addListener(callback)

    return () => {
      browser.runtime.onMessage.removeListener(callback)
    }
  }, [])

  return <Toaster />
}

export function initToast(): void {
  if (!runOnce("toast")) return

  whenBodyReady(() => {
    const { mountPoint } = mountUi({
      id: "synclify-toast-root",
      watchFullscreenHost: true
    })
    const root = ReactDOM.createRoot(mountPoint)
    root.render(<ToastOverlay />)
  })
}
