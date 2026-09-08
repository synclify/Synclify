import type { CallParticipant } from "~/types/call"
import type { CommunicationCommand } from "~/types/communication"

export type ScreenShareViewerSnapshot = {
  roomId: string
  shareStartedAt: number
  sharerId: string
  sharerName: string
  participants: CallParticipant[]
  selfId: string
  micEnabled: boolean
  cameraEnabled: boolean
}

export type ScreenShareRelayStream = {
  streamId: string
  participantId: string
  kind: "screen" | "camera"
  self: boolean
}

export type ScreenShareRelayMessage =
  | {
      kind: "offer"
      generation: number
      description: RTCSessionDescriptionInit
      streams: ScreenShareRelayStream[]
      snapshot: ScreenShareViewerSnapshot
    }
  | {
      kind: "answer"
      generation: number
      description: RTCSessionDescriptionInit
    }
  | {
      kind: "candidate"
      generation: number
      candidate: RTCIceCandidateInit | null
    }
  | { kind: "state"; snapshot: ScreenShareViewerSnapshot }
  | { kind: "ended" }

export type ScreenShareViewerEvent =
  | {
      kind: "ready" | "closed"
      viewerTabId: number
      roomId: string
      shareStartedAt: number
    }
  | {
      kind: "relay"
      viewerTabId: number
      roomId: string
      shareStartedAt: number
      message: ScreenShareRelayMessage
    }

export type ScreenShareViewerSession = {
  sourceTabId: number
  roomId: string
  shareStartedAt: number
}

export type ScreenShareViewerBridgeMessage =
  | (ScreenShareViewerSession & { action: "screenShareViewerReady" })
  | (ScreenShareViewerSession & { action: "screenShareViewerClosed" })
  | (ScreenShareViewerSession & {
      action: "screenShareRelayFromViewer"
      message: ScreenShareRelayMessage
    })
  | (ScreenShareViewerSession & {
      action: "screenShareViewerCommand"
      command: CommunicationCommand
    })
  | (ScreenShareViewerSession & { action: "closeScreenShareViewer" })
