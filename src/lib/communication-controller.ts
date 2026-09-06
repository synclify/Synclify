import browser from "webextension-polyfill"
import { t } from "~/lib/i18n"
import { WebRtcCallController } from "~/lib/webrtc-call"
import type {
  CallCommand,
  CallErrorPayload,
  VideoCallEvent
} from "~/types/call"
import {
  EMPTY_CALL_STATE,
  initialPresentationState,
  reducePresentation,
  type CommunicationCommand,
  type CommunicationSnapshot,
  type CommunicationView
} from "~/types/communication"
import type { State } from "~/types/state"

const JOIN_TIMEOUT_MS = 10_000
const MAX_CHAT_MESSAGES = 250

type Listener = () => void

function callErrorMessage(error: CallErrorPayload): string {
  switch (error.code) {
    case "full":
      return t("callFullError")
    case "not_in_room":
    case "not_in_call":
      return t("callRoomEndedError")
    case "connection":
      return t("callConnectionError")
    default:
      return error.message || t("callGenericError")
  }
}

export class CommunicationController {
  private snapshot: CommunicationSnapshot = {
    tabId: -1,
    visible: false,
    roomId: "",
    view: "call",
    chatEnabled: true,
    chatOpen: false,
    messages: [],
    unread: 0,
    roomParticipants: [],
    callState: EMPTY_CALL_STATE,
    connectionStatus: "idle",
    inCall: false,
    joining: false,
    rejoinSuggested: false,
    selfId: null,
    micEnabled: true,
    cameraEnabled: true,
    error: "",
    inPagePanelOpen: false,
    presentation: initialPresentationState(),
    connectionStates: {},
    streamParticipantIds: []
  }
  private readonly listeners = new Set<Listener>()
  private readonly remoteStreams = new Map<string, MediaStream>()
  private joinTimer: ReturnType<typeof setTimeout> | null = null
  private statePoll: ReturnType<typeof setInterval> | null = null
  private pendingJoinKind: "started" | "joined" = "started"
  private ready = false
  private destroyed = false
  private panelOpenBeforeFullscreen = false
  private readonly callController: WebRtcCallController

  constructor() {
    this.callController = new WebRtcCallController({
      sendSignal: (signal) => {
        this.sendCallCommand({ kind: "signal", ...signal }).catch(() => {})
      },
      onRemoteStream: (participantId, stream) => {
        if (stream) this.remoteStreams.set(participantId, stream)
        else this.remoteStreams.delete(participantId)
        this.updateStreamIds()
      },
      onConnectionState: (participantId, state) => {
        this.patch({
          connectionStates: {
            ...this.snapshot.connectionStates,
            [participantId]: state
          }
        })
      }
    })
  }

  getSnapshot = (): CommunicationSnapshot => this.snapshot

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getStream(participantId: string): MediaStream | undefined {
    if (participantId === this.snapshot.selfId) {
      return this.callController.getLocalStream() ?? undefined
    }
    return this.remoteStreams.get(participantId)
  }

  async initialize(): Promise<void> {
    if (this.ready) return
    this.ready = true

    const tabId = (await browser.runtime.sendMessage({
      action: "getSenderTabId"
    })) as number
    this.patch({ tabId })
    await Promise.all([
      this.refreshRoomState(),
      this.refreshSettings(),
      this.refreshRejoinSuggestion()
    ])

    browser.runtime.onMessage.addListener(this.onRuntimeMessage)
    browser.storage.onChanged.addListener(this.onStorageChanged)
    document.addEventListener("fullscreenchange", this.onFullscreenChange)
    window.addEventListener("pagehide", this.destroy)
    this.onFullscreenChange()
    this.sendCallCommand({ kind: "getState" }).catch(() => {})
    this.statePoll = setInterval(() => {
      if (!this.snapshot.callState.roomId) {
        this.sendCallCommand({ kind: "getState" }).catch(() => {})
      }
    }, 2000)
  }

  execute = async (command: CommunicationCommand): Promise<void> => {
    switch (command.kind) {
      case "openView":
        this.openView(command.view)
        return
      case "selectView":
        this.selectView(command.view)
        return
      case "setPresentation":
        this.patch({
          presentation: reducePresentation(this.snapshot.presentation, {
            type: "setMode",
            mode: command.mode
          }),
          inPagePanelOpen:
            command.mode === "minimized"
              ? false
              : this.snapshot.inPagePanelOpen,
          chatOpen:
            command.mode === "minimized" ? false : this.snapshot.chatOpen
        })
        return
      case "joinCall":
        await this.joinCall(command.micEnabled, command.cameraEnabled)
        return
      case "leaveCall":
        this.leaveCall()
        return
      case "setMic":
        await this.setMic(command.enabled)
        return
      case "setCamera":
        await this.setCamera(command.enabled)
        return
      case "sendChat":
        await this.sendChat(command.text)
        return
      case "markChatRead":
        this.patch({ unread: 0, chatOpen: true })
        return
    }
  }

  private patch(patch: Partial<CommunicationSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch }
    this.listeners.forEach((listener) => listener())
  }

  private sendCallCommand(command: CallCommand): Promise<unknown> {
    return browser.runtime.sendMessage({
      action: "videoCallCommand",
      body: command
    })
  }

  private async refreshRoomState(): Promise<void> {
    const result = await browser.storage.local.get("state")
    const state = result.state as State | undefined
    const tabState = state?.[this.snapshot.tabId]
    const visible = !!tabState
    const roomChanged =
      !!this.snapshot.roomId && this.snapshot.roomId !== tabState?.roomId
    if (!visible && this.snapshot.inCall) this.leaveCall()
    this.patch({
      visible,
      roomId: tabState?.roomId ?? "",
      roomParticipants: tabState?.participants ?? [],
      messages: roomChanged ? [] : this.snapshot.messages,
      unread: roomChanged ? 0 : this.snapshot.unread,
      callState: roomChanged ? EMPTY_CALL_STATE : this.snapshot.callState
    })
    if (visible && (roomChanged || !this.snapshot.callState.roomId)) {
      this.sendCallCommand({ kind: "getState" }).catch(() => {})
    }
  }

  private async refreshSettings(): Promise<void> {
    const result = await browser.storage.sync.get("settings")
    const settings = result.settings as { showChat?: boolean } | undefined
    const chatEnabled = settings?.showChat !== false
    this.patch({
      chatEnabled,
      view:
        !chatEnabled && this.snapshot.view === "chat"
          ? "call"
          : this.snapshot.view,
      chatOpen: chatEnabled ? this.snapshot.chatOpen : false,
      unread: chatEnabled ? this.snapshot.unread : 0
    })
  }

  private async refreshRejoinSuggestion(): Promise<void> {
    const result = await browser.storage.local.get("communicationRejoin")
    const rejoin = result.communicationRejoin as
      Record<number, boolean> | undefined
    this.patch({ rejoinSuggested: rejoin?.[this.snapshot.tabId] === true })
  }

  private async setRejoinSuggestion(enabled: boolean): Promise<void> {
    if (this.snapshot.tabId < 0) return
    const result = await browser.storage.local.get("communicationRejoin")
    const rejoin = {
      ...((result.communicationRejoin as Record<number, boolean> | undefined) ??
        {})
    }
    if (enabled) rejoin[this.snapshot.tabId] = true
    else delete rejoin[this.snapshot.tabId]
    await browser.storage.local.set({ communicationRejoin: rejoin })
    if (!this.destroyed) this.patch({ rejoinSuggested: enabled })
  }

  private readonly onStorageChanged = (
    changes: Record<string, browser.Storage.StorageChange>,
    area: string
  ) => {
    if (area === "local" && changes.state)
      this.refreshRoomState().catch(() => {})
    if (area === "sync" && changes.settings)
      this.refreshSettings().catch(() => {})
  }

  private readonly onRuntimeMessage = (rawMessage: unknown) => {
    const message = rawMessage as {
      to?: string
      type?: string
      nickname?: string
      text?: string
      timestamp?: number
      self?: boolean
      event?: VideoCallEvent
      command?: CommunicationCommand
    }

    if (message.to === "communication" && message.command) {
      return this.execute(message.command)
    }
    if (message.to === "chat" && message.type === "incoming") {
      this.receiveChat(message)
      return Promise.resolve(null)
    }
    if (message.to === "videoCall" && message.event) {
      this.handleCallEvent(message.event)
      return Promise.resolve(null)
    }
    return undefined
  }

  private receiveChat(message: {
    nickname?: string
    text?: string
    timestamp?: number
    self?: boolean
  }): void {
    if (!this.snapshot.chatEnabled) return
    const incoming = !message.self
    const nextMessage = {
      id: `${message.timestamp ?? Date.now()}-${Math.random().toString(36).slice(2)}`,
      nickname: message.nickname || t("anonymousNickname"),
      text: message.text || "",
      timestamp: message.timestamp || Date.now(),
      self: message.self === true
    }
    this.patch({
      messages: [...this.snapshot.messages, nextMessage].slice(
        -MAX_CHAT_MESSAGES
      ),
      unread:
        incoming && !this.snapshot.chatOpen
          ? this.snapshot.unread + 1
          : this.snapshot.unread
    })
    if (incoming && this.snapshot.messages.length === 0) {
      this.trackChat("chat_used", "incoming")
    }
  }

  private async sendChat(value: string): Promise<void> {
    const text = value.trim()
    if (!text || !this.snapshot.chatEnabled) return
    await browser.runtime.sendMessage({ action: "chatMessage", body: { text } })
    if (!this.snapshot.messages.some((message) => message.self)) {
      this.trackChat("chat_used", "outgoing")
    }
  }

  private trackChat(
    event: "chat_opened" | "chat_used",
    firstInteraction?: "incoming" | "outgoing"
  ): void {
    browser.runtime
      .sendMessage({
        action: "trackChatTelemetry",
        body: { event, firstInteraction }
      })
      .catch(() => {})
  }

  private openView(view: CommunicationView): void {
    if (!this.selectView(view)) return

    if (this.snapshot.presentation.fullscreen) {
      this.panelOpenBeforeFullscreen = true
      this.patch({ inPagePanelOpen: true })
      return
    }
    this.patch({ inPagePanelOpen: true })
  }

  private selectView(view: CommunicationView): boolean {
    if (view === "chat" && !this.snapshot.chatEnabled) return false
    this.patch({
      view,
      chatOpen: view === "chat",
      unread: view === "chat" ? 0 : this.snapshot.unread,
      presentation: reducePresentation(this.snapshot.presentation, {
        type: "setMode",
        mode: "docked"
      })
    })
    if (view === "chat") this.trackChat("chat_opened")
    return true
  }

  private async joinCall(
    requestedMic: boolean,
    requestedCamera: boolean
  ): Promise<void> {
    if (this.snapshot.joining || this.snapshot.inCall) return
    this.patch({
      joining: true,
      connectionStatus: "joining",
      error: "",
      micEnabled: requestedMic,
      cameraEnabled: requestedCamera
    })
    this.pendingJoinKind = this.snapshot.callState.active ? "joined" : "started"

    try {
      let stream: MediaStream
      try {
        stream = await this.callController.acquireLocalMedia({
          audio: requestedMic,
          video: requestedCamera
            ? {
                width: { ideal: 640, max: 1280 },
                height: { ideal: 360, max: 720 },
                frameRate: { ideal: 24, max: 24 }
              }
            : false
        })
      } catch (error) {
        const name = error instanceof DOMException ? error.name : ""
        if (name !== "NotFoundError" || !requestedCamera || !requestedMic) {
          throw error
        }
        stream = await this.callController.acquireLocalMedia({
          audio: true,
          video: false
        })
      }

      const micEnabled = requestedMic && stream.getAudioTracks().length > 0
      const cameraEnabled =
        requestedCamera && stream.getVideoTracks().length > 0
      this.callController.setMicEnabled(micEnabled)
      this.callController.setCameraEnabled(cameraEnabled)
      this.patch({ micEnabled, cameraEnabled })
      await this.sendCallCommand({ kind: "join", micEnabled, cameraEnabled })
      this.clearJoinTimer()
      this.joinTimer = setTimeout(() => {
        this.sendCallCommand({ kind: "leave" }).catch(() => {})
        this.resetCall()
        this.patch({
          error: t("callConnectionError"),
          connectionStatus: "error"
        })
      }, JOIN_TIMEOUT_MS)
    } catch (error) {
      this.resetCall()
      const name = error instanceof DOMException ? error.name : ""
      this.patch({
        connectionStatus: "error",
        error:
          name === "NotAllowedError" || name === "SecurityError"
            ? t("callPermissionError")
            : name === "NotFoundError" || name === "DevicesNotFoundError"
              ? t("callDeviceError")
              : t("callGenericError")
      })
    }
  }

  private handleCallEvent(event: VideoCallEvent): void {
    if (event.kind === "transport") {
      if (event.payload.state === "reconnecting" && this.snapshot.inCall) {
        this.callController.resetPeers()
        this.remoteStreams.clear()
        this.patch({
          connectionStatus: "reconnecting",
          connectionStates: {},
          streamParticipantIds: this.snapshot.selfId
            ? [this.snapshot.selfId]
            : []
        })
      } else if (
        event.payload.state === "connected" &&
        this.snapshot.inCall &&
        this.snapshot.connectionStatus === "reconnecting"
      ) {
        this.patch({ connectionStatus: "joining" })
        this.sendCallCommand({
          kind: "join",
          micEnabled: this.snapshot.micEnabled,
          cameraEnabled: this.snapshot.cameraEnabled
        }).catch(() => {})
        this.clearJoinTimer()
        this.joinTimer = setTimeout(() => {
          this.sendCallCommand({ kind: "leave" }).catch(() => {})
          this.resetCall()
          this.patch({
            error: t("callConnectionError"),
            connectionStatus: "error"
          })
        }, JOIN_TIMEOUT_MS)
      }
      return
    }

    if (event.kind === "joined") {
      this.clearJoinTimer()
      this.callController.configure(event.payload.iceConfig.iceServers)
      this.patch({
        callState: event.payload.state,
        selfId: event.payload.participantId,
        inCall: true,
        joining: false,
        connectionStatus: "connected",
        error: "",
        rejoinSuggested: false,
        presentation: reducePresentation(this.snapshot.presentation, {
          type: "callStarted"
        })
      })
      this.updateStreamIds()
      this.setRejoinSuggestion(false).catch(() => {})
      this.callController
        .connectToExisting(event.payload.existingParticipantIds)
        .catch(() =>
          this.patch({
            error: t("callConnectionError"),
            connectionStatus: "error"
          })
        )
      this.trackCall(
        this.pendingJoinKind === "started"
          ? "video_call_started"
          : "video_call_joined"
      )
      return
    }

    if (event.kind === "state") {
      const selfPresent = event.payload.participants.some(
        (participant) => participant.id === this.snapshot.selfId
      )
      this.patch({ callState: event.payload })
      if (this.snapshot.inCall && this.snapshot.selfId) {
        this.callController.syncParticipants(
          event.payload.participants
            .map((participant) => participant.id)
            .filter((id) => id !== this.snapshot.selfId)
        )
        if (
          !selfPresent &&
          this.snapshot.connectionStatus !== "reconnecting" &&
          this.snapshot.connectionStatus !== "joining"
        ) {
          this.resetCall()
        }
      }
      return
    }

    if (event.kind === "signal") {
      this.callController.handleSignal(event.payload).catch(() =>
        this.patch({
          error: t("callConnectionError"),
          connectionStatus: "error"
        })
      )
      return
    }

    this.patch({
      error: callErrorMessage(event.payload),
      connectionStatus: "error"
    })
    if (
      event.payload.code === "not_in_room" ||
      event.payload.code === "not_in_call" ||
      this.snapshot.joining
    ) {
      this.resetCall()
    }
  }

  private async setMic(enabled: boolean): Promise<void> {
    if (
      enabled &&
      this.snapshot.inCall &&
      (this.callController.getLocalStream()?.getAudioTracks().length ?? 0) === 0
    ) {
      try {
        await this.callController.ensureMedia("audio")
        this.updateStreamIds()
      } catch {
        this.patch({ error: t("callPermissionError") })
        return
      }
    }
    this.callController.setMicEnabled(enabled)
    this.patch({ micEnabled: enabled, error: "" })
    if (this.snapshot.inCall) this.publishMediaState()
    this.trackCall("video_call_mic_toggled", { enabled })
  }

  private async setCamera(enabled: boolean): Promise<void> {
    if (
      enabled &&
      this.snapshot.inCall &&
      (this.callController.getLocalStream()?.getVideoTracks().length ?? 0) === 0
    ) {
      try {
        await this.callController.ensureMedia("video")
        this.updateStreamIds()
      } catch {
        this.patch({ error: t("callPermissionError") })
        return
      }
    }
    this.callController.setCameraEnabled(enabled)
    this.patch({ cameraEnabled: enabled, error: "" })
    if (this.snapshot.inCall) this.publishMediaState()
    this.trackCall("video_call_camera_toggled", { enabled })
  }

  private publishMediaState(): void {
    this.sendCallCommand({
      kind: "mediaState",
      micEnabled: this.snapshot.micEnabled,
      cameraEnabled: this.snapshot.cameraEnabled
    }).catch(() => {})
  }

  private leaveCall(): void {
    if (this.snapshot.inCall || this.snapshot.joining) {
      this.sendCallCommand({ kind: "leave" }).catch(() => {})
    }
    this.resetCall()
    this.setRejoinSuggestion(false).catch(() => {})
    this.trackCall("video_call_left")
  }

  private resetCall(): void {
    this.clearJoinTimer()
    this.callController.stop()
    this.remoteStreams.clear()
    this.patch({
      inCall: false,
      joining: false,
      selfId: null,
      micEnabled: true,
      cameraEnabled: true,
      connectionStatus: "idle",
      connectionStates: {},
      streamParticipantIds: [],
      presentation: reducePresentation(this.snapshot.presentation, {
        type: "callEnded"
      })
    })
  }

  private clearJoinTimer(): void {
    if (this.joinTimer) clearTimeout(this.joinTimer)
    this.joinTimer = null
  }

  private updateStreamIds(): void {
    this.patch({
      streamParticipantIds: [
        ...(this.snapshot.selfId ? [this.snapshot.selfId] : []),
        ...this.remoteStreams.keys()
      ]
    })
  }

  private readonly onFullscreenChange = () => {
    const fullscreen = document.fullscreenElement !== null
    if (fullscreen === this.snapshot.presentation.fullscreen) return
    if (fullscreen) {
      this.panelOpenBeforeFullscreen = this.snapshot.inPagePanelOpen
    }
    const restoredPanelOpen =
      !fullscreen &&
      this.snapshot.presentation.previousModeBeforeFullscreen === "docked" &&
      this.panelOpenBeforeFullscreen
    this.patch({
      inPagePanelOpen: fullscreen ? false : restoredPanelOpen,
      presentation: reducePresentation(this.snapshot.presentation, {
        type: fullscreen ? "fullscreenEntered" : "fullscreenExited",
        callActive: this.snapshot.inCall
      })
    })
  }

  private trackCall(event: string, properties?: Record<string, unknown>): void {
    browser.runtime
      .sendMessage({
        action: "trackVideoCallTelemetry",
        body: { event, ...properties }
      })
      .catch(() => {})
  }

  destroy = (): void => {
    if (this.destroyed) return
    this.destroyed = true
    if (this.snapshot.inCall) {
      this.setRejoinSuggestion(true).catch(() => {})
      this.sendCallCommand({ kind: "leave" }).catch(() => {})
    }
    this.callController.stop()
    this.clearJoinTimer()
    if (this.statePoll) clearInterval(this.statePoll)
    this.statePoll = null
  }
}

let controller: CommunicationController | null = null

export function getCommunicationController(): CommunicationController {
  controller ??= new CommunicationController()
  return controller
}
