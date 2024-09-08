import type { PlasmoMessaging } from "@plasmohq/messaging"
import { captureException } from "@sentry/browser"
import { SOCKET_URL } from "~types/socket"

const handler: PlasmoMessaging.MessageHandler = async (_req, _res) => {
  const res = await fetch(`${SOCKET_URL}/create`)
  const code = await res.text()
  if (!res.ok) {
    const e = new Error(
      `Failed to fetch room code from socket server: ${JSON.stringify({ code: res.status, statusText: res.statusText, body: code })}`
    )
    captureException(e)
  }
  _res.send(code)
}

export default handler
