import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import browser from "webextension-polyfill"
import { Mic, MicOff, PhoneOff, Video, VideoOff } from "lucide-react"
import logoUrl from "~/assets/logo.svg"
import { t } from "~/lib/i18n"
import type { CommunicationCommand } from "~/types/communication"
import type {
  ScreenShareRelayMessage,
  ScreenShareViewerBridgeMessage,
  ScreenShareRelayStream,
  ScreenShareViewerSnapshot
} from "~/types/screen-share"

function MediaVideo({
  stream,
  muted = false,
  offerAudio = false,
  className = ""
}: {
  stream?: MediaStream
  muted?: boolean
  offerAudio?: boolean
  className?: string
}) {
  const ref = useRef<HTMLVideoElement>(null)
  const [audioBlocked, setAudioBlocked] = useState(false)
  useEffect(() => {
    const video = ref.current
    if (!video) return
    video.srcObject = stream ?? null
    video.muted = muted
    video.play().catch(() => {
      if (!offerAudio) return
      video.muted = true
      video.play().catch(() => {})
      setAudioBlocked(true)
    })
    return () => {
      video.srcObject = null
    }
  }, [muted, offerAudio, stream])
  return (
    <>
      <video
        ref={ref}
        autoPlay
        playsInline
        muted={muted}
        className={className}
      />
      {audioBlocked && (
        <button
          type="button"
          className="enable-audio"
          onClick={() => {
            if (!ref.current) return
            ref.current.muted = false
            ref.current
              .play()
              .then(() => setAudioBlocked(false))
              .catch(() => {})
          }}>
          {t("playCallAudio")}
        </button>
      )}
    </>
  )
}

export default function App() {
  const params = useMemo(() => new URLSearchParams(location.search), [])
  const sourceTabId = Number(params.get("sourceTabId"))
  const roomId = params.get("roomId") ?? ""
  const expectedStartedAt = Number(params.get("shareStartedAt"))
  const [snapshot, setSnapshot] = useState<ScreenShareViewerSnapshot | null>(
    null
  )
  const [streams, setStreams] = useState<Record<string, MediaStream>>({})
  const [ended, setEnded] = useState(false)
  const [headerVisible, setHeaderVisible] = useState(true)
  const peerRef = useRef<RTCPeerConnection | null>(null)
  const viewerTabIdRef = useRef<number | null>(null)
  const generationRef = useRef(0)
  const descriptorsRef = useRef<ScreenShareRelayStream[]>([])
  const pendingCandidatesRef = useRef<RTCIceCandidateInit[]>([])
  const headerTimerRef = useRef<number | undefined>(undefined)

  const revealHeader = useCallback(() => {
    setHeaderVisible(true)
    if (headerTimerRef.current) window.clearTimeout(headerTimerRef.current)
    headerTimerRef.current = window.setTimeout(() => {
      setHeaderVisible(false)
    }, 2_200)
  }, [])

  useEffect(() => {
    document.title = `Synclify · ${t("viewSharedScreen")}`
    revealHeader()
    return () => {
      if (headerTimerRef.current) window.clearTimeout(headerTimerRef.current)
    }
  }, [revealHeader])

  const sendToSource = useCallback(
    (message: ScreenShareRelayMessage) =>
      browser.runtime.sendMessage({
        action: "screenShareRelayFromViewer",
        sourceTabId,
        roomId,
        shareStartedAt: expectedStartedAt,
        message
      } satisfies ScreenShareViewerBridgeMessage),
    [expectedStartedAt, roomId, sourceTabId]
  )

  const handleOffer = useCallback(
    async (
      tabId: number,
      message: Extract<ScreenShareRelayMessage, { kind: "offer" }>
    ) => {
      peerRef.current?.close()
      generationRef.current = message.generation
      descriptorsRef.current = message.streams
      setSnapshot(message.snapshot)
      setStreams({})
      const peer = new RTCPeerConnection()
      peerRef.current = peer
      peer.ontrack = (event) => {
        const stream = event.streams[0]
        if (!stream) return
        const descriptor = descriptorsRef.current.find(
          ({ streamId }) => streamId === stream.id
        )
        if (!descriptor) return
        setStreams((current) => ({
          ...current,
          [`${descriptor.kind}:${descriptor.participantId}`]: stream
        }))
      }
      peer.onicecandidate = (event) => {
        sendToSource({
          kind: "candidate",
          generation: message.generation,
          candidate: event.candidate?.toJSON() ?? null
        }).catch(() => {})
      }
      await peer.setRemoteDescription(message.description)
      const answer = await peer.createAnswer()
      await peer.setLocalDescription(answer)
      await sendToSource({
        kind: "answer",
        generation: message.generation,
        description: answer
      })
      for (const candidate of pendingCandidatesRef.current.splice(0)) {
        await peer.addIceCandidate(candidate)
      }
      viewerTabIdRef.current = tabId
    },
    [sendToSource]
  )

  useEffect(() => {
    let closeTimer: number | undefined
    const listener = (raw: unknown) => {
      const payload = raw as {
        to?: string
        viewerTabId?: number
        message?: ScreenShareRelayMessage
      }
      if (
        payload.to !== "screenShareViewer" ||
        payload.viewerTabId !== viewerTabIdRef.current ||
        !payload.message
      ) {
        return
      }
      const message = payload.message
      if (message.kind === "offer") {
        handleOffer(payload.viewerTabId, message).catch(() => setEnded(true))
      } else if (
        message.kind === "candidate" &&
        message.generation === generationRef.current &&
        message.candidate
      ) {
        if (peerRef.current?.remoteDescription) {
          peerRef.current.addIceCandidate(message.candidate).catch(() => {})
        } else {
          pendingCandidatesRef.current.push(message.candidate)
        }
      } else if (message.kind === "state") {
        setSnapshot(message.snapshot)
      } else if (message.kind === "ended") {
        setEnded(true)
        closeTimer = window.setTimeout(() => {
          browser.runtime.sendMessage({
            action: "closeScreenShareViewer",
            sourceTabId,
            roomId,
            shareStartedAt: expectedStartedAt
          } satisfies ScreenShareViewerBridgeMessage)
        }, 1_500)
      }
    }
    browser.runtime.onMessage.addListener(listener)
    browser.runtime
      .sendMessage({ action: "getSenderTabId" })
      .then((id) => {
        const tabId = id as number
        viewerTabIdRef.current = tabId
        return browser.runtime.sendMessage({
          action: "screenShareViewerReady",
          sourceTabId,
          roomId,
          shareStartedAt: expectedStartedAt
        } satisfies ScreenShareViewerBridgeMessage)
      })
      .catch(() => setEnded(true))

    const notifyClosed = () => {
      browser.runtime
        .sendMessage({
          action: "screenShareViewerClosed",
          sourceTabId,
          roomId,
          shareStartedAt: expectedStartedAt
        } satisfies ScreenShareViewerBridgeMessage)
        .catch(() => {})
    }
    window.addEventListener("pagehide", notifyClosed)
    return () => {
      if (closeTimer) window.clearTimeout(closeTimer)
      browser.runtime.onMessage.removeListener(listener)
      window.removeEventListener("pagehide", notifyClosed)
      peerRef.current?.close()
    }
  }, [expectedStartedAt, handleOffer, roomId, sourceTabId])

  const command = (value: CommunicationCommand) =>
    browser.runtime.sendMessage({
      action: "screenShareViewerCommand",
      sourceTabId,
      roomId,
      shareStartedAt: expectedStartedAt,
      command: value
    } satisfies ScreenShareViewerBridgeMessage)

  const screenStream = snapshot
    ? streams[`screen:${snapshot.sharerId}`]
    : undefined
  const cameras = snapshot?.participants ?? []

  return (
    <main className="viewer-shell" onMouseMove={revealHeader}>
      <header
        className={`viewer-header${headerVisible ? " visible" : ""}`}
        aria-hidden={!headerVisible}>
        <div className="brand-lockup">
          <img src={logoUrl} alt="Synclify" />
        </div>
        <div className="share-status">
          <span className={ended ? "status-dot ended" : "status-dot"} />
          {ended
            ? t("screenShareEnded")
            : snapshot
              ? `${snapshot.sharerName} ${t("isSharingScreen")}`
              : t("screenShareConnecting")}
        </div>
      </header>

      <section className="screen-stage" aria-label={t("viewSharedScreen")}>
        {screenStream && !ended ? (
          <MediaVideo
            stream={screenStream}
            offerAudio
            className="screen-video"
          />
        ) : (
          <div className="screen-placeholder">
            <div className="signal-mark">
              <span />
              <span />
              <span />
            </div>
            <h1>
              {ended ? t("screenShareEnded") : t("screenShareConnecting")}
            </h1>
            <p>
              {ended ? t("screenShareReturning") : t("screenShareReadySoon")}
            </p>
          </div>
        )}
        <div className="stage-grain" />
      </section>

      <aside className="right-rail">
        <div className="viewer-controls">
          <button
            type="button"
            className={!snapshot?.micEnabled ? "control off" : "control"}
            disabled={!snapshot || ended}
            onClick={() =>
              command({ kind: "setMic", enabled: !snapshot?.micEnabled })
            }
            aria-label={
              snapshot?.micEnabled ? t("muteMicrophone") : t("unmuteMicrophone")
            }>
            {snapshot?.micEnabled ? <Mic /> : <MicOff />}
          </button>
          <button
            type="button"
            className={!snapshot?.cameraEnabled ? "control off" : "control"}
            disabled={!snapshot || ended}
            onClick={() =>
              command({ kind: "setCamera", enabled: !snapshot?.cameraEnabled })
            }
            aria-label={
              snapshot?.cameraEnabled ? t("hideCamera") : t("showCamera")
            }>
            {snapshot?.cameraEnabled ? <Video /> : <VideoOff />}
          </button>
          <button
            type="button"
            className="control leave"
            disabled={!snapshot || ended}
            onClick={() => command({ kind: "leaveCall" })}
            aria-label={t("leaveVideoCall")}>
            <PhoneOff />
          </button>
        </div>

        <section className="participant-rail" aria-label={t("participants")}>
          {cameras.map((participant) => {
            const stream = streams[`camera:${participant.id}`]
            const cameraVisible = participant.cameraEnabled && !!stream
            return (
              <article className="participant-card" key={participant.id}>
                {cameraVisible ? (
                  <MediaVideo
                    stream={stream}
                    muted
                    className={`camera-video${participant.id === snapshot?.selfId ? " mirror" : ""}`}
                  />
                ) : (
                  <div className="participant-avatar">
                    {participant.nickname.slice(0, 1).toUpperCase()}
                  </div>
                )}
                <div className="participant-label">
                  <span>
                    {participant.id === snapshot?.selfId
                      ? t("you")
                      : participant.nickname}
                  </span>
                  {!participant.micEnabled && (
                    <MicOff size={13} aria-label="Muted" />
                  )}
                </div>
              </article>
            )
          })}
        </section>
      </aside>
    </main>
  )
}
