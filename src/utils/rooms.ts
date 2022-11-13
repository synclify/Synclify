type RoomsList = { [tabId: string]: string }

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
  const obj = JSON.parse(rooms)
  delete obj[tabid]
  return JSON.stringify(obj)
}

export const parseRooms = (rooms: string): RoomsList => {
  if (rooms === undefined) return {}
  return JSON.parse(rooms)
}

export {}
