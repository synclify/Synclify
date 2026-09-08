export type CallMediaState = {
  micEnabled: boolean
  cameraEnabled: boolean
}

export type CallParticipant = CallMediaState & {
  id: string
  nickname: string
  joinedAt: number
}

export type MediaSource =
  "microphone" | "camera" | "screen-video" | "screen-audio"

export type ScreenShareState = {
  active: boolean
  participantId: string | null
  startedAt: number | null
  maxParticipants: number
}

export type CallState = {
  roomId: string
  active: boolean
  participants: CallParticipant[]
  participantCount: number
  maxParticipants: number
  screenShare: ScreenShareState
}

export type IceConfig = {
  iceServers: RTCIceServer[]
  expiresAt?: number
}

export type CallSignal = {
  toParticipantId: string
  description?: RTCSessionDescriptionInit
  candidate?: RTCIceCandidateInit | null
  mediaSources?: Record<string, MediaSource>
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
  | { kind: "startScreenShare" }
  | { kind: "stopScreenShare" }
  | { kind: "leave" }

export type CallCommandResult =
  | { ok: true }
  | { ok: false; code: "connection"; message: string }

export type ScreenShareCommandResult =
  | { ok: true; state: CallState }
  | { ok: false; code: CallErrorPayload["code"]; message: string }

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
    | "screen_share_limit"
    | "screen_share_in_progress"
    | "screen_share_not_owner"
    | "connection"
  message: string
}

export type VideoCallEvent =
  | { kind: "joined"; payload: CallJoinedPayload }
  | { kind: "state"; payload: CallState }
  | { kind: "signal"; payload: IncomingCallSignal }
  | { kind: "transport"; payload: { state: "connected" | "reconnecting" } }
  | { kind: "error"; payload: CallErrorPayload }
