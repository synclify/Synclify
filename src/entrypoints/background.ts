import { defineBackground } from "wxt/utils/define-background"
import browser from "webextension-polyfill"
import { SOCKET_URL, SOCKET_EVENTS } from "~/types/socket"
import { MESSAGE_STATUS, MESSAGE_TYPE } from "~/types/messaging"
import type { State } from "~/types/state"
import { createPostHog } from "~/lib/posthog"
import type { PostHog } from "posthog-js/dist/module.no-external"

let posthog: PostHog

export default defineBackground(async () => {
  posthog = await createPostHog("background")

  // --- Persistent rooms: re-inject on full page navigation ---
  browser.webNavigation.onCompleted.addListener(async (details) => {
    if (details.frameId !== 0) return // only top-level navigations
    const result = await browser.storage.local.get("state")
    const state = result.state as State | undefined
    if (state && state[details.tabId]) {
      try {
        await reinjectTab(details.tabId)
      } catch {
        // Tab may not be ready yet, ignore
      }
    }
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

  // Self-contained function injected into page context via executeScript.
  // Must not reference any outer scope — it gets serialized and run in the page.
  function detectPageVideos() {
    const SITE_VIDEO_SELECTORS: Record<
      string,
      {
        hostPatterns: RegExp[]
        videoSelector: string
        playerContainer: string
        excludeSelector?: string
        watchPageTest?: () => boolean
      }
    > = {
      netflix: {
        hostPatterns: [/netflix\.com$/],
        videoSelector: ".watch-video--player-view video",
        playerContainer: ".watch-video--player-view",
        watchPageTest: () => location.pathname.includes("/watch")
      },
      youtube: {
        hostPatterns: [/youtube\.com$/, /youtu\.be$/],
        videoSelector: "#movie_player video.html5-main-video",
        playerContainer: "#movie_player",
        watchPageTest: () => location.pathname.includes("/watch"),
        excludeSelector: ".ytp-ad-overlay-container video"
      },
      primevideo: {
        hostPatterns: [
          /primevideo\.com$/,
          /amazon\.(com|co\.\w+|de|fr|it|es|in|jp|br|ca|com\.au)$/
        ],
        videoSelector: ".dv-player-fullscreen video",
        playerContainer: ".dv-player-fullscreen",
        watchPageTest: () => !!document.querySelector(".dv-player-fullscreen")
      },
      disneyplus: {
        hostPatterns: [/disneyplus\.com$/],
        videoSelector: "#hudson-wrapper video",
        playerContainer: "#hudson-wrapper",
        watchPageTest: () => {
          const url = location.href
          return (
            url.includes("video") ||
            url.includes("/watch") ||
            url.includes("/play")
          )
        }
      },
      max: {
        hostPatterns: [/play\.max\.com$/, /play\.hbomax\.com$/],
        videoSelector:
          '[data-testid="playerContainer"] video:not([class^="mmn-screenVideo"])',
        playerContainer: '[data-testid="playerContainer"]',
        watchPageTest: () => location.href.includes("video/watch"),
        excludeSelector: '[class^="mmn-screenVideo"]'
      },
      hulu: {
        hostPatterns: [/hulu\.com$/],
        videoSelector: ".ContentPlayer video",
        playerContainer: ".ContentPlayer",
        watchPageTest: () => location.href.includes("watch"),
        excludeSelector: "#ad-video-player, #intro-video-player"
      },
      appletv: {
        hostPatterns: [/tv\.apple\.com$/],
        videoSelector: "#hudson-wrapper video",
        playerContainer: "#hudson-wrapper"
      },
      peacock: {
        hostPatterns: [/peacocktv\.com$/],
        videoSelector: "#hudson-wrapper video",
        playerContainer: "#hudson-wrapper"
      },
      crunchyroll: {
        hostPatterns: [/crunchyroll\.com$/],
        videoSelector: "#hudson-wrapper video",
        playerContainer: "#hudson-wrapper"
      },
      paramountplus: {
        hostPatterns: [/paramountplus\.com$/],
        videoSelector: "video",
        playerContainer: "body"
      },
      hotstar: {
        hostPatterns: [/hotstar\.com$/],
        videoSelector: "video",
        playerContainer: ".player-base"
      },
      mubi: {
        hostPatterns: [/mubi\.com$/],
        videoSelector: "video",
        playerContainer: ".player"
      }
    }

    const COMMERCIAL_PLAYER_SELECTORS = [
      ".watch-video--player-view",
      "#movie_player",
      ".dv-player-fullscreen",
      "#hudson-wrapper",
      '[data-testid="playerContainer"]',
      ".ContentPlayer",
      ".html5-video-player",
      ".video-player",
      ".jw-wrapper",
      ".vjs-player",
      ".plyr",
      ".mejs__container",
      ".flowplayer",
      ".video-js",
      "[data-player]",
      ".bitmovin-player",
      ".bmpui-ui-uicontainer",
      ".bmpui-container",
      ".shaka-video-container",
      ".theoplayer-container",
      ".fp-player",
      "[class*='brightcove']",
      ".avp-player",
      ".html5-main-video",
      "[data-uia='video-canvas']"
    ]

    /* Detect which streaming site we are on */
    const host = location.hostname
    let siteConfig: (typeof SITE_VIDEO_SELECTORS)[string] | null = null
    let detectedSite = "unknown"
    for (const [site, config] of Object.entries(SITE_VIDEO_SELECTORS)) {
      if (config.hostPatterns.some((p) => p.test(host))) {
        siteConfig = config
        detectedSite = site
        break
      }
    }

    /* If on a known site, skip watch-page test failures */
    if (siteConfig?.watchPageTest && !siteConfig.watchPageTest()) {
      return []
    }

    /* Helper: does a video have playable content? */
    const isPlayable = (video: HTMLVideoElement) => {
      const sourceChild = video.querySelector(
        "source"
      ) as HTMLSourceElement | null
      const src = video.currentSrc || video.src || sourceChild?.src || ""
      return (
        video.srcObject !== null ||
        src !== "" ||
        video.videoWidth > 0 ||
        video.readyState > 0
      )
    }

    /* Find candidate videos */
    let candidates: HTMLVideoElement[]
    if (siteConfig) {
      // Use site-specific selector for more precise matching
      candidates = Array.from(
        document.querySelectorAll<HTMLVideoElement>(siteConfig.videoSelector)
      )
      // Filter out excluded elements (ads, overlays, etc.)
      if (siteConfig.excludeSelector) {
        const excludeSel = siteConfig.excludeSelector
        candidates = candidates.filter((v) => !v.matches(excludeSel))
      }
      // If site-specific selector returned nothing, fall back to all videos
      if (candidates.length === 0) {
        candidates = Array.from(document.getElementsByTagName("video"))
      }
    } else {
      candidates = Array.from(document.getElementsByTagName("video"))
    }

    return candidates
      .map((video) => {
        if (!isPlayable(video)) return null
        if (!video.dataset.synclifyId)
          video.dataset.synclifyId = Math.random().toString(36).slice(2, 7)

        const sourceChild = video.querySelector(
          "source"
        ) as HTMLSourceElement | null
        const src = video.currentSrc || video.src || sourceChild?.src || ""

        /* Decide whether Synclify should show its own player controls.
           On known streaming sites, always false (their UI is better). */
        let needsCustomPlayer = false
        if (detectedSite === "unknown") {
          const hasNativeControls = video.hasAttribute("controls")
          const isNotLooping = !video.loop
          const isVisible = video.videoWidth > 0
          const isLongEnough = video.duration > 10 || isNaN(video.duration)
          const insideCommercialPlayer = COMMERCIAL_PLAYER_SELECTORS.some(
            (sel) => video.closest(sel) !== null
          )
          needsCustomPlayer =
            hasNativeControls &&
            isNotLooping &&
            isVisible &&
            isLongEnough &&
            !insideCommercialPlayer
        }

        return {
          src,
          duration: video.duration,
          width: video.videoWidth,
          height: video.videoHeight,
          title: document.title,
          id: video.dataset.synclifyId,
          needsCustomPlayer,
          streamingSite: detectedSite
        }
      })
      .filter((video) => video !== null)
  }

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
      posthog.captureException(e)
    }
    return code
  }

  async function handleShouldInject(senderTabId?: number): Promise<boolean> {
    let tabId = senderTabId
    if (tabId === undefined) {
      const tabs = await browser.tabs.query({
        active: true,
        currentWindow: true
      })
      tabId = tabs[0]?.id
    }
    if (!tabId) return false
    const result = await browser.storage.local.get("state")
    const rooms = result.state as State | undefined
    return !!(rooms && rooms[tabId])
  }

  interface Video {
    src: string
    duration: number
    width: number
    height: number
    title: string
    id: string
    needsCustomPlayer: boolean
    streamingSite: string
  }

  async function handleInject(body?: {
    frameIds: number[]
    videoId: string
    needsCustomPlayer?: boolean
  }) {
    const wait = (ms: number) =>
      new Promise((resolve) => setTimeout(resolve, ms))

    const tabs = await browser.tabs.query({
      active: true,
      currentWindow: true
    })
    const tabId = tabs[0].id
    if (!tabId) throw new Error("Tab id is undefined")

    let frameIds = body ? body.frameIds : null
    let videoId: string | null = null
    let needsCustomPlayer = true

    if (!frameIds) {
      let videos: Array<Video & { frameId: number }> = []
      for (let attempt = 0; attempt < 3 && videos.length === 0; attempt++) {
        const result = await browser.scripting.executeScript({
          func: detectPageVideos,
          target: { tabId: tabId, allFrames: true }
        })

        videos = result
          .filter(
            (injection) =>
              Array.isArray(injection.result) && injection.result.length !== 0
          )
          .flatMap((injection) =>
            Array.from(injection.result as Video[]).map((video) => {
              return {
                ...video,
                frameId: injection.frameId
              }
            })
          )

        if (videos.length === 0 && attempt < 2) {
          await wait(700)
        }
      }

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
        needsCustomPlayer = videos[0].needsCustomPlayer
      } else {
        return null
      }
    }

    // Inject the unlisted content script into desired frames
    await browser.scripting.executeScript({
      files: ["injected.js"],
      target: { tabId: tabId, frameIds: frameIds }
    })

    const initPayload = {
      type: MESSAGE_TYPE.INIT,
      videoId: body ? body.videoId : videoId
    }
    let initSucceeded = false
    for (let attempt = 0; attempt < 4 && !initSucceeded; attempt++) {
      try {
        await browser.tabs.sendMessage(tabId, initPayload, {
          frameId: frameIds[0]
        })
        initSucceeded = true
      } catch {
        await wait(150)
      }
    }
    if (!initSucceeded) {
      return {
        status: MESSAGE_STATUS.ERROR,
        message: "Injected script not ready yet, retry sync"
      }
    }

    // Notify the video player content script to attach custom controls
    // Only show custom player for native videos not inside commercial players
    const selectedVideoId = body ? body.videoId : videoId
    const showCustomPlayer = body
      ? (body.needsCustomPlayer ?? needsCustomPlayer)
      : needsCustomPlayer
    if (selectedVideoId && showCustomPlayer) {
      setTimeout(() => {
        browser.tabs
          .sendMessage(tabId, {
            to: "videoPlayer",
            videoId: selectedVideoId
          })
          .catch(() => {
            /* videoPlayer content script may not be ready yet */
          })
      }, 300)
    }

    return { status: MESSAGE_STATUS.SUCCESS }
  }

  async function handleShowToast(
    body: {
      error?: boolean
      content: string
      show?: boolean
    },
    senderTabId?: number
  ) {
    let id = senderTabId
    if (!id) {
      const tabs = await browser.tabs.query({
        active: true,
        currentWindow: true
      })
      id = tabs[0].id as number
    }
    browser.tabs.sendMessage(id, {
      to: "toast",
      error: body.error,
      content: body.content,
      show: body.show ?? true
    })
    return null
  }

  async function reinjectTab(tabId: number) {
    const wait = (ms: number) =>
      new Promise((resolve) => setTimeout(resolve, ms))

    // Find a video in the tab's frames
    let videos: Array<{
      id: string
      frameId: number
      needsCustomPlayer: boolean
    }> = []
    for (let attempt = 0; attempt < 3 && videos.length === 0; attempt++) {
      const result = await browser.scripting.executeScript({
        func: detectPageVideos,
        target: { tabId, allFrames: true }
      })
      videos = result
        .filter(
          (injection) =>
            Array.isArray(injection.result) && injection.result.length !== 0
        )
        .flatMap((injection) =>
          (
            injection.result as Array<{
              id: string
              needsCustomPlayer: boolean
            }>
          ).map((v) => ({
            ...v,
            frameId: injection.frameId
          }))
        )
      if (videos.length === 0 && attempt < 2) await wait(700)
    }
    if (videos.length === 0) return

    const frameIds = [videos[0].frameId]
    const videoId = videos[0].id
    const needsCustomPlayer = videos[0].needsCustomPlayer

    await browser.scripting.executeScript({
      files: ["injected.js"],
      target: { tabId, frameIds }
    })

    const initPayload = {
      type: MESSAGE_TYPE.INIT,
      videoId
    }
    const wait150 = (ms: number) =>
      new Promise((resolve) => setTimeout(resolve, ms))
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        await browser.tabs.sendMessage(tabId, initPayload, {
          frameId: frameIds[0]
        })
        // Notify video player content script only for native videos
        if (needsCustomPlayer) {
          browser.tabs
            .sendMessage(tabId, { to: "videoPlayer", videoId })
            .catch(() => {})
        }
        return
      } catch {
        await wait150(150)
      }
    }
  }

  // Central message router
  browser.runtime.onMessage.addListener((message, sender) => {
    switch (message.action) {
      case "getTabId":
        return handleGetTabId()
      case "createRoom":
        return handleCreateRoom()
      case "shouldInject":
        return handleShouldInject(sender.tab?.id)
      case "inject":
        return handleInject(message.body)
      case "showToast":
        return handleShowToast(message.body, sender.tab?.id)
      case "chatMessage": {
        // Relay from chat content script -> injected script
        const chatTabId = sender.tab?.id
        if (chatTabId) {
          browser.tabs.sendMessage(chatTabId, {
            type: MESSAGE_TYPE.CHAT,
            text: message.body.text
          })
        }
        return Promise.resolve(null)
      }
      case "reaction": {
        // Relay from reactions content script -> injected script
        const reactionTabId = sender.tab?.id
        if (reactionTabId) {
          browser.tabs.sendMessage(reactionTabId, {
            type: MESSAGE_TYPE.REACTION,
            emoji: message.body.emoji
          })
        }
        return Promise.resolve(null)
      }
      case "forwardToChat": {
        // Relay from injected script -> chat content script
        const fwdChatTabId = sender.tab?.id
        if (fwdChatTabId) {
          browser.tabs.sendMessage(fwdChatTabId, {
            to: "chat",
            type: "incoming",
            nickname: message.nickname,
            text: message.text,
            timestamp: message.timestamp,
            self: message.self
          })
        }
        return Promise.resolve(null)
      }
      case "forwardToReaction": {
        // Relay from injected script -> reactions content script
        const fwdReactionTabId = sender.tab?.id
        if (fwdReactionTabId) {
          browser.tabs.sendMessage(fwdReactionTabId, {
            to: "reaction",
            emoji: message.emoji,
            nickname: message.nickname
          })
        }
        return Promise.resolve(null)
      }
      default:
        return undefined
    }
  })
})
