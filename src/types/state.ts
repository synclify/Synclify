import type { ControlMode, RoomParticipant } from "~/types/socket"

export type TabState = {
  roomId: string
  participantId?: string
  controlMode?: ControlMode
  videoFound?: boolean
  nickname?: string
  participants?: RoomParticipant[]
  participantCount?: number
  hostId?: string
  isHost?: boolean
  maxParticipants?: number
}

export type State = {
  [tabId: number]: TabState
}
