import type { PlasmoGetStyle, PlasmoRender } from "plasmo"
import { useEffect, useState } from "react"

import browser from "webextension-polyfill"
import { createRoot } from "react-dom/client"
import styleText from "data-text:../style.css"

export const getStyle: PlasmoGetStyle = () => {
  const style = document.createElement("style")
  style.textContent = styleText
  return style
}

const PlasmoOverlay = () => {
  const [show, setShow] = useState(false)
  const [content, setContent] = useState("")
  useEffect(() => {
    browser.runtime.onMessage.addListener((msg) => {
      console.log(msg)
      if (msg.to === "toast") {
        if (msg.show) {
          setShow(true)
          setContent(msg.content)
        } else setShow(false)
        return Promise.resolve(true)
      }
    })

    return () => {}
  }, [])

  return (
    <>
      {show ? <span className="fixed bg-amber-100 p-3">{content}</span> : null}
    </>
  )
}
export const render: PlasmoRender = async (
  {
    anchor = { element: document.body, type: "overlay" }, // the observed anchor, OR document.body.
    createRootContainer // This creates the default root container
  },
  _,
  OverlayCSUIContainer
) => {
  if (createRootContainer && anchor) {
    const rootContainer = await createRootContainer(anchor)
    console.log("called render")

    const root = createRoot(rootContainer) // Any root
    root.render(<PlasmoOverlay />)
  }
}

export default PlasmoOverlay
