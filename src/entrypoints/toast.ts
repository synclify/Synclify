import { defineUnlistedScript } from "wxt/utils/define-unlisted-script"
import { initToast } from "~/runtime/toast"

export default defineUnlistedScript(() => {
  initToast()
})
