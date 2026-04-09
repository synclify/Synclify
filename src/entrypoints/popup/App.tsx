import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  TooltipArrow
} from "~/components/ui/tooltip"
import {
  type ExtResponse,
  MESSAGE_STATUS,
  MESSAGE_TYPE
} from "~/types/messaging"
import React, { useCallback, useEffect, useMemo, useState } from "react"
import type { State, TabState } from "~/types/state"
import browser from "webextension-polyfill"
import logo from "~/assets/logo.svg?raw"
import { useForm } from "react-hook-form"
import { Button } from "~/components/ui/button"
import { Input } from "~/components/ui/input"
import { Switch } from "~/components/ui/switch"
import { usePostHog } from "@posthog/react"
import { debugRoomLog } from "~/lib/debug"
import { t } from "~/lib/i18n"
import type { ControlMode } from "~/types/socket"

type FormData = {
  room: string
  nickname?: string
}

function App() {
  const posthog = usePostHog()
  const [state, setState] = useState<State | undefined>()
  const [inRoom, setInRoom] = useState(false)
  const [error, setError] = useState(false)
  const [errorMessage, setErrorMessage] = useState("")
  const [currentTab, setCurrentTab] = useState<number>(0)
  const [tooltipText, setTooltipText] = useState(() => t("clickToCopy"))
  const [openTooltip, setOpenTooltip] = useState(false)
  const [nickname, setNickname] = useState("")
  const [reportOpen, setReportOpen] = useState(false)
  const [reportDetails, setReportDetails] = useState("")
  const [reportSent, setReportSent] = useState(false)
  const [participantsOpen, setParticipantsOpen] = useState(false)
  const [sharedMode, setSharedMode] = useState(true)
  const [sharedModeHelpOpen, setSharedModeHelpOpen] = useState(false)
  const {
    register,
    handleSubmit,
    formState: { errors }
  } = useForm<FormData>()

  const logRoomDebug = useCallback(
    (
      source: string,
      details?: {
        stateSnapshot?: State | undefined
        currentTabOverride?: number
        extra?: Record<string, unknown>
      }
    ) => {
      const snapshot = details?.stateSnapshot ?? state
      const resolvedTabId = details?.currentTabOverride ?? currentTab
      const tabState = snapshot?.[resolvedTabId]
      debugRoomLog("popup", {
        source,
        at: new Date().toISOString(),
        currentTab: resolvedTabId,
        roomId: tabState?.roomId,
        participantId: tabState?.participantId,
        participantCount: tabState?.participantCount,
        participants: tabState?.participants?.map((participant) => ({
          id: participant.id,
          nickname: participant.nickname,
          isHost: participant.isHost
        })),
        extra: details?.extra
      })
    },
    [currentTab]
  )

  const getPopupTabId = useCallback(async () => {
    const tabs = await browser.tabs.query({
      active: true,
      currentWindow: true
    })
    if (!tabs[0]?.id) {
      throw new Error("No active tab found for popup window")
    }
    return tabs[0].id as number
  }, [])

  const loadPopupState = useCallback(async () => {
    const [tabId, storageResult, nicknameResult] = await Promise.all([
      getPopupTabId(),
      browser.storage.local.get("state"),
      browser.storage.local.get("nickname")
    ])

    const nextState = storageResult.state
      ? ({ ...(storageResult.state as State) } as State)
      : undefined

    setCurrentTab(tabId)
    if (nicknameResult.nickname) {
      setNickname(nicknameResult.nickname as string)
    }
    logRoomDebug("loadPopupState", {
      currentTabOverride: tabId,
      stateSnapshot: nextState,
      extra: {
        resolvedTabId: tabId
      }
    })
    setState(nextState)
    return { tabId, nextState }
  }, [getPopupTabId, logRoomDebug])

  useEffect(() => {
    const storage = browser.storage.local
    loadPopupState().catch(() => {})
    const listener = (
      changes: Record<string, browser.Storage.StorageChange>,
      areaName: string
    ) => {
      if (areaName !== "local" || !changes.state) return
      const nextState = changes.state.newValue as State | undefined
      logRoomDebug("hydrate.storage.onChanged", {
        stateSnapshot: nextState ? { ...nextState } : undefined,
        extra: {
          oldParticipantCount: (changes.state.oldValue as State | undefined)?.[
            currentTab
          ]?.participantCount,
          newParticipantCount: nextState?.[currentTab]?.participantCount
        }
      })
      setState(nextState ? { ...nextState } : undefined)
    }
    const refreshState = () => {
      loadPopupState()
        .then(({ nextState }) => {
          logRoomDebug("hydrate.refreshState", {
            stateSnapshot: nextState
          })
        })
        .catch(() => {})
    }
    const handleWindowFocus = () => {
      refreshState()
    }
    window.addEventListener("focus", handleWindowFocus)
    browser.tabs.onActivated.addListener(handleWindowFocus)
    browser.windows.onFocusChanged.addListener(handleWindowFocus)
    browser.storage.onChanged.addListener(listener)
    return () => {
      window.removeEventListener("focus", handleWindowFocus)
      browser.tabs.onActivated.removeListener(handleWindowFocus)
      browser.windows.onFocusChanged.removeListener(handleWindowFocus)
      browser.storage.onChanged.removeListener(listener)
    }
  }, [currentTab, loadPopupState, logRoomDebug])

  const setStoredState = useCallback((newState: State) => {
    logRoomDebug("setStoredState", {
      stateSnapshot: newState
    })
    setState(newState)
    browser.storage.local.set({ state: newState })
  }, [logRoomDebug])

  const responseCallback = useCallback((response: ExtResponse) => {
    if (!response) {
      setError(true)
      setErrorMessage(t("videoNotDetectedYet"))
      return
    }
    switch (response.status) {
      case MESSAGE_STATUS.SUCCESS:
        setInRoom(true)
        setError(false)
        break
      case MESSAGE_STATUS.ERROR:
        setError(true)
        setErrorMessage(
          response.messageKey
            ? t(response.messageKey)
            : ((response.message as string) ?? t("videoNotDetectedYet"))
        )
        break
      case MESSAGE_STATUS.MULTIPLE_VIDEOS:
        setError(true)
        setErrorMessage(
          response.messageKey
            ? t(response.messageKey)
            : ((response.message as string) ?? t("multipleVideosDetected"))
        )
        break
    }
  }, [])

  const roomCallback = useCallback(
    (roomId: string) => {
      const nick = nickname.trim() || t("anonymousNickname")
      const participantId =
        state?.[currentTab]?.participantId || crypto.randomUUID()
      const controlMode: ControlMode =
        state?.[currentTab]?.controlMode ?? (sharedMode ? "shared" : "host")
      browser.storage.local.set({ nickname: nick })
      const newState = Object.assign({}, state ?? {}, {
        [currentTab]: {
          ...state?.[currentTab],
          roomId: roomId,
          participantId,
          controlMode,
          nickname: nick
        }
      })
      setStoredState(newState)
      browser.runtime
        .sendMessage({ action: "inject" })
        .then((response: ExtResponse) => responseCallback(response))
    },
    [currentTab, responseCallback, state, setStoredState, nickname, sharedMode]
  )

  const requestRoomPermission = useCallback(() => {
    return browser.permissions
      .request({
        permissions: ["activeTab"],
        origins: ["https://*/*", "http://*/*"]
      })
      .catch((err) => {
        console.error(err)
        return false
      })
  }, [])

  const createOrJoinRoom = useCallback(
    (data?: FormData) => {
      if (data) {
        const room = data.room.toUpperCase()
        roomCallback(room)
      } else {
        browser.runtime
          .sendMessage({ action: "createRoom" })
          .then((roomCode: string) => roomCallback(roomCode))
      }
    },
    [roomCallback]
  )

  const handleCreateRoomClick = useCallback(async () => {
    const granted = await requestRoomPermission()
    if (!granted) return

    createOrJoinRoom()
  }, [createOrJoinRoom, requestRoomPermission])

  const handleJoinRoomSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault()

      const granted = await requestRoomPermission()
      if (!granted) return

      void handleSubmit((data) => createOrJoinRoom(data))(event)
    },
    [createOrJoinRoom, handleSubmit, requestRoomPermission]
  )

  useEffect(() => {
    if (state && state[currentTab]) {
      setInRoom(true)
      if (!state[currentTab].videoFound) {
        setError(true)
        setErrorMessage(t("videoNotDetectedYet"))
      }
    } else {
      setInRoom(false)
    }
  }, [currentTab, state])

  const exitRoom = useCallback(() => {
    if (state) {
      const newState = { ...state }
      delete newState[currentTab]
      setStoredState(newState)
    }
    setInRoom(false)
    browser.tabs.query({ active: true, currentWindow: true }).then((tabs) =>
      browser.tabs.sendMessage(tabs[0].id as number, {
        type: MESSAGE_TYPE.EXIT
      })
    )
  }, [currentTab, state, setStoredState])

  const getRoom = useMemo(
    () => state?.[currentTab]?.roomId ?? "ERROR",
    [currentTab, state]
  )

  const tabState: TabState | undefined = state?.[currentTab]
  const participants = tabState?.participants
  const participantCount = tabState?.participantCount ?? participants?.length ?? 0
  const maxParticipants = tabState?.maxParticipants
  const isHost = tabState?.isHost ?? false
  const controlMode = tabState?.controlMode ?? "shared"
  const localNickname = tabState?.nickname
  const localParticipantId = tabState?.participantId

  const copyToClipboard = useCallback(() => {
    navigator.clipboard.writeText(getRoom)
    setTooltipText(t("copied"))
  }, [getRoom])

  const submitReport = useCallback(async () => {
    const tabs = await browser.tabs.query({
      active: true,
      currentWindow: true
    })
    const url = tabs[0]?.url || "unknown"
    posthog.capture("website_reported", {
      reported_url: url,
      details: reportDetails.trim(),
      page_title: tabs[0]?.title || "",
      extension_version: browser.runtime.getManifest().version
    })
    setReportSent(true)
    setReportDetails("")
    setTimeout(() => {
      setReportSent(false)
      setReportOpen(false)
    }, 2000)
  }, [posthog, reportDetails])

  return (
    <div className="dark relative flex min-h-[320px] flex-col bg-background">
      {/* Ambient top glow */}
      <div
        className="pointer-events-none absolute -top-20 left-1/2 h-40 w-60 -translate-x-1/2 rounded-full opacity-20 blur-3xl"
        style={{ background: "hsl(38 92% 55%)" }}
      />

      {/* Header */}
      <div className="animate-fade-in-up relative z-10 px-5 pb-3 pt-5">
        <div
          dangerouslySetInnerHTML={{ __html: logo }}
          className="mx-auto w-36 opacity-90"
        />
      </div>

      {/* Main content */}
      <div className="relative z-10 flex flex-1 flex-col px-5 pb-3">
        {inRoom ? (
          <div className="flex flex-1 flex-col">
            {/* Room code ticket */}
            <div className="animate-fade-in-up stagger-1 mb-3">
              <p className="mb-1.5 text-center text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
                {t("roomCode")}
              </p>
              <div className="flex justify-center">
                <TooltipProvider>
                  <Tooltip open={openTooltip}>
                    <TooltipTrigger asChild>
                      <button
                        className="animate-pulse-glow group relative cursor-pointer rounded-lg border border-[hsl(38_92%_55%/0.2)] bg-[hsl(38_92%_55%/0.06)] px-6 py-3 transition-all hover:border-[hsl(38_92%_55%/0.4)] hover:bg-[hsl(38_92%_55%/0.1)]"
                        onMouseOver={() => {
                          setOpenTooltip(true)
                          setTooltipText(t("clickToCopy"))
                        }}
                        onMouseLeave={() => setOpenTooltip(false)}
                        onClick={copyToClipboard}>
                        <span
                          className="text-glow block text-2xl font-bold tracking-[0.3em] text-[hsl(38_92%_55%)]"
                          style={{
                            fontFamily: "'DM Mono', monospace"
                          }}>
                          {getRoom}
                        </span>
                      </button>
                    </TooltipTrigger>
                    <TooltipContent
                      side="bottom"
                      className="border-border bg-popover text-xs text-popover-foreground">
                      {tooltipText}
                      <TooltipArrow />
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>

              {/* Participant count pill */}
              {participantCount > 0 && (
                <div className="mt-2 flex justify-center">
                  <button
                    onClick={() => setParticipantsOpen(!participantsOpen)}
                    className="group/pill inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-border/60 bg-card/50 px-2.5 py-1 transition-all hover:border-[hsl(38_92%_55%/0.3)] hover:bg-card">
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="text-muted-foreground transition-colors group-hover/pill:text-foreground">
                      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                      <circle cx="9" cy="7" r="4" />
                      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
                      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                    </svg>
                    <span
                      className="text-[11px] tabular-nums text-muted-foreground transition-colors group-hover/pill:text-foreground"
                      style={{ fontFamily: "'DM Mono', monospace" }}>
                      {maxParticipants
                        ? `${participantCount} / ${maxParticipants}`
                        : participantCount}
                    </span>
                    <svg
                      width="10"
                      height="10"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className={`text-muted-foreground transition-transform duration-200 ${participantsOpen ? "rotate-180" : ""}`}>
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </button>
                </div>
              )}
            </div>

            {/* Participant list (collapsible) */}
            {participantsOpen && participants && participants.length > 0 && (
              <div className="animate-fade-in-up mb-3 overflow-hidden rounded-lg border border-border/50 bg-card/30">
                <div className="px-3 pb-1 pt-2">
                  <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
                    {t("participants")}
                  </p>
                </div>
                <div className="max-h-[120px] overflow-y-auto px-1 pb-1.5">
                  {participants.map((p, i) => {
                    const isSelf =
                      p.id === localParticipantId ||
                      (!localParticipantId && p.nickname === localNickname)
                    return (
                      <div
                        key={p.id}
                        className="flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-accent/30"
                        style={{
                          animationDelay: `${i * 30}ms`
                        }}>
                        {/* Avatar circle */}
                        <span
                          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-semibold uppercase ${
                            p.isHost
                              ? "bg-[hsl(38_92%_55%/0.2)] text-[hsl(38_92%_55%)]"
                              : "bg-secondary text-secondary-foreground"
                          }`}>
                          {p.nickname?.charAt(0) || "?"}
                        </span>

                        {/* Name */}
                        <span
                          className={`flex-1 truncate text-[11px] ${
                            isSelf
                              ? "font-semibold text-foreground"
                              : "text-secondary-foreground"
                          }`}>
                          {p.nickname || t("anonymousNickname")}
                        </span>

                        {/* Badges */}
                        <span className="flex shrink-0 items-center gap-1">
                          {isSelf && (
                            <span className="rounded-sm bg-secondary px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground">
                              {t("you")}
                            </span>
                          )}
                          {p.isHost && (
                            <span className="rounded-sm bg-[hsl(38_92%_55%/0.15)] px-1.5 py-0.5 text-[9px] font-semibold text-[hsl(38_92%_55%)]">
                              {t("host")}
                            </span>
                          )}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Status indicator */}
            {!error && (
              <div className="animate-fade-in-up stagger-2 mb-2 flex flex-col items-center gap-1.5">
                <div className="flex items-center gap-2">
                  <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
                  <span className="text-xs text-emerald-400/80">
                    {t("connectedAndSyncing")}
                  </span>
                  {isHost && (
                    <span className="rounded-sm bg-[hsl(38_92%_55%/0.15)] px-1.5 py-0.5 text-[9px] font-semibold text-[hsl(38_92%_55%)]">
                      {t("host")}
                    </span>
                  )}
                </div>

                {/* Playback notice */}
                {participantCount > 0 && controlMode === "shared" && (
                  <p className="text-center text-[10px] leading-snug text-muted-foreground">
                    {t("sharedControlsPlayback")}
                  </p>
                )}
                {!isHost && participantCount > 0 && controlMode === "host" && (
                  <p className="text-center text-[10px] leading-snug text-muted-foreground">
                    {t("hostControlsPlayback")}
                  </p>
                )}
              </div>
            )}

            {error && (
              <div className="animate-fade-in-up stagger-2 mb-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-center text-xs text-destructive">
                {errorMessage}
              </div>
            )}

            {/* Action buttons */}
            <div className="animate-fade-in-up stagger-3 mt-auto flex flex-col gap-2">
              {(error || (state && !error)) && (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full border-border text-xs text-secondary-foreground hover:border-[hsl(38_92%_55%/0.4)] hover:text-foreground"
                  onClick={() =>
                    createOrJoinRoom(
                      state ? { room: state?.[currentTab].roomId } : undefined
                    )
                  }>
                  {t("retrySync")}
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="w-full text-xs text-secondary-foreground hover:text-destructive"
                onClick={exitRoom}>
                {t("leaveRoom")}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-1 flex-col">
            {/* Nickname input */}
            <div className="animate-fade-in-up mb-3">
              <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.15em] text-muted-foreground">
                {t("chatNickname")}
              </label>
              <Input
                type="text"
                placeholder={t("nicknameOptional")}
                value={nickname}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setNickname(e.target.value)
                }
                maxLength={20}
                className="h-9 rounded-lg border-border bg-card text-center text-sm text-foreground placeholder:text-muted-foreground focus-visible:border-[hsl(38_92%_55%/0.4)] focus-visible:ring-[hsl(38_92%_55%/0.2)]"
              />
            </div>

            {/* Shared mode toggle */}
            <div className="animate-fade-in-up mb-3 flex items-center justify-between rounded-lg border border-border/50 bg-card/30 px-3 py-2.5">
              <div className="flex items-center gap-1.5">
                <label
                  htmlFor="shared-mode-switch"
                  className="text-[11px] font-medium uppercase tracking-[0.15em] text-muted-foreground">
                  {t("sharedMode")}
                </label>
                <button
                  type="button"
                  onClick={() => setSharedModeHelpOpen(true)}
                  className="inline-flex h-4 w-4 shrink-0 cursor-pointer items-center justify-center rounded-full border border-muted-foreground/40 text-[9px] font-semibold leading-none text-muted-foreground transition-colors hover:border-[hsl(38_92%_55%/0.6)] hover:text-foreground">
                  ?
                </button>
              </div>
              <Switch
                id="shared-mode-switch"
                checked={sharedMode}
                onCheckedChange={setSharedMode}
                className="data-[state=checked]:bg-[hsl(38_92%_55%)]"
              />
            </div>

            {/* Shared mode help modal */}
            {sharedModeHelpOpen && (
              <div
                className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
                onClick={() => setSharedModeHelpOpen(false)}>
                <div
                  className="animate-fade-in-up mx-4 w-full max-w-[280px] rounded-xl border border-border bg-background p-5 shadow-xl"
                  onClick={(e: React.MouseEvent) => e.stopPropagation()}>
                  <h3 className="mb-3 text-center text-xs font-semibold uppercase tracking-[0.15em] text-foreground">
                    {t("sharedMode")}
                  </h3>
                  <div className="flex flex-col gap-3">
                    <div className="rounded-lg border border-[hsl(38_92%_55%/0.2)] bg-[hsl(38_92%_55%/0.06)] px-3 py-2.5">
                      <p className="mb-1 text-[11px] font-semibold text-[hsl(38_92%_55%)]">
                        ON
                      </p>
                      <p className="text-[11px] leading-snug text-secondary-foreground">
                        {t("sharedModeOnHelp")}
                      </p>
                    </div>
                    <div className="rounded-lg border border-border/60 bg-card/40 px-3 py-2.5">
                      <p className="mb-1 text-[11px] font-semibold text-foreground">
                        OFF
                      </p>
                      <p className="text-[11px] leading-snug text-secondary-foreground">
                        {t("sharedModeOffHelp")}
                      </p>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-4 w-full text-xs"
                    onClick={() => setSharedModeHelpOpen(false)}>
                    {t("close")}
                  </Button>
                </div>
              </div>
            )}

            {/* Create room CTA */}
            <div className="animate-fade-in-up stagger-1 mb-4">
              <Button
                onClick={handleCreateRoomClick}
                className="relative w-full overflow-hidden rounded-lg bg-[hsl(38_92%_55%)] py-5 text-sm font-semibold tracking-wide text-[hsl(220_20%_6%)] shadow-lg shadow-[hsl(38_92%_55%/0.2)] transition-all hover:bg-[hsl(38_80%_50%)] hover:shadow-[hsl(38_92%_55%/0.3)]">
                {t("createRoom")}
              </Button>
            </div>

            {/* Divider */}
            <div className="animate-fade-in-up stagger-2 mb-4 flex items-center gap-3">
              <div className="h-px flex-1 bg-border" />
              <span className="text-[10px] font-medium uppercase tracking-[0.25em] text-secondary-foreground">
                {t("orJoin")}
              </span>
              <div className="h-px flex-1 bg-border" />
            </div>

            {/* Join form */}
            <form
              onSubmit={handleJoinRoomSubmit}
              className="animate-fade-in-up stagger-3 flex flex-col gap-2.5">
              <Input
                type="text"
                placeholder={t("enterRoomCode")}
                className="h-10 rounded-lg border-border bg-card text-center text-sm uppercase tracking-[0.15em] text-foreground placeholder:normal-case placeholder:tracking-normal placeholder:text-muted-foreground focus-visible:border-[hsl(38_92%_55%/0.4)] focus-visible:ring-[hsl(38_92%_55%/0.2)]"
                style={{ fontFamily: "'DM Mono', monospace" }}
                {...register("room", {
                  required: {
                    value: true,
                    message: t("roomCodeEmpty")
                  },
                  maxLength: { value: 5, message: t("roomCodeTooLong") },
                  minLength: { value: 5, message: t("roomCodeTooShort") },
                  pattern: {
                    value: /^[a-zA-Z0-9]*$/,
                    message: t("roomCodeFormatIncorrect")
                  }
                })}
              />
              {errors.room && (
                <p
                  className="text-center text-[11px] text-destructive"
                  role="alert">
                  {errors.room?.message}
                </p>
              )}
              <Button
                type="submit"
                variant="outline"
                className="h-10 rounded-lg border-border text-sm font-medium text-foreground transition-all hover:border-[hsl(38_92%_55%/0.4)] hover:text-foreground">
                {t("joinRoom")}
              </Button>
            </form>
          </div>
        )}
      </div>

      {/* Report panel */}
      {reportOpen && (
        <div className="relative z-10 border-t border-border/50 px-5 py-3">
          {reportSent ? (
            <p className="text-center text-xs text-emerald-400">
              {t("thanksForReporting")}
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              <p className="text-[11px] font-medium text-muted-foreground">
                {t("reportWebsiteNotWorking")}
              </p>
              <textarea
                value={reportDetails}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                  setReportDetails(e.target.value)
                }
                placeholder={t("reportWhatWentWrongOptional")}
                rows={2}
                className="resize-none rounded-md border border-border bg-card px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:border-[hsl(38_92%_55%/0.4)] focus:outline-none"
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 flex-1 text-[11px]"
                  onClick={() => setReportOpen(false)}>
                  {t("cancel")}
                </Button>
                <Button
                  size="sm"
                  className="h-7 flex-1 bg-[hsl(38_92%_55%)] text-[11px] text-[hsl(220_20%_6%)] hover:bg-[hsl(38_80%_50%)]"
                  onClick={submitReport}>
                  {t("sendReport")}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="animate-fade-in stagger-4 relative z-10 flex justify-center gap-4 border-t border-border/50 px-5 py-2.5">
        <button
          onClick={() => {
            setReportOpen(!reportOpen)
            setReportSent(false)
          }}
          className="text-[11px] text-muted-foreground transition-colors hover:text-[hsl(38_92%_55%)]">
          {t("reportIssue")}
        </button>
        <button
          onClick={() => browser.runtime.openOptionsPage()}
          className="text-[11px] text-muted-foreground transition-colors hover:text-[hsl(38_92%_55%)]">
          {t("settings")}
        </button>
        <a
          href="https://synclify.party"
          target="about:blank"
          className="text-[11px] text-muted-foreground transition-colors hover:text-[hsl(38_92%_55%)]">
          {t("website")}
        </a>
      </div>
    </div>
  )
}

export default App
