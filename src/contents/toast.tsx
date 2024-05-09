import type {
  PlasmoCSUIJSXContainer,
  PlasmoGetStyle,
  PlasmoRender
} from "plasmo"

import { Toaster } from "~components/ui/sonner"
import browser from "webextension-polyfill"
import { createRoot } from "react-dom/client"
import styleText from "data-text:../style.css"
import { toast } from "../../node_modules/sonner/dist"
import { useEffect } from "react"

export const getStyle: PlasmoGetStyle = () => {
  const style = document.createElement("style")
  style.textContent = styleText
  return style
}

const PlasmoOverlay = () => {
  useEffect(() => {
    const callback = (
      msg: {
        to: string
        show: boolean
        content: string
        error: boolean
      },
      _sender,
      sendResponse
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

  return (
    <Toaster />
  )
}

export default PlasmoOverlay

export const render: PlasmoRender<PlasmoCSUIJSXContainer> = async ({
  createRootContainer
}) => {
  if (createRootContainer) {
    const rootContainer = await createRootContainer()
    const root = createRoot(rootContainer)
    root.render(<PlasmoOverlay />)
  }
}

export const getRootContainer = () => {
  const rootContainer = document.createElement("div")
  document.body.appendChild(rootContainer)
  return rootContainer
}
