import { defineUnlistedScript } from "wxt/utils/define-unlisted-script"
import { initFullscreenPatch } from "~/runtime/fullscreenPatch"

export default defineUnlistedScript(() => {
  initFullscreenPatch()
})
