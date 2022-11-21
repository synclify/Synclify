type RoomsList = { [tabId: number]: string }

export const storeRoom = (rooms: string | undefined, r: RoomsList) => {
  if (rooms === undefined) return JSON.stringify(r)
  const obj: Record<number, string> = JSON.parse(rooms)
  console.log("after parse", obj)
  Object.assign(obj, r)
  console.log("after assignement", obj)
  console.log("JSON string", JSON.stringify(obj))
  return JSON.stringify(obj)
}

export const deleteRoom = (rooms: string | undefined, tabid: number) => {
  if (!rooms) return
  const obj: RoomsList = JSON.parse(rooms)
  if (obj[tabid]) delete obj[tabid]
  return JSON.stringify(obj)
}

export const parseRooms = (rooms?: string): RoomsList | null => {
  if (rooms === undefined) return null
  return JSON.parse(rooms)
}

export {}
