import { defineBackground } from "wxt/utils/define-background"
import browser from "webextension-polyfill"
import * as Sentry from "@sentry/browser"
import { SOCKET_URL, SOCKET_EVENTS } from "~/types/socket"
import { MESSAGE_STATUS, MESSAGE_TYPE } from "~/types/messaging"
import type { State } from "~/types/state"

export default defineBackground(() => {
  Sentry.init({
    dsn: import.meta.env.WXT_SENTRY_DSN,
    tunnel: `${SOCKET_URL}/t`
  })

  // --- Tab lifecycle ---
  browser.tabs.onRemoved.addListener((tabId) => {
    browser.storage.local.get("state").then((result) => {
      const state = result.state as State | undefined
      if (state === undefined)
        throw new Error(
          "State undefined in background worker tab closed callback"
        )
      delete state[tabId]
      browser.storage.local.set({ state })
    })
  })

  browser.runtime.onInstalled.addListener(async (details) => {
    if (details.previousVersion !== browser.runtime.getManifest().version) {
      await browser.storage.local.clear()
      browser.runtime.reload()
    }
  })

  // --- Message handlers (replaces Plasmo background/messages/) ---

  async function handleGetTabId(): Promise<number> {
    const tabs = await browser.tabs.query({
      active: true,
      currentWindow: true
    })
    if (tabs.length === 0) throw new Error("No active tab found")
    return tabs[0].id as number
  }

  async function handleCreateRoom(): Promise<string> {
    const res = await fetch(`${SOCKET_URL}/create`)
    const code = await res.text()
    if (!res.ok) {
      const e = new Error(
        `Failed to fetch room code from socket server: ${JSON.stringify({ code: res.status, statusText: res.statusText, body: code })}`
      )
      Sentry.captureException(e)
    }
    return code
  }

  async function handleShouldInject(): Promise<boolean> {
    const tabs = await browser.tabs.query({
      active: true,
      currentWindow: true
    })
    const result = await browser.storage.local.get("state")
    const rooms = result.state as State | undefined
    if (rooms && tabs[0].id && rooms[tabs[0].id]) {
      return true
    }
    return false
  }

  interface Video {
    src: string
    duration: number
    width: number
    height: number
    title: string
    id: string
  }

  async function handleInject(body?: { frameIds: number[]; videoId: string }) {
    const tabs = await browser.tabs.query({
      active: true,
      currentWindow: true
    })
    const tabId = tabs[0].id
    if (!tabId) throw new Error("Tab id is undefined")

    let frameIds = body ? body.frameIds : null
    let videoId: string | null = null

    if (!frameIds) {
      const result = await browser.scripting.executeScript({
        func: () => {
          const videos = document.getElementsByTagName("video")
          return Array.from(videos).map((video) => {
            if (video.src === "" && video.children.length === 0) return
            if (
              video.dataset.synclifyId === "" ||
              video.dataset.synclifyId === undefined
            )
              video.dataset.synclifyId = Math.random().toString(36).slice(2, 7)
            return {
              src:
                video.src === ""
                  ? (
                      Array.from(video.children).find(
                        (child) => child.tagName === "SOURCE"
                      ) as HTMLSourceElement
                    ).src
                  : video.src,
              duration: video.duration,
              width: video.videoWidth,
              height: video.videoHeight,
              title: document.title,
              id: video.dataset.synclifyId
            }
          })
        },
        target: { tabId: tabId, allFrames: true }
      })

      const videos = result
        .filter((injection) => injection.result && injection.result.length != 0)
        .flatMap((injection) =>
          Array.from(injection.result as Video[])
            .filter((video) => video != null)
            .map((video) => {
              return {
                ...video,
                frameId: injection.frameId
              }
            })
        )

      if (videos.length > 1) {
        browser.tabs.sendMessage(tabId, {
          to: "videoSelector",
          videos: videos
        })
        return {
          status: MESSAGE_STATUS.MULTIPLE_VIDEOS,
          message: "Multiple videos detected"
        }
      } else if (videos.length === 1) {
        frameIds = [videos[0].frameId]
        videoId = videos[0].id
      } else {
        return null
      }
    }

    // Inject the unlisted content script into desired frames
    await browser.scripting.executeScript({
      files: ["injected.js"],
      target: { tabId: tabId, frameIds: frameIds }
    })

    browser.tabs.sendMessage(tabId, {
      type: MESSAGE_TYPE.INIT,
      videoId: body ? body.videoId : videoId
    })

    return { status: MESSAGE_STATUS.SUCCESS }
  }

  async function handleShowToast(body: {
    error?: boolean
    content: string
    show?: boolean
  }) {
    const tabs = await browser.tabs.query({
      active: true,
      currentWindow: true
    })
    const id = tabs[0].id as number
    browser.tabs.sendMessage(id, {
      to: "toast",
      error: body.error,
      content: body.content,
      show: body.show ?? true
    })
    return null
  }

  // Central message router
  browser.runtime.onMessage.addListener((message, _sender) => {
    switch (message.action) {
      case "getTabId":
        return handleGetTabId()
      case "createRoom":
        return handleCreateRoom()
      case "shouldInject":
        return handleShouldInject()
      case "inject":
        return handleInject(message.body)
      case "showToast":
        return handleShowToast(message.body)
      default:
        return undefined
    }
  })
})
