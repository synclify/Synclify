import { defineUnlistedScript } from "wxt/utils/define-unlisted-script"
import { initReactions } from "~/runtime/reactions"

export default defineUnlistedScript(() => {
  initReactions()
})
