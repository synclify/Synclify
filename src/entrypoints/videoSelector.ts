import { defineUnlistedScript } from "wxt/utils/define-unlisted-script"
import { initVideoSelector } from "~/runtime/videoSelector"

export default defineUnlistedScript(() => {
  initVideoSelector()
})
