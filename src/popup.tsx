import "./style.css"

import { Button, TextInput } from "flowbite-react"
import { ChromeLinkOptions, chromeLink } from "trpc-chrome/link"
import { ExtResponse, MESSAGE_STATUS, MESSAGE_TYPE } from "~types/messaging"
import React, { useCallback, useEffect, useMemo, useState } from "react"
import { deleteRoom, parseRooms, storeRoom } from "~utils/rooms"

import type { AppRouter } from "./background"
import Tooltip from "~components/atoms/Tooltip"
import browser from "webextension-polyfill"
import { createTRPCProxyClient } from "@trpc/client"
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
    string | undefined
  >({
    key: "rooms",
    area: "local"
  })
  const [inRoom, setInRoom] = useState(false)
  const [detected, setDetected] = useState(false)
  const [error, setError] = useState(false)
  const [errorMessage, setErrorMessage] = useState("")
  const [currentTab, setCurrentTab] = useState<number>(0)
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
  const roomCallback = useCallback(
    (room: string) => {
      setRenderValue((rooms) => {
        console.log(rooms)
        const r = storeRoom(rooms, { [currentTab]: room })
        setStoreValue(r)
        return r
      })
      browser.tabs
        .sendMessage(currentTab, { type: MESSAGE_TYPE.INIT })
        .then((response: ExtResponse) => {
          if (response.status === MESSAGE_STATUS.SUCCESS) {
            setDetected(true)
            setInRoom(true)
            setError(false)
            console.log("init success")
          }
        })
    },
    [currentTab, setRenderValue, setStoreValue]
  )

  const createRoom = useCallback(() => {
    trpc.createRoom.query().then((roomCode) => roomCallback(roomCode))
  }, [roomCallback])

  const joinRoom = useCallback(
    (data: FormData) => {
      const room = data.room.toUpperCase()
      console.log(room)
      roomCallback(room)
    },
    [roomCallback]
  )

  useEffect(() => {
    const room = parseRooms(rooms)?.[currentTab]
    if (room) {
      console.log(room)
      setInRoom(true)
    }
  }, [currentTab, roomCallback, rooms])

  useEffect(() => {
    trpc.getTabId.query().then((tabId) => {
      console.log("SETTING STATE:", tabId)
      setCurrentTab(tabId)
    })
  }, [])

  useEffect(() => {
    if (inRoom)
      browser.tabs
        .sendMessage(currentTab, { type: MESSAGE_TYPE.CHECK_VIDEO })
        .then((response: ExtResponse) => {
          if (response.status === MESSAGE_STATUS.ERROR) {
            setError(true)
            setErrorMessage(response.message as string)
          } else if (response.status === MESSAGE_STATUS.SUCCESS)
            setDetected(true)
        })
  }, [currentTab, inRoom])

  const exitRoom = useCallback(() => {
    setRenderValue((rooms) => {
      const r = deleteRoom(rooms, currentTab)
      setStoreValue(r)
      return r
    })
    setInRoom(false)
    browser.tabs.query({ active: true, currentWindow: true }).then((tabs) =>
      browser.tabs
        .sendMessage(tabs[0].id as number, { type: MESSAGE_TYPE.EXIT })
        .then((response: ExtResponse) => {
          if (response.status === MESSAGE_STATUS.SUCCESS)
            console.log("exit success")
        })
    )
  }, [currentTab, setRenderValue, setStoreValue])

  const getRoom = useMemo(() => {
    return parseRooms(rooms)?.[currentTab] ?? "ERROR"
  }, [currentTab, rooms])

  const copyToClipboard = useCallback(() => {
    navigator.clipboard.writeText(getRoom)
  }, [getRoom])

  return (
    <React.StrictMode>
      <div className="flex flex-col p-4">
        <h1 className="mb-3 text-center font-['Space_Mono'] text-4xl">
          openW2G
        </h1>
        {inRoom ? (
          <>
            <div className="text-base">
              <p>Room code (click to copy):</p>
              <Tooltip content="Copied!" onReferenceClick={copyToClipboard}>
                <span className="cursor-pointer">{getRoom}</span>
              </Tooltip>
            </div>
            <Button
              gradientDuoTone="purpleToBlue"
              onClick={exitRoom}
              className="my-4">
              Exit
            </Button>
            {detected ? (
              <></>
            ) : (
              <p className="text-base">Detecting the video...</p>
            )}
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
        {error ? (
          <p className="text-base text-red-700">{errorMessage}</p>
        ) : (
          <></>
        )}
      </div>
    </React.StrictMode>
  )
}

export default IndexPopup
