export const SOCKET_URL =
  (import.meta.env.WXT_SOCKET_ENDPOINT as string) || "http://localhost:3001"

export const MAX_ROOM_PARTICIPANTS = 10
export type ControlMode = "shared" | "host"

export type RoomParticipant = {
  id: string
  nickname: string
  isHost: boolean
}

export type RoomState = {
  roomId: string
  hostId: string
  controlMode: ControlMode
  participants: RoomParticipant[]
  participantCount: number
  maxParticipants: number
}

export type JoinRoomPayload = {
  roomId: string
  nickname: string
  participantId: string
  controlMode?: ControlMode
}

export type LeaveRoomPayload = {
  roomId: string
  participantId: string
}

export type RoomErrorPayload = {
  roomId: string
  code: "full" | "not_found" | "invalid_room"
  message: string
}

export enum SOCKET_EVENTS {
  CREATE = "create",
  JOIN = "join",
  FULL = "full",
  LOG = "log",
  VIDEO_EVENT = "videoEvent",
  CHAT_MESSAGE = "chatMessage",
  REACTION = "reaction",
  LEAVE = "leaveRoom",
  SYNC_PING = "syncPing",
  SYNC_PONG = "syncPong",
  ROOM_JOINED = "roomJoined",
  ROOM_UPDATED = "roomUpdated",
  ROOM_ERROR = "roomError"
}
