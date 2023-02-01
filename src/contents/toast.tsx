/* eslint-disable @typescript-eslint/ban-ts-comment */
import { useEffect, useState } from "react"

import type { PlasmoGetStyle } from "plasmo"
import browser from "webextension-polyfill"
import icon from "data-base64:~assets/icon.png"
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
      error: boolean
    }) => {
      if (msg.to === "toast") {
        if (msg.show) {
          setError(msg.error)
          setContent(msg.content)
          setShow(msg.show)
          setTimeout(() => setShow(false), 2000)
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
    <div
      className={`fixed right-0 flex translate-x-40 rounded-l-2xl border-y border-l bg-opacity-20 p-3 opacity-0 backdrop-blur transition duration-300 ${
        show ? "translate-x-0 opacity-100" : ""
      } ${
        error ? "border-red-500 bg-red-500" : "border-green-400 bg-green-400"
      }`}>
      <img src={icon} alt="Synclify icon" className="mr-2 h-6 w-6" />
      <p className="font-bold text-white">{content}</p>
    </div>
  )
}

export default PlasmoOverlay
