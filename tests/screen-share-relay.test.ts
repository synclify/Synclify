import test from "node:test"
import assert from "node:assert/strict"
import { ScreenShareRelayHost } from "../src/lib/screen-share-relay"
import type {
  ScreenShareRelayMessage,
  ScreenShareViewerSnapshot
} from "../src/types/screen-share"

class FakeRelayStream {
  readonly id = `stream-${Math.random()}`
  readonly tracks: Array<{ kind: string }> = []

  addTrack(track: { kind: string }) {
    this.tracks.push(track)
  }

  getTracks() {
    return this.tracks
  }
}

class FakeSourceStream {
  constructor(readonly tracks: Array<{ kind: string }>) {}

  getTracks() {
    return this.tracks
  }

  getVideoTracks() {
    return this.tracks.filter((track) => track.kind === "video")
  }
}

class FakeRelayPeer {
  localDescription: RTCSessionDescription | null = null
  remoteDescription: RTCSessionDescription | null = null
  onicecandidate: ((event: RTCPeerConnectionIceEvent) => unknown) | null = null
  readonly tracks: Array<{ kind: string }> = []
  readonly candidates: RTCIceCandidateInit[] = []
  closed = false

  addTrack(track: { kind: string }) {
    this.tracks.push(track)
  }

  async createOffer(): Promise<RTCSessionDescriptionInit> {
    return { type: "offer", sdp: "offer" }
  }

  async setLocalDescription(description: RTCSessionDescriptionInit) {
    this.localDescription = description as RTCSessionDescription
  }

  async setRemoteDescription(description: RTCSessionDescriptionInit) {
    this.remoteDescription = description as RTCSessionDescription
  }

  async addIceCandidate(candidate: RTCIceCandidateInit) {
    this.candidates.push(candidate)
  }

  close() {
    this.closed = true
  }
}

const snapshot: ScreenShareViewerSnapshot = {
  roomId: "ROOM1",
  shareStartedAt: 123,
  sharerId: "a",
  sharerName: "Ada",
  participants: [
    {
      id: "a",
      nickname: "Ada",
      joinedAt: 1,
      micEnabled: true,
      cameraEnabled: true
    }
  ],
  selfId: "b",
  micEnabled: true,
  cameraEnabled: true
}

test("relays screen media and camera video with explicit descriptors", async () => {
  const messages: ScreenShareRelayMessage[] = []
  const peer = new FakeRelayPeer()
  const host = new ScreenShareRelayHost(
    (_viewerTabId, message) => messages.push(message),
    () => peer as unknown as RTCPeerConnection,
    () => new FakeRelayStream() as unknown as MediaStream
  )
  const screen = new FakeSourceStream([{ kind: "video" }, { kind: "audio" }])
  const camera = new FakeSourceStream([{ kind: "video" }, { kind: "audio" }])

  await host.connect(
    7,
    [
      {
        stream: screen as unknown as MediaStream,
        participantId: "a",
        kind: "screen",
        self: false
      },
      {
        stream: camera as unknown as MediaStream,
        participantId: "b",
        kind: "camera",
        self: true
      }
    ],
    snapshot
  )

  assert.equal(peer.tracks.length, 3)
  const offer = messages[0]
  assert.equal(offer?.kind, "offer")
  if (offer?.kind !== "offer") return
  assert.deepEqual(
    offer.streams.map(({ kind, participantId }) => [kind, participantId]),
    [
      ["screen", "a"],
      ["camera", "b"]
    ]
  )
})

test("queues relay ICE until the viewer answer and closes independently", async () => {
  const messages: ScreenShareRelayMessage[] = []
  const peer = new FakeRelayPeer()
  const host = new ScreenShareRelayHost(
    (_viewerTabId, message) => messages.push(message),
    () => peer as unknown as RTCPeerConnection,
    () => new FakeRelayStream() as unknown as MediaStream
  )

  await host.connect(7, [], snapshot)
  await host.handle({
    kind: "candidate",
    generation: 1,
    candidate: { candidate: "viewer-candidate" }
  })
  assert.equal(peer.candidates.length, 0)
  await host.handle({
    kind: "answer",
    generation: 1,
    description: { type: "answer", sdp: "answer" }
  })
  assert.equal(peer.candidates.length, 1)

  host.end()
  assert.equal(peer.closed, true)
  assert.equal(messages.at(-1)?.kind, "ended")
})
