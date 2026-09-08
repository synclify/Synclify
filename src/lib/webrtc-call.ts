import type { CallSignal, IncomingCallSignal, MediaSource } from "~/types/call"

const CAMERA_MAX_BITRATE = 750_000
const CAMERA_SHARING_MAX_BITRATE = 300_000
const SCREEN_MAX_BITRATE = 2_500_000

export type RemoteMediaKind = "camera" | "screen"

type CallControllerOptions = {
  sendSignal: (signal: CallSignal) => void
  onRemoteStream: (
    participantId: string,
    kind: RemoteMediaKind,
    stream: MediaStream | null
  ) => void
  onConnectionState?: (
    participantId: string,
    state: RTCPeerConnectionState
  ) => void
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>
  getDisplayMedia?: (
    constraints: DisplayMediaStreamOptions
  ) => Promise<MediaStream>
  createPeerConnection?: (configuration: RTCConfiguration) => RTCPeerConnection
}

type ScreenCaptureOptions = DisplayMediaStreamOptions & {
  preferCurrentTab?: boolean
  selfBrowserSurface?: "include" | "exclude"
  surfaceSwitching?: "include" | "exclude"
}

export class WebRtcCallController {
  private readonly peers = new Map<string, RTCPeerConnection>()
  private readonly remoteStreams = new Map<string, MediaStream>()
  private readonly remoteMediaSources = new Map<
    string,
    Record<string, MediaSource>
  >()
  private readonly pendingCandidates = new Map<
    string,
    Array<RTCIceCandidateInit | null>
  >()
  private readonly localTrackSources = new Map<string, MediaSource>()
  private readonly sendSignal: CallControllerOptions["sendSignal"]
  private readonly onRemoteStream: CallControllerOptions["onRemoteStream"]
  private readonly onConnectionState?: CallControllerOptions["onConnectionState"]
  private readonly getUserMedia: NonNullable<
    CallControllerOptions["getUserMedia"]
  >
  private readonly getDisplayMedia: NonNullable<
    CallControllerOptions["getDisplayMedia"]
  >
  private readonly createPeerConnection: NonNullable<
    CallControllerOptions["createPeerConnection"]
  >
  private iceServers: RTCIceServer[] = []
  private localStream: MediaStream | null = null
  private screenStream: MediaStream | null = null
  private screenEnded: (() => void) | null = null

  constructor(options: CallControllerOptions) {
    this.sendSignal = options.sendSignal
    this.onRemoteStream = options.onRemoteStream
    this.onConnectionState = options.onConnectionState
    this.getUserMedia =
      options.getUserMedia ??
      ((constraints) => navigator.mediaDevices.getUserMedia(constraints))
    this.getDisplayMedia =
      options.getDisplayMedia ??
      ((constraints) => navigator.mediaDevices.getDisplayMedia(constraints))
    this.createPeerConnection =
      options.createPeerConnection ??
      ((configuration) => new RTCPeerConnection(configuration))
  }

  async acquireLocalMedia(
    constraints: MediaStreamConstraints = {
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      },
      video: {
        width: { ideal: 640, max: 1280 },
        height: { ideal: 360, max: 720 },
        frameRate: { ideal: 24, max: 24 }
      }
    }
  ): Promise<MediaStream> {
    if (this.localStream) return this.localStream
    if (constraints.audio === false && constraints.video === false) {
      this.localStream = new MediaStream()
      return this.localStream
    }
    this.localStream = await this.getUserMedia(constraints)
    this.registerLocalTracks(this.localStream)
    return this.localStream
  }

  async captureScreen(): Promise<MediaStream> {
    const captureOptions: ScreenCaptureOptions = {
      video: true,
      audio: true,
      // Chromium uses these hints to keep the Synclify source tab available
      // and prominent. Browsers that do not implement them ignore the fields.
      selfBrowserSurface: "include",
      preferCurrentTab: true,
      surfaceSwitching: "include"
    }
    const stream = await this.getDisplayMedia(captureOptions)
    if (stream.getVideoTracks().length === 0) {
      stream.getTracks().forEach((track) => track.stop())
      throw new DOMException("No screen was selected", "NotFoundError")
    }
    stream
      .getVideoTracks()[0]
      ?.applyConstraints?.({
        width: { ideal: 1920, max: 1920 },
        height: { ideal: 1080, max: 1080 },
        frameRate: { ideal: 15, max: 30 }
      })
      .catch(() => {})
    return stream
  }

  async startScreenShare(
    stream: MediaStream,
    onEnded: () => void
  ): Promise<void> {
    if (
      stream.getVideoTracks().length === 0 ||
      stream.getVideoTracks().every((track) => track.readyState === "ended")
    ) {
      stream.getTracks().forEach((track) => track.stop())
      throw new DOMException("Screen sharing ended", "AbortError")
    }
    if (this.screenStream) await this.stopScreenShare()
    this.screenStream = stream
    this.screenEnded = onEnded
    for (const track of stream.getVideoTracks()) {
      this.localTrackSources.set(track.id, "screen-video")
      track.onended = this.onScreenTrackEnded
    }
    for (const track of stream.getAudioTracks()) {
      this.localTrackSources.set(track.id, "screen-audio")
    }
    for (const peer of this.peers.values()) {
      for (const track of stream.getTracks()) {
        const sender = peer.addTrack(track, stream)
        this.configureSender(sender, this.sourceForTrack(track))
      }
    }
    this.setCameraSharingProfile(true)
    await this.renegotiatePeers()
  }

  async stopScreenShare(): Promise<void> {
    const stream = this.screenStream
    if (!stream) return
    this.screenStream = null
    this.screenEnded = null
    const trackIds = new Set(stream.getTracks().map((track) => track.id))
    for (const track of stream.getTracks()) {
      track.onended = null
      this.localTrackSources.delete(track.id)
      track.stop()
    }
    for (const peer of this.peers.values()) {
      for (const sender of peer.getSenders?.() ?? []) {
        if (sender.track && trackIds.has(sender.track.id))
          peer.removeTrack(sender)
      }
    }
    this.setCameraSharingProfile(false)
    await this.renegotiatePeers()
  }

  getLocalStream(): MediaStream | null {
    return this.localStream
  }

  getScreenStream(): MediaStream | null {
    return this.screenStream
  }

  async ensureMedia(kind: "audio" | "video"): Promise<MediaStream> {
    const existingTracks =
      kind === "audio"
        ? this.localStream?.getAudioTracks()
        : this.localStream?.getVideoTracks()
    if (existingTracks?.length) {
      existingTracks.forEach((track) => {
        track.enabled = true
      })
      return this.localStream as MediaStream
    }

    const acquired = await this.getUserMedia({
      audio:
        kind === "audio"
          ? {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true
            }
          : false,
      video:
        kind === "video"
          ? {
              width: { ideal: 640, max: 1280 },
              height: { ideal: 360, max: 720 },
              frameRate: { ideal: 24, max: 24 }
            }
          : false
    })
    this.localStream ??= new MediaStream()
    for (const track of acquired.getTracks()) {
      this.localStream.addTrack(track)
      this.localTrackSources.set(
        track.id,
        track.kind === "audio" ? "microphone" : "camera"
      )
      for (const peer of this.peers.values()) {
        const sender = peer.addTrack(track, this.localStream)
        this.configureSender(sender, this.sourceForTrack(track))
      }
    }
    if (this.screenStream) this.setCameraSharingProfile(true)
    await this.renegotiatePeers()
    return this.localStream
  }

  configure(iceServers: RTCIceServer[]): void {
    this.iceServers = iceServers
  }

  async connectToExisting(participantIds: string[]): Promise<void> {
    for (const participantId of participantIds) {
      const peer = this.getOrCreatePeer(participantId)
      await this.sendOffer(participantId, peer)
    }
  }

  async handleSignal(signal: IncomingCallSignal): Promise<void> {
    const participantId = signal.fromParticipantId
    const peer = this.getOrCreatePeer(participantId)

    if (signal.mediaSources) {
      this.remoteMediaSources.set(participantId, signal.mediaSources)
      if (
        !Object.values(signal.mediaSources).some((source) =>
          source.startsWith("screen")
        )
      ) {
        const key = `${participantId}:screen`
        if (this.remoteStreams.delete(key)) {
          this.onRemoteStream(participantId, "screen", null)
        }
      }
    }
    if (signal.description) {
      await peer.setRemoteDescription(signal.description)
      await this.flushPendingCandidates(participantId, peer)

      if (signal.description.type === "offer") {
        const answer = await peer.createAnswer()
        await peer.setLocalDescription(answer)
        this.sendSignal({
          toParticipantId: participantId,
          description: answer,
          mediaSources: this.describeLocalSources(peer)
        })
      }
    }

    if (signal.candidate !== undefined) {
      if (peer.remoteDescription) {
        await peer.addIceCandidate(signal.candidate)
      } else {
        const queued = this.pendingCandidates.get(participantId) ?? []
        queued.push(signal.candidate)
        this.pendingCandidates.set(participantId, queued)
      }
    }
  }

  syncParticipants(participantIds: string[]): void {
    const activeIds = new Set(participantIds)
    for (const participantId of this.peers.keys()) {
      if (!activeIds.has(participantId)) this.removePeer(participantId)
    }
  }

  setMicEnabled(enabled: boolean): void {
    for (const track of this.localStream?.getAudioTracks() ?? []) {
      track.enabled = enabled
    }
  }

  setCameraEnabled(enabled: boolean): void {
    for (const track of this.localStream?.getVideoTracks() ?? []) {
      track.enabled = enabled
    }
  }

  resetPeers(): void {
    for (const participantId of Array.from(this.peers.keys())) {
      this.removePeer(participantId)
    }
    this.pendingCandidates.clear()
    this.remoteMediaSources.clear()
  }

  stop(): void {
    this.resetPeers()
    for (const track of this.localStream?.getTracks() ?? []) track.stop()
    for (const track of this.screenStream?.getTracks() ?? []) {
      track.onended = null
      track.stop()
    }
    this.localStream = null
    this.screenStream = null
    this.screenEnded = null
    this.localTrackSources.clear()
    this.iceServers = []
  }

  private readonly onScreenTrackEnded = () => {
    const callback = this.screenEnded
    this.stopScreenShare()
      .catch(() => {})
      .finally(() => callback?.())
  }

  private registerLocalTracks(stream: MediaStream): void {
    for (const track of stream.getTracks()) {
      this.localTrackSources.set(
        track.id,
        track.kind === "audio" ? "microphone" : "camera"
      )
    }
  }

  private sourceForTrack(track: MediaStreamTrack): MediaSource {
    return (
      this.localTrackSources.get(track.id) ??
      (track.kind === "audio" ? "microphone" : "camera")
    )
  }

  private allLocalStreams(): MediaStream[] {
    return [this.localStream, this.screenStream].filter(
      (stream): stream is MediaStream => stream !== null
    )
  }

  private async renegotiatePeers(): Promise<void> {
    for (const [participantId, peer] of this.peers) {
      await this.sendOffer(participantId, peer)
    }
  }

  private async sendOffer(
    participantId: string,
    peer: RTCPeerConnection
  ): Promise<void> {
    const offer = await peer.createOffer()
    await peer.setLocalDescription(offer)
    this.sendSignal({
      toParticipantId: participantId,
      description: offer,
      mediaSources: this.describeLocalSources(peer)
    })
  }

  private describeLocalSources(
    peer: RTCPeerConnection
  ): Record<string, MediaSource> {
    const sources: Record<string, MediaSource> = {}
    for (const transceiver of peer.getTransceivers?.() ?? []) {
      const track = transceiver.sender.track
      if (transceiver.mid && track) {
        sources[transceiver.mid] = this.sourceForTrack(track)
      }
    }
    return sources
  }

  private getOrCreatePeer(participantId: string): RTCPeerConnection {
    const existing = this.peers.get(participantId)
    if (existing) return existing
    if (!this.localStream) {
      throw new Error("Local media is required before creating a call peer")
    }

    const peer = this.createPeerConnection({ iceServers: this.iceServers })
    this.peers.set(participantId, peer)

    for (const stream of this.allLocalStreams()) {
      for (const track of stream.getTracks()) {
        const sender = peer.addTrack(track, stream)
        this.configureSender(sender, this.sourceForTrack(track))
      }
    }
    const localSources = new Set(this.localTrackSources.values())
    if (typeof peer.addTransceiver === "function") {
      if (!localSources.has("microphone")) {
        peer.addTransceiver("audio", { direction: "recvonly" })
      }
      if (!localSources.has("camera")) {
        peer.addTransceiver("video", { direction: "recvonly" })
      }
    }

    peer.onicecandidate = (event) => {
      this.sendSignal({
        toParticipantId: participantId,
        candidate: event.candidate?.toJSON() ?? null
      })
    }
    peer.ontrack = (event) => {
      const source =
        (event.transceiver.mid
          ? this.remoteMediaSources.get(participantId)?.[event.transceiver.mid]
          : undefined) ??
        (event.track.kind === "audio" ? "microphone" : "camera")
      const kind: RemoteMediaKind = source.startsWith("screen")
        ? "screen"
        : "camera"
      const key = `${participantId}:${kind}`
      const stream = this.remoteStreams.get(key) ?? new MediaStream()
      if (!stream.getTracks().some((track) => track.id === event.track.id)) {
        stream.addTrack(event.track)
      }
      this.remoteStreams.set(key, stream)
      this.onRemoteStream(participantId, kind, stream)
      event.track.onended = () => {
        stream.removeTrack(event.track)
        if (stream.getTracks().length === 0) {
          this.remoteStreams.delete(key)
          this.onRemoteStream(participantId, kind, null)
        } else {
          this.onRemoteStream(participantId, kind, stream)
        }
      }
    }
    peer.onconnectionstatechange = () => {
      this.onConnectionState?.(participantId, peer.connectionState)
    }

    return peer
  }

  private async flushPendingCandidates(
    participantId: string,
    peer: RTCPeerConnection
  ): Promise<void> {
    const candidates = this.pendingCandidates.get(participantId) ?? []
    this.pendingCandidates.delete(participantId)
    for (const candidate of candidates) await peer.addIceCandidate(candidate)
  }

  private removePeer(participantId: string): void {
    this.peers.get(participantId)?.close()
    this.peers.delete(participantId)
    this.pendingCandidates.delete(participantId)
    this.remoteMediaSources.delete(participantId)
    for (const kind of ["camera", "screen"] as const) {
      this.remoteStreams.delete(`${participantId}:${kind}`)
      this.onRemoteStream(participantId, kind, null)
    }
  }

  private configureSender(sender: RTCRtpSender, source: MediaSource): void {
    if (source !== "camera" && !source.startsWith("screen")) return
    this.setSenderParameters(
      sender,
      source.startsWith("screen")
        ? SCREEN_MAX_BITRATE
        : this.screenStream
          ? CAMERA_SHARING_MAX_BITRATE
          : CAMERA_MAX_BITRATE
    )
  }

  private setCameraSharingProfile(sharing: boolean): void {
    this.localStream
      ?.getVideoTracks()[0]
      ?.applyConstraints?.({
        width: { ideal: sharing ? 640 : 1280, max: sharing ? 640 : 1280 },
        height: { ideal: sharing ? 360 : 720, max: sharing ? 360 : 720 },
        frameRate: { ideal: 24, max: 24 }
      })
      .catch(() => {})
    for (const peer of this.peers.values()) {
      for (const sender of peer.getSenders?.() ?? []) {
        if (sender.track && this.sourceForTrack(sender.track) === "camera") {
          this.setSenderParameters(
            sender,
            sharing ? CAMERA_SHARING_MAX_BITRATE : CAMERA_MAX_BITRATE
          )
        }
      }
    }
  }

  private setSenderParameters(sender: RTCRtpSender, maxBitrate: number): void {
    try {
      const parameters = sender.getParameters()
      if (!parameters.encodings || parameters.encodings.length === 0) {
        parameters.encodings = [{}]
      }
      const encoding = parameters.encodings[0]
      if (encoding) encoding.maxBitrate = maxBitrate
      sender.setParameters(parameters).catch(() => {})
    } catch {
      // Some Firefox versions reject encoding changes before negotiation.
    }
  }
}
