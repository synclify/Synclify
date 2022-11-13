import React, { useCallback, useEffect, useRef, useState } from "react"
import { deleteRoom, parseRooms, storeRoom } from "~utils/rooms"

import { SOCKET_EVENTS } from "~types/socket"
import { io } from "socket.io-client"
import { setDefaultResultOrder } from "dns"
import { useForm } from "react-hook-form"
import { useStorage } from "@plasmohq/storage/hook"

const socket = io(
  process.env.NODE_ENV === "development"
    ? "http://localhost:3000"
    : process.env.PLASMO_PUBLIC_SOCKET_ENDPOINT
)

type FormData = {
  room: string
}

function IndexPopup() {
  const [rooms, , { setRenderValue, setStoreValue }] = useStorage<string>({
    key: "rooms",
    area: "local"
  })
  const [inRoom, setInRoom] = useState(false)
  const [error, setError] = useState(false)
  const [errorMessage, setErrorMessage] = useState("")
  const currentTabRef = useRef<number>()

  const {
    register,
    handleSubmit,
    formState: { errors }
  } = useForm<FormData>()

  const [detected, setDetected] = useState(false)

  const createRoom = useCallback(() => {
    socket.emit(SOCKET_EVENTS.CREATE)
    detectVideo()
  }, [])

  const joinRoom = useCallback((data: FormData) => {
    const room = data.room.toUpperCase()
    console.log(room)
    roomCallback(room)
    setInRoom(true)

    detectVideo()
  }, [])

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

  const roomCallback = useCallback((room: string) => {
    setRenderValue((rooms) => {
      console.log(rooms)
      const r = storeRoom(rooms, { [currentTabRef.current]: room })
      setStoreValue(r)
      return r
    })
    setInRoom(true)
  }, [])

  useEffect(() => {
    socket.on(SOCKET_EVENTS.CREATE, roomCallback)

    chrome.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
      console.log("SETTING STATE:", tabs[0].id)
      currentTabRef.current = tabs[0].id
    })

    if (parseRooms(rooms)[currentTabRef.current] != undefined) setInRoom(true)

    return () => {
      socket.off(SOCKET_EVENTS.CREATE, roomCallback)
    }
  }, [])

  useEffect(() => {
    if (parseRooms(rooms)[currentTabRef.current] != undefined) setInRoom(true)
  }, [rooms])

  const exitRoom = useCallback(() => {
    setRenderValue((rooms) => {
      const r = deleteRoom(rooms, currentTabRef.current)
      setStoreValue(r)
      return r
    })
    setInRoom(false)
  }, [])

  return (
    <React.StrictMode>
      {inRoom ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            padding: 16
          }}>
          <h1>Room code: {parseRooms(rooms)[currentTabRef.current]}</h1>
          <button onClick={exitRoom}>Exit</button>
          {detected ? <></> : <p>Detecting the video...</p>}
          {error ? <p style={{ color: "red" }}>{errorMessage}</p> : <></>}
        </div>
      ) : (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            padding: 16
          }}>
          <button onClick={createRoom}>Create room</button>
          <p>or</p>
          <p>Join room: </p>
          <form onSubmit={handleSubmit(joinRoom)}>
            <input
              type="text"
              placeholder="Room code"
              {...register("room", {
                required: { value: true, message: "Room code can't be empty." },
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
        </div>
      )}
    </React.StrictMode>
  )
}

export default IndexPopup
