import { ExtResponse, MESSAGE_STATUS, MESSAGE_TYPE } from "~types/messaging"
import React, { useCallback, useEffect, useMemo, useState } from "react"
import { deleteRoom, parseRooms, storeRoom } from "~utils/rooms"

import type { AppRouter } from "./background"
import { chromeLink } from "trpc-chrome/link"
import { createTRPCProxyClient } from "@trpc/client"
import { useForm } from "react-hook-form"
import { useStorage } from "@plasmohq/storage/hook"

const port = chrome.runtime.connect()
const trpc = createTRPCProxyClient<AppRouter>({
  links: [chromeLink({ port })]
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
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      chrome.tabs.sendMessage(
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
      chrome.tabs.sendMessage(
        currentTab,
        { type: MESSAGE_TYPE.INIT },
        function (response: ExtResponse) {
          if (response.status === MESSAGE_STATUS.SUCCESS) {
            setDetected(true)
            setInRoom(true)
            setError(false)
            console.log("init success")
          }
        }
      )
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
      chrome.tabs.sendMessage(
        currentTab,
        { type: MESSAGE_TYPE.CHECK_VIDEO },
        function (response: ExtResponse) {
          if (response.status === MESSAGE_STATUS.ERROR) {
            setError(true)
            setErrorMessage(response.message as string)
          } else if (response.status === MESSAGE_STATUS.SUCCESS)
            setDetected(true)
        }
      )
  }, [currentTab, inRoom])

  const exitRoom = useCallback(() => {
    setRenderValue((rooms) => {
      const r = deleteRoom(rooms, currentTab)
      setStoreValue(r)
      return r
    })
    setInRoom(false)
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      chrome.tabs.sendMessage(
        tabs[0].id as number,
        { type: MESSAGE_TYPE.EXIT },
        function (response) {
          if (response.status === MESSAGE_STATUS.SUCCESS)
            console.log("exit success")
        }
      )
    })
  }, [currentTab, setRenderValue, setStoreValue])

  const getRoom = useMemo(() => {
    return parseRooms(rooms)?.[currentTab] ?? "ERROR"
  }, [currentTab, rooms])

  return (
    <React.StrictMode>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          padding: 16
        }}>
        {inRoom ? (
          <>
            <h1>Room code: {getRoom}</h1>
            <button onClick={exitRoom}>Exit</button>
            {detected ? <></> : <p>Detecting the video...</p>}
          </>
        ) : (
          <>
            <button onClick={createRoom}>Create room</button>
            <p>or</p>
            <p>Join room: </p>
            <form onSubmit={handleSubmit(joinRoom)}>
              <input
                type="text"
                placeholder="Room code"
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
                  <p style={{ color: "red" }} role="alert">
                    {errors.room?.message}
                  </p>
                </div>
              )}
              <input type="submit" value="Join!" />
            </form>
          </>
        )}
        {error ? <p style={{ color: "red" }}>{errorMessage}</p> : <></>}
      </div>
    </React.StrictMode>
  )
}

export default IndexPopup
