export const DEBUG_ROOM_STATE = false

export function debugRoomLog(scope: "popup" | "injected", payload: unknown) {
  if (!DEBUG_ROOM_STATE) return
  console.log(`[synclify][room-debug][${scope}]`, payload)
}
