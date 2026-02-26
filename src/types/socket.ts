export const SOCKET_URL =
  (import.meta.env.WXT_SOCKET_ENDPOINT as string) || "http://localhost:3001"

export enum SOCKET_EVENTS {
  CREATE = "create",
  JOIN = "join",
  FULL = "full",
  LOG = "log",
  VIDEO_EVENT = "videoEvent"
}
