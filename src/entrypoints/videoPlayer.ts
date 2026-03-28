import { defineUnlistedScript } from "wxt/utils/define-unlisted-script"
import { initVideoPlayer } from "~/runtime/videoPlayer"

export default defineUnlistedScript(() => {
  initVideoPlayer()
})
