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
 *  Find the primary video element using site-specific knowledge
 *
 *  Returns the best-matching <video> element, or null if not found.
 *  Falls back to a generic heuristic for unknown sites.
 * ------------------------------------------------------------------ */

export function findSiteVideo(hostname?: string): HTMLVideoElement | null {
  const config = getSiteConfig(hostname)

  if (config) {
    // On a known site — check that we're on a watch page first
    if (config.watchPageTest && !config.watchPageTest()) {
      return null
    }

    const candidates = Array.from(
      document.querySelectorAll<HTMLVideoElement>(config.videoSelector)
    )

    // Filter out excluded elements
    const filtered = config.excludeSelector
      ? candidates.filter((v) => !v.matches(config.excludeSelector!))
      : candidates

    // Return the first video that has actual content
    for (const video of filtered) {
      if (isPlayableVideo(video)) return video
    }

    // Fallback: the selector might not match yet (lazy load); return first
    return filtered[0] ?? null
  }

  // Unknown site — use generic heuristic
  return findGenericVideo()
}

/* ------------------------------------------------------------------
 *  Generic video finder (for non-streaming sites)
 *
 *  Picks the largest visible, long-enough, non-looping video.
 * ------------------------------------------------------------------ */

function findGenericVideo(): HTMLVideoElement | null {
  const videos = Array.from(
    document.querySelectorAll<HTMLVideoElement>("video")
  )
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

/* ------------------------------------------------------------------
 *  Determine whether Synclify should show its custom player controls
 *  over a given video element.
 *
 *  On known streaming sites this always returns false (their own UI
 *  is better). On unknown sites, it returns true only for plain HTML5
 *  videos with native controls that are not inside a commercial player.
 * ------------------------------------------------------------------ */

export function shouldShowCustomPlayer(video: HTMLVideoElement): boolean {
  // On a known streaming site, never overlay our own controls
  const site = detectStreamingSite()
  if (site !== "unknown") return false

  const hasNativeControls = video.hasAttribute("controls")
  const isNotLooping = !video.loop
  const isVisible = video.videoWidth > 0
  const isLongEnough = video.duration > 10 || isNaN(video.duration)
  const insideCommercialPlayer = COMMERCIAL_PLAYER_SELECTORS.some(
    (sel) => video.closest(sel) !== null
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
