import test from "node:test";
import assert from "node:assert/strict";
import { CallRegistry, MAX_CALL_PARTICIPANTS } from "./call-registry";

const media = { micEnabled: true, cameraEnabled: true };

test("creates a call and returns existing peers in join order", () => {
  const registry = new CallRegistry();
  const first = registry.join("ROOM1", { id: "a", nickname: "Ada" }, media);
  const second = registry.join("ROOM1", { id: "b", nickname: "Ben" }, media);

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  if (!second.ok) return;
  assert.deepEqual(second.existingParticipantIds, ["a"]);
  assert.equal(second.state.active, true);
  assert.equal(second.state.participantCount, 2);
});

test("rejects a fifth participant without changing call state", () => {
  const registry = new CallRegistry();
  for (let index = 0; index < MAX_CALL_PARTICIPANTS; index += 1) {
    registry.join(
      "ROOM1",
      { id: String(index), nickname: `User ${index}` },
      media,
    );
  }

  const result = registry.join(
    "ROOM1",
    { id: "overflow", nickname: "Overflow" },
    media,
  );
  assert.deepEqual(result, {
    ok: false,
    code: "full",
    message: "Video call is full (4 people max).",
  });
  assert.equal(registry.getState("ROOM1").participantCount, 4);
});

test("updates media state and preserves the participant identity", () => {
  const registry = new CallRegistry();
  registry.join("ROOM1", { id: "a", nickname: "Ada" }, media);
  const state = registry.updateMediaState("ROOM1", "a", {
    micEnabled: false,
    cameraEnabled: false,
  });

  assert.deepEqual(state?.participants[0], {
    id: "a",
    nickname: "Ada",
    joinedAt: state?.participants[0].joinedAt,
    micEnabled: false,
    cameraEnabled: false,
  });
});

test("validates targeted signaling membership", () => {
  const registry = new CallRegistry();
  registry.join("ROOM1", { id: "a", nickname: "Ada" }, media);
  registry.join("ROOM1", { id: "b", nickname: "Ben" }, media);

  assert.equal(registry.validateSignal("ROOM1", "a", "b"), null);
  assert.equal(
    registry.validateSignal("ROOM1", "spoofed", "b"),
    "not_in_call",
  );
  assert.equal(
    registry.validateSignal("ROOM1", "a", "missing"),
    "invalid_target",
  );
  assert.equal(
    registry.validateSignal("ROOM1", "a", "a"),
    "invalid_target",
  );
});

test("removes callers and tears down the final call", () => {
  const registry = new CallRegistry();
  registry.join("ROOM1", { id: "a", nickname: "Ada" }, media);
  registry.join("ROOM1", { id: "b", nickname: "Ben" }, media);

  assert.equal(registry.leave("ROOM1", "a").participantCount, 1);
  assert.deepEqual(registry.leave("ROOM1", "b"), {
    roomId: "ROOM1",
    active: false,
    participants: [],
    participantCount: 0,
    maxParticipants: 4,
  });
});
