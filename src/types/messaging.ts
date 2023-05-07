export type ExtMessage = {
  type: MESSAGE_TYPE
  videoId: string
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
  CHECK_VIDEO = "checkVideo"
}
