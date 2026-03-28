import { defineUnlistedScript } from "wxt/utils/define-unlisted-script"
import { initAutoInject } from "~/runtime/autoInject"

export default defineUnlistedScript(() => {
  initAutoInject()
})
