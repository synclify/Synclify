import type { PlasmoMessaging } from "@plasmohq/messaging"
import type { State } from "~types/state"
import { Storage } from "@plasmohq/storage"
import browser from "webextension-polyfill"

/**
 * Returns true or false depending on whether a room exists for the active tab
 */
const handler: PlasmoMessaging.MessageHandler = async (req, res) => {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true })

  const storage = new Storage({ area: "local" })
  const rooms = await storage.get<State | undefined>("state")
  if (rooms && tabs[0].id && rooms[tabs[0].id]) {
    res.send(true)
    return
  }
  res.send(false)
}

export default handler
