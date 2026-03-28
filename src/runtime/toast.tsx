import ReactDOM from "react-dom/client"
import { Toaster } from "~/components/ui/sonner"
import { toast } from "sonner"
import { useEffect } from "react"
import browser from "webextension-polyfill"
import { mountUi, runOnce, whenBodyReady } from "~/lib/runtime-ui"

const ToastOverlay = () => {
  useEffect(() => {
    const callback = (
      msg: {
        to: string
        show: boolean
        content: string
        error: boolean
      },
      _sender: browser.Runtime.MessageSender,
      sendResponse: (response: unknown) => void
    ) => {
      if (msg.to === "toast") {
        if (msg.show) {
          if (msg.error) toast.error(msg.content)
          else toast.success(msg.content)
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
