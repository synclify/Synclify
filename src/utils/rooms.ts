type RoomsList = { [tabId: number]: string }

export const storeRoom = (rooms: string | undefined, r: RoomsList) => {
  if (!rooms) return JSON.stringify(r)
  const obj: Record<number, string> = JSON.parse(rooms)
  Object.assign(obj, r)
  return JSON.stringify(obj)
}

export const deleteRoom = (rooms: string | undefined, tabid: number) => {
  if (!rooms) return
  const obj: RoomsList = JSON.parse(rooms)
  if (obj[tabid]) delete obj[tabid]
  return JSON.stringify(obj)
}

export const parseRooms = (rooms?: string): RoomsList | null => {
  if (!rooms) return null
  return JSON.parse(rooms)
}

export const isInRoom = (rooms: string, tabId: number) => {
  if (parseRooms(rooms)?.[tabId]) return true
  return false
}

export {}
