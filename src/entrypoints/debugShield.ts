import { defineUnlistedScript } from "wxt/utils/define-unlisted-script"
import { initDebugShield } from "~/runtime/debugShield"

export default defineUnlistedScript(() => {
  initDebugShield()
})
