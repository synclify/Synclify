/* eslint-disable quotes */
/* eslint-disable prefer-const */
/* eslint-disable @typescript-eslint/no-explicit-any */
import * as rooms from "../../../src/utils/rooms"
// @ponicode
describe("rooms.parseRooms", () => {
  test("0", () => {
    let result: any = rooms.parseRooms(undefined)
    expect(result).toMatchSnapshot()
  })

  test("1", () => {
    let result: any = rooms.parseRooms('{ "1000959510": "EB875" }')
    expect(result).toMatchSnapshot()
  })

  test("2", () => {
    let result: any = rooms.parseRooms("")
    expect(result).toMatchSnapshot()
  })
})

// @ponicode
describe("rooms.deleteRoom", () => {
  test("0", () => {
    let result: any = rooms.deleteRoom('{ "1000959510": "EB875" }', 1)
    expect(result).toMatchSnapshot()
  })

  test("1", () => {
    let result: any = rooms.deleteRoom(undefined, -5.48)
    expect(result).toMatchSnapshot()
  })

  test("2", () => {
    let result: any = rooms.deleteRoom(undefined, 1)
    expect(result).toMatchSnapshot()
  })

  test("3", () => {
    let result: any = rooms.deleteRoom('{ "1000959510": "EB875" }', 1000959510)
    expect(result).toMatchSnapshot()
  })

  test("4", () => {
    let result: any = rooms.deleteRoom(undefined, 100)
    expect(result).toMatchSnapshot()
  })

  test("5", () => {
    let result: any = rooms.deleteRoom(undefined, -Infinity)
    expect(result).toMatchSnapshot()
  })
})

// @ponicode
describe("rooms.storeRoom", () => {
  test("0", () => {
    let result: any = rooms.storeRoom(undefined, { 123: "ABCD" })
    expect(result).toMatchSnapshot()
  })

  test("1", () => {
    let result: any = rooms.storeRoom('{ "1000959510": "EB875" }', {
      123: "ABCD",
      456: "DEFG"
    })
    expect(result).toMatchSnapshot()
  })

  test("3", () => {
    let result: any = rooms.storeRoom(undefined, {})
    expect(result).toMatchSnapshot()
  })

  test("4", () => {
    let result: any = rooms.storeRoom(undefined, { 123: "ABCD", 456: "DEFG" })
    expect(result).toMatchSnapshot()
  })

  test("5", () => {
    let result: any = rooms.storeRoom("", { 123: "" })
    expect(result).toMatchSnapshot()
  })
})
