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
            ["VIDEO", "IFRAME"].includes(node.nodeName)
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
          if (result !== MESSAGE_STATUS.SUCCESS)
            observer.observe(document, { subtree: true, childList: true })
        }
      })
  }
})
