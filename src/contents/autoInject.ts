import type { PlasmoCSConfig } from "plasmo"
import { sendToBackground } from "@plasmohq/messaging"
// this cs reinjects automatically the main logic if a room has been created and no videos were found
export const config: PlasmoCSConfig = {
  matches: ["<all_urls>"],
  all_frames: true,
  run_at: "document_end"
}

let shouldInject = false

const observer = new MutationObserver((mutations) => {
  // check to reinject only if videos or iframes are added
  if (
    mutations.some((mut) =>
      Array.from(mut.addedNodes).some((node) =>
        ["VIDEO", "IFRAME"].includes(node.nodeName)
      )
    )
  ) {
    if (shouldInject) sendToBackground({ name: "inject" })
    return true
  }
})

sendToBackground({ name: "shouldInject" }).then((res: boolean) => {
  shouldInject = res
  if (shouldInject)
    observer.observe(document, { subtree: true, childList: true })
})

export {}
