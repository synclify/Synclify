/* -------------------------------------------------------------------
 *  Site-aware video detection for Synclify
 *
 *  Provides two main capabilities:
 *  1. Detecting which streaming service the current page belongs to
 *  2. Finding the correct <video> element using site-specific selectors
 *
 * ------------------------------------------------------------------- */

/* ------------------------------------------------------------------
 *  Streaming site identifiers
 * ------------------------------------------------------------------ */

export type StreamingSite =
  | "netflix"
  | "youtube"
  | "primevideo"
  | "disneyplus"
  | "max"
  | "hulu"
  | "appletv"
  | "peacock"
  | "crunchyroll"
  | "paramountplus"
  | "hotstar"
  | "mubi"
  | "stan"
  | "britbox"
  | "shudder"
  | "movy"
  | "vkvideo"
  | "unknown"

/* ------------------------------------------------------------------
 *  Site-specific configuration
 *
 *  Each entry describes how to find the video element on a given
 *  streaming site. Fields:
 *
 *  - hostPatterns:   RegExps matched against window.location.hostname
 *  - videoSelector:  CSS selector that yields the main <video> element(s)
 *  - playerContainer: CSS selector for the wrapping player element
 *                     (used to avoid showing our custom player overlay)
 *  - watchPageTest:  Optional function to confirm we are on a page that
 *                    is actually playing content (not a browse/home page)
 *  - excludeSelector: Optional selector for videos to ignore (e.g. ad
 *                     overlays, preview thumbnails, screen-share feeds)
 * ------------------------------------------------------------------ */

export type SiteConfig = {
  hostPatterns: RegExp[]
  videoSelector: string
  playerContainer: string
  watchPageTest?: () => boolean
  excludeSelector?: string
  allowUnplayableMatch?: boolean
}

export const SITE_CONFIGS: Record<
  Exclude<StreamingSite, "unknown">,
  SiteConfig
> = {
  /* ---- Netflix ---- */
  netflix: {
    hostPatterns: [/netflix\.com$/],
    videoSelector: ".watch-video--player-view video",
    playerContainer: ".watch-video--player-view",
    watchPageTest: () => location.pathname.includes("/watch")
  },

  /* ---- YouTube ---- */
  youtube: {
    hostPatterns: [/youtube\.com$/, /youtu\.be$/],
    videoSelector: "#movie_player video.html5-main-video",
    playerContainer: "#movie_player",
    watchPageTest: () => location.pathname.includes("/watch"),
    excludeSelector: ".ytp-ad-overlay-container video"
  },

  /* ---- Amazon Prime Video ---- */
  primevideo: {
    hostPatterns: [
      /primevideo\.com$/,
      /amazon\.(com|co\.\w+|de|fr|it|es|in|jp|br|ca|com\.au)$/
    ],
    videoSelector: ".dv-player-fullscreen video",
    playerContainer: ".dv-player-fullscreen",
    watchPageTest: () => {
      // Prime Video doesn't always use /watch — the player container must exist
      return !!document.querySelector(".dv-player-fullscreen")
    }
  },

  /* ---- Disney+ ---- */
  disneyplus: {
    hostPatterns: [/disneyplus\.com$/],
    videoSelector: "#hudson-wrapper video",
    playerContainer: "#hudson-wrapper",
    watchPageTest: () => {
      const url = location.href
      return (
        url.includes("video") || url.includes("/watch") || url.includes("/play")
      )
    }
  },

  /* ---- Max (HBO Max) ---- */
  max: {
    hostPatterns: [/play\.max\.com$/, /play\.hbomax\.com$/],
    videoSelector:
      '[data-testid="playerContainer"] video:not([class^="mmn-screenVideo"])',
    playerContainer: '[data-testid="playerContainer"]',
    watchPageTest: () => location.href.includes("video/watch"),
    excludeSelector: '[class^="mmn-screenVideo"]'
  },

  /* ---- Hulu ---- */
  hulu: {
    hostPatterns: [/hulu\.com$/],
    videoSelector: ".ContentPlayer video",
    playerContainer: ".ContentPlayer",
    watchPageTest: () => location.href.includes("watch"),
    excludeSelector: "#ad-video-player, #intro-video-player"
  },

  /* ---- Apple TV+ ---- */
  appletv: {
    hostPatterns: [/tv\.apple\.com$/],
    videoSelector: "#hudson-wrapper video",
    playerContainer: "#hudson-wrapper"
  },

  /* ---- Peacock ---- */
  peacock: {
    hostPatterns: [/peacocktv\.com$/],
    videoSelector: "#hudson-wrapper video",
    playerContainer: "#hudson-wrapper"
  },

  /* ---- Crunchyroll ---- */
  crunchyroll: {
    hostPatterns: [/crunchyroll\.com$/],
    videoSelector: "#hudson-wrapper video",
    playerContainer: "#hudson-wrapper"
  },

  /* ---- Paramount+ ---- */
  paramountplus: {
    hostPatterns: [/paramountplus\.com$/],
    videoSelector: "video",
    playerContainer: "body"
  },

  /* ---- Hotstar / Disney+ Hotstar ---- */
  hotstar: {
    hostPatterns: [/hotstar\.com$/],
    videoSelector: "video",
    playerContainer: ".player-base"
  },

  /* ---- MUBI ---- */
  mubi: {
    hostPatterns: [/mubi\.com$/],
    videoSelector: "video",
    playerContainer: ".player"
  },

  /* ---- Stan ---- */
  stan: {
    hostPatterns: [/stan\.com\.au$/],
    videoSelector: "video",
    playerContainer: ".player-container"
  },

  /* ---- BritBox ---- */
  britbox: {
    hostPatterns: [/britbox\.(com|co\.uk)$/],
    videoSelector: "video",
    playerContainer: ".player-container"
  },

  /* ---- Shudder ---- */
  shudder: {
    hostPatterns: [/shudder\.com$/],
    videoSelector: "video",
    playerContainer: ".player-container"
  },

  /* ---- Movy ---- */
  movy: {
    hostPatterns: [/(^|\.)movy\.bz$/],
    videoSelector: "#vp-shell video",
    playerContainer: "#vp-shell",
    watchPageTest: () => document.querySelector("#vp-shell") !== null
  },

  /* ---- VK Video (vkvideo.ru + vk.com, including /video_ext.php embeds) ----
     The VK player lives inside an open Shadow DOM rooted at
     div.shadow-root-container. Inside, the main <video> sits in
     .vk-vp-root > .player-wrapper > ... > [data-testid="video-container"],
     and an ad <video> sits in .ads-container. The detection code uses a
     deep walk that crosses shadow boundaries — selectors below are
     matched against video elements regardless of shadow root. */
  vkvideo: {
    hostPatterns: [/(^|\.)vkvideo\.ru$/, /(^|\.)vk\.com$/],
    videoSelector: '[data-testid="video-container"] video',
    playerContainer: ".vk-vp-root",
    watchPageTest: () =>
      /^\/video_ext\.php/.test(location.pathname) ||
      /^\/video-?\d+_\d+/.test(location.pathname) ||
      /^video-?\d+_\d+(?:\/|$)/.test(
        new URLSearchParams(location.search).get("z") ?? ""
      ),
    excludeSelector: ".ads-container video",
    allowUnplayableMatch: true
  }
}

/* ------------------------------------------------------------------
 *  Detect which streaming site we are currently on
 * ------------------------------------------------------------------ */

export function detectStreamingSite(hostname?: string): StreamingSite {
  const host = hostname ?? location.hostname
  for (const [site, config] of Object.entries(SITE_CONFIGS)) {
    if (config.hostPatterns.some((pattern) => pattern.test(host))) {
      return site as StreamingSite
    }
  }
  return "unknown"
}

/* ------------------------------------------------------------------
 *  Get the site config for the current page (or null for unknown)
 * ------------------------------------------------------------------ */

export function getSiteConfig(hostname?: string): SiteConfig | null {
  const site = detectStreamingSite(hostname)
  if (site === "unknown") return null
  return SITE_CONFIGS[site]
}

/* ------------------------------------------------------------------
 *  Shadow-DOM aware traversal helpers
 *
 *  Modern players (VK Video, Bitmovin, etc.) put their <video> inside
 *  open shadow roots. document.querySelector* does not cross shadow
 *  boundaries — these helpers do.
 * ------------------------------------------------------------------ */

/**
 * Yields a document or shadow root before recursively traversing its
 * open shadow-root descendants in document order.
 *
 * Closed shadow roots are intentionally invisible to this traversal.
 */
function* allRoots(
  root: Document | ShadowRoot = document
): Generator<Document | ShadowRoot> {
  yield root
  for (const element of root.querySelectorAll<Element>("*")) {
    if (element.shadowRoot) yield* allRoots(element.shadowRoot)
  }
}

/**
 * Collects every video in the document and reachable open shadow roots.
 *
 * Videos are returned once, grouped by their root-first traversal order.
 */
export function collectAllVideos(): HTMLVideoElement[] {
  const found: HTMLVideoElement[] = []
  for (const root of allRoots()) {
    for (const video of root.querySelectorAll<HTMLVideoElement>("video")) {
      found.push(video)
    }
  }
  return found
}

/**
 * Finds the first selector match using the same root-first traversal as
 * {@link collectAllVideos}, crossing each open shadow-root host boundary.
 */
export function deepQuerySelector<E extends Element = Element>(
  selector: string
): E | null {
  for (const root of allRoots()) {
    const match = root.querySelector<E>(selector)
    if (match) return match
  }
  return null
}

/**
 * Finds the primary video for a known watch page, or uses the playable
 * size-and-duration heuristic on an unknown site.
 *
 * Known-site matching allows VK's unplayable placeholder when configured,
 * while non-watch pages are rejected before candidate selection.
 */

export function findSiteVideo(hostname?: string): HTMLVideoElement | null {
  const config = getSiteConfig(hostname)

  if (config) {
    // On a known site — check that we're on a watch page first
    if (config.watchPageTest && !config.watchPageTest()) {
      return null
    }

    const sel = config.videoSelector
    const exclude = config.excludeSelector
    const candidates = collectAllVideos().filter((v) => {
      try {
        if (!v.matches(sel)) return false
      } catch {
        return false
      }
      if (exclude) {
        try {
          if (v.matches(exclude)) return false
        } catch {
          /* ignore bad exclude selector */
        }
      }
      return true
    })

    for (const video of candidates) {
      if (isPlayableVideo(video)) return video
    }

    if (config.allowUnplayableMatch) {
      return candidates[0] ?? null
    }
    return null
  }

  // Unknown site — use generic heuristic
  return findGenericVideo()
}

/**
 * Finds the highest-scoring playable video on an unknown site.
 *
 * Candidates are ranked by rendered area with a duration bonus; this
 * helper does not apply visibility or loop filtering.
 */

function findGenericVideo(): HTMLVideoElement | null {
  const videos = collectAllVideos()
  const scored = videos
    .filter((v) => isPlayableVideo(v))
    .map((v) => ({
      el: v,
      score: v.videoWidth * v.videoHeight + (v.duration > 60 ? 10000 : 0)
    }))
    .sort((a, b) => b.score - a.score)

  return scored[0]?.el ?? null
}

/* ------------------------------------------------------------------
 *  Whether a video element has actual playable content
 * ------------------------------------------------------------------ */

function isPlayableVideo(video: HTMLVideoElement): boolean {
  const src =
    video.currentSrc || video.src || video.querySelector("source")?.src || ""
  return (
    video.srcObject !== null ||
    src !== "" ||
    video.videoWidth > 0 ||
    video.readyState > 0
  )
}

/* ------------------------------------------------------------------
 *  Commercial player selectors (superset used by the custom-player
 *  overlay to decide whether to show Synclify's own controls)
 *
 *  Includes all known streaming site containers plus generic
 *  commercial video player wrappers.
 * ------------------------------------------------------------------ */

export const COMMERCIAL_PLAYER_SELECTORS = [
  // --- Known streaming sites ---
  ".watch-video--player-view", // Netflix
  "#movie_player", // YouTube
  ".dv-player-fullscreen", // Prime Video
  "#hudson-wrapper", // Disney+, Peacock, Crunchyroll, Apple TV+
  '[data-testid="playerContainer"]', // Max / HBO Max
  ".ContentPlayer", // Hulu
  "#vp-shell", // Movy
  ".vk-vp-root", // VK Video (shadow DOM player root)
  '[data-testid="video-container"]', // VK Video (player video container)

  // --- Generic commercial player wrappers ---
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

/**
 * Finds a selector match on an element or one of its shadow-root hosts.
 *
 * The lookup crosses each open shadow-root boundary from the element
 * toward the document.
 */

function closestAcrossShadowRoots(
  element: Element,
  selector: string
): Element | null {
  let current: Element | null = element
  while (current) {
    const match = current.closest(selector)
    if (match) return match
    const root = current.getRootNode()
    if (!(root instanceof ShadowRoot)) return null
    current = root.host
  }
  return null
}

/**
 * Reports whether Synclify should add native controls for a video.
 *
 * Known streaming services always opt out; unknown sites require native
 * controls, visible content, sufficient duration, and no commercial
 * player ancestor across shadow-root boundaries.
 */
export function shouldShowCustomPlayer(video: HTMLVideoElement): boolean {
  // On a known streaming site, never overlay our own controls
  const site = detectStreamingSite()
  if (site !== "unknown") return false

  const hasNativeControls = video.hasAttribute("controls")
  const isNotLooping = !video.loop
  const isVisible = video.videoWidth > 0
  const isLongEnough = video.duration > 10 || isNaN(video.duration)
  const insideCommercialPlayer = COMMERCIAL_PLAYER_SELECTORS.some(
    (sel) => closestAcrossShadowRoots(video, sel) !== null
  )

  return (
    hasNativeControls &&
    isNotLooping &&
    isVisible &&
    isLongEnough &&
    !insideCommercialPlayer
  )
}

/* ------------------------------------------------------------------
 *  Check whether the current page is a watch/player page for a known
 *  streaming service. Useful for early bailout in detection loops.
 * ------------------------------------------------------------------ */

export function isKnownWatchPage(hostname?: string): boolean {
  const config = getSiteConfig(hostname)
  if (!config) return false
  if (!config.watchPageTest) return true
  return config.watchPageTest()
}
