import ReactDOM from "react-dom/client"
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore
} from "react"
import type React from "react"
import browser from "webextension-polyfill"
import { MonitorUp, Scaling, ScreenShareOff } from "lucide-react"
import iconUrl from "~/assets/icon.png"
import tailwindStyles from "~/assets/style.css?inline"
import {
  CameraIcon,
  CommunicationPanel,
  EndCallIcon,
  MicIcon,
  ParticipantVideo
} from "~/components/communication/CommunicationPanel"
import { getCommunicationController } from "~/lib/communication-controller"
import { t } from "~/lib/i18n"
import { mountUi, runOnce, whenBodyReady } from "~/lib/runtime-ui"
import { cn } from "~/lib/utils"
import { sortCallParticipants } from "~/types/communication"
import type { CallParticipant } from "~/types/call"

const ROOT_ID = "synclify-communication-root"
const BUBBLE_SIZE = 48
const PANEL_DEFAULT_WIDTH = 320
const PANEL_MIN_WIDTH = 220
const PANEL_HEIGHT = Math.round((PANEL_DEFAULT_WIDTH * 9) / 16)
const PANEL_MAX_WIDTH = 660
const PANEL_MIN_HEIGHT = 180
const PANEL_SIZE_VERSION = 2
const EDGE_MARGIN = 12
const PANEL_BUBBLE_GAP = 8
const PANEL_BUBBLE_SPACE = BUBBLE_SIZE + PANEL_BUBBLE_GAP
const KEYBOARD_EVENTS = ["keydown", "keyup", "keypress"] as const

type Position = { x: number; y: number }
type Size = { width: number; height: number }
type BubbleSide = "left" | "right"
type BubblePosition = Position & { side: BubbleSide }

function clampBubblePosition(
  position: Position,
  width = BUBBLE_SIZE
): Position {
  return {
    x: Math.max(
      EDGE_MARGIN,
      Math.min(position.x, window.innerWidth - width - EDGE_MARGIN)
    ),
    y: Math.max(
      EDGE_MARGIN,
      Math.min(position.y, window.innerHeight - BUBBLE_SIZE - EDGE_MARGIN)
    )
  }
}

function bubbleSideForX(x: number, width = BUBBLE_SIZE): BubbleSide {
  return x + width / 2 < window.innerWidth / 2 ? "left" : "right"
}

function bubblePositionAtEdge(
  side: BubbleSide,
  y: number,
  width = BUBBLE_SIZE
): BubblePosition {
  const position = clampBubblePosition(
    {
      x:
        side === "left" ? EDGE_MARGIN : window.innerWidth - width - EDGE_MARGIN,
      y
    },
    width
  )
  return { ...position, side }
}

function snapBubblePosition(
  position: Position,
  width = BUBBLE_SIZE
): BubblePosition {
  const clamped = clampBubblePosition(position, width)
  return bubblePositionAtEdge(
    bubbleSideForX(clamped.x, width),
    clamped.y,
    width
  )
}

function clampPanelSize(size: Size): Size {
  return {
    width: Math.max(
      PANEL_MIN_WIDTH,
      Math.min(size.width, PANEL_MAX_WIDTH, window.innerWidth - EDGE_MARGIN * 2)
    ),
    height: Math.max(
      PANEL_MIN_HEIGHT,
      Math.min(
        size.height,
        window.innerHeight - EDGE_MARGIN * 2 - PANEL_BUBBLE_SPACE
      )
    )
  }
}

function clampPanelPosition(
  position: Position,
  size: { width: number; height: number } = {
    width: PANEL_DEFAULT_WIDTH,
    height: PANEL_HEIGHT
  }
): Position {
  const width = Math.min(size.width, window.innerWidth - EDGE_MARGIN * 2)
  const height = Math.min(
    size.height,
    window.innerHeight - EDGE_MARGIN * 2 - PANEL_BUBBLE_SPACE
  )
  return {
    x: Math.max(
      EDGE_MARGIN,
      Math.min(position.x, window.innerWidth - width - EDGE_MARGIN)
    ),
    y: Math.max(
      EDGE_MARGIN,
      Math.min(
        position.y,
        window.innerHeight - height - EDGE_MARGIN - PANEL_BUBBLE_SPACE
      )
    )
  }
}

function defaultPanelPosition(): Position {
  const width = Math.min(
    PANEL_DEFAULT_WIDTH,
    window.innerWidth - EDGE_MARGIN * 2
  )
  return clampPanelPosition({
    x: window.innerWidth - width - BUBBLE_SIZE - EDGE_MARGIN * 2,
    y: EDGE_MARGIN
  })
}

function bubblePositionBelowPanel(
  position: Position,
  size: Size,
  width = BUBBLE_SIZE
): BubblePosition {
  return snapBubblePosition(
    {
      x: position.x + size.width / 2 - width / 2,
      y: position.y + size.height + PANEL_BUBBLE_GAP
    },
    width
  )
}

function useActiveSpeaker(
  participants: CallParticipant[],
  streams: Record<string, MediaStream>,
  selfId: string | null
): string | null {
  const fallbackId =
    participants.find((participant) => participant.id !== selfId)?.id ??
    participants[0]?.id ??
    null
  const [activeId, setActiveId] = useState<string | null>(fallbackId)

  useEffect(() => {
    if (!activeId || !participants.some(({ id }) => id === activeId)) {
      setActiveId(fallbackId)
    }
  }, [activeId, fallbackId, participants])

  useEffect(() => {
    const sources = participants.flatMap((participant) => {
      const stream = streams[participant.id]
      if (
        !stream?.getAudioTracks().some((track) => track.readyState === "live")
      ) {
        return []
      }
      return [{ id: participant.id, stream }]
    })
    if (sources.length === 0) return

    const audioContext = new AudioContext()
    const analysers = sources.map(({ id, stream }) => {
      const source = audioContext.createMediaStreamSource(stream)
      const analyser = audioContext.createAnalyser()
      analyser.fftSize = 256
      analyser.smoothingTimeConstant = 0.72
      source.connect(analyser)
      return { id, analyser, samples: new Uint8Array(analyser.fftSize) }
    })
    let candidateId: string | null = null
    let candidateSamples = 0
    const interval = window.setInterval(() => {
      let loudestId: string | null = null
      let loudestLevel = 0.035
      for (const entry of analysers) {
        entry.analyser.getByteTimeDomainData(entry.samples)
        let energy = 0
        for (const sample of entry.samples) {
          const amplitude = (sample - 128) / 128
          energy += amplitude * amplitude
        }
        const level = Math.sqrt(energy / entry.samples.length)
        if (level > loudestLevel) {
          loudestLevel = level
          loudestId = entry.id
        }
      }
      if (!loudestId) {
        candidateId = null
        candidateSamples = 0
        return
      }
      if (candidateId === loudestId) candidateSamples += 1
      else {
        candidateId = loudestId
        candidateSamples = 1
      }
      if (candidateSamples >= 2) setActiveId(loudestId)
    }, 120)

    audioContext.resume().catch(() => {})
    return () => {
      window.clearInterval(interval)
      audioContext.close().catch(() => {})
    }
  }, [participants, streams])

  return activeId
}

function ParticipantAudio({ stream }: { stream: MediaStream }) {
  const audioRef = useRef<HTMLAudioElement>(null)

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    audio.srcObject = stream
    const play = () => {
      audio.play().catch(() => {})
    }
    play()
    document.addEventListener("pointerdown", play, {
      once: true,
      capture: true
    })
    return () => {
      document.removeEventListener("pointerdown", play, { capture: true })
      audio.srcObject = null
    }
  }, [stream])

  return <audio ref={audioRef} autoPlay hidden />
}

function CommunicationApp() {
  const controller = useMemo(() => getCommunicationController(), [])
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot
  )
  const [bubblePos, setBubblePos] = useState<BubblePosition>({
    x: -1,
    y: -1,
    side: "right"
  })
  const [dragging, setDragging] = useState(false)
  const [panelPos, setPanelPos] = useState(defaultPanelPosition)
  const [panelSize, setPanelSize] = useState<Size | null>(null)
  const [measuredPanelSize, setMeasuredPanelSize] = useState<Size>({
    width: PANEL_DEFAULT_WIDTH,
    height: PANEL_MIN_HEIGHT
  })
  const [panelDragging, setPanelDragging] = useState(false)
  const [panelResizing, setPanelResizing] = useState(false)
  const [overlayPos, setOverlayPos] = useState({ x: 16, y: 16 })
  const [overlayCollapsed, setOverlayCollapsed] = useState(false)
  const pointerRef = useRef({
    active: false,
    moved: false,
    x: 0,
    y: 0,
    bx: 0,
    by: 0,
    width: BUBBLE_SIZE
  })
  const panelPointerRef = useRef({
    active: false,
    moved: false,
    x: 0,
    y: 0,
    bx: 0,
    by: 0
  })
  const resizePointerRef = useRef({
    active: false,
    x: 0,
    y: 0,
    width: PANEL_DEFAULT_WIDTH,
    height: PANEL_MIN_HEIGHT,
    bx: 0,
    by: 0
  })
  const panelRef = useRef<HTMLDivElement>(null)
  const bubbleRef = useRef<HTMLButtonElement>(null)
  const bubbleWidthRef = useRef(BUBBLE_SIZE)
  const panelSizeRef = useRef({
    width: PANEL_DEFAULT_WIDTH,
    height: PANEL_HEIGHT
  })
  const overlayPointerRef = useRef({ active: false, x: 0, y: 0, bx: 0, by: 0 })

  useEffect(() => {
    controller.initialize().catch(() => {})
  }, [controller])

  useEffect(() => {
    browser.storage.local
      .get([
        "communicationBubblePos",
        "communicationPanelPos",
        "communicationPanelSize",
        "communicationPanelSizeVersion",
        "chatBubblePos",
        "videoCallBubblePos"
      ])
      .then((result) => {
        const saved = (result.communicationBubblePos ??
          result.chatBubblePos ??
          result.videoCallBubblePos) as Partial<BubblePosition> | undefined
        const savedPosition = {
          x:
            Number.isFinite(saved?.x) && saved?.x !== undefined
              ? saved.x
              : window.innerWidth - BUBBLE_SIZE - EDGE_MARGIN,
          y:
            Number.isFinite(saved?.y) && saved?.y !== undefined
              ? saved.y
              : window.innerHeight - BUBBLE_SIZE - 80
        }
        setBubblePos(
          saved?.side === "left" || saved?.side === "right"
            ? bubblePositionAtEdge(saved.side, savedPosition.y, BUBBLE_SIZE)
            : snapBubblePosition(savedPosition)
        )
        const savedPanel = result.communicationPanelPos as Position | undefined
        setPanelPos(
          savedPanel ? clampPanelPosition(savedPanel) : defaultPanelPosition()
        )
        const savedSize = result.communicationPanelSize as Size | undefined
        if (
          result.communicationPanelSizeVersion === PANEL_SIZE_VERSION &&
          Number.isFinite(savedSize?.width) &&
          Number.isFinite(savedSize?.height)
        ) {
          const size = clampPanelSize(savedSize as Size)
          panelSizeRef.current = size
          setPanelSize(size)
        } else {
          browser.storage.local
            .remove("communicationPanelSize")
            .then(() =>
              browser.storage.local.set({
                communicationPanelSizeVersion: PANEL_SIZE_VERSION
              })
            )
            .catch(() => {})
        }
      })
  }, [])

  useEffect(() => {
    const onResize = () => {
      const width = bubbleRef.current?.offsetWidth ?? bubbleWidthRef.current
      bubbleWidthRef.current = width
      setBubblePos((position) =>
        bubblePositionAtEdge(position.side, position.y, width)
      )
      setPanelPos((position) =>
        clampPanelPosition(position, panelSizeRef.current)
      )
      setPanelSize((size) => {
        if (!size) return size
        const nextSize = clampPanelSize(size)
        panelSizeRef.current = nextSize
        return nextSize
      })
    }
    onResize()
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [snapshot.inCall])

  const adaptiveCallLayout = snapshot.inCall && snapshot.view === "call"
  const panelVisible =
    snapshot.inPagePanelOpen &&
    (!snapshot.presentation.fullscreen || !snapshot.inCall)

  useEffect(() => {
    const bubble = bubbleRef.current
    if (!bubble) return
    const syncWidth = () => {
      const width = bubble.offsetWidth
      if (width <= 0) return
      bubbleWidthRef.current = width
      setBubblePos((position) => {
        const next = bubblePositionAtEdge(position.side, position.y, width)
        return next.x === position.x && next.y === position.y ? position : next
      })
    }
    syncWidth()
    const observer = new ResizeObserver(syncWidth)
    observer.observe(bubble)
    return () => observer.disconnect()
  }, [panelVisible, snapshot.inCall, snapshot.presentation.mode])

  useEffect(() => {
    const panel = panelRef.current
    if (!panel || !snapshot.inPagePanelOpen) return
    const observer = new ResizeObserver(() => {
      // A final ResizeObserver notification can arrive after React detaches the
      // panel. Detached elements report a zero-sized rect at (0, 0), which
      // would incorrectly move the minimized bubble to the top-left corner.
      if (
        !panel.isConnected ||
        panel.offsetWidth <= 0 ||
        panel.offsetHeight <= 0
      )
        return
      const rect = panel.getBoundingClientRect()
      const size = {
        width: panel.offsetWidth,
        height: panel.offsetHeight
      }
      panelSizeRef.current = size
      setMeasuredPanelSize((current) =>
        current.width === size.width && current.height === size.height
          ? current
          : size
      )
      const position = clampPanelPosition({ x: rect.left, y: rect.top }, size)
      setPanelPos(position)
      setBubblePos(
        bubblePositionBelowPanel(position, size, bubbleWidthRef.current)
      )
    })
    observer.observe(panel)
    return () => observer.disconnect()
  }, [
    snapshot.inPagePanelOpen,
    snapshot.inCall,
    snapshot.presentation.fullscreen,
    snapshot.view
  ])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      setOverlayCollapsed(true)
      if (snapshot.inPagePanelOpen)
        controller.execute({ kind: "setPresentation", mode: "minimized" })
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [controller, snapshot.inPagePanelOpen])

  const dispatch = useCallback(
    (command: Parameters<typeof controller.execute>[0]) => {
      controller.execute(command).catch(() => {})
    },
    [controller]
  )
  const panelDispatch = useCallback(
    (command: Parameters<typeof controller.execute>[0]) => {
      dispatch(
        command.kind === "openView"
          ? { kind: "selectView", view: command.view }
          : command
      )
    },
    [controller, dispatch]
  )
  const openCall = () => dispatch({ kind: "openView", view: "call" })
  const streams = useMemo(
    () =>
      Object.fromEntries(
        snapshot.streamParticipantIds
          .map((id) => [id, controller.getStream(id)])
          .filter((entry): entry is [string, MediaStream] => !!entry[1])
      ),
    [controller, snapshot.streamParticipantIds]
  )
  const callParticipants = useMemo(
    () =>
      sortCallParticipants(snapshot.callState.participants, snapshot.selfId),
    [snapshot.callState.participants, snapshot.selfId]
  )
  const remoteParticipants = useMemo(
    () =>
      callParticipants.filter(
        (participant) => participant.id !== snapshot.selfId
      ),
    [callParticipants, snapshot.selfId]
  )
  const localParticipant = callParticipants.find(
    (participant) => participant.id === snapshot.selfId
  )
  const activeParticipantId = useActiveSpeaker(
    remoteParticipants,
    streams,
    snapshot.selfId
  )
  const activeParticipant =
    remoteParticipants.find(({ id }) => id === activeParticipantId) ??
    remoteParticipants[0]
  const stackedTileWidth = Math.max(0, measuredPanelSize.width - 24)
  const stackedTileHeight = Math.max(126, (stackedTileWidth * 9) / 16)
  const verticalVideoCapacity = Math.max(
    1,
    Math.floor(
      (Math.max(0, measuredPanelSize.height - 24) + 8) / (stackedTileHeight + 8)
    )
  )
  const stackVideos =
    remoteParticipants.length > 1 && verticalVideoCapacity >= 2
  const visibleVideoCount = Math.min(
    remoteParticipants.length,
    stackVideos
      ? verticalVideoCapacity
      : measuredPanelSize.width >= 500
        ? 3
        : measuredPanelSize.width >= 350
          ? 2
          : 1
  )
  const syncBubbleToPanel = (position: Position, size: Size) => {
    setBubblePos(
      bubblePositionBelowPanel(position, size, bubbleWidthRef.current)
    )
  }

  const onBubbleDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    const rect = event.currentTarget.getBoundingClientRect()
    bubbleWidthRef.current = rect.width
    pointerRef.current = {
      active: true,
      moved: false,
      x: event.clientX,
      y: event.clientY,
      bx: rect.left,
      by: bubblePos.y,
      width: rect.width
    }
    setDragging(false)
  }
  const onBubbleMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    const start = pointerRef.current
    if (!start.active) return
    const dx = event.clientX - start.x
    const dy = event.clientY - start.y
    if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
      start.moved = true
      setDragging(true)
    }
    if (!start.moved) return
    const position = clampBubblePosition(
      { x: start.bx + dx, y: start.by + dy },
      start.width
    )
    setBubblePos({
      ...position,
      side: bubbleSideForX(position.x, start.width)
    })
  }
  const onBubbleUp = (event: React.PointerEvent<HTMLButtonElement>) => {
    const start = pointerRef.current
    start.active = false
    setDragging(false)
    if (!start.moved) return
    const position = snapBubblePosition(
      {
        x: start.bx + event.clientX - start.x,
        y: start.by + event.clientY - start.y
      },
      start.width
    )
    setBubblePos(position)
    browser.storage.local
      .set({ communicationBubblePos: position })
      .catch(() => {})
  }
  const onBubbleClick = () => {
    if (pointerRef.current.moved) {
      pointerRef.current.moved = false
      return
    }
    const size = panelSize ?? panelSizeRef.current
    const bubbleRect = bubbleRef.current?.getBoundingClientRect()
    const bubbleCenterX = bubbleRect
      ? bubbleRect.left + bubbleRect.width / 2
      : bubblePos.x + bubbleWidthRef.current / 2
    const position = clampPanelPosition(
      {
        x: bubbleCenterX - size.width / 2,
        y: bubblePos.y - size.height - PANEL_BUBBLE_GAP
      },
      size
    )
    setPanelPos(position)
    if (snapshot.inCall) {
      if (snapshot.presentation.fullscreen) setOverlayCollapsed(false)
      else openCall()
    } else openCall()
  }

  const onPanelDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement
    if (!target.closest("[data-panel-drag-handle]")) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    panelPointerRef.current = {
      active: true,
      moved: false,
      x: event.clientX,
      y: event.clientY,
      bx: panelPos.x,
      by: panelPos.y
    }
    setPanelDragging(false)
  }
  const onPanelMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = panelPointerRef.current
    if (!start.active) return
    const dx = event.clientX - start.x
    const dy = event.clientY - start.y
    if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
      start.moved = true
      setPanelDragging(true)
    }
    if (!start.moved) return
    const position = clampPanelPosition(
      {
        x: start.bx + dx,
        y: start.by + dy
      },
      panelSizeRef.current
    )
    setPanelPos(position)
    syncBubbleToPanel(position, panelSizeRef.current)
  }
  const onPanelUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = panelPointerRef.current
    if (!start.active) return
    start.active = false
    setPanelDragging(false)
    if (!start.moved) {
      if (event.type !== "pointercancel") {
        dispatch({ kind: "setPresentation", mode: "minimized" })
      }
      return
    }
    const position = clampPanelPosition(
      {
        x: start.bx + event.clientX - start.x,
        y: start.by + event.clientY - start.y
      },
      panelSizeRef.current
    )
    setPanelPos(position)
    const bubblePosition = bubblePositionBelowPanel(
      position,
      panelSizeRef.current,
      bubbleWidthRef.current
    )
    setBubblePos(bubblePosition)
    browser.storage.local
      .set({
        communicationPanelPos: position,
        communicationBubblePos: bubblePosition
      })
      .catch(() => {})
  }

  const onPanelKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault()
      event.stopPropagation()
      dispatch({ kind: "setPresentation", mode: "minimized" })
      return
    }
    const offset = {
      ArrowLeft: { x: -16, y: 0 },
      ArrowRight: { x: 16, y: 0 },
      ArrowUp: { x: 0, y: -16 },
      ArrowDown: { x: 0, y: 16 }
    }[event.key]
    if (!offset) return
    event.preventDefault()
    event.stopPropagation()
    const position = clampPanelPosition(
      { x: panelPos.x + offset.x, y: panelPos.y + offset.y },
      panelSizeRef.current
    )
    setPanelPos(position)
    syncBubbleToPanel(position, panelSizeRef.current)
    const bubblePosition = bubblePositionBelowPanel(
      position,
      panelSizeRef.current,
      bubbleWidthRef.current
    )
    browser.storage.local
      .set({
        communicationPanelPos: position,
        communicationBubblePos: bubblePosition
      })
      .catch(() => {})
  }

  const getResizedPanel = (clientX: number, clientY: number) => {
    const start = resizePointerRef.current
    const size = clampPanelSize({
      width: start.width - (clientX - start.x),
      height: start.height + clientY - start.y
    })
    const position = clampPanelPosition(
      {
        x: start.bx + start.width - size.width,
        y: Math.min(start.by, window.innerHeight - size.height - EDGE_MARGIN)
      },
      size
    )
    return { size, position }
  }
  const onResizeDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    const rect = panelRef.current?.getBoundingClientRect()
    if (!rect) return
    event.currentTarget.setPointerCapture(event.pointerId)
    resizePointerRef.current = {
      active: true,
      x: event.clientX,
      y: event.clientY,
      width: rect.width,
      height: rect.height,
      bx: panelPos.x,
      by: panelPos.y
    }
    setPanelResizing(true)
  }
  const onResizeMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    if (!resizePointerRef.current.active) return
    const { size, position } = getResizedPanel(event.clientX, event.clientY)
    panelSizeRef.current = size
    setPanelSize(size)
    setPanelPos(position)
    syncBubbleToPanel(position, size)
  }
  const onResizeUp = (event: React.PointerEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    if (!resizePointerRef.current.active) return
    resizePointerRef.current.active = false
    setPanelResizing(false)
    const { size, position } = getResizedPanel(event.clientX, event.clientY)
    panelSizeRef.current = size
    setPanelSize(size)
    setPanelPos(position)
    const bubblePosition = bubblePositionBelowPanel(
      position,
      size,
      bubbleWidthRef.current
    )
    setBubblePos(bubblePosition)
    browser.storage.local
      .set({
        communicationPanelPos: position,
        communicationPanelSize: size,
        communicationPanelSizeVersion: PANEL_SIZE_VERSION,
        communicationBubblePos: bubblePosition
      })
      .catch(() => {})
  }
  const onResizeKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    const direction = {
      ArrowLeft: { width: 16, height: 0 },
      ArrowRight: { width: -16, height: 0 },
      ArrowUp: { width: 0, height: -16 },
      ArrowDown: { width: 0, height: 16 }
    }[event.key]
    if (!direction) return
    event.preventDefault()
    event.stopPropagation()
    const current = panelSize ?? panelSizeRef.current
    const size = clampPanelSize({
      width: current.width + direction.width,
      height: current.height + direction.height
    })
    const position = clampPanelPosition(
      {
        x: panelPos.x + current.width - size.width,
        y: panelPos.y
      },
      size
    )
    panelSizeRef.current = size
    setPanelSize(size)
    setPanelPos(position)
    const bubblePosition = bubblePositionBelowPanel(
      position,
      size,
      bubbleWidthRef.current
    )
    setBubblePos(bubblePosition)
    browser.storage.local
      .set({
        communicationPanelPos: position,
        communicationPanelSize: size,
        communicationPanelSizeVersion: PANEL_SIZE_VERSION,
        communicationBubblePos: bubblePosition
      })
      .catch(() => {})
  }

  const panelStyle = {
    left: panelPos.x,
    top: panelPos.y,
    width:
      panelSize?.width ??
      Math.min(PANEL_DEFAULT_WIDTH, window.innerWidth - EDGE_MARGIN * 2),
    height:
      panelSize?.height ??
      (adaptiveCallLayout
        ? "auto"
        : Math.min(PANEL_HEIGHT, window.innerHeight - EDGE_MARGIN * 2)),
    minWidth: Math.min(PANEL_MIN_WIDTH, window.innerWidth - EDGE_MARGIN * 2),
    minHeight: Math.min(
      PANEL_MIN_HEIGHT,
      window.innerHeight - EDGE_MARGIN * 2 - PANEL_BUBBLE_SPACE
    ),
    maxHeight: window.innerHeight - EDGE_MARGIN * 2 - PANEL_BUBBLE_SPACE
  }
  const onOverlayDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement
    if (target.closest("button")) return
    event.currentTarget.setPointerCapture(event.pointerId)
    overlayPointerRef.current = {
      active: true,
      x: event.clientX,
      y: event.clientY,
      bx: overlayPos.x,
      by: overlayPos.y
    }
  }
  const onOverlayMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = overlayPointerRef.current
    if (!start.active) return
    setOverlayPos({
      x: Math.max(
        8,
        Math.min(
          start.bx - (event.clientX - start.x),
          window.innerWidth - (overlayCollapsed ? 156 : 220) - 8
        )
      ),
      y: Math.max(
        8,
        Math.min(start.by + event.clientY - start.y, window.innerHeight - 100)
      )
    })
  }
  const onOverlayUp = () => {
    overlayPointerRef.current.active = false
  }

  if (!snapshot.visible || bubblePos.x < 0) return null

  return (
    <div className="dark font-sans text-[13px] text-[#f2eee5] antialiased">
      <style>{tailwindStyles}</style>
      {callParticipants
        .filter((participant) => participant.id !== snapshot.selfId)
        .map((participant) => {
          const stream = streams[participant.id]
          return stream ? (
            <ParticipantAudio key={participant.id} stream={stream} />
          ) : null
        })}
      {!panelVisible &&
        !(snapshot.inCall && snapshot.presentation.mode === "floating") && (
          <button
            ref={bubbleRef}
            type="button"
            className={cn(
              "fixed z-[2147483647] flex h-12 min-w-12 touch-none select-none items-center justify-center gap-2 rounded-3xl border border-[#f4b238]/30 bg-[linear-gradient(145deg,#1a1d24,#090b10)] p-0 text-[#f2eee5] shadow-[0_7px_24px_rgba(0,0,0,.48),inset_0_1px_rgba(255,255,255,.06)] transition hover:-translate-y-0.5 hover:border-[#f4b238]/50 hover:shadow-[0_10px_30px_rgba(0,0,0,.52),0_0_22px_rgba(244,178,56,.16),inset_0_1px_rgba(255,255,255,.08)]",
              snapshot.inCall && "justify-start py-0 pl-[7px] pr-3",
              dragging && "translate-y-0 transition-none"
            )}
            style={{ left: bubblePos.x, top: bubblePos.y }}
            onPointerDown={onBubbleDown}
            onPointerMove={onBubbleMove}
            onPointerUp={onBubbleUp}
            onPointerCancel={onBubbleUp}
            onClick={onBubbleClick}
            aria-haspopup="dialog"
            aria-label={
              snapshot.inCall
                ? `${t("showVideoCall")}. ${snapshot.callState.participantCount} people in the call. Microphone ${snapshot.micEnabled ? "on" : "muted"}.`
                : t("showVideoCall")
            }
            title={t("showVideoCall")}>
            <span
              className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-full bg-white/[.035]"
              aria-hidden="true">
              <img
                className="pointer-events-none block h-6 w-[27px] select-none object-contain"
                src={iconUrl}
                alt=""
              />
            </span>
            {snapshot.inCall && (
              <span className="flex min-w-0 flex-1 items-center gap-1.5 pr-0.5 text-left">
                {snapshot.callState.screenShare.participantId ===
                  snapshot.selfId && (
                  <span
                    className="flex items-center text-[#f4b238]"
                    role="img"
                    aria-label={t("youAreSharingScreen")}
                    title={t("youAreSharingScreen")}>
                    <MonitorUp aria-hidden="true" size={13} />
                  </span>
                )}
                <span
                  className={cn(
                    "grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full [&>svg]:h-3 [&>svg]:w-3",
                    snapshot.micEnabled
                      ? "bg-white/[.07] text-[#d8d5ce]"
                      : "bg-[#f4b238]/12 text-[#f4b238]"
                  )}
                  role="img"
                  aria-label={
                    snapshot.micEnabled ? "Microphone on" : "Microphone muted"
                  }
                  title={
                    snapshot.micEnabled ? "Microphone on" : "Microphone muted"
                  }>
                  <MicIcon off={!snapshot.micEnabled} />
                </span>
              </span>
            )}
            {snapshot.unread > 0 && (
              <span className="absolute -right-1 -top-1 grid h-[19px] min-w-[19px] place-items-center rounded-[10px] border-2 border-[#111318] bg-red-500 px-1 font-mono text-[9px] font-bold text-white">
                {snapshot.unread > 99 ? "99+" : snapshot.unread}
              </span>
            )}
          </button>
        )}

      {panelVisible && (
        <div
          ref={panelRef}
          className={cn(
            "fixed z-[2147483645] overflow-visible rounded-[17px] border border-[#f4b238]/25 shadow-[0_32px_90px_rgba(0,0,0,.65)] transition-[width,height] duration-200",
            panelResizing && "select-none transition-none"
          )}
          style={panelStyle}
          onPointerDown={onPanelDown}
          onPointerMove={onPanelMove}
          onPointerUp={onPanelUp}
          onPointerCancel={onPanelUp}>
          <button
            type="button"
            data-panel-drag-handle
            className={cn(
              "absolute left-1/2 top-[calc(100%+8px)] z-[8] grid h-12 w-12 -translate-x-1/2 cursor-grab touch-none place-items-center rounded-full border border-[#f4b238]/35 bg-[linear-gradient(145deg,rgba(31,33,40,.98),rgba(8,10,15,.98))] p-0 text-[#f2eee5] shadow-[0_8px_24px_rgba(0,0,0,.46),0_0_18px_rgba(244,178,56,.1),inset_0_1px_rgba(255,255,255,.07)] transition hover:-translate-y-px hover:border-[#f4b238]/60 hover:shadow-[0_10px_28px_rgba(0,0,0,.5),0_0_22px_rgba(244,178,56,.16),inset_0_1px_rgba(255,255,255,.09)]",
              panelDragging && "cursor-grabbing transition-none"
            )}
            aria-label="Minimize or move communication window"
            title="Click to minimize · drag to move"
            onKeyDown={onPanelKeyDown}>
            <img
              className="pointer-events-none block h-6 w-[27px] select-none object-contain"
              src={iconUrl}
              alt=""
            />
            {snapshot.unread > 0 && (
              <span className="absolute -right-[3px] -top-[3px] grid h-[19px] min-w-[19px] place-items-center rounded-[10px] border-2 border-[#111318] bg-red-500 px-1 font-mono text-[9px] font-bold text-white">
                {snapshot.unread > 99 ? "99+" : snapshot.unread}
              </span>
            )}
          </button>
          <CommunicationPanel
            snapshot={snapshot}
            streams={streams}
            dispatch={panelDispatch}
            activeParticipantId={activeParticipantId ?? undefined}
            visibleVideoCount={visibleVideoCount}
            fillAvailable={panelSize !== null && adaptiveCallLayout}
            stackVideos={stackVideos}
          />
          <button
            type="button"
            className="absolute bottom-1.5 left-1.5 z-[7] grid h-7 w-7 cursor-nesw-resize touch-none place-items-center rounded-[9px] border border-[#f4b238]/25 bg-[#080a0f]/70 p-0 text-[#f4b238]/80 shadow-[0_4px_14px_rgba(0,0,0,.28)] backdrop-blur-xl hover:border-[#f4b238]/50 hover:bg-[#f4b238]/10 hover:text-[#f4b238] [&>svg]:pointer-events-none [&>svg]:block"
            aria-label="Resize communication window"
            title="Drag to resize"
            onPointerDown={onResizeDown}
            onPointerMove={onResizeMove}
            onPointerUp={onResizeUp}
            onPointerCancel={onResizeUp}
            onKeyDown={onResizeKeyDown}>
            <Scaling aria-hidden="true" size={15} strokeWidth={1.5} />
          </button>
        </div>
      )}

      {snapshot.inCall && snapshot.presentation.mode === "floating" && (
        <aside
          className={cn(
            "fixed z-[2147483646] w-[220px] touch-none overflow-hidden rounded-2xl border border-[#f4b238]/30 bg-[#0b0d12] shadow-[0_24px_72px_rgba(0,0,0,.7)]",
            overlayCollapsed && "w-[156px] rounded-[25px]"
          )}
          style={{ right: overlayPos.x, top: overlayPos.y }}
          aria-label={t("videoCall")}
          onPointerDown={onOverlayDown}
          onPointerMove={onOverlayMove}
          onPointerUp={onOverlayUp}
          onPointerCancel={onOverlayUp}>
          <div className="flex h-9 cursor-grab items-center justify-between py-0 pl-[11px] pr-[9px] text-[9px] uppercase tracking-[.08em] text-[#d8d5ce]">
            <span>
              {snapshot.connectionStatus === "reconnecting"
                ? "Reconnecting"
                : snapshot.callState.screenShare.participantId ===
                    snapshot.selfId
                  ? "You are sharing"
                  : `${snapshot.callState.participantCount} live`}
            </span>
            <button
              type="button"
              className="grid h-[25px] w-[25px] cursor-pointer place-items-center rounded-[7px] border-0 bg-white/[.06] p-0 text-[#9297a2]"
              aria-label={
                overlayCollapsed ? t("showVideoCall") : t("hideVideoCall")
              }
              title={overlayCollapsed ? t("showVideoCall") : t("hideVideoCall")}
              onClick={() => setOverlayCollapsed((value) => !value)}>
              {overlayCollapsed ? "□" : "—"}
            </button>
          </div>
          {overlayCollapsed ? (
            <div className="flex items-center gap-[7px] px-2.5 pb-[9px] text-[10px] text-[#f2eee5]">
              <span className="h-[7px] w-[7px] shrink-0 rounded-full bg-green-400 shadow-[0_0_12px_rgba(74,222,128,.55)]" />
              <span className="min-w-0 flex-1 whitespace-nowrap">
                Call continues
              </span>
              <span
                className={cn(
                  "grid h-5 w-5 shrink-0 place-items-center rounded-full [&>svg]:h-3.5 [&>svg]:w-3.5",
                  snapshot.micEnabled
                    ? "bg-white/[.07] text-[#d8d5ce]"
                    : "bg-[#f4b238]/12 text-[#f4b238]"
                )}
                role="img"
                aria-label={
                  snapshot.micEnabled ? "Microphone on" : "Microphone muted"
                }
                title={
                  snapshot.micEnabled ? "Microphone on" : "Microphone muted"
                }>
                <MicIcon off={!snapshot.micEnabled} />
              </span>
            </div>
          ) : (
            <>
              <div className="relative grid grid-cols-1 px-1.5 pb-1.5">
                {activeParticipant ? (
                  <ParticipantVideo
                    key={activeParticipant.id}
                    participant={activeParticipant}
                    self={false}
                    stream={streams[activeParticipant.id]}
                    connectionState={
                      snapshot.connectionStates[activeParticipant.id]
                    }
                    compact
                    muteAudio
                    className="min-h-0 rounded-[9px]"
                  />
                ) : (
                  <div className="grid min-h-[110px] place-items-center rounded-[13px] border border-dashed border-[#f4b238]/20 bg-[radial-gradient(circle_at_50%_45%,rgba(244,178,56,.07),transparent_58%)] text-center text-[10px] text-[#9297a2]">
                    Waiting for others…
                  </div>
                )}
                {localParticipant && (
                  <div className="absolute bottom-3 right-3 z-[3] aspect-[16/10] w-[62px] drop-shadow-[0_8px_18px_rgba(0,0,0,.55)]">
                    <ParticipantVideo
                      participant={localParticipant}
                      self
                      stream={streams[localParticipant.id]}
                      compact
                      muteAudio
                      className="aspect-auto h-full min-h-0 w-full border-[#f4b238]/40"
                    />
                  </div>
                )}
              </div>
              <div className="flex justify-center gap-[7px] border-t border-white/[.09] p-2 opacity-0 transition-opacity focus-within:opacity-100 hover:opacity-100">
                <button
                  type="button"
                  className={cn(
                    "grid h-[34px] w-[34px] cursor-pointer place-items-center rounded-full border border-white/[.13] bg-white/[.07] p-0 text-[#f2eee5]",
                    !snapshot.micEnabled &&
                      "border-[#f4b238]/35 bg-[#f4b238]/10 text-[#f4b238]"
                  )}
                  onClick={() =>
                    dispatch({ kind: "setMic", enabled: !snapshot.micEnabled })
                  }
                  aria-label={
                    snapshot.micEnabled
                      ? t("muteMicrophone")
                      : t("unmuteMicrophone")
                  }>
                  <MicIcon off={!snapshot.micEnabled} />
                </button>
                <button
                  type="button"
                  className={cn(
                    "grid h-[34px] w-[34px] cursor-pointer place-items-center rounded-full border border-white/[.13] bg-white/[.07] p-0 text-[#f2eee5]",
                    !snapshot.cameraEnabled &&
                      "border-[#f4b238]/35 bg-[#f4b238]/10 text-[#f4b238]"
                  )}
                  onClick={() =>
                    dispatch({
                      kind: "setCamera",
                      enabled: !snapshot.cameraEnabled
                    })
                  }
                  aria-label={
                    snapshot.cameraEnabled ? t("hideCamera") : t("showCamera")
                  }>
                  <CameraIcon off={!snapshot.cameraEnabled} />
                </button>
                <button
                  type="button"
                  className={cn(
                    "grid h-[34px] w-[34px] cursor-pointer place-items-center rounded-full border border-white/[.13] bg-white/[.07] p-0 text-[#f2eee5]",
                    snapshot.callState.screenShare.active &&
                      "border-[#f4b238]/35 bg-[#f4b238]/10 text-[#f4b238]"
                  )}
                  disabled={
                    !snapshot.callState.screenShare.active &&
                    snapshot.callState.participantCount >
                      snapshot.callState.screenShare.maxParticipants
                  }
                  onClick={() =>
                    dispatch({
                      kind:
                        snapshot.callState.screenShare.participantId ===
                        snapshot.selfId
                          ? "stopScreenShare"
                          : snapshot.callState.screenShare.active
                            ? "openScreenShareViewer"
                            : "startScreenShare"
                    })
                  }
                  aria-label={
                    snapshot.callState.screenShare.participantId ===
                    snapshot.selfId
                      ? t("stopScreenSharing")
                      : snapshot.callState.screenShare.active
                        ? t("viewSharedScreen")
                        : t("shareScreen")
                  }>
                  {snapshot.callState.screenShare.participantId ===
                  snapshot.selfId ? (
                    <ScreenShareOff aria-hidden="true" size={16} />
                  ) : (
                    <MonitorUp aria-hidden="true" size={16} />
                  )}
                </button>
                <button
                  type="button"
                  className="grid h-[34px] w-[52px] cursor-pointer place-items-center rounded-xl border border-rose-400/40 bg-[#dc4650] p-0 text-[#f2eee5]"
                  onClick={() => dispatch({ kind: "leaveCall" })}
                  aria-label={t("leaveVideoCall")}>
                  <EndCallIcon />
                </button>
              </div>
            </>
          )}
        </aside>
      )}
    </div>
  )
}

export function initCommunication(): void {
  const mountedStyles = document
    .getElementById(ROOT_ID)
    ?.shadowRoot?.querySelector("style")
  if (mountedStyles) mountedStyles.textContent = tailwindStyles
  if (!runOnce("communication")) return

  whenBodyReady(() => {
    const { host, mountPoint } = mountUi({
      id: ROOT_ID,
      shadow: true,
      watchFullscreenHost: true
    })
    const stopKeyboardEventPropagation = (event: Event) =>
      event.stopPropagation()
    KEYBOARD_EVENTS.forEach((eventName) =>
      host.addEventListener(eventName, stopKeyboardEventPropagation)
    )
    ReactDOM.createRoot(mountPoint).render(<CommunicationApp />)
  })
}
