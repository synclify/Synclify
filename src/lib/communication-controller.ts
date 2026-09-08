import browser from "webextension-polyfill"
import { t } from "~/lib/i18n"
import { WebRtcCallController } from "~/lib/webrtc-call"
import { ScreenShareRelayHost } from "~/lib/screen-share-relay"
import type {
  CallCommand,
  CallCommandResult,
  CallErrorPayload,
  ScreenShareCommandResult,
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
import type {
  ScreenShareViewerEvent,
  ScreenShareViewerSnapshot
} from "~/types/screen-share"

const JOIN_TIMEOUT_MS = 10_000
const MAX_CHAT_MESSAGES = 250

type Listener = () => void

function normalizeCallState(
  state: CommunicationSnapshot["callState"]
): CommunicationSnapshot["callState"] {
  return {
    ...state,
    screenShare: state.screenShare ?? EMPTY_CALL_STATE.screenShare
  }
}

function callErrorMessage(error: CallErrorPayload): string {
  switch (error.code) {
    case "full":
      return t("callFullError")
    case "not_in_room":
    case "not_in_call":
      return t("callRoomEndedError")
    case "connection":
      return t("callConnectionError")
    case "screen_share_limit":
      return t("screenShareLimitError")
    case "screen_share_in_progress":
      return t("screenShareInProgressError")
    case "screen_share_not_owner":
      return t("screenShareOwnerError")
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
    streamParticipantIds: [],
    screenStreamParticipantIds: [],
    screenShareStarting: false,
    screenViewerOpen: false
  }
  private readonly listeners = new Set<Listener>()
  private readonly remoteStreams = new Map<string, MediaStream>()
  private readonly remoteScreenStreams = new Map<string, MediaStream>()
  private joinTimer: ReturnType<typeof setTimeout> | null = null
  private statePoll: ReturnType<typeof setInterval> | null = null
  private pendingJoinKind: "started" | "joined" = "started"
  private ready = false
  private destroyed = false
  private panelOpenBeforeFullscreen = false
  private readonly callController: WebRtcCallController
  private readonly screenRelay: ScreenShareRelayHost
  private viewerTabId: number | null = null
  private openedViewerShareStartedAt: number | null = null

  constructor() {
    this.callController = new WebRtcCallController({
      sendSignal: (signal) => {
        this.sendCallCommand({ kind: "signal", ...signal }).catch(() => {})
      },
      onRemoteStream: (participantId, kind, stream) => {
        const target =
          kind === "screen" ? this.remoteScreenStreams : this.remoteStreams
        if (stream) target.set(participantId, stream)
        else target.delete(participantId)
        this.updateStreamIds()
        this.refreshScreenRelay().catch(() => {})
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
    this.screenRelay = new ScreenShareRelayHost((viewerTabId, message) => {
      browser.runtime
        .sendMessage({
          action: "screenShareRelayToViewer",
          viewerTabId,
          sourceTabId: this.snapshot.tabId,
          roomId: this.snapshot.roomId,
          shareStartedAt: this.snapshot.callState.screenShare.startedAt,
          message
        })
        .catch(() => {})
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

  getScreenStream(participantId: string): MediaStream | undefined {
    if (participantId === this.snapshot.selfId) {
      return this.callController.getScreenStream() ?? undefined
    }
    return this.remoteScreenStreams.get(participantId)
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
      case "startScreenShare":
        await this.startScreenShare()
        return
      case "stopScreenShare":
        await this.stopScreenShare()
        return
      case "openScreenShareViewer":
        await this.openScreenShareViewer(true)
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

  private sendCallCommand<T = unknown>(command: CallCommand): Promise<T> {
    return browser.runtime.sendMessage({
      action: "videoCallCommand",
      body: command
    }) as Promise<T>
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
      screenShareViewer?: ScreenShareViewerEvent
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
    if (message.to === "communication" && message.screenShareViewer) {
      const viewer = message.screenShareViewer
      if (
        viewer.roomId !== this.snapshot.roomId ||
        viewer.shareStartedAt !== this.snapshot.callState.screenShare.startedAt
      ) {
        return Promise.resolve(null)
      }
      if (viewer.kind === "ready") {
        this.viewerTabId = viewer.viewerTabId
        this.patch({ screenViewerOpen: true })
        return this.refreshScreenRelay()
      }
      if (viewer.kind === "closed") {
        if (this.viewerTabId === viewer.viewerTabId) {
          this.viewerTabId = null
          this.screenRelay.close()
          this.patch({ screenViewerOpen: false })
        }
        return Promise.resolve(null)
      }
      if (viewer.kind === "relay") {
        return this.screenRelay.handle(viewer.message)
      }
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
      this.clearJoinTimer()
      this.joinTimer = setTimeout(() => {
        this.sendCallCommand({ kind: "leave" }).catch(() => {})
        this.resetCall()
        this.patch({
          error: t("callConnectionError"),
          connectionStatus: "error"
        })
      }, JOIN_TIMEOUT_MS)
      const result = await this.sendCallCommand<CallCommandResult>({
        kind: "join",
        micEnabled,
        cameraEnabled
      })
      if (!result?.ok) {
        this.resetCall()
        this.patch({
          error: t("callConnectionError"),
          connectionStatus: "error"
        })
      }
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
        this.callController.stopScreenShare().catch(() => {})
        this.callController.resetPeers()
        this.remoteStreams.clear()
        this.remoteScreenStreams.clear()
        this.patch({
          connectionStatus: "reconnecting",
          connectionStates: {},
          streamParticipantIds: this.snapshot.selfId
            ? [this.snapshot.selfId]
            : [],
          screenStreamParticipantIds: [],
          screenShareStarting: false
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
      const callState = normalizeCallState(event.payload.state)
      this.clearJoinTimer()
      this.callController.configure(event.payload.iceConfig.iceServers)
      this.patch({
        callState,
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
      this.syncScreenShareExperience()
      return
    }

    if (event.kind === "state") {
      const previousScreenShare = this.snapshot.callState.screenShare
      const callState = normalizeCallState(event.payload)
      const selfPresent = callState.participants.some(
        (participant) => participant.id === this.snapshot.selfId
      )
      this.patch({ callState })
      if (this.snapshot.inCall && this.snapshot.selfId) {
        this.callController.syncParticipants(
          callState.participants
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
      this.syncScreenShareExperience(previousScreenShare)
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
    const viewerSnapshot = this.createViewerSnapshot()
    if (viewerSnapshot) this.screenRelay.updateState(viewerSnapshot)
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
        await this.refreshScreenRelay()
      } catch {
        this.patch({ error: t("callPermissionError") })
        return
      }
    }
    this.callController.setCameraEnabled(enabled)
    this.patch({ cameraEnabled: enabled, error: "" })
    const viewerSnapshot = this.createViewerSnapshot()
    if (viewerSnapshot) this.screenRelay.updateState(viewerSnapshot)
    if (this.snapshot.inCall) this.publishMediaState()
    this.trackCall("video_call_camera_toggled", { enabled })
  }

  private async startScreenShare(): Promise<void> {
    const screenState = this.snapshot.callState.screenShare
    if (
      !this.snapshot.inCall ||
      this.snapshot.screenShareStarting ||
      screenState.active
    ) {
      return
    }
    if (
      this.snapshot.callState.participantCount > screenState.maxParticipants
    ) {
      this.patch({ error: t("screenShareLimitError") })
      return
    }

    this.patch({ screenShareStarting: true, error: "" })
    let stream: MediaStream
    try {
      // Keep this as the first awaited operation so it retains the click's
      // transient user activation in browsers that enforce it strictly.
      stream = await this.callController.captureScreen()
    } catch (error) {
      const name = error instanceof DOMException ? error.name : ""
      this.patch({
        screenShareStarting: false,
        error:
          name === "NotAllowedError" || name === "AbortError"
            ? t("screenShareCancelled")
            : t("screenSharePermissionError")
      })
      return
    }

    const result = await this.sendCallCommand<ScreenShareCommandResult>({
      kind: "startScreenShare"
    }).catch((): ScreenShareCommandResult => ({
      ok: false,
      code: "connection",
      message: t("callConnectionError")
    }))
    if (!result?.ok) {
      stream.getTracks().forEach((track) => track.stop())
      this.patch({
        screenShareStarting: false,
        error: result
          ? callErrorMessage({ roomId: this.snapshot.roomId, ...result })
          : t("callConnectionError")
      })
      return
    }

    try {
      await this.callController.startScreenShare(stream, () => {
        this.stopScreenShare().catch(() => {})
      })
      this.patch({
        callState: result.state,
        screenShareStarting: false,
        error: ""
      })
      this.trackCall("screen_share_started")
    } catch {
      stream.getTracks().forEach((track) => track.stop())
      await this.sendCallCommand({ kind: "stopScreenShare" }).catch(() => {})
      this.patch({
        screenShareStarting: false,
        error: t("screenShareStartError")
      })
    }
  }

  private async stopScreenShare(): Promise<void> {
    const isOwner =
      this.snapshot.callState.screenShare.participantId === this.snapshot.selfId
    await this.callController.stopScreenShare().catch(() => {})
    if (isOwner) {
      this.patch({
        callState: {
          ...this.snapshot.callState,
          screenShare: {
            ...this.snapshot.callState.screenShare,
            active: false,
            participantId: null,
            startedAt: null
          }
        }
      })
      const result = await this.sendCallCommand<ScreenShareCommandResult>({
        kind: "stopScreenShare"
      }).catch(() => null)
      if (result?.ok) this.patch({ callState: result.state })
      else if (result) {
        this.patch({
          error: callErrorMessage({ roomId: this.snapshot.roomId, ...result })
        })
      }
      this.trackCall("screen_share_stopped")
    }
    this.patch({ screenShareStarting: false })
  }

  private syncScreenShareExperience(
    previous = EMPTY_CALL_STATE.screenShare
  ): void {
    const current = this.snapshot.callState.screenShare
    const isRemoteShare =
      current.active && current.participantId !== this.snapshot.selfId

    if (!current.active) {
      if (
        previous.active &&
        previous.participantId === this.snapshot.selfId &&
        this.callController.getScreenStream()
      ) {
        this.callController.stopScreenShare().catch(() => {})
      }
      if (previous.active && previous.participantId !== this.snapshot.selfId) {
        this.screenRelay.close()
        browser.runtime
          .sendMessage({
            action: "endScreenShareViewer",
            sourceTabId: this.snapshot.tabId,
            shareStartedAt: previous.startedAt
          })
          .catch(() => {})
      }
      this.viewerTabId = null
      this.openedViewerShareStartedAt = null
      this.patch({ screenViewerOpen: false })
      return
    }

    const viewerSnapshot = this.createViewerSnapshot()
    if (viewerSnapshot) this.screenRelay.updateState(viewerSnapshot)
    if (
      isRemoteShare &&
      this.snapshot.inCall &&
      current.startedAt !== this.openedViewerShareStartedAt
    ) {
      this.openScreenShareViewer(false).catch(() => {})
    }
  }

  private async openScreenShareViewer(force: boolean): Promise<void> {
    const screenShare = this.snapshot.callState.screenShare
    if (
      !this.snapshot.inCall ||
      !screenShare.active ||
      !screenShare.startedAt ||
      screenShare.participantId === this.snapshot.selfId
    ) {
      return
    }
    if (!force && screenShare.startedAt === this.openedViewerShareStartedAt) {
      return
    }
    this.openedViewerShareStartedAt = screenShare.startedAt
    await browser.runtime.sendMessage({
      action: "openScreenShareViewer",
      sourceTabId: this.snapshot.tabId,
      roomId: this.snapshot.roomId,
      shareStartedAt: screenShare.startedAt
    })
  }

  private createViewerSnapshot(): ScreenShareViewerSnapshot | null {
    const screenShare = this.snapshot.callState.screenShare
    if (
      !this.snapshot.selfId ||
      !screenShare.active ||
      !screenShare.participantId ||
      !screenShare.startedAt
    ) {
      return null
    }
    const sharer = this.snapshot.callState.participants.find(
      ({ id }) => id === screenShare.participantId
    )
    if (!sharer) return null
    return {
      roomId: this.snapshot.roomId,
      shareStartedAt: screenShare.startedAt,
      sharerId: sharer.id,
      sharerName: sharer.nickname,
      participants: this.snapshot.callState.participants,
      selfId: this.snapshot.selfId,
      micEnabled: this.snapshot.micEnabled,
      cameraEnabled: this.snapshot.cameraEnabled
    }
  }

  private async refreshScreenRelay(): Promise<void> {
    if (this.viewerTabId === null) return
    const snapshot = this.createViewerSnapshot()
    if (!snapshot || snapshot.sharerId === snapshot.selfId) return
    const media = []
    const screenStream = this.remoteScreenStreams.get(snapshot.sharerId)
    if (screenStream) {
      media.push({
        stream: screenStream,
        participantId: snapshot.sharerId,
        kind: "screen" as const,
        self: false
      })
    }
    const localStream = this.callController.getLocalStream()
    if (localStream) {
      media.push({
        stream: localStream,
        participantId: snapshot.selfId,
        kind: "camera" as const,
        self: true
      })
    }
    for (const [participantId, stream] of this.remoteStreams) {
      media.push({
        stream,
        participantId,
        kind: "camera" as const,
        self: false
      })
    }
    await this.screenRelay.connect(this.viewerTabId, media, snapshot)
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
    this.screenRelay.close()
    if (this.snapshot.callState.screenShare.active) {
      browser.runtime
        .sendMessage({
          action: "endScreenShareViewer",
          sourceTabId: this.snapshot.tabId,
          shareStartedAt: this.snapshot.callState.screenShare.startedAt
        })
        .catch(() => {})
    }
    this.remoteStreams.clear()
    this.remoteScreenStreams.clear()
    this.viewerTabId = null
    this.openedViewerShareStartedAt = null
    this.patch({
      inCall: false,
      joining: false,
      selfId: null,
      micEnabled: true,
      cameraEnabled: true,
      connectionStatus: "idle",
      connectionStates: {},
      streamParticipantIds: [],
      screenStreamParticipantIds: [],
      screenShareStarting: false,
      screenViewerOpen: false,
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
      ],
      screenStreamParticipantIds: [...this.remoteScreenStreams.keys()]
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
    this.screenRelay.end()
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
