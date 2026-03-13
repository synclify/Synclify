export const COMMERCIAL_PLAYER_SELECTORS = [
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
  "#movie_player",
  ".watch-video--player-view",
  "[data-uia='video-canvas']"
]

export function shouldShowCustomPlayer(video: HTMLVideoElement): boolean {
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
