import type {
  ScreenShareRelayMessage,
  ScreenShareRelayStream,
  ScreenShareViewerSnapshot
} from "~/types/screen-share"

export type RelayMedia = Omit<ScreenShareRelayStream, "streamId"> & {
  stream: MediaStream
}

export class ScreenShareRelayHost {
  private peer: RTCPeerConnection | null = null
  private generation = 0
  private viewerTabId: number | null = null
  private pendingCandidates: RTCIceCandidateInit[] = []

  constructor(
    private readonly send: (
      viewerTabId: number,
      message: ScreenShareRelayMessage
    ) => void,
    private readonly createPeerConnection: () => RTCPeerConnection = () =>
      new RTCPeerConnection(),
    private readonly createMediaStream: () => MediaStream = () =>
      new MediaStream()
  ) {}

  async connect(
    viewerTabId: number,
    media: RelayMedia[],
    snapshot: ScreenShareViewerSnapshot
  ): Promise<void> {
    this.closePeer()
    this.viewerTabId = viewerTabId
    const generation = ++this.generation
    const peer = this.createPeerConnection()
    this.peer = peer
    const streams: ScreenShareRelayStream[] = []

    for (const item of media) {
      const relayStream = this.createMediaStream()
      const tracks =
        item.kind === "screen"
          ? item.stream.getTracks()
          : item.stream.getVideoTracks()
      for (const track of tracks) relayStream.addTrack(track)
      if (relayStream.getTracks().length === 0) continue
      for (const track of relayStream.getTracks()) {
        peer.addTrack(track, relayStream)
      }
      streams.push({
        streamId: relayStream.id,
        participantId: item.participantId,
        kind: item.kind,
        self: item.self
      })
    }

    peer.onicecandidate = (event) => {
      if (this.viewerTabId !== viewerTabId || this.generation !== generation) {
        return
      }
      this.send(viewerTabId, {
        kind: "candidate",
        generation,
        candidate: event.candidate?.toJSON() ?? null
      })
    }
    const offer = await peer.createOffer()
    await peer.setLocalDescription(offer)
    this.send(viewerTabId, {
      kind: "offer",
      generation,
      description: offer,
      streams,
      snapshot
    })
  }

  async handle(message: ScreenShareRelayMessage): Promise<void> {
    if (
      !this.peer ||
      !("generation" in message) ||
      message.generation !== this.generation
    ) {
      return
    }
    if (message.kind === "answer") {
      await this.peer.setRemoteDescription(message.description)
      for (const candidate of this.pendingCandidates.splice(0)) {
        await this.peer.addIceCandidate(candidate)
      }
    } else if (message.kind === "candidate" && message.candidate) {
      if (this.peer.remoteDescription) {
        await this.peer.addIceCandidate(message.candidate)
      } else {
        this.pendingCandidates.push(message.candidate)
      }
    }
  }

  updateState(snapshot: ScreenShareViewerSnapshot): void {
    if (this.viewerTabId !== null) {
      this.send(this.viewerTabId, { kind: "state", snapshot })
    }
  }

  end(): void {
    if (this.viewerTabId !== null) {
      this.send(this.viewerTabId, { kind: "ended" })
    }
    this.close()
  }

  close(): void {
    this.closePeer()
    this.viewerTabId = null
  }

  private closePeer(): void {
    this.peer?.close()
    this.peer = null
    this.pendingCandidates = []
  }
}
