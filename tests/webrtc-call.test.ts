import test from "node:test"
import assert from "node:assert/strict"
import { WebRtcCallController } from "../src/lib/webrtc-call"

class FakeTrack {
  enabled = true
  stopped = false

  constructor(
    readonly kind: "audio" | "video",
    readonly id: string
  ) {}

  stop() {
    this.stopped = true
  }
}

class FakeStream {
  readonly audio = new FakeTrack("audio", "audio-1")
  readonly video = new FakeTrack("video", "video-1")

  getTracks() {
    return [this.audio, this.video]
  }

  getAudioTracks() {
    return [this.audio]
  }

  getVideoTracks() {
    return [this.video]
  }
}

class FakeSender {
  parameters: RTCRtpSendParameters = {
    transactionId: "test",
    codecs: [],
    encodings: [],
    headerExtensions: [],
    rtcp: { cname: "", reducedSize: false }
  }

  getParameters() {
    return this.parameters
  }

  async setParameters(parameters: RTCRtpSendParameters) {
    this.parameters = parameters
  }
}

class FakePeerConnection {
  localDescription: RTCSessionDescription | null = null
  remoteDescription: RTCSessionDescription | null = null
  connectionState: RTCPeerConnectionState = "new"
  onicecandidate: ((event: RTCPeerConnectionIceEvent) => unknown) | null = null
  ontrack: ((event: RTCTrackEvent) => unknown) | null = null
  onconnectionstatechange: (() => unknown) | null = null
  readonly candidates: Array<RTCIceCandidateInit | null> = []
  readonly senders: FakeSender[] = []
  closed = false

  addTrack() {
    const sender = new FakeSender()
    this.senders.push(sender)
    return sender as unknown as RTCRtpSender
  }

  async createOffer(): Promise<RTCSessionDescriptionInit> {
    return { type: "offer", sdp: "offer" }
  }

  async createAnswer(): Promise<RTCSessionDescriptionInit> {
    return { type: "answer", sdp: "answer" }
  }

  async setLocalDescription(description: RTCSessionDescriptionInit) {
    this.localDescription = description as RTCSessionDescription
  }

  async setRemoteDescription(description: RTCSessionDescriptionInit) {
    this.remoteDescription = description as RTCSessionDescription
  }

  async addIceCandidate(candidate?: RTCIceCandidateInit | null) {
    this.candidates.push(candidate ?? null)
  }

  close() {
    this.closed = true
    this.connectionState = "closed"
  }
}

function createHarness() {
  const stream = new FakeStream()
  let mediaCalls = 0
  const peers = new Map<string, FakePeerConnection>()
  const signals: Array<{
    toParticipantId: string
    description?: RTCSessionDescriptionInit
    candidate?: RTCIceCandidateInit | null
  }> = []
  const controller = new WebRtcCallController({
    sendSignal: (signal) => signals.push(signal),
    onRemoteStream: () => {},
    getUserMedia: async () => {
      mediaCalls += 1
      return stream as unknown as MediaStream
    },
    createPeerConnection: () => {
      const peer = new FakePeerConnection()
      peers.set(String(peers.size), peer)
      return peer as unknown as RTCPeerConnection
    }
  })
  return {
    controller,
    stream,
    peers,
    signals,
    get mediaCalls() {
      return mediaCalls
    }
  }
}

test("acquires constrained media and creates offers for existing callers", async () => {
  const harness = createHarness()
  await harness.controller.acquireLocalMedia()
  harness.controller.configure([{ urls: "stun:stun.example" }])
  await harness.controller.connectToExisting(["one", "two"])

  assert.equal(harness.peers.size, 2)
  assert.deepEqual(
    harness.signals.map((signal) => [
      signal.toParticipantId,
      signal.description?.type
    ]),
    [
      ["one", "offer"],
      ["two", "offer"]
    ]
  )
})

test("surfaces media permission failures without creating peers", async () => {
  const controller = new WebRtcCallController({
    sendSignal: () => {},
    onRemoteStream: () => {},
    getUserMedia: async () => {
      throw new DOMException("Permission denied", "NotAllowedError")
    }
  })

  await assert.rejects(
    controller.acquireLocalMedia(),
    (error: DOMException) => error.name === "NotAllowedError"
  )
  controller.stop()
})

test("queues ICE candidates until the remote offer is applied", async () => {
  const harness = createHarness()
  await harness.controller.acquireLocalMedia()

  await harness.controller.handleSignal({
    roomId: "ROOM1",
    fromParticipantId: "peer",
    candidate: { candidate: "candidate-1" }
  })
  const peer = harness.peers.values().next().value as FakePeerConnection
  assert.equal(peer.candidates.length, 0)

  await harness.controller.handleSignal({
    roomId: "ROOM1",
    fromParticipantId: "peer",
    description: { type: "offer", sdp: "offer" }
  })
  assert.deepEqual(peer.candidates, [{ candidate: "candidate-1" }])
  assert.equal(harness.signals.at(-1)?.description?.type, "answer")
})

test("toggles local tracks and stops every resource", async () => {
  const harness = createHarness()
  await harness.controller.acquireLocalMedia()
  await harness.controller.connectToExisting(["peer"])

  harness.controller.setMicEnabled(false)
  harness.controller.setCameraEnabled(false)
  assert.equal(harness.stream.audio.enabled, false)
  assert.equal(harness.stream.video.enabled, false)

  const peer = harness.peers.values().next().value as FakePeerConnection
  harness.controller.stop()
  assert.equal(harness.stream.audio.stopped, true)
  assert.equal(harness.stream.video.stopped, true)
  assert.equal(peer.closed, true)
})

test("removes peer connections that leave the active call", async () => {
  const harness = createHarness()
  await harness.controller.acquireLocalMedia()
  await harness.controller.connectToExisting(["one", "two"])
  const peers = Array.from(harness.peers.values())

  harness.controller.syncParticipants(["two"])
  assert.equal(peers[0]?.closed, true)
  assert.equal(peers[1]?.closed, false)
})

test("resets peer connections without reacquiring or stopping local media", async () => {
  const harness = createHarness()
  const firstStream = await harness.controller.acquireLocalMedia()
  await harness.controller.connectToExisting(["one"])

  harness.controller.resetPeers()
  const secondStream = await harness.controller.acquireLocalMedia()
  await harness.controller.connectToExisting(["two"])

  assert.equal(firstStream, secondStream)
  assert.equal(harness.mediaCalls, 1)
  assert.equal(harness.stream.audio.stopped, false)
  assert.equal(harness.stream.video.stopped, false)
})

test("adds a newly enabled camera track without replacing local media", async () => {
  const audio = new FakeTrack("audio", "audio-only")
  const video = new FakeTrack("video", "video-later")
  const localTracks: FakeTrack[] = [audio]
  const localStream = {
    getTracks: () => localTracks,
    getAudioTracks: () => localTracks.filter((track) => track.kind === "audio"),
    getVideoTracks: () => localTracks.filter((track) => track.kind === "video"),
    addTrack: (track: FakeTrack) => localTracks.push(track)
  }
  const cameraStream = {
    getTracks: () => [video],
    getAudioTracks: () => [],
    getVideoTracks: () => [video]
  }
  const signals: Array<{ description?: RTCSessionDescriptionInit }> = []
  let mediaCalls = 0
  const controller = new WebRtcCallController({
    sendSignal: (signal) => signals.push(signal),
    onRemoteStream: () => {},
    getUserMedia: async () => {
      mediaCalls += 1
      return (mediaCalls === 1
        ? localStream
        : cameraStream) as unknown as MediaStream
    },
    createPeerConnection: () =>
      new FakePeerConnection() as unknown as RTCPeerConnection
  })

  const originalStream = await controller.acquireLocalMedia({
    audio: true,
    video: false
  })
  await controller.connectToExisting(["peer"])
  const updatedStream = await controller.ensureMedia("video")

  assert.equal(updatedStream, originalStream)
  assert.equal(mediaCalls, 2)
  assert.equal(localStream.getVideoTracks()[0], video)
  assert.equal(signals.at(-1)?.description?.type, "offer")
})
