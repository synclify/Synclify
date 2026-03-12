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
import type { State } from "~/types/state"
import browser from "webextension-polyfill"
import logo from "~/assets/logo.svg?raw"
import { useForm } from "react-hook-form"
import { Button } from "~/components/ui/button"
import { Input } from "~/components/ui/input"
import { usePostHog } from "@posthog/react"

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
  const [tooltipText, setTooltipText] = useState("Click to copy")
  const [openTooltip, setOpenTooltip] = useState(false)
  const [nickname, setNickname] = useState("")
  const [reportOpen, setReportOpen] = useState(false)
  const [reportDetails, setReportDetails] = useState("")
  const [reportSent, setReportSent] = useState(false)
  const {
    register,
    handleSubmit,
    formState: { errors }
  } = useForm<FormData>()

  useEffect(() => {
    const storage = browser.storage.local
    storage.get("state").then((result) => {
      if (result.state) {
        setState(result.state as State)
      }
    })
    storage.get("nickname").then((result) => {
      if (result.nickname) setNickname(result.nickname as string)
    })
    const listener = (
      changes: Record<string, browser.Storage.StorageChange>
    ) => {
      if (changes.state) {
        setState(changes.state.newValue as State)
      }
    }
    browser.storage.onChanged.addListener(listener)
    return () => {
      browser.storage.onChanged.removeListener(listener)
    }
  }, [])

  const setStoredState = useCallback((newState: State) => {
    setState(newState)
    browser.storage.local.set({ state: newState })
  }, [])

  const responseCallback = useCallback((response: ExtResponse) => {
    if (!response) {
      setError(true)
      setErrorMessage("Video not detected yet")
      return
    }
    switch (response.status) {
      case MESSAGE_STATUS.SUCCESS:
        setInRoom(true)
        setError(false)
        break
      case MESSAGE_STATUS.ERROR:
        setError(true)
        setErrorMessage(response.message as string)
        break
      case MESSAGE_STATUS.MULTIPLE_VIDEOS:
        setError(true)
        setErrorMessage(response.message as string)
        break
    }
  }, [])

  const roomCallback = useCallback(
    (roomId: string) => {
      const nick = nickname.trim() || "Anonymous"
      browser.storage.local.set({ nickname: nick })
      const newState = Object.assign(state ?? {}, {
        [currentTab]: {
          roomId: roomId,
          videoFound: state?.[currentTab]?.videoFound ?? false,
          nickname: nick
        }
      })
      setStoredState(newState)
      browser.runtime
        .sendMessage({ action: "inject" })
        .then((response: ExtResponse) => responseCallback(response))
    },
    [currentTab, responseCallback, state, setStoredState, nickname]
  )

  const createOrJoinRoom = useCallback(
    (data?: FormData) => {
      browser.permissions
        .request({
          permissions: ["activeTab"],
          origins: ["https://*/*"]
        })
        .catch((err) => console.error(err))
        .then((granted) => {
          if (granted) {
            if (data) {
              const room = data.room.toUpperCase()
              roomCallback(room)
            } else
              browser.runtime
                .sendMessage({ action: "createRoom" })
                .then((roomCode: string) => roomCallback(roomCode))
          }
        })
    },
    [roomCallback]
  )

  useEffect(() => {
    if (state && state[currentTab]) {
      setInRoom(true)
      if (!state[currentTab].videoFound) {
        setError(true)
        setErrorMessage("Video not detected yet")
      }
    }
  }, [currentTab, state])

  useEffect(() => {
    browser.runtime
      .sendMessage({ action: "getTabId" })
      .then((tabId: number) => setCurrentTab(tabId))
  }, [])

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

  const copyToClipboard = useCallback(() => {
    navigator.clipboard.writeText(getRoom)
    setTooltipText("Copied!")
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
      page_title: tabs[0]?.title || ""
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
            <div className="animate-fade-in-up stagger-1 mb-4">
              <p className="mb-1.5 text-center text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
                Room Code
              </p>
              <div className="flex justify-center">
                <TooltipProvider>
                  <Tooltip open={openTooltip}>
                    <TooltipTrigger asChild>
                      <button
                        className="animate-pulse-glow group relative cursor-pointer rounded-lg border border-[hsl(38_92%_55%/0.2)] bg-[hsl(38_92%_55%/0.06)] px-6 py-3 transition-all hover:border-[hsl(38_92%_55%/0.4)] hover:bg-[hsl(38_92%_55%/0.1)]"
                        onMouseOver={() => {
                          setOpenTooltip(true)
                          setTooltipText("Click to copy")
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
            </div>

            {/* Status indicator */}
            {!error && (
              <div className="animate-fade-in-up stagger-2 mb-4 flex items-center justify-center gap-2">
                <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
                <span className="text-xs text-emerald-400/80">
                  Connected & syncing
                </span>
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
                  Retry sync
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="w-full text-xs text-secondary-foreground hover:text-destructive"
                onClick={exitRoom}>
                Leave room
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-1 flex-col">
            {/* Nickname input */}
            <div className="animate-fade-in-up mb-3">
              <Input
                type="text"
                placeholder="Nickname (optional)"
                value={nickname}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNickname(e.target.value)}
                maxLength={20}
                className="h-9 rounded-lg border-border bg-card text-center text-sm text-foreground placeholder:text-muted-foreground focus-visible:border-[hsl(38_92%_55%/0.4)] focus-visible:ring-[hsl(38_92%_55%/0.2)]"
              />
            </div>

            {/* Create room CTA */}
            <div className="animate-fade-in-up stagger-1 mb-4">
              <Button
                onClick={() => createOrJoinRoom()}
                className="relative w-full overflow-hidden rounded-lg bg-[hsl(38_92%_55%)] py-5 text-sm font-semibold tracking-wide text-[hsl(220_20%_6%)] shadow-lg shadow-[hsl(38_92%_55%/0.2)] transition-all hover:bg-[hsl(38_80%_50%)] hover:shadow-[hsl(38_92%_55%/0.3)]">
                Create Room
              </Button>
            </div>

            {/* Divider */}
            <div className="animate-fade-in-up stagger-2 mb-4 flex items-center gap-3">
              <div className="h-px flex-1 bg-border" />
              <span className="text-[10px] font-medium uppercase tracking-[0.25em] text-secondary-foreground">
                or join
              </span>
              <div className="h-px flex-1 bg-border" />
            </div>

            {/* Join form */}
            <form
              onSubmit={handleSubmit(createOrJoinRoom)}
              className="animate-fade-in-up stagger-3 flex flex-col gap-2.5">
              <Input
                type="text"
                placeholder="Enter room code"
                className="h-10 rounded-lg border-border bg-card text-center text-sm uppercase tracking-[0.15em] text-foreground placeholder:normal-case placeholder:tracking-normal placeholder:text-muted-foreground focus-visible:border-[hsl(38_92%_55%/0.4)] focus-visible:ring-[hsl(38_92%_55%/0.2)]"
                style={{ fontFamily: "'DM Mono', monospace" }}
                {...register("room", {
                  required: {
                    value: true,
                    message: "Room code can't be empty."
                  },
                  maxLength: { value: 5, message: "Room code too long." },
                  minLength: { value: 5, message: "Room code too short" },
                  pattern: {
                    value: /^[a-zA-Z0-9]*$/,
                    message: "Room code format incorrect"
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
                Join Room
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
              Thanks for reporting!
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              <p className="text-[11px] font-medium text-muted-foreground">
                Report this website as not working
              </p>
              <textarea
                value={reportDetails}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                  setReportDetails(e.target.value)
                }
                placeholder="What went wrong? (optional)"
                rows={2}
                className="resize-none rounded-md border border-border bg-card px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:border-[hsl(38_92%_55%/0.4)] focus:outline-none"
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 flex-1 text-[11px]"
                  onClick={() => setReportOpen(false)}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  className="h-7 flex-1 bg-[hsl(38_92%_55%)] text-[11px] text-[hsl(220_20%_6%)] hover:bg-[hsl(38_80%_50%)]"
                  onClick={submitReport}>
                  Send Report
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
          Report issue
        </button>
        <button
          onClick={() => browser.runtime.openOptionsPage()}
          className="text-[11px] text-muted-foreground transition-colors hover:text-[hsl(38_92%_55%)]">
          Settings
        </button>
        <a
          href="https://synclify.party"
          target="about:blank"
          className="text-[11px] text-muted-foreground transition-colors hover:text-[hsl(38_92%_55%)]">
          Website
        </a>
      </div>
    </div>
  )
}

export default App
