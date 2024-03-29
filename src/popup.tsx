import "./style.css"

import { Button, TextInput, Tooltip } from "flowbite-react"
import {
  type ExtResponse,
  MESSAGE_STATUS,
  MESSAGE_TYPE
} from "~types/messaging"
import React, { useCallback, useEffect, useMemo, useState } from "react"

import type { State } from "~types/state"
import { Storage } from "@plasmohq/storage"
import browser from "webextension-polyfill"
import logo from "data-text:~assets/logo.svg"
import { sendToBackground } from "@plasmohq/messaging"
import { useForm } from "react-hook-form"
import { useStorage } from "@plasmohq/storage/hook"
import { setState } from "~utils"

type FormData = {
  room: string
}

function IndexPopup() {
  const [state, , { setRenderValue, setStoreValue }] = useStorage<
    State | undefined
  >({
    key: "state",
    instance: new Storage({
      area: "local"
    })
  })
  const [inRoom, setInRoom] = useState(false)
  const [error, setError] = useState(false)
  const [errorMessage, setErrorMessage] = useState("")
  const [currentTab, setCurrentTab] = useState<number>(0)
  const [tooltipText, setTooltipText] = useState("Click to copy")
  const {
    register,
    handleSubmit,
    formState: { errors }
  } = useForm<FormData>()

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
      setRenderValue((state) => {
        const newState = setState(currentTab, roomId, state)
        setStoreValue(newState)
        return newState
      })
      sendToBackground({ name: "inject" }).then((response: ExtResponse) =>
        responseCallback(response)
      )
    },
    [currentTab, responseCallback, setRenderValue, setStoreValue]
  )

  const createOrJoinRoom = useCallback(
    (data?: FormData) => {
      // get permissions for all frames host
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
              sendToBackground({ name: "createRoom" }).then((roomCode) =>
                roomCallback(roomCode)
              )
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
    sendToBackground({ name: "getTabId" }).then((tabId) => setCurrentTab(tabId))
  }, [])

  const exitRoom = useCallback(() => {
    setRenderValue((state) => {
      if (state) {
        delete state[currentTab]
        setStoreValue(state)
        return state
      }
    })
    setInRoom(false)
    browser.tabs.query({ active: true, currentWindow: true }).then((tabs) =>
      browser.tabs.sendMessage(tabs[0].id as number, {
        type: MESSAGE_TYPE.EXIT
      })
    )
  }, [currentTab, setRenderValue, setStoreValue])

  const getRoom = useMemo(
    () => state?.[currentTab]?.roomId ?? "ERROR",
    [currentTab, state]
  )

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
            {error ? (
              <>
                <p className="text-base text-red-700">{errorMessage}</p>
                <Button
                  gradientDuoTone="purpleToBlue"
                  onClick={() =>
                    createOrJoinRoom(
                      state ? { room: state?.[currentTab].roomId } : undefined
                    )
                  }>
                  Click to try again
                </Button>
              </>
            ) : null}
          </>
        ) : (
          <>
            <Button
              gradientDuoTone="purpleToBlue"
              onClick={() => createOrJoinRoom()}>
              Create room
            </Button>
            <p className="text-base">or</p>
            <p className="text-base">Join room: </p>
            <form
              onSubmit={handleSubmit(createOrJoinRoom)}
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
      <div className="mx-3 my-2 flex justify-between">
        <a
          href="https://forms.gle/HN6AGyThWAXSCaXC8"
          target="about:blank"
          className="text-sm font-medium text-blue-600 hover:underline dark:text-blue-500">
          Feedback
        </a>
        <a
          href="https://synclify.party"
          target="about:blank"
          className="text-sm font-medium text-blue-600 hover:underline dark:text-blue-500">
          Website
        </a>
      </div>
    </React.StrictMode>
  )
}

export default IndexPopup
