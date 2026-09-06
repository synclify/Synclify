import type { CallSignal, IncomingCallSignal } from "~/types/call"

const VIDEO_MAX_BITRATE = 750_000

type CallControllerOptions = {
  sendSignal: (signal: CallSignal) => void
  onRemoteStream: (participantId: string, stream: MediaStream | null) => void
  onConnectionState?: (
    participantId: string,
    state: RTCPeerConnectionState
  ) => void
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>
  createPeerConnection?: (configuration: RTCConfiguration) => RTCPeerConnection
}

export class WebRtcCallController {
  private readonly peers = new Map<string, RTCPeerConnection>()
  private readonly remoteStreams = new Map<string, MediaStream>()
  private readonly pendingCandidates = new Map<
    string,
    Array<RTCIceCandidateInit | null>
  >()
  private readonly sendSignal: CallControllerOptions["sendSignal"]
  private readonly onRemoteStream: CallControllerOptions["onRemoteStream"]
  private readonly onConnectionState?: CallControllerOptions["onConnectionState"]
  private readonly getUserMedia: NonNullable<
    CallControllerOptions["getUserMedia"]
  >
  private readonly createPeerConnection: NonNullable<
    CallControllerOptions["createPeerConnection"]
  >
  private iceServers: RTCIceServer[] = []
  private localStream: MediaStream | null = null

  constructor(options: CallControllerOptions) {
    this.sendSignal = options.sendSignal
    this.onRemoteStream = options.onRemoteStream
    this.onConnectionState = options.onConnectionState
    this.getUserMedia =
      options.getUserMedia ??
      ((constraints) => navigator.mediaDevices.getUserMedia(constraints))
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
    return this.localStream
  }

  getLocalStream(): MediaStream | null {
    return this.localStream
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
      for (const peer of this.peers.values()) {
        const receivingTransceiver = peer
          .getTransceivers?.()
          .find(
            (transceiver) =>
              transceiver.receiver.track.kind === track.kind &&
              !transceiver.sender.track
          )
        const sender = receivingTransceiver
          ? receivingTransceiver.sender
          : peer.addTrack(track, this.localStream)
        if (receivingTransceiver) {
          await sender.replaceTrack(track)
          receivingTransceiver.direction = "sendrecv"
        }
        if (track.kind === "video") this.limitVideoBitrate(sender)
      }
    }
    await this.renegotiatePeers()
    return this.localStream
  }

  configure(iceServers: RTCIceServer[]): void {
    this.iceServers = iceServers
  }

  async connectToExisting(participantIds: string[]): Promise<void> {
    for (const participantId of participantIds) {
      const peer = this.getOrCreatePeer(participantId)
      const offer = await peer.createOffer()
      await peer.setLocalDescription(offer)
      this.sendSignal({
        toParticipantId: participantId,
        description: offer
      })
    }
  }

  private async renegotiatePeers(): Promise<void> {
    for (const [participantId, peer] of this.peers) {
      const offer = await peer.createOffer()
      await peer.setLocalDescription(offer)
      this.sendSignal({ toParticipantId: participantId, description: offer })
    }
  }

  async handleSignal(signal: IncomingCallSignal): Promise<void> {
    const participantId = signal.fromParticipantId
    const peer = this.getOrCreatePeer(participantId)

    if (signal.description) {
      await peer.setRemoteDescription(signal.description)
      await this.flushPendingCandidates(participantId, peer)

      if (signal.description.type === "offer") {
        const answer = await peer.createAnswer()
        await peer.setLocalDescription(answer)
        this.sendSignal({
          toParticipantId: participantId,
          description: answer
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
  }

  stop(): void {
    this.resetPeers()
    for (const track of this.localStream?.getTracks() ?? []) {
      track.stop()
    }
    this.localStream = null
    this.iceServers = []
  }

  private getOrCreatePeer(participantId: string): RTCPeerConnection {
    const existing = this.peers.get(participantId)
    if (existing) return existing
    if (!this.localStream) {
      throw new Error("Local media is required before creating a call peer")
    }

    const peer = this.createPeerConnection({ iceServers: this.iceServers })
    this.peers.set(participantId, peer)

    for (const track of this.localStream.getTracks()) {
      const sender = peer.addTrack(track, this.localStream)
      if (track.kind === "video") {
        this.limitVideoBitrate(sender)
      }
    }
    const localKinds = new Set(
      this.localStream.getTracks().map((track) => track.kind)
    )
    if (typeof peer.addTransceiver === "function") {
      if (!localKinds.has("audio")) {
        peer.addTransceiver("audio", { direction: "recvonly" })
      }
      if (!localKinds.has("video")) {
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
      let stream = event.streams[0]
      if (!stream) {
        stream = this.remoteStreams.get(participantId) ?? new MediaStream()
        if (!stream.getTracks().some((track) => track.id === event.track.id)) {
          stream.addTrack(event.track)
        }
      }
      this.remoteStreams.set(participantId, stream)
      this.onRemoteStream(participantId, stream)
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
    for (const candidate of candidates) {
      await peer.addIceCandidate(candidate)
    }
  }

  private removePeer(participantId: string): void {
    const peer = this.peers.get(participantId)
    peer?.close()
    this.peers.delete(participantId)
    this.pendingCandidates.delete(participantId)
    this.remoteStreams.delete(participantId)
    this.onRemoteStream(participantId, null)
  }

  private limitVideoBitrate(sender: RTCRtpSender): void {
    try {
      const parameters = sender.getParameters()
      if (!parameters.encodings || parameters.encodings.length === 0) {
        parameters.encodings = [{}]
      }
      const encoding = parameters.encodings[0]
      if (encoding) encoding.maxBitrate = VIDEO_MAX_BITRATE
      sender.setParameters(parameters).catch(() => {})
    } catch {
      // Some Firefox versions reject encoding changes before negotiation.
    }
  }
}
