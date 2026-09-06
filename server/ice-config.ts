import crypto from "crypto";

export type IceServerConfig = {
  urls: string | string[];
  username?: string;
  credential?: string;
};

export type IceConfig = {
  iceServers: IceServerConfig[];
  expiresAt?: number;
};

const DEFAULT_STUN_URL = "stun:stun.l.google.com:19302";
const DEFAULT_TURN_TTL_SECONDS = 86_400;

function readUrls(value: string | undefined, fallback?: string): string[] {
  const urls = (value || fallback || "")
    .split(",")
    .map((url) => url.trim())
    .filter(Boolean);
  return Array.from(new Set(urls));
}

export function createIceConfig(
  participantId: string,
  nowMs = Date.now(),
): IceConfig {
  const stunUrls = readUrls(process.env.STUN_URLS, DEFAULT_STUN_URL);
  const turnUrls = readUrls(process.env.TURN_URLS);
  const turnSecret = process.env.TURN_SHARED_SECRET;
  const parsedTtl = Number(process.env.TURN_CREDENTIAL_TTL_SECONDS);
  const ttlSeconds =
    Number.isFinite(parsedTtl) && parsedTtl > 0
      ? Math.floor(parsedTtl)
      : DEFAULT_TURN_TTL_SECONDS;
  const iceServers: IceServerConfig[] = [];

  if (stunUrls.length > 0) {
    iceServers.push({ urls: stunUrls });
  }

  if (turnUrls.length > 0 && turnSecret) {
    const expiresAtSeconds = Math.floor(nowMs / 1000) + ttlSeconds;
    const username = `${expiresAtSeconds}:${participantId}`;
    const credential = crypto
      .createHmac("sha1", turnSecret)
      .update(username)
      .digest("base64");
    iceServers.push({
      urls: turnUrls,
      username,
      credential,
    });
    return { iceServers, expiresAt: expiresAtSeconds * 1000 };
  }

  return { iceServers };
}
