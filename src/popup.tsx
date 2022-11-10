import React, { useCallback, useEffect, useState } from "react"

import { io } from "socket.io-client"
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
  const [room, , { setRenderValue, setStoreValue, remove }] = useStorage({
    key: "room",
    area: "session"
  })

  const {
    register,
    handleSubmit,
    formState: { errors }
  } = useForm<FormData>()

  const [detected, setDetected] = useState(false)

  const createRoom = useCallback(() => {
    socket.emit("create")
    detectVideo()
  }, [])

  const joinRoom = useCallback((data: FormData) => {
    const room = data.room.toUpperCase()
    console.log(room)
    setRenderValue(room)
    setStoreValue(room)
    detectVideo()
  }, [])

  const detectVideo = () => {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      chrome.tabs.sendMessage(
        tabs[0].id,
        { message: "detectVideo" },
        function (response) {
          if (response.message === "ok") setDetected(true)
        }
      )
    })
  }

  useEffect(() => {
    socket.on("create", (room) => {
      console.log("code created by server", room)
      setStoreValue(room)
    })

    return () => {
      socket.off("create")
    }
  }, [])

  return (
    <React.StrictMode>
      {room ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            padding: 16
          }}>
          <h1>Room code: {room}</h1>
          <button onClick={() => remove()}>Exit</button>
          {detected ? <p></p> : <p>Now click on the video to detect it</p>}
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
