import { useEffect, useRef, useState } from "react"
import type { CSSProperties } from "react"
import browser from "webextension-polyfill"
import {
  ChevronDown,
  ChevronUp,
  MessageSquare,
  Mic,
  MicOff,
  MonitorUp,
  PhoneOff,
  ScreenShareOff,
  Users,
  Video,
  VideoOff
} from "lucide-react"
import { t } from "~/lib/i18n"
import { cn } from "~/lib/utils"
import { sortCallParticipants } from "~/types/communication"
import type {
  CommunicationCommand,
  CommunicationSnapshot,
  CommunicationView
} from "~/types/communication"

const roundButtonClass =
  "grid h-[42px] w-[42px] cursor-pointer place-items-center rounded-full border border-white/[.13] bg-white/[.07] p-0 text-[#f2eee5] transition-colors hover:bg-white/[.12] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f4b238]"
const compactButtonClass =
  "relative inline-flex h-[29px] w-[29px] shrink-0 cursor-pointer items-center justify-center rounded-full border border-white/[.13] bg-white/[.07] p-0 leading-none text-[#f2eee5] transition-colors hover:bg-white/[.12] disabled:cursor-not-allowed disabled:opacity-35 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f4b238] [&>svg]:m-auto [&>svg]:block [&>svg]:shrink-0"
const mediaOffClass = "border-[#f4b238]/35 bg-[#f4b238]/10 text-[#f4b238]"

export function MicIcon({ off = false }: { off?: boolean }) {
  const Icon = off ? MicOff : Mic
  return <Icon aria-hidden="true" size={18} strokeWidth={2} />
}

export function CameraIcon({ off = false }: { off?: boolean }) {
  const Icon = off ? VideoOff : Video
  return <Icon aria-hidden="true" size={19} strokeWidth={2} />
}

export function ChatIcon() {
  return <MessageSquare aria-hidden="true" size={18} strokeWidth={2} />
}

export function ParticipantsIcon() {
  return <Users aria-hidden="true" size={18} strokeWidth={2} />
}

export function EndCallIcon() {
  return <PhoneOff aria-hidden="true" size={17} strokeWidth={2} />
}

function ControlToggleIcon({ open }: { open: boolean }) {
  const Icon = open ? ChevronDown : ChevronUp
  return <Icon aria-hidden="true" size={16} strokeWidth={2} />
}

function SlidingParticipantName({ text }: { text: string }) {
  const containerRef = useRef<HTMLSpanElement>(null)
  const textRef = useRef<HTMLSpanElement>(null)
  const [overflow, setOverflow] = useState(0)

  useEffect(() => {
    const update = () => {
      const container = containerRef.current
      const textElement = textRef.current
      if (!container || !textElement) return
      setOverflow(Math.max(0, textElement.scrollWidth - container.clientWidth))
    }
    update()
    const observer = new ResizeObserver(update)
    if (containerRef.current) observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [text])

  return (
    <span
      ref={containerRef}
      className={cn(
        "relative block max-w-[92px] overflow-hidden whitespace-nowrap",
        overflow > 0 &&
          "after:absolute after:right-0 after:top-0 after:bg-gradient-to-r after:from-transparent after:to-[#05070a] after:pl-2 after:content-['…'] group-hover/name:after:opacity-0"
      )}
      title={text}>
      <span
        ref={textRef}
        className={cn(
          "inline-block min-w-max translate-x-0 transition-transform ease-in-out [transition-duration:1800ms]",
          overflow > 0 &&
            "group-hover/name:[transform:translateX(calc(-1*var(--sc-name-shift)))]"
        )}
        style={{ "--sc-name-shift": `${overflow}px` } as CSSProperties}>
        {text}
      </span>
    </span>
  )
}

export type VideoTileProps = {
  participant: CommunicationSnapshot["callState"]["participants"][number]
  stream?: MediaStream
  self: boolean
  connectionState?: RTCPeerConnectionState
  compact?: boolean
  muteAudio?: boolean
  featured?: boolean
  className?: string
  videoClassName?: string
}

export function ParticipantVideo({
  participant,
  stream,
  self,
  connectionState,
  compact = false,
  muteAudio = false,
  featured = false,
  className,
  videoClassName
}: VideoTileProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [blocked, setBlocked] = useState(false)
  const participantName = `${participant.nickname || t("anonymousNickname")}${
    self ? ` ${t("callYouSuffix")}` : ""
  }`

  useEffect(() => {
    if (!videoRef.current) return
    videoRef.current.srcObject = stream ?? null
    if (stream) {
      videoRef.current
        .play()
        .then(() => setBlocked(false))
        .catch(() => setBlocked(!self))
    }
  }, [self, stream])

  return (
    <article
      className={cn(
        "relative aspect-video min-h-[126px] overflow-hidden rounded-[13px] border border-white/[.09] bg-[#11151c] shadow-[inset_0_1px_rgba(255,255,255,.04)]",
        featured && "border-[#f4b238]/25",
        compact && "min-h-0 rounded-lg",
        className
      )}>
      <div className="absolute inset-0 grid place-items-center bg-[radial-gradient(circle_at_50%_34%,#29303d,#11151c_67%)]">
        <span
          className={cn(
            "grid h-14 w-14 place-items-center rounded-full border border-[#f4b238]/30 bg-[#f4b238]/10 font-sans text-[22px] font-semibold text-[#f4b238] shadow-[0_0_34px_rgba(244,178,56,.09)]",
            compact && "h-[30px] w-[30px] text-[13px]"
          )}>
          {(participant.nickname || "?").slice(0, 1).toUpperCase()}
        </span>
      </div>
      {stream && (
        <video
          ref={videoRef}
          className={cn(
            "absolute inset-0 h-full w-full bg-[#11151c] object-cover",
            self && "-scale-x-100",
            participant.cameraEnabled ? "opacity-100" : "opacity-0",
            videoClassName
          )}
          autoPlay
          playsInline
          muted={self || muteAudio}
        />
      )}
      {!self &&
        connectionState !== "connected" &&
        participant.cameraEnabled && (
          <span className="absolute right-[7px] top-[7px] rounded-md bg-[#05070a]/70 px-1.5 py-[3px] font-mono text-[8px] uppercase tracking-[.08em] text-[#c7cad1]">
            {t("callConnecting")}
          </span>
        )}
      {blocked && (
        <button
          type="button"
          className="absolute right-[7px] top-[7px] cursor-pointer rounded-md border-0 bg-[#05070a]/70 px-1.5 py-[3px] font-mono text-[8px] uppercase tracking-[.08em] text-[#c7cad1]"
          onClick={() =>
            videoRef.current?.play().then(() => setBlocked(false))
          }>
          {t("playCallAudio")}
        </button>
      )}
      <div
        className={cn(
          "group/name absolute bottom-[7px] left-[7px] flex max-w-[calc(100%-14px)] items-center gap-[5px] overflow-hidden rounded-[7px] border border-white/[.08] bg-[#05070a]/75 px-1.5 py-[3px] text-[8px] backdrop-blur-xl",
          compact &&
            "bottom-1 left-1 max-w-[calc(100%-8px)] rounded-[5px] px-1 py-0.5 text-[6px]"
        )}>
        <SlidingParticipantName text={participantName} />
        {(!participant.micEnabled || !participant.cameraEnabled) && (
          <span className={cn("text-rose-400", compact && "hidden")}>
            {!participant.micEnabled ? "Mic off" : "Camera off"}
          </span>
        )}
      </div>
    </article>
  )
}

type PanelProps = {
  snapshot: CommunicationSnapshot
  streams: Record<string, MediaStream>
  dispatch: (command: CommunicationCommand) => void
  activeParticipantId?: string
  visibleVideoCount?: number
  fillAvailable?: boolean
  stackVideos?: boolean
}

export function CommunicationPanel({
  snapshot,
  streams,
  dispatch,
  activeParticipantId,
  visibleVideoCount = 1,
  fillAvailable = false,
  stackVideos = false
}: PanelProps) {
  const [draft, setDraft] = useState("")
  const [prejoinMic, setPrejoinMic] = useState(true)
  const [prejoinCamera, setPrejoinCamera] = useState(true)
  const [controlsOpen, setControlsOpen] = useState(false)
  const messagesRef = useRef<HTMLDivElement>(null)
  const participants = sortCallParticipants(
    snapshot.callState.participants,
    snapshot.selfId
  )
  const remoteParticipants = participants.filter(
    (participant) => participant.id !== snapshot.selfId
  )
  const localParticipant = participants.find(
    (participant) => participant.id === snapshot.selfId
  )
  const activeParticipant =
    remoteParticipants.find(
      (participant) => participant.id === activeParticipantId
    ) ?? remoteParticipants[0]
  const visibleParticipants = activeParticipant
    ? [
        activeParticipant,
        ...remoteParticipants.filter(
          (participant) => participant.id !== activeParticipant.id
        )
      ].slice(0, visibleVideoCount)
    : []
  const callFull =
    snapshot.callState.participantCount >=
    (snapshot.callState.screenShare.active
      ? snapshot.callState.screenShare.maxParticipants
      : snapshot.callState.maxParticipants)
  const callActionLabel = snapshot.joining
    ? "Connecting…"
    : callFull
      ? "Call is full"
      : snapshot.rejoinSuggested
        ? "Rejoin call"
        : snapshot.callState.active
          ? "Join call"
          : "Start call"
  const controlsAlwaysVisible = snapshot.view !== "call"
  const controlsVisible = controlsAlwaysVisible || controlsOpen
  const screenShare = snapshot.callState.screenShare
  const isScreenSharer =
    screenShare.active && screenShare.participantId === snapshot.selfId
  const remoteSharer = snapshot.callState.participants.find(
    ({ id }) => id === screenShare.participantId
  )
  const screenShareBlocked =
    !screenShare.active &&
    snapshot.callState.participantCount > screenShare.maxParticipants

  useEffect(() => {
    if (snapshot.view === "chat") dispatch({ kind: "markChatRead" })
  }, [dispatch, snapshot.view])

  useEffect(() => {
    if (snapshot.view === "chat" && messagesRef.current) {
      messagesRef.current.scrollTop = messagesRef.current.scrollHeight
    }
  }, [snapshot.messages, snapshot.view])

  const selectView = (view: CommunicationView) =>
    dispatch({ kind: "openView", view })
  const submit = () => {
    if (!draft.trim()) return
    dispatch({ kind: "sendChat", text: draft })
    setDraft("")
  }

  return (
    <section
      className="relative flex h-full min-h-0 w-full flex-col overflow-hidden rounded-[inherit] bg-[radial-gradient(circle_at_82%_-8%,rgba(244,178,56,.16),transparent_31%),linear-gradient(155deg,#15161a_0%,#080a0f_62%)] font-sans text-[13px] leading-[1.4] text-[#f2eee5] antialiased"
      aria-label="Synclify communication">
      <div
        className={cn(
          "relative flex min-h-0 flex-1 flex-col overflow-auto",
          !snapshot.inCall && "pb-10",
          fillAvailable && "overflow-hidden"
        )}>
        {snapshot.view === "call" && (
          <div
            className={cn(
              "flex min-h-full flex-col",
              fillAvailable && "h-full min-h-0"
            )}>
            {!snapshot.inCall ? (
              <div className="flex min-h-full flex-1 items-center justify-center p-3">
                <div className="flex max-w-[300px] flex-col items-center gap-2.5">
                  <div
                    className="flex items-center justify-center gap-[5px] rounded-[20px] border border-white/10 bg-[#080a0f]/70 p-[5px] shadow-[0_12px_34px_rgba(0,0,0,.32)] backdrop-blur-2xl"
                    aria-label="Call setup">
                    <button
                      type="button"
                      className={cn(
                        roundButtonClass,
                        !prejoinMic && mediaOffClass
                      )}
                      onClick={() => setPrejoinMic((value) => !value)}
                      aria-label={
                        prejoinMic ? t("muteMicrophone") : t("unmuteMicrophone")
                      }
                      title={
                        prejoinMic ? t("muteMicrophone") : t("unmuteMicrophone")
                      }>
                      <MicIcon off={!prejoinMic} />
                    </button>
                    <button
                      type="button"
                      className={cn(
                        roundButtonClass,
                        !prejoinCamera && mediaOffClass
                      )}
                      onClick={() => setPrejoinCamera((value) => !value)}
                      aria-label={
                        prejoinCamera ? t("hideCamera") : t("showCamera")
                      }
                      title={prejoinCamera ? t("hideCamera") : t("showCamera")}>
                      <CameraIcon off={!prejoinCamera} />
                    </button>
                    <button
                      type="button"
                      className={cn(
                        "grid h-[42px] min-w-[82px] cursor-pointer place-items-center rounded-[15px] border-0 bg-[#f4b238] px-3 text-[11px] font-extrabold text-[#080a0f] shadow-[0_10px_28px_rgba(244,178,56,.18)] transition hover:-translate-y-px hover:bg-[#ffc14c] disabled:cursor-wait disabled:opacity-50",
                        snapshot.joining && "animate-pulse"
                      )}
                      disabled={snapshot.joining || callFull}
                      onClick={() =>
                        dispatch({
                          kind: "joinCall",
                          micEnabled: prejoinMic,
                          cameraEnabled: prejoinCamera
                        })
                      }
                      aria-label={callActionLabel}
                      title={callActionLabel}>
                      {callActionLabel}
                    </button>
                  </div>
                  {callFull && (
                    <p
                      className="text-center text-[11px] leading-relaxed text-[#b9bbc2]"
                      role="status">
                      {snapshot.callState.screenShare.active ? (
                        t("screenShareLimitError")
                      ) : (
                        <>
                          Video calls currently support up to 4 people. Need
                          room for more? Tell us through the{" "}
                          <a
                            className="font-semibold text-[#f4b238] underline decoration-[#f4b238]/50 underline-offset-2 transition hover:text-[#ffc14c]"
                            href="https://forms.gle/tMiFzZPLHVjqjJwm7"
                            target="_blank"
                            rel="noopener noreferrer">
                            Synclify feedback form
                          </a>
                          .
                        </>
                      )}
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <>
                {snapshot.connectionStatus === "reconnecting" && (
                  <div
                    className="mx-3 mt-2.5 rounded-[9px] border border-rose-400/30 bg-red-900/20 px-2.5 py-[9px] text-center text-[11px] text-rose-300"
                    role="status">
                    Reconnecting without dropping your camera and microphone…
                  </div>
                )}
                {screenShare.active && (
                  <div className="mx-3 mt-2.5 flex items-center gap-2 rounded-[10px] border border-[#f4b238]/30 bg-[#f4b238]/10 px-2.5 py-2 text-[10px] text-[#e7e4dd]">
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-[#f4b238]/15 text-[#f4b238]">
                      <MonitorUp aria-hidden="true" size={15} strokeWidth={2} />
                    </span>
                    <span className="min-w-0 flex-1 truncate">
                      {isScreenSharer
                        ? t("youAreSharingScreen")
                        : `${remoteSharer?.nickname || t("anonymousNickname")} ${t("isSharingScreen")}`}
                    </span>
                    <button
                      type="button"
                      className="shrink-0 cursor-pointer rounded-lg border border-[#f4b238]/30 bg-[#090b10]/55 px-2 py-1 font-semibold text-[#f4b238]"
                      onClick={() =>
                        dispatch({
                          kind: isScreenSharer
                            ? "stopScreenShare"
                            : "openScreenShareViewer"
                        })
                      }>
                      {isScreenSharer
                        ? t("stopScreenSharing")
                        : snapshot.screenViewerOpen
                          ? t("viewSharedScreen")
                          : t("reopenSharedScreen")}
                    </button>
                  </div>
                )}
                {screenShareBlocked && (
                  <p className="mx-3 mt-2 text-center text-[10px] text-[#b9bbc2]">
                    {t("screenShareLimitError")}
                  </p>
                )}
                <div
                  className={cn(
                    "relative min-w-0",
                    fillAvailable && "flex h-full min-h-0 flex-1"
                  )}>
                  {visibleParticipants.length > 0 ? (
                    <div
                      className={cn(
                        "grid min-w-0 grid-cols-1 gap-2 p-3",
                        visibleVideoCount === 1 && "w-full gap-0 p-0",
                        !stackVideos &&
                          visibleVideoCount === 2 &&
                          "grid-cols-2",
                        !stackVideos && visibleVideoCount >= 3 && "grid-cols-3",
                        stackVideos && "grid-cols-1",
                        fillAvailable && "h-full flex-1 auto-rows-fr"
                      )}>
                      {visibleParticipants.map((participant) => (
                        <ParticipantVideo
                          key={participant.id}
                          participant={participant}
                          self={false}
                          stream={streams[participant.id]}
                          connectionState={
                            snapshot.connectionStates[participant.id]
                          }
                          featured={participant.id === activeParticipant?.id}
                          muteAudio
                          className={cn(
                            "min-h-0 min-w-0",
                            visibleVideoCount === 1 &&
                              "rounded-[16px] border-0",
                            fillAvailable && "aspect-auto h-full"
                          )}
                          videoClassName="object-contain"
                        />
                      ))}
                    </div>
                  ) : (
                    <div
                      className={cn(
                        "m-3 grid aspect-video min-h-[126px] place-items-center rounded-[13px] border border-dashed border-[#f4b238]/20 bg-[radial-gradient(circle_at_50%_45%,rgba(244,178,56,.07),transparent_58%)] text-center text-[10px] text-[#9297a2]",
                        visibleVideoCount === 0 &&
                          "m-0 w-full rounded-[16px] border-0",
                        fillAvailable && "aspect-auto min-h-0 flex-1"
                      )}>
                      Waiting for others…
                    </div>
                  )}
                  {localParticipant && (
                    <div
                      className={cn(
                        "absolute bottom-[19px] right-[19px] z-[3] aspect-[16/10] w-[clamp(68px,22%,96px)] drop-shadow-[0_8px_18px_rgba(0,0,0,.55)]",
                        visibleVideoCount <= 1 && "bottom-2 right-2"
                      )}>
                      <ParticipantVideo
                        participant={localParticipant}
                        self
                        stream={streams[localParticipant.id]}
                        muteAudio
                        compact
                        className="aspect-auto h-full min-h-0 w-full border-[#f4b238]/40"
                      />
                    </div>
                  )}
                </div>
              </>
            )}
            {snapshot.error && (
              <div
                className="mx-3 mt-2.5 rounded-[9px] border border-rose-400/30 bg-red-900/20 px-2.5 py-[9px] text-center text-[11px] text-rose-300"
                role="alert"
                aria-live="assertive">
                {snapshot.error}
              </div>
            )}
          </div>
        )}
        {snapshot.view === "chat" && (
          <div className="flex min-h-full flex-col pb-12">
            <div
              className="flex min-h-[170px] flex-1 flex-col gap-[5px] overflow-auto px-3 py-3.5"
              ref={messagesRef}
              aria-live="polite">
              {snapshot.messages.length === 0 && (
                <div className="m-auto text-[#9297a2]">No messages yet</div>
              )}
              {snapshot.messages.map((message, index) => {
                const previous = snapshot.messages[index - 1]
                const grouped =
                  previous?.nickname === message.nickname &&
                  previous.self === message.self
                return (
                  <div
                    className={cn(
                      "flex flex-col items-start",
                      message.self && "items-end"
                    )}
                    key={message.id}>
                    {!grouped && (
                      <span className="mx-2 mb-[3px] mt-[7px] text-[9px] text-[#9297a2]">
                        {message.nickname}
                      </span>
                    )}
                    <div
                      className={cn(
                        "max-w-[84%] whitespace-pre-wrap break-words rounded-[12px_12px_12px_4px] bg-white/[.08] px-[11px] py-[7px] text-[#e7e4dd]",
                        message.self &&
                          "rounded-[12px_12px_4px_12px] bg-[#f4b238] text-[#080a0f]"
                      )}>
                      {message.text}
                    </div>
                    <span className="mx-2 mt-0.5 font-mono text-[8px] text-[#666c77]">
                      {new Date(message.timestamp).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit"
                      })}
                    </span>
                  </div>
                )
              })}
            </div>
            <div className="sticky bottom-0 flex items-end gap-2 border-t border-white/[.09] bg-[#0a0c11]/95 px-3 pb-[13px] pt-2.5">
              <textarea
                className="max-h-[90px] min-h-[38px] flex-1 resize-none rounded-[10px] border border-white/[.09] bg-white/[.06] px-[11px] py-[9px] text-[#f2eee5] outline-none placeholder:text-[#9297a2] focus:border-[#f4b238]/45 focus:ring-4 focus:ring-[#f4b238]/10"
                value={draft}
                rows={1}
                placeholder={t("typeMessage")}
                aria-label={t("typeMessage")}
                onChange={(event) => setDraft(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault()
                    submit()
                  }
                }}
              />
              <button
                type="button"
                className="grid h-[38px] w-[38px] cursor-pointer place-items-center rounded-[10px] border-0 bg-[#f4b238] text-[#080a0f]"
                onClick={submit}
                aria-label="Send message"
                title="Send message">
                →
              </button>
            </div>
          </div>
        )}
        {snapshot.view === "participants" && (
          <div className="flex min-h-full flex-col gap-[7px] p-[13px] pb-[61px]">
            {snapshot.roomParticipants.map((participant) => {
              const caller = snapshot.callState.participants.find(
                (item) => item.id === participant.id
              )
              return (
                <div
                  className="flex items-center gap-[11px] rounded-[11px] border border-white/[.09] bg-white/[.035] p-2.5"
                  key={participant.id}>
                  <div className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-full bg-[#f4b238]/10 font-sans font-semibold text-[#f4b238]">
                    {(participant.nickname || "?").slice(0, 1).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-bold">
                      {participant.nickname || t("anonymousNickname")}
                      {participant.id === snapshot.selfId
                        ? ` (${t("you")})`
                        : ""}
                    </div>
                    <div className="text-[9px] text-[#9297a2]">
                      {participant.isHost ? t("host") : "Party member"}
                      {caller
                        ? ` · ${caller.micEnabled ? "Mic on" : "Mic off"}`
                        : ""}
                    </div>
                  </div>
                  {caller && (
                    <span
                      className="h-2 w-2 rounded-full bg-green-400 shadow-[0_0_9px_rgba(74,222,128,.5)]"
                      title="In call"
                    />
                  )}
                </div>
              )
            })}
            <button
              type="button"
              className="mx-[13px] mb-[13px] mt-auto cursor-pointer border-0 bg-transparent text-[10px] text-[#9297a2] underline underline-offset-[3px]"
              onClick={() => browser.runtime.openOptionsPage()}>
              {t("settings")}
            </button>
          </div>
        )}
      </div>
      <div className="pointer-events-none absolute inset-x-2 bottom-2 z-[6] flex flex-col items-center gap-[5px]">
        {snapshot.view === "call" && (
          <button
            type="button"
            className="pointer-events-auto grid h-[30px] w-[30px] shrink-0 cursor-pointer place-items-center rounded-full border border-white/[.14] bg-[#080a0f]/80 p-0 text-[#f2eee5] shadow-[0_6px_20px_rgba(0,0,0,.4)] backdrop-blur-2xl transition hover:-translate-y-px hover:bg-[#12141a]/90 hover:text-[#f4b238]"
            onClick={() => setControlsOpen((open) => !open)}
            aria-expanded={controlsOpen}
            aria-controls="synclify-call-controls"
            aria-label={controlsOpen ? "Hide controls" : "Show controls"}
            title={controlsOpen ? "Hide controls" : "Show controls"}>
            <ControlToggleIcon open={controlsOpen} />
          </button>
        )}
        <div
          id="synclify-call-controls"
          className={cn(
            "pointer-events-auto flex max-h-12 w-max max-w-full translate-y-0 items-center justify-center gap-[3px] overflow-hidden rounded-[18px] border border-white/[.11] bg-[#080a0f]/85 px-[5px] py-1.5 opacity-100 shadow-[0_10px_30px_rgba(0,0,0,.42)] backdrop-blur-2xl transition-all duration-200",
            !controlsVisible &&
              "pointer-events-none invisible max-h-0 translate-y-2 border-transparent py-0 opacity-0"
          )}
          aria-label={snapshot.inCall ? "Call controls" : "Window controls"}
          aria-hidden={!controlsVisible}>
          {snapshot.inCall && (
            <>
              <button
                type="button"
                className={cn(
                  compactButtonClass,
                  !snapshot.micEnabled && mediaOffClass
                )}
                onClick={() =>
                  dispatch({ kind: "setMic", enabled: !snapshot.micEnabled })
                }
                aria-label={
                  snapshot.micEnabled
                    ? t("muteMicrophone")
                    : t("unmuteMicrophone")
                }
                title={
                  snapshot.micEnabled
                    ? t("muteMicrophone")
                    : t("unmuteMicrophone")
                }>
                <MicIcon off={!snapshot.micEnabled} />
              </button>
              <button
                type="button"
                className={cn(
                  compactButtonClass,
                  !snapshot.cameraEnabled && mediaOffClass
                )}
                onClick={() =>
                  dispatch({
                    kind: "setCamera",
                    enabled: !snapshot.cameraEnabled
                  })
                }
                aria-label={
                  snapshot.cameraEnabled ? t("hideCamera") : t("showCamera")
                }
                title={
                  snapshot.cameraEnabled ? t("hideCamera") : t("showCamera")
                }>
                <CameraIcon off={!snapshot.cameraEnabled} />
              </button>
              <button
                type="button"
                className={cn(
                  compactButtonClass,
                  isScreenSharer &&
                    "border-rose-400/45 bg-rose-500/15 text-rose-300",
                  screenShare.active &&
                    !isScreenSharer &&
                    "border-[#f4b238]/40 bg-[#f4b238]/10 text-[#f4b238]"
                )}
                disabled={screenShareBlocked || snapshot.screenShareStarting}
                onClick={() =>
                  dispatch({
                    kind: isScreenSharer
                      ? "stopScreenShare"
                      : screenShare.active
                        ? "openScreenShareViewer"
                        : "startScreenShare"
                  })
                }
                aria-label={
                  isScreenSharer
                    ? t("stopScreenSharing")
                    : screenShare.active
                      ? t("viewSharedScreen")
                      : t("shareScreen")
                }
                title={
                  screenShareBlocked
                    ? t("screenShareLimitError")
                    : isScreenSharer
                      ? t("stopScreenSharing")
                      : screenShare.active
                        ? t("viewSharedScreen")
                        : t("shareScreen")
                }>
                {isScreenSharer ? (
                  <ScreenShareOff aria-hidden="true" size={16} />
                ) : (
                  <MonitorUp aria-hidden="true" size={16} />
                )}
              </button>
              <button
                type="button"
                className="inline-flex h-[29px] w-[38px] shrink-0 cursor-pointer items-center justify-center rounded-xl border border-rose-400/40 bg-[#dc4650] p-0 leading-none text-[#f2eee5] [&>svg]:m-auto [&>svg]:block [&>svg]:shrink-0"
                onClick={() => dispatch({ kind: "leaveCall" })}
                aria-label={t("leaveVideoCall")}
                title={t("leaveVideoCall")}>
                <EndCallIcon />
              </button>
            </>
          )}
          <button
            type="button"
            className={cn(
              compactButtonClass,
              snapshot.view === "chat" &&
                "border-[#f4b238]/50 bg-[#f4b238] text-[#080a0f] shadow-[0_7px_20px_rgba(244,178,56,.16)]"
            )}
            disabled={!snapshot.chatEnabled}
            onClick={() =>
              selectView(
                snapshot.inCall && snapshot.view === "chat" ? "call" : "chat"
              )
            }
            aria-label={
              snapshot.inCall && snapshot.view === "chat"
                ? "Show video call"
                : t("chat")
            }
            aria-pressed={snapshot.view === "chat"}
            title={
              snapshot.inCall && snapshot.view === "chat"
                ? "Show video call"
                : t("chat")
            }>
            <ChatIcon />
            {snapshot.unread > 0 && snapshot.view !== "chat" && (
              <span className="absolute -right-[5px] -top-[5px] grid h-4 min-w-4 place-items-center rounded-full border-2 border-[#0a0c11] bg-[#dc4650] px-1 font-mono text-[8px] font-bold text-white">
                {snapshot.unread > 9 ? "9+" : snapshot.unread}
              </span>
            )}
          </button>
          <button
            type="button"
            className={cn(
              compactButtonClass,
              snapshot.view === "participants" &&
                "border-[#f4b238]/50 bg-[#f4b238] text-[#080a0f] shadow-[0_7px_20px_rgba(244,178,56,.16)]"
            )}
            onClick={() =>
              selectView(
                snapshot.inCall && snapshot.view === "participants"
                  ? "call"
                  : "participants"
              )
            }
            aria-label={
              snapshot.inCall && snapshot.view === "participants"
                ? "Show video call"
                : t("participants")
            }
            aria-pressed={snapshot.view === "participants"}
            title={
              snapshot.inCall && snapshot.view === "participants"
                ? "Show video call"
                : t("participants")
            }>
            <ParticipantsIcon />
          </button>
        </div>
      </div>
    </section>
  )
}
