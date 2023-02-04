import type { PlasmoMessaging } from "@plasmohq/messaging"
import { SOCKET_URL } from "~types/socket"

const handler: PlasmoMessaging.MessageHandler = async (_req, _res) => {
  const res = await fetch(`${SOCKET_URL}/create`)
  const code = await res.text()
  _res.send(code)
}

export default handler
