import type { PlasmoMessaging } from "@plasmohq/messaging"
import type { RoomsList } from "~utils/rooms"
import { Storage } from "@plasmohq/storage"
import browser from "webextension-polyfill"

const handler: PlasmoMessaging.MessageHandler = async (req, res) => {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true })

  const storage = new Storage({ area: "local" })
  const rooms = await storage.get<RoomsList>("rooms")
  if (tabs[0].id && rooms[tabs[0].id]) res.send(true)
  res.send(false)
}

export default handler
