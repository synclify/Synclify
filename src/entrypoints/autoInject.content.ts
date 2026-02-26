import { defineContentScript } from "wxt/utils/define-content-script"
import { MESSAGE_STATUS } from "~/types/messaging"
import browser from "webextension-polyfill"

export default defineContentScript({
  matches: ["<all_urls>"],
  allFrames: true,
  runAt: "document_end",

  main() {
    let shouldInject = false

    const observer = new MutationObserver((mutations) => {
      if (
        mutations.some((mut) =>
          Array.from(mut.addedNodes).some((node) =>
            node.nodeName === "VIDEO" ||
            node.nodeName === "IFRAME" ||
            (node instanceof Element && node.querySelector("video, iframe"))
          )
        )
      ) {
        if (shouldInject) browser.runtime.sendMessage({ action: "inject" })
        return true
      }
    })

    browser.runtime
      .sendMessage({ action: "shouldInject" })
      .then(async (res: boolean) => {
        shouldInject = res
        if (shouldInject) {
          const result = await browser.runtime.sendMessage({
            action: "inject"
          })
          if (
            result?.status !== MESSAGE_STATUS.SUCCESS &&
            result?.status !== MESSAGE_STATUS.MULTIPLE_VIDEOS
          )
            observer.observe(document, { subtree: true, childList: true })
        }
      })
  }
})
