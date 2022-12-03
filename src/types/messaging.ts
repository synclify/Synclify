export type ExtMessage = {
  type: MESSAGE_TYPE
}

export type ExtResponse = {
  status?: MESSAGE_STATUS
  message?: string
}

export enum MESSAGE_STATUS {
  SUCCESS = "success",
  ERROR = "error"
}

export enum MESSAGE_TYPE {
  VIDEO = "video",
  INIT = "init",
  EXIT = "exit",
  DETECT_VIDEO = "detectVideo",
  CHECK_VIDEO = "checkVideo"
}
