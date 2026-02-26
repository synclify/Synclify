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
import { Label } from "~/components/ui/label"
import { Separator } from "~/components/ui/separator"

type FormData = {
  room: string
}

function App() {
  const [state, setState] = useState<State | undefined>()
  const [inRoom, setInRoom] = useState(false)
  const [error, setError] = useState(false)
  const [errorMessage, setErrorMessage] = useState("")
  const [currentTab, setCurrentTab] = useState<number>(0)
  const [tooltipText, setTooltipText] = useState("Click to copy")
  const [openTooltip, setOpenTooltip] = useState(false)
  const {
    register,
    handleSubmit,
    formState: { errors }
  } = useForm<FormData>()

  // Load state from storage
  useEffect(() => {
    const storage = browser.storage.local
    storage.get("state").then((result) => {
      if (result.state) {
        setState(result.state as State)
      }
    })
    // Listen for storage changes
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
      const newState = Object.assign(state ?? {}, {
        [currentTab]: {
          roomId: roomId,
          videoFound: state?.[currentTab]?.videoFound ?? false
        }
      })
      setStoredState(newState)
      browser.runtime
        .sendMessage({ action: "inject" })
        .then((response: ExtResponse) => responseCallback(response))
    },
    [currentTab, responseCallback, state, setStoredState]
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

  return (
    <div className="dark flex flex-col bg-stone-900 p-4 text-primary">
      <div dangerouslySetInnerHTML={{ __html: logo }} className="pb-2" />
      {inRoom ? (
        <>
          <div className="text-base">
            <p>Room code:</p>
            <div className="flex place-content-center">
              <TooltipProvider>
                <Tooltip open={openTooltip}>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      className="cursor-pointer text-xl font-bold"
                      onMouseOver={() => {
                        setOpenTooltip(true)
                        setTooltipText("Click to copy")
                      }}
                      onMouseLeave={() => setOpenTooltip(false)}
                      onClick={copyToClipboard}>
                      {getRoom}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="right">
                    {tooltipText}
                    <TooltipArrow />
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          </div>
          <Button onClick={exitRoom} className="my-4">
            Exit
          </Button>
          {state && !error && (
            <div className="flex flex-col justify-between">
              <p>Video not in sync?</p>
              <Button
                variant="outline"
                onClick={() =>
                  createOrJoinRoom(
                    state ? { room: state?.[currentTab].roomId } : undefined
                  )
                }>
                Click to try again
              </Button>
            </div>
          )}
          {error && (
            <>
              <p className="text-base text-red-700">{errorMessage}</p>
              <Button
                onClick={() =>
                  createOrJoinRoom(
                    state ? { room: state?.[currentTab].roomId } : undefined
                  )
                }>
                Click to try again
              </Button>
            </>
          )}
        </>
      ) : (
        <>
          <Button onClick={() => createOrJoinRoom()}>Create room</Button>
          <div className="flex items-center">
            <Separator className="dark w-auto flex-grow" />
            <p className="mx-2 flex-grow-0 text-base">or</p>
            <Separator className="dark w-auto flex-grow" />
          </div>
          <Label>Join room: </Label>
          <form
            onSubmit={handleSubmit(createOrJoinRoom)}
            className="flex flex-col gap-4">
            <Input
              type="text"
              placeholder="Room code"
              className="text-base"
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
              <div>
                <p className="text-base text-red-700" role="alert">
                  {errors.room?.message}
                </p>
              </div>
            )}
            <Button type="submit">Join!</Button>
          </form>
        </>
      )}
      <div className="mx-3 my-2 flex justify-between">
        <Button variant="link" asChild>
          <a
            href="https://forms.gle/HN6AGyThWAXSCaXC8"
            target="about:blank"
            className="text-sm hover:underline">
            Feedback
          </a>
        </Button>
        <Button
          variant="link"
          onClick={() => browser.runtime.openOptionsPage()}
          className="text-sm hover:underline">
          Settings
        </Button>
        <Button variant="link" asChild>
          <a
            href="https://synclify.party"
            target="about:blank"
            className="text-sm font-medium hover:underline">
            Website
          </a>
        </Button>
      </div>
    </div>
  )
}

export default App
