import { defineContentScript } from "wxt/utils/define-content-script"
import { createIntegratedUi } from "wxt/utils/content-script-ui/integrated"
import ReactDOM from "react-dom/client"
import { Toaster } from "~/components/ui/sonner"
import { toast } from "sonner"
import { useEffect } from "react"
import browser from "webextension-polyfill"

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

export default defineContentScript({
  matches: ["<all_urls>"],

  main(ctx) {
    const ui = createIntegratedUi(ctx, {
      position: "inline",
      anchor: "body",
      onMount: (container) => {
        const root = ReactDOM.createRoot(container)
        root.render(<ToastOverlay />)
        return root
      },
      onRemove: (root) => {
        root?.unmount()
      }
    })

    ui.mount()
  }
})
