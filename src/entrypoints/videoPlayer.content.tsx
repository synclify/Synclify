import { defineContentScript } from "wxt/utils/define-content-script"
import { createIntegratedUi } from "wxt/utils/content-script-ui/integrated"
import ReactDOM from "react-dom/client"
import { createPortal } from "react-dom"
import { useCallback, useEffect, useRef, useState } from "react"
import browser from "webextension-polyfill"

const TAG = "[synclify/player]"
const WRAPPER_ATTR = "data-synclify-player-wrapper"

/* ------------------------------------------------------------------ */
/*  Design tokens                                                      */
/* ------------------------------------------------------------------ */

const AMBER = "hsl(38, 92%, 55%)"
const AMBER_DIM = "hsl(38, 70%, 42%)"
const AMBER_GLOW = "hsl(38, 92%, 55%, 0.35)"
const GLASS_BG = "rgba(8, 10, 16, 0.82)"
const GLASS_BORDER = "rgba(210, 160, 60, 0.12)"
const TEXT_PRIMARY = "rgba(255, 255, 255, 0.92)"
const TEXT_DIM = "rgba(255, 255, 255, 0.45)"
const TRACK_BG = "rgba(255, 255, 255, 0.1)"
const FONT =
  "'DM Sans', 'SF Pro Display', -apple-system, BlinkMacSystemFont, sans-serif"

/* ------------------------------------------------------------------ */
/*  SVG Icons — refined stroke weights, consistent sizing              */
/* ------------------------------------------------------------------ */

const PlayIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
    <path d="M8 5.14v13.72a1 1 0 0 0 1.53.85l10.47-6.86a1 1 0 0 0 0-1.7L9.53 4.3A1 1 0 0 0 8 5.14z" />
  </svg>
)

const PauseIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
    <rect x="6" y="4" width="4" height="16" rx="1" />
    <rect x="14" y="4" width="4" height="16" rx="1" />
  </svg>
)

const VolumeLowIcon = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round">
    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
    <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
  </svg>
)

const VolumeHighIcon = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round">
    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
    <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
    <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
  </svg>
)

const VolumeMuteIcon = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round">
    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
    <line x1="22" y1="9" x2="16" y2="15" />
    <line x1="16" y1="9" x2="22" y2="15" />
  </svg>
)

const FullscreenEnterIcon = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round">
    <path d="M8 3H5a2 2 0 0 0-2 2v3" />
    <path d="M21 8V5a2 2 0 0 0-2-2h-3" />
    <path d="M3 16v3a2 2 0 0 0 2 2h3" />
    <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
  </svg>
)

const FullscreenExitIcon = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round">
    <path d="M8 3v3a2 2 0 0 1-2 2H3" />
    <path d="M21 8h-3a2 2 0 0 1-2-2V3" />
    <path d="M3 16h3a2 2 0 0 1 2 2v3" />
    <path d="M16 21v-3a2 2 0 0 1 2-2h3" />
  </svg>
)

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || isNaN(seconds)) return "0:00"
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0)
    return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`
  return `${m}:${s.toString().padStart(2, "0")}`
}

/* ------------------------------------------------------------------ */
/*  Scoped CSS — injected once into the wrapper                        */
/* ------------------------------------------------------------------ */

const STYLE_ID = "synclify-player-styles"

function injectStyles(wrapper: HTMLDivElement) {
  if (wrapper.querySelector(`#${STYLE_ID}`)) return
  const style = document.createElement("style")
  style.id = STYLE_ID
  style.textContent = `
    /* --- Seek bar --- */
    [data-synclify-player-wrapper] input[type="range"].synclify-seek,
    [data-synclify-player-wrapper] input[type="range"].synclify-vol {
      -webkit-appearance: none;
      appearance: none;
      height: 4px;
      border-radius: 2px;
      outline: none;
      cursor: pointer;
      margin: 0;
      transition: height 0.15s cubic-bezier(0.16, 1, 0.3, 1);
    }
    [data-synclify-player-wrapper] input[type="range"].synclify-seek:hover,
    [data-synclify-player-wrapper] input[type="range"].synclify-seek:active {
      height: 6px;
    }
    /* Thumb */
    [data-synclify-player-wrapper] input[type="range"].synclify-seek::-webkit-slider-thumb,
    [data-synclify-player-wrapper] input[type="range"].synclify-vol::-webkit-slider-thumb {
      -webkit-appearance: none;
      appearance: none;
      width: 14px;
      height: 14px;
      border-radius: 50%;
      background: ${AMBER};
      border: 2px solid rgba(255,255,255,0.9);
      box-shadow: 0 0 8px ${AMBER_GLOW}, 0 1px 3px rgba(0,0,0,0.4);
      cursor: pointer;
      transition: transform 0.15s cubic-bezier(0.16, 1, 0.3, 1),
                  box-shadow 0.15s ease;
      transform: scale(0);
    }
    [data-synclify-player-wrapper] input[type="range"].synclify-seek:hover::-webkit-slider-thumb,
    [data-synclify-player-wrapper] input[type="range"].synclify-seek:active::-webkit-slider-thumb {
      transform: scale(1);
    }
    [data-synclify-player-wrapper] input[type="range"].synclify-vol::-webkit-slider-thumb {
      width: 12px;
      height: 12px;
      transform: scale(0);
    }
    [data-synclify-player-wrapper] input[type="range"].synclify-vol:hover::-webkit-slider-thumb {
      transform: scale(1);
    }
    /* Firefox */
    [data-synclify-player-wrapper] input[type="range"].synclify-seek::-moz-range-thumb,
    [data-synclify-player-wrapper] input[type="range"].synclify-vol::-moz-range-thumb {
      width: 14px;
      height: 14px;
      border-radius: 50%;
      background: ${AMBER};
      border: 2px solid rgba(255,255,255,0.9);
      box-shadow: 0 0 8px ${AMBER_GLOW};
      cursor: pointer;
    }
    /* --- Control button hover --- */
    [data-synclify-player-wrapper] .synclify-btn:hover {
      background: rgba(255,255,255,0.08) !important;
      transform: scale(1.08);
    }
    [data-synclify-player-wrapper] .synclify-btn:active {
      transform: scale(0.95);
    }
    /* --- Big play overlay --- */
    @keyframes synclify-play-pop {
      0% { transform: translate(-50%,-50%) scale(0.6); opacity: 0.9; }
      100% { transform: translate(-50%,-50%) scale(1.2); opacity: 0; }
    }
    .synclify-play-flash {
      animation: synclify-play-pop 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards;
    }
    /* --- Native UI badge --- */
    .synclify-native-badge {
      opacity: 0;
      transition: opacity 0.25s ease;
    }
    [data-synclify-player-wrapper]:hover .synclify-native-badge {
      opacity: 1;
    }
    /* --- Control bar entrance --- */
    @keyframes synclify-controls-in {
      from { transform: translateY(8px); opacity: 0; }
      to   { transform: translateY(0);   opacity: 1; }
    }
  `
  wrapper.prepend(style)
}

/* ------------------------------------------------------------------ */
/*  PlayerControls                                                     */
/* ------------------------------------------------------------------ */

function PlayerControls({
  video,
  wrapper,
  onDisable
}: {
  video: HTMLVideoElement
  wrapper: HTMLDivElement
  onDisable: () => void
}) {
  const [playing, setPlaying] = useState(!video.paused)
  const [currentTime, setCurrentTime] = useState(video.currentTime)
  const [duration, setDuration] = useState(video.duration || 0)
  const [volume, setVolume] = useState(video.volume)
  const [muted, setMuted] = useState(video.muted)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [visible, setVisible] = useState(true)
  const [seeking, setSeeking] = useState(false)
  const [flash, setFlash] = useState<"play" | "pause" | null>(null)
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const flashKeyRef = useRef(0)

  useEffect(() => {
    injectStyles(wrapper)
  }, [wrapper])

  // Sync state from video element
  useEffect(() => {
    const onPlay = () => setPlaying(true)
    const onPause = () => setPlaying(false)
    const onTime = () => {
      if (!seeking) setCurrentTime(video.currentTime)
    }
    const onDur = () => setDuration(video.duration || 0)
    const onVol = () => {
      setVolume(video.volume)
      setMuted(video.muted)
    }

    video.addEventListener("play", onPlay)
    video.addEventListener("pause", onPause)
    video.addEventListener("timeupdate", onTime)
    video.addEventListener("durationchange", onDur)
    video.addEventListener("volumechange", onVol)

    return () => {
      video.removeEventListener("play", onPlay)
      video.removeEventListener("pause", onPause)
      video.removeEventListener("timeupdate", onTime)
      video.removeEventListener("durationchange", onDur)
      video.removeEventListener("volumechange", onVol)
    }
  }, [video, seeking])

  // Fullscreen tracking
  useEffect(() => {
    const onFs = () => setIsFullscreen(document.fullscreenElement === wrapper)
    document.addEventListener("fullscreenchange", onFs)
    return () => document.removeEventListener("fullscreenchange", onFs)
  }, [wrapper])

  // Auto-hide
  const scheduleHide = useCallback(() => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
    setVisible(true)
    hideTimerRef.current = setTimeout(() => {
      if (!video.paused) setVisible(false)
    }, 3000)
  }, [video])

  useEffect(() => {
    const onMove = () => scheduleHide()
    const onLeave = () => {
      if (!video.paused) {
        if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
        setVisible(false)
      }
    }
    wrapper.addEventListener("mousemove", onMove)
    wrapper.addEventListener("mouseleave", onLeave)
    scheduleHide()
    return () => {
      wrapper.removeEventListener("mousemove", onMove)
      wrapper.removeEventListener("mouseleave", onLeave)
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
    }
  }, [wrapper, scheduleHide, video])

  useEffect(() => {
    if (!playing) setVisible(true)
  }, [playing])

  const togglePlay = useCallback(() => {
    if (video.paused) {
      video.play()
      setFlash("play")
    } else {
      video.pause()
      setFlash("pause")
    }
    flashKeyRef.current++
    setTimeout(() => setFlash(null), 450)
  }, [video])

  const toggleMute = useCallback(() => {
    video.muted = !video.muted
  }, [video])

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement === wrapper) {
      document.exitFullscreen()
    } else {
      wrapper.requestFullscreen()
    }
  }, [wrapper])

  const onSeekStart = useCallback(() => setSeeking(true), [])
  const onSeekInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setCurrentTime(Number(e.currentTarget.value))
    },
    []
  )
  const onSeekEnd = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      video.currentTime = Number(e.currentTarget.value)
      setSeeking(false)
    },
    [video]
  )

  const onVolInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = Number(e.currentTarget.value)
      video.volume = v
      if (v > 0 && video.muted) video.muted = false
    },
    [video]
  )

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0
  const volPct = (muted ? 0 : volume) * 100

  const VolumeIcon =
    muted || volume === 0
      ? VolumeMuteIcon
      : volume < 0.5
        ? VolumeLowIcon
        : VolumeHighIcon

  return createPortal(
    <>
      {/* Click overlay: play/pause + double-click fullscreen */}
      <div
        onClick={togglePlay}
        onDoubleClick={toggleFullscreen}
        style={{
          position: "absolute",
          inset: 0,
          bottom: 52,
          cursor: visible ? "default" : "none",
          zIndex: 2147483646
        }}
      />

      {/* Center flash icon on play/pause */}
      {flash && (
        <div
          key={flashKeyRef.current}
          className="synclify-play-flash"
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%,-50%)",
            width: 56,
            height: 56,
            borderRadius: "50%",
            background: "rgba(0,0,0,0.45)",
            backdropFilter: "blur(8px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: TEXT_PRIMARY,
            pointerEvents: "none",
            zIndex: 2147483647
          }}>
          {flash === "play" ? <PlayIcon /> : <PauseIcon />}
        </div>
      )}

      {/* "Use native controls" badge — top-right, appears on wrapper hover */}
      <div
        className="synclify-native-badge"
        style={{
          position: "absolute",
          top: 10,
          right: 10,
          zIndex: 2147483647
        }}>
        <button
          onClick={onDisable}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 5,
            padding: "4px 10px 4px 8px",
            borderRadius: 6,
            border: `1px solid ${GLASS_BORDER}`,
            background: GLASS_BG,
            backdropFilter: "blur(12px)",
            color: TEXT_DIM,
            fontSize: 10,
            fontFamily: FONT,
            fontWeight: 500,
            letterSpacing: "0.03em",
            cursor: "pointer",
            transition: "color 0.2s, border-color 0.2s"
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = TEXT_PRIMARY
            e.currentTarget.style.borderColor = "rgba(210, 160, 60, 0.3)"
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = TEXT_DIM
            e.currentTarget.style.borderColor = GLASS_BORDER
          }}
          title="Switch to native video controls">
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round">
            <polyline points="1 4 1 10 7 10" />
            <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
          </svg>
          <span>Native UI</span>
        </button>
      </div>

      {/* ---- SEEK BAR — full-width above controls ---- */}
      <div
        style={{
          position: "absolute",
          bottom: 36,
          left: 0,
          right: 0,
          height: 24,
          display: "flex",
          alignItems: "center",
          padding: "0 12px",
          zIndex: 2147483647,
          opacity: visible ? 1 : 0,
          pointerEvents: visible ? "auto" : "none",
          transition: "opacity 0.3s cubic-bezier(0.16, 1, 0.3, 1)"
        }}
        onClick={(e) => e.stopPropagation()}>
        <input
          type="range"
          className="synclify-seek"
          min={0}
          max={duration || 0}
          step={0.1}
          value={currentTime}
          onMouseDown={onSeekStart}
          onTouchStart={onSeekStart}
          onChange={onSeekInput}
          onMouseUp={onSeekEnd}
          onTouchEnd={onSeekEnd}
          style={{
            width: "100%",
            background: `linear-gradient(to right, ${AMBER} 0%, ${AMBER_DIM} ${progress}%, ${TRACK_BG} ${progress}%)`
          }}
        />
      </div>

      {/* ---- CONTROL BAR ---- */}
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          height: 42,
          display: "flex",
          alignItems: "center",
          gap: 2,
          padding: "0 8px",
          background: GLASS_BG,
          backdropFilter: "blur(16px)",
          borderTop: `1px solid ${GLASS_BORDER}`,
          color: TEXT_PRIMARY,
          fontFamily: FONT,
          fontSize: 12,
          zIndex: 2147483647,
          userSelect: "none",
          opacity: visible ? 1 : 0,
          pointerEvents: visible ? "auto" : "none",
          transition:
            "opacity 0.3s cubic-bezier(0.16, 1, 0.3, 1), transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
          transform: visible ? "translateY(0)" : "translateY(4px)"
        }}
        onClick={(e) => e.stopPropagation()}>
        {/* Play / Pause */}
        <button
          className="synclify-btn"
          onClick={togglePlay}
          style={{
            background: "none",
            border: "none",
            color: TEXT_PRIMARY,
            cursor: "pointer",
            padding: 6,
            borderRadius: 6,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            transition: "background 0.15s, transform 0.12s"
          }}
          title={playing ? "Pause" : "Play"}>
          {playing ? <PauseIcon /> : <PlayIcon />}
        </button>

        {/* Time display */}
        <span
          style={{
            fontSize: 11,
            fontWeight: 500,
            color: TEXT_DIM,
            minWidth: 72,
            textAlign: "center",
            letterSpacing: "0.04em",
            fontVariantNumeric: "tabular-nums",
            whiteSpace: "nowrap",
            padding: "0 4px"
          }}>
          <span style={{ color: TEXT_PRIMARY }}>{formatTime(currentTime)}</span>
          <span style={{ margin: "0 3px", opacity: 0.35 }}>/</span>
          {formatTime(duration)}
        </span>

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* Volume group */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 2
          }}>
          <button
            className="synclify-btn"
            onClick={toggleMute}
            style={{
              background: "none",
              border: "none",
              color: TEXT_PRIMARY,
              cursor: "pointer",
              padding: 6,
              borderRadius: 6,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transition: "background 0.15s, transform 0.12s"
            }}
            title={muted ? "Unmute" : "Mute"}>
            <VolumeIcon />
          </button>

          <input
            type="range"
            className="synclify-vol"
            min={0}
            max={1}
            step={0.01}
            value={muted ? 0 : volume}
            onChange={onVolInput}
            style={{
              width: 56,
              background: `linear-gradient(to right, ${AMBER} ${volPct}%, ${TRACK_BG} ${volPct}%)`
            }}
          />
        </div>

        {/* Fullscreen */}
        <button
          className="synclify-btn"
          onClick={toggleFullscreen}
          style={{
            background: "none",
            border: "none",
            color: TEXT_PRIMARY,
            cursor: "pointer",
            padding: 6,
            borderRadius: 6,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            transition: "background 0.15s, transform 0.12s"
          }}
          title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}>
          {isFullscreen ? <FullscreenExitIcon /> : <FullscreenEnterIcon />}
        </button>
      </div>
    </>,
    wrapper
  )
}

/* ------------------------------------------------------------------ */
/*  ReEnableBadge — floating button over native video to re-enable     */
/* ------------------------------------------------------------------ */

const REENABLE_STYLE_ID = "synclify-reenable-styles"

function ReEnableBadge({
  videoEl,
  onEnable
}: {
  videoEl: HTMLVideoElement
  onEnable: () => void
}) {
  const [host, setHost] = useState<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!videoEl.ownerDocument.getElementById(REENABLE_STYLE_ID)) {
      const style = videoEl.ownerDocument.createElement("style")
      style.id = REENABLE_STYLE_ID
      style.textContent = `
        .synclify-reenable-badge {
          opacity: 0;
          transition: opacity 0.25s ease;
          pointer-events: none;
        }
        .synclify-reenable-host:hover .synclify-reenable-badge {
          opacity: 1;
          pointer-events: auto;
        }
      `
      videoEl.ownerDocument.head.appendChild(style)
    }
  }, [videoEl])

  useEffect(() => {
    const el = document.createElement("div")
    el.className = "synclify-reenable-host"
    el.style.cssText =
      "position:relative;display:inline-block;line-height:0"

    videoEl.parentNode!.insertBefore(el, videoEl)
    el.appendChild(videoEl)
    setHost(el)

    return () => {
      if (el.parentNode) {
        el.parentNode.insertBefore(videoEl, el)
        el.remove()
      }
      setHost(null)
    }
  }, [videoEl])

  if (!host) return null

  return createPortal(
    <div
      className="synclify-reenable-badge"
      style={{
        position: "absolute",
        top: 10,
        right: 10,
        zIndex: 2147483647
      }}>
      <button
        onClick={onEnable}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 5,
          padding: "4px 10px 4px 8px",
          borderRadius: 6,
          border: `1px solid ${GLASS_BORDER}`,
          background: GLASS_BG,
          backdropFilter: "blur(12px)",
          color: TEXT_DIM,
          fontSize: 10,
          fontFamily: FONT,
          fontWeight: 500,
          letterSpacing: "0.03em",
          cursor: "pointer",
          transition: "color 0.2s, border-color 0.2s"
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = TEXT_PRIMARY
          e.currentTarget.style.borderColor = "rgba(210, 160, 60, 0.3)"
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = TEXT_DIM
          e.currentTarget.style.borderColor = GLASS_BORDER
        }}
        title="Switch to Synclify video player">
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round">
          <polygon points="5 3 19 12 5 21 5 3" />
        </svg>
        <span>Synclify UI</span>
      </button>
    </div>,
    host
  )
}

/* ------------------------------------------------------------------ */
/*  PlayerManager                                                      */
/* ------------------------------------------------------------------ */

function PlayerManager() {
  console.debug(TAG, "PlayerManager render")
  const [video, setVideo] = useState<HTMLVideoElement | null>(null)
  const [wrapper, setWrapper] = useState<HTMLDivElement | null>(null)
  const [enabled, setEnabled] = useState(true)
  const [settingEnabled, setSettingEnabled] = useState(true)
  const [disabledVideo, setDisabledVideo] = useState<HTMLVideoElement | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const wrapperRef = useRef<HTMLDivElement | null>(null)

  videoRef.current = video
  wrapperRef.current = wrapper

  useEffect(() => {
    browser.storage.sync.get("settings").then((result) => {
      if (result.settings && typeof result.settings.showPlayer === "boolean") {
        setSettingEnabled(result.settings.showPlayer)
      }
    })
    const onChange = (changes: Record<string, browser.Storage.StorageChange>) => {
      if (changes.settings?.newValue && typeof changes.settings.newValue.showPlayer === "boolean") {
        setSettingEnabled(changes.settings.newValue.showPlayer)
      }
    }
    browser.storage.onChanged.addListener(onChange)
    return () => browser.storage.onChanged.removeListener(onChange)
  }, [])

  const attachToVideo = useCallback((el: HTMLVideoElement) => {
    const existingWrapper = el.closest(
      `[${WRAPPER_ATTR}]`
    ) as HTMLDivElement | null
    if (existingWrapper) {
      setVideo(el)
      setWrapper(existingWrapper)
      return
    }

    console.debug(TAG, "wrapping video", el)

    el.controls = false
    el.removeAttribute("controls")

    const computed = getComputedStyle(el)
    const w = document.createElement("div")
    w.setAttribute(WRAPPER_ATTR, "")
    w.style.cssText = [
      "position: relative",
      "background: #000",
      "overflow: hidden",
      "line-height: 0"
    ].join(";")

    w.style.width = computed.width
    w.style.height = computed.height
    if (computed.maxWidth !== "none") w.style.maxWidth = computed.maxWidth
    if (computed.maxHeight !== "none") w.style.maxHeight = computed.maxHeight

    el.parentNode!.insertBefore(w, el)
    w.appendChild(el)

    el.style.width = "100%"
    el.style.height = "100%"
    el.style.display = "block"

    setVideo(el)
    setWrapper(w)
  }, [])

  const detach = useCallback(() => {
    const v = videoRef.current
    const w = wrapperRef.current
    if (v && w) {
      console.debug(TAG, "unwrapping video", v)

      // Exit fullscreen first if the wrapper is the fullscreen element
      if (document.fullscreenElement === w) {
        document.exitFullscreen().then(() => {
          v.controls = true
          v.style.width = ""
          v.style.height = ""
          v.style.display = ""
          if (w.parentNode) {
            w.parentNode.insertBefore(v, w)
            w.remove()
          }
        })
      } else {
        v.controls = true
        v.style.width = ""
        v.style.height = ""
        v.style.display = ""
        if (w.parentNode) {
          w.parentNode.insertBefore(v, w)
          w.remove()
        }
      }
    }
    setVideo(null)
    setWrapper(null)
  }, [])

  const handleDisable = useCallback(() => {
    const v = videoRef.current
    setEnabled(false)
    detach()
    if (v) setDisabledVideo(v)
  }, [detach])

  const handleReEnable = useCallback(() => {
    const v = disabledVideo
    setDisabledVideo(null)
    setEnabled(true)
    if (v && v.isConnected) {
      const host = v.closest(".synclify-reenable-host")
      if (host && host.parentNode) {
        host.parentNode.insertBefore(v, host)
        host.remove()
      }
      v.style.width = ""
      v.style.height = ""
      v.style.display = ""
      attachToVideo(v)
    }
  }, [disabledVideo, attachToVideo])

  // Listen for video-player messages
  useEffect(() => {
    console.debug(TAG, "registering onMessage listener, enabled:", enabled)
    const handler = (
      msg: { to?: string; videoId?: string; enable?: boolean },
      _sender: browser.Runtime.MessageSender,
      sendResponse: (r: unknown) => void
    ) => {
      console.debug(TAG, "onMessage received", msg)
      if (msg.to === "videoPlayer" && msg.videoId) {
        if (!enabled || !settingEnabled) {
          console.debug(TAG, "player disabled, ignoring attach")
          sendResponse(null)
          return true
        }
        console.debug(TAG, "looking for video with synclify-id", msg.videoId)
        const el = document.querySelector(
          `[data-synclify-id="${msg.videoId}"]`
        ) as HTMLVideoElement | null
        console.debug(TAG, "found video element?", el)
        if (el) attachToVideo(el)
        sendResponse(null)
        return true
      }
      if (msg.to === "videoPlayerToggle") {
        const next = msg.enable !== undefined ? msg.enable : !enabled
        setEnabled(next)
        if (!next) detach()
        sendResponse(null)
        return true
      }
    }
    browser.runtime.onMessage.addListener(handler)
    return () => browser.runtime.onMessage.removeListener(handler)
  }, [enabled, settingEnabled, attachToVideo, detach])

  // Auto-attach when a video is detected (storage state change)
  useEffect(() => {
    if (!enabled || !settingEnabled) return
    console.debug(TAG, "registering storage listener")
    const listener = (
      changes: Record<string, browser.Storage.StorageChange>
    ) => {
      console.debug(TAG, "storage changed", {
        hasStateChange: !!changes.state,
        enabled,
        hasVideo: !!videoRef.current
      })
      if (videoRef.current) return
      if (changes.state) {
        const newState = changes.state.newValue
        if (!newState) return
        const hasVideo = Object.values(newState).some(
          (entry: { videoFound?: boolean }) => entry.videoFound
        )
        console.debug(TAG, "hasVideo in state?", hasVideo)
        if (hasVideo) {
          const vid = document.querySelector(
            "[data-synclify-id]"
          ) as HTMLVideoElement | null
          console.debug(TAG, "found video in DOM?", vid)
          if (vid) attachToVideo(vid)
        }
      }
    }
    browser.storage.onChanged.addListener(listener)
    return () => browser.storage.onChanged.removeListener(listener)
  }, [enabled, settingEnabled, attachToVideo])

  useEffect(() => {
    if (!settingEnabled) {
      detach()
      setDisabledVideo(null)
      setEnabled(true)
    }
  }, [settingEnabled, detach])

  if (!settingEnabled) return null

  if (!enabled && disabledVideo && disabledVideo.isConnected) {
    return <ReEnableBadge videoEl={disabledVideo} onEnable={handleReEnable} />
  }

  if (!enabled || !video || !wrapper) return null

  return (
    <PlayerControls
      video={video}
      wrapper={wrapper}
      onDisable={handleDisable}
    />
  )
}

/* ------------------------------------------------------------------ */
/*  Content script entry                                               */
/* ------------------------------------------------------------------ */

export default defineContentScript({
  matches: ["<all_urls>"],

  main(ctx) {
    console.log(TAG, "content script main() called")

    const ui = createIntegratedUi(ctx, {
      position: "inline",
      anchor: "body",
      onMount: (container) => {
        const root = ReactDOM.createRoot(container)
        root.render(<PlayerManager />)
        return root
      },
      onRemove: (root) => {
        root?.unmount()
      }
    })

    ui.mount()
  }
})
