import { defineUnlistedScript } from "wxt/utils/define-unlisted-script"
import { initCommunication } from "~/runtime/communication"

export default defineUnlistedScript(() => {
  initCommunication()
})
