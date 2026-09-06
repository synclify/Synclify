import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createIceConfig } from "./ice-config";

test("returns STUN-only configuration when TURN is not configured", () => {
  const previous = { ...process.env };
  delete process.env.TURN_URLS;
  delete process.env.TURN_SHARED_SECRET;
  process.env.STUN_URLS = "stun:one.example, stun:two.example";

  try {
    assert.deepEqual(createIceConfig("participant"), {
      iceServers: [{ urls: ["stun:one.example", "stun:two.example"] }],
    });
  } finally {
    process.env = previous;
  }
});

test("generates time-limited coturn REST credentials", () => {
  const previous = { ...process.env };
  process.env.STUN_URLS = "stun:stun.example";
  process.env.TURN_URLS = "turn:turn.example:3478?transport=udp";
  process.env.TURN_SHARED_SECRET = "shared-secret";
  process.env.TURN_CREDENTIAL_TTL_SECONDS = "60";

  try {
    const config = createIceConfig("participant", 1_000_000);
    const username = "1060:participant";
    const credential = crypto
      .createHmac("sha1", "shared-secret")
      .update(username)
      .digest("base64");
    assert.deepEqual(config, {
      iceServers: [
        { urls: ["stun:stun.example"] },
        {
          urls: ["turn:turn.example:3478?transport=udp"],
          username,
          credential,
        },
      ],
      expiresAt: 1_060_000,
    });
  } finally {
    process.env = previous;
  }
});
