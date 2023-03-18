import type { PlasmoCSConfig } from "plasmo"
import { sendToBackground } from "@plasmohq/messaging"
// this cs reinjects automatically the main logic if a room has been created and no vides were found
export const config: PlasmoCSConfig = {
  matches: ["<all_urls>"],
  all_frames: true
}

const observer = new MutationObserver((mutations) => {
  // check to reinject only if videos or iframes are added
  if (
    mutations.some((mut) =>
      Array.from(mut.addedNodes).some((node) =>
        ["VIDEO", "IFRAME"].includes(node.nodeName)
      )
    )
  ) {
    sendToBackground({ name: "shouldInject" }).then((res: boolean) => {
      if (res) sendToBackground({ name: "inject" })
    })
  }
})

observer.observe(document, { subtree: true, childList: true })

export {}
