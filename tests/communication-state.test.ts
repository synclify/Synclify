import test from "node:test"
import assert from "node:assert/strict"
import {
  initialPresentationState,
  reducePresentation
} from "../src/types/communication"

test("restores docked mode after fullscreen", () => {
  let state = reducePresentation(initialPresentationState(), {
    type: "setMode",
    mode: "docked"
  })
  state = reducePresentation(state, {
    type: "fullscreenEntered",
    callActive: true
  })
  assert.equal(state.mode, "floating")
  assert.equal(state.previousModeBeforeFullscreen, "docked")

  state = reducePresentation(state, {
    type: "fullscreenExited",
    callActive: true
  })
  assert.equal(state.mode, "docked")
})

test("restores minimized mode after fullscreen", () => {
  let state = reducePresentation(initialPresentationState(), {
    type: "fullscreenEntered",
    callActive: true
  })
  state = reducePresentation(state, {
    type: "fullscreenExited",
    callActive: true
  })
  assert.equal(state.mode, "minimized")
})

test("call started and ended while fullscreen controls the floating overlay", () => {
  let state = reducePresentation(initialPresentationState(), {
    type: "fullscreenEntered",
    callActive: false
  })
  state = reducePresentation(state, { type: "callStarted" })
  assert.equal(state.mode, "floating")

  state = reducePresentation(state, { type: "callEnded" })
  assert.equal(state.mode, "minimized")
  assert.equal(state.previousModeBeforeFullscreen, "minimized")
})

test("mode changes while fullscreen update the mode restored on exit", () => {
  let state = reducePresentation(initialPresentationState(), {
    type: "fullscreenEntered",
    callActive: true
  })
  state = reducePresentation(state, {
    type: "setMode",
    mode: "docked"
  })
  assert.equal(state.mode, "floating")

  state = reducePresentation(state, {
    type: "fullscreenExited",
    callActive: true
  })
  assert.equal(state.mode, "docked")
})
