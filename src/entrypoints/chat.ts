import { defineUnlistedScript } from "wxt/utils/define-unlisted-script"
import { initChat } from "~/runtime/chat"

export default defineUnlistedScript(() => {
  initChat()
})
