import "./style.css"

import { Button, TextInput, Tooltip } from "flowbite-react"
import { ChromeLinkOptions, chromeLink } from "trpc-chrome/link"
import { ExtResponse, MESSAGE_STATUS, MESSAGE_TYPE } from "~types/messaging"
import React, { useCallback, useEffect, useMemo, useState } from "react"

import type { AppRouter } from "./background"
import type { RoomsList } from "~utils/rooms"
import browser from "webextension-polyfill"
import { createTRPCProxyClient } from "@trpc/client"
import logo from "data-text:~assets/logo.svg"
import { useForm } from "react-hook-form"
import { useStorage } from "@plasmohq/storage/hook"

const port = browser.runtime.connect()
const trpc = createTRPCProxyClient<AppRouter>({
  links: [chromeLink({ port } as ChromeLinkOptions)]
})

type FormData = {
  room: string
}

function IndexPopup() {
  const [rooms, , { setRenderValue, setStoreValue }] = useStorage<
    RoomsList | undefined
  >({
    key: "rooms",
    area: "local"
  })
  const [inRoom, setInRoom] = useState(false)
  const [detected, setDetected] = useState(false)
  const [error, setError] = useState(false)
  const [errorMessage, setErrorMessage] = useState("")
  const [currentTab, setCurrentTab] = useState<number>(0)
  const [tooltipText, setTooltipText] = useState("Click to copy")
  const {
    register,
    handleSubmit,
    formState: { errors }
  } = useForm<FormData>()
  /*
  const detectVideo = () => {
    browser.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      browser.tabs.sendMessage(
        tabs[0].id,
        { message: "detectVideo" },
        function (response) {
          if (response.status === "success") setDetected(true)
          else if (response.status === "error") {
            setError(true)
            setErrorMessage(response.message)
          }
        }
      )
    })
  }
*/

  const responseCallback = useCallback((response: ExtResponse) => {
    if (!response) {
      setDetected(false)
      setError(true)
      setErrorMessage("Video not detected")
    } else if (response.status === MESSAGE_STATUS.SUCCESS) {
      setDetected(true)
      setInRoom(true)
      setError(false)
    } else if (response.status === MESSAGE_STATUS.ERROR) {
      setDetected(false)
      setError(true)
      setErrorMessage(response.message as string)
    }
  }, [])

  const roomCallback = useCallback(
    (newRooms: string) => {
      setRenderValue((oldRooms) => {
        const r = Object.assign(oldRooms ?? {}, { [currentTab]: newRooms })
        setStoreValue(r)
        return r
      })

      browser.tabs
        .sendMessage(currentTab, { type: MESSAGE_TYPE.INIT })
        .then((response: ExtResponse) => responseCallback(response))
    },
    [currentTab, responseCallback, setRenderValue, setStoreValue]
  )

  const createRoom = useCallback(() => {
    trpc.createRoom.query().then((roomCode) => roomCallback(roomCode))
  }, [roomCallback])

  const joinRoom = useCallback(
    (data: FormData) => {
      const room = data.room.toUpperCase()
      roomCallback(room)
    },
    [roomCallback]
  )

  useEffect(() => {
    if (rooms && rooms[currentTab]) setInRoom(true)
  }, [currentTab, roomCallback, rooms])

  useEffect(() => {
    trpc.getTabId.query().then((tabId) => {
      setCurrentTab(tabId)
    })
  }, [])

  useEffect(() => {
    if (inRoom)
      browser.tabs
        .sendMessage(currentTab, { type: MESSAGE_TYPE.CHECK_VIDEO })
        .then((response: ExtResponse) => responseCallback(response))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const exitRoom = useCallback(() => {
    setRenderValue((roomsState) => {
      if (roomsState) {
        delete roomsState[currentTab]
        setStoreValue(roomsState)
        return roomsState
      }
    })
    setInRoom(false)
    browser.tabs.query({ active: true, currentWindow: true }).then((tabs) =>
      browser.tabs.sendMessage(tabs[0].id as number, {
        type: MESSAGE_TYPE.EXIT
      })
    )
  }, [currentTab, setRenderValue, setStoreValue])

  const getRoom = useMemo(() => {
    return rooms?.[currentTab] ?? "ERROR"
  }, [currentTab, rooms])

  const copyToClipboard = useCallback(() => {
    navigator.clipboard.writeText(getRoom)
    setTooltipText("Copied!")
  }, [getRoom])

  return (
    <React.StrictMode>
      <div className="flex flex-col p-4">
        <div dangerouslySetInnerHTML={{ __html: logo }} className="pb-2" />
        {inRoom ? (
          <>
            <div className="text-base">
              <p>Room code:</p>
              <div className="flex place-content-center">
                <Tooltip
                  content={tooltipText}
                  placement="right"
                  arrow={true}
                  style="light">
                  <p
                    className="cursor-pointer text-xl font-bold"
                    onClick={copyToClipboard}>
                    {getRoom}
                  </p>
                </Tooltip>
              </div>
            </div>
            <Button
              gradientDuoTone="purpleToBlue"
              onClick={exitRoom}
              className="my-4">
              Exit
            </Button>
            {detected && !error ? null : (
              <p className="text-base">Detecting the video...</p>
            )}
            {error ? (
              <p className="text-base text-red-700">{errorMessage}</p>
            ) : null}
          </>
        ) : (
          <>
            <Button gradientDuoTone="purpleToBlue" onClick={createRoom}>
              Create room
            </Button>
            <p className="text-base">or</p>
            <p className="text-base">Join room: </p>
            <form
              onSubmit={handleSubmit(joinRoom)}
              className="flex flex-col gap-4">
              <TextInput
                type="text"
                placeholder="Room code"
                sizing="sm"
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
              <Button gradientDuoTone="purpleToBlue" type="submit">
                Join!
              </Button>
            </form>
          </>
        )}
      </div>
    </React.StrictMode>
  )
}

export default IndexPopup
