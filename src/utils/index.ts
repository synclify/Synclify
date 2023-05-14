import type { State } from "../types/state"

export const hasVideos = () => {
  return document.getElementsByTagName("video").length > 0
}

export const setState = (
  tabId: number,
  roomId: string,
  state?: State,
  videoFound?: boolean
) => {
  return Object.assign(state ?? {}, {
    [tabId]: {
      roomId: roomId,
      videoFound: videoFound ?? state?.[tabId]?.videoFound ?? false
    }
  })
}
