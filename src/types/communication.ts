import type { CallParticipant, CallState } from "~/types/call"

export type CallPresentationMode = "docked" | "floating" | "minimized"
export type CommunicationView = "call" | "chat" | "participants"
export type CallConnectionStatus =
  "idle" | "joining" | "connected" | "reconnecting" | "error"

export type CommunicationChatMessage = {
  id: string
  nickname: string
  text: string
  timestamp: number
  self: boolean
}

export type CommunicationSnapshot = {
  tabId: number
  visible: boolean
  roomId: string
  view: CommunicationView
  chatEnabled: boolean
  chatOpen: boolean
  messages: CommunicationChatMessage[]
  unread: number
  roomParticipants: Array<{
    id: string
    nickname: string
    isHost: boolean
  }>
  callState: CallState
  connectionStatus: CallConnectionStatus
  inCall: boolean
  joining: boolean
  rejoinSuggested: boolean
  selfId: string | null
  micEnabled: boolean
  cameraEnabled: boolean
  error: string
  inPagePanelOpen: boolean
  presentation: CommunicationPresentationState
  connectionStates: Record<string, RTCPeerConnectionState>
  streamParticipantIds: string[]
}

export type CommunicationPresentationState = {
  mode: CallPresentationMode
  fullscreen: boolean
  previousModeBeforeFullscreen: Exclude<CallPresentationMode, "floating"> | null
}

export type CommunicationPresentationAction =
  | { type: "setMode"; mode: Exclude<CallPresentationMode, "floating"> }
  | { type: "fullscreenEntered"; callActive: boolean }
  | { type: "fullscreenExited"; callActive: boolean }
  | { type: "callStarted" }
  | { type: "callEnded" }

export type CommunicationCommand =
  | { kind: "openView"; view: CommunicationView }
  | { kind: "selectView"; view: CommunicationView }
  | { kind: "setPresentation"; mode: "docked" | "minimized" }
  | { kind: "joinCall"; micEnabled: boolean; cameraEnabled: boolean }
  | { kind: "leaveCall" }
  | { kind: "setMic"; enabled: boolean }
  | { kind: "setCamera"; enabled: boolean }
  | { kind: "sendChat"; text: string }
  | { kind: "markChatRead" }

export const EMPTY_CALL_STATE: CallState = {
  roomId: "",
  active: false,
  participants: [],
  participantCount: 0,
  maxParticipants: 4
}

export function initialPresentationState(): CommunicationPresentationState {
  return {
    mode: "minimized",
    fullscreen: false,
    previousModeBeforeFullscreen: null
  }
}

export function reducePresentation(
  state: CommunicationPresentationState,
  action: CommunicationPresentationAction
): CommunicationPresentationState {
  switch (action.type) {
    case "setMode":
      if (state.fullscreen) {
        return {
          ...state,
          previousModeBeforeFullscreen: action.mode
        }
      }
      return { ...state, mode: action.mode }
    case "fullscreenEntered":
      if (state.fullscreen) return state
      return {
        fullscreen: true,
        mode: action.callActive ? "floating" : state.mode,
        previousModeBeforeFullscreen:
          state.mode === "floating" ? "minimized" : state.mode
      }
    case "fullscreenExited":
      return {
        fullscreen: false,
        mode: action.callActive
          ? (state.previousModeBeforeFullscreen ?? "minimized")
          : "minimized",
        previousModeBeforeFullscreen: null
      }
    case "callStarted":
      return {
        ...state,
        mode: state.fullscreen ? "floating" : state.mode
      }
    case "callEnded":
      return {
        ...state,
        mode: "minimized",
        previousModeBeforeFullscreen: state.fullscreen ? "minimized" : null
      }
  }
}

export function sortCallParticipants(
  participants: CallParticipant[],
  selfId: string | null
): CallParticipant[] {
  return [...participants].sort((a, b) => {
    if (a.id === selfId) return 1
    if (b.id === selfId) return -1
    return a.joinedAt - b.joinedAt
  })
}
