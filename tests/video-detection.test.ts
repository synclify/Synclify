import assert from "node:assert/strict"
import test from "node:test"
import { isKnownWatchPage } from "../src/lib/video-detection"

const cases = [
  ["https://vkvideo.ru/video-224818409_456239432", true],
  ["https://m.vk.com/video205387401_165548505", true],
  ["https://vk.com/video_ext.php?oid=-77521&id=162222515", true],
  ["https://vk.com/feed?z=video-224818409_456239432", true],
  [
    "https://vk.com/videos-77521?z=video-77521_162222515%2Fclub77521",
    true
  ],
  [
    "https://vk.com/videos-387766?z=video-387766_456242764%2Fpl_-387766_-2",
    true
  ],
  ["https://vkvideo.ru/", false],
  ["https://vk.com/video", false],
  ["https://vk.com/feed", false],
  ["https://vk.com/videos-77521?z=", false],
  ["https://vk.com/feed?z=photo-1_2", false],
  ["https://vk.com/feed?z=video-224818409", false],
  ["https://vk.com/feed?z=video-1_2oops", false]
] as const

test("VK selected-video URLs are watch pages", () => {
  const locationDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "location"
  )

  try {
    for (const [url, expected] of cases) {
      Object.defineProperty(globalThis, "location", {
        configurable: true,
        value: new URL(url)
      })
      assert.equal(isKnownWatchPage(), expected, url)
    }
  } finally {
    if (locationDescriptor) {
      Object.defineProperty(globalThis, "location", locationDescriptor)
    } else {
      Reflect.deleteProperty(globalThis, "location")
    }
  }
})
