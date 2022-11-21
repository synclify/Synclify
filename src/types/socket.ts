export const SOCKET_URL =
  process.env.NODE_ENV === "development"
    ? "http://localhost:3000"
    : (process.env.PLASMO_PUBLIC_SOCKET_ENDPOINT as string)

export enum SOCKET_EVENTS {
  CREATE = "create",
  JOIN = "join",
  FULL = "full",
  LOG = "log",
  VIDEO_EVENT = "videoEvent"
}
