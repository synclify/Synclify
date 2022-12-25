/* eslint-disable @typescript-eslint/ban-ts-comment */
import { useEffect, useState } from "react"

import type { PlasmoGetStyle } from "plasmo"
import browser from "webextension-polyfill"
import styleText from "data-text:../style.css"

export const getStyle: PlasmoGetStyle = () => {
  const style = document.createElement("style")
  style.textContent = styleText
  return style
}

const PlasmoOverlay = () => {
  const [show, setShow] = useState(false)
  const [content, setContent] = useState("")
  const [error, setError] = useState(false)

  useEffect(() => {
    const callback = (msg: {
      to: string
      show: boolean
      content: string
      error?: boolean
    }) => {
      console.log(msg)
      if (msg.to === "toast") {
        if (msg.show) {
          setError(msg.error ?? false)
          setContent(msg.content)
          setShow(true)
          setTimeout(() => setShow(false), 1500)
        } else setShow(false)
        return false
      }
    }
    // @ts-ignore
    browser.runtime.onMessage.addListener(callback)

    return () => {
      // @ts-ignore
      browser.runtime.onMessage.removeListener(callback)
    }
  }, [])

  return (
    <>
      <span
        className={`fixed right-0 translate-x-40 p-3 opacity-0 transition duration-300 ${
          show ? "translate-x-0 opacity-100" : ""
        } ${error ? "bg-red-500" : "bg-green-500"}`}>
        {content}
      </span>
    </>
  )
}

export default PlasmoOverlay
