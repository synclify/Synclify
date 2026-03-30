import type { MessageKey } from "~/lib/i18n"

export type ChatMessage = {
  nickname: string
  text: string
  timestamp: number
}

export type ExtMessage = {
  type: MESSAGE_TYPE
  videoId: string
}

export type ExtResponse = {
  status?: MESSAGE_STATUS
  message?: string
  messageKey?: MessageKey
}

export enum MESSAGE_STATUS {
  SUCCESS = "success",
  ERROR = "error",
  MULTIPLE_VIDEOS = "multiple"
}

export enum MESSAGE_TYPE {
  VIDEO = "video",
  INIT = "init",
  EXIT = "exit",
  CHECK_VIDEO = "checkVideo",
  CHAT = "chat",
  REACTION = "reaction"
}
