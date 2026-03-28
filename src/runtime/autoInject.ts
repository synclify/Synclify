import { MESSAGE_STATUS } from "~/types/messaging"
import browser from "webextension-polyfill"
import { runOnce } from "~/lib/runtime-ui"

export function initAutoInject(): void {
  if (!runOnce("autoInject")) return

  let shouldInject = false
  let debounceTimer: ReturnType<typeof setTimeout> | null = null

    const triggerInject = () => {
      if (!shouldInject) return
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => {
        browser.runtime.sendMessage({ action: "inject" })
      }, 500)
    }

    // Persistent rooms: detect SPA navigations and re-inject
    let lastUrl = location.href
    const urlObserver = new MutationObserver(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href
        // Re-check if we should inject (room may still be active for this tab)
        browser.runtime
          .sendMessage({ action: "shouldInject" })
          .then((res: boolean) => {
            if (res) {
              shouldInject = true
              triggerInject()
            }
          })
      }
    })
    urlObserver.observe(document, { subtree: true, childList: true })

    const observer = new MutationObserver((mutations) => {
      for (const mut of mutations) {
        // Case 1: New nodes added that are or contain video/iframe
        if (mut.type === "childList") {
          for (const node of Array.from(mut.addedNodes)) {
            if (
              node.nodeName === "VIDEO" ||
              node.nodeName === "IFRAME" ||
              (node instanceof Element && node.querySelector("video, iframe"))
            ) {
              triggerInject()
              return
            }
          }
        }

        // Case 2: An iframe's src attribute changed (e.g. embed loaded via AJAX)
        if (
          mut.type === "attributes" &&
          mut.attributeName === "src" &&
          mut.target instanceof HTMLIFrameElement
        ) {
          const src = mut.target.src
          // Ignore blank/empty/about:blank iframes
          if (src && src !== "" && src !== "about:blank") {
            triggerInject()
            return
          }
        }
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
        ) {
          observer.observe(document, {
            subtree: true,
            childList: true,
            attributes: true,
            attributeFilter: ["src"]
          })
        }
      }
    })
}
