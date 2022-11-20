type RoomsList = { [tabId: number]: string }

export const storeRoom = (rooms: string, r: RoomsList) => {
  if (rooms === undefined) return JSON.stringify(r)
  const obj = JSON.parse(rooms)
  console.log("after parse", obj)
  Object.assign(obj, r)
  console.log("after assignement", obj)
  console.log("JSON string", JSON.stringify(obj))
  return JSON.stringify(obj)
}

export const deleteRoom = (rooms: string, tabid: number) => {
  const obj: RoomsList = JSON.parse(rooms)
  if (obj[tabid]) delete obj[tabid]
  return JSON.stringify(obj)
}

export const parseRooms = (rooms: string): RoomsList => {
  if (rooms === undefined) return {}
  return JSON.parse(rooms)
}

export {}
