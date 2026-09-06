export type CallMediaState = {
  micEnabled: boolean
  cameraEnabled: boolean
}

export type CallParticipant = CallMediaState & {
  id: string
  nickname: string
  joinedAt: number
}

export type CallState = {
  roomId: string
  active: boolean
  participants: CallParticipant[]
  participantCount: number
  maxParticipants: number
}

export type IceConfig = {
  iceServers: RTCIceServer[]
  expiresAt?: number
}

export type CallSignal = {
  toParticipantId: string
  description?: RTCSessionDescriptionInit
  candidate?: RTCIceCandidateInit | null
}

export type IncomingCallSignal = Omit<CallSignal, "toParticipantId"> & {
  roomId: string
  fromParticipantId: string
}

export type CallCommand =
  | { kind: "getState" }
  | ({ kind: "join" } & CallMediaState)
  | ({ kind: "signal" } & CallSignal)
  | ({ kind: "mediaState" } & CallMediaState)
  | { kind: "leave" }

export type CallJoinedPayload = {
  participantId: string
  state: CallState
  existingParticipantIds: string[]
  iceConfig: IceConfig
}

export type CallErrorPayload = {
  roomId: string
  code:
    | "full"
    | "not_in_room"
    | "not_in_call"
    | "invalid_target"
    | "invalid_payload"
    | "connection"
  message: string
}

export type VideoCallEvent =
  | { kind: "joined"; payload: CallJoinedPayload }
  | { kind: "state"; payload: CallState }
  | { kind: "signal"; payload: IncomingCallSignal }
  | { kind: "transport"; payload: { state: "connected" | "reconnecting" } }
  | { kind: "error"; payload: CallErrorPayload }
