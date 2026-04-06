import "./instrument";
import { App, HttpResponse } from "uWebSockets.js";
import { Server, Socket } from "socket.io";
import crypto from "crypto";
import { instrument } from "@socket.io/admin-ui";

const app = App();

const io = new Server({
  cors: { origin: true, credentials: true, methods: ["GET"] },
});
io.attachApp(app);
const MAX_ROOM_PARTICIPANTS = 10;
const PARTICIPANT_RECONNECT_GRACE_MS = 10_000;
type ControlMode = "shared" | "host";
const random = () =>
  crypto.randomBytes(20).toString("hex").slice(0, 5).toUpperCase();

type Participant = {
  id: string;
  nickname: string;
  joinedAt: number;
  socketId: string | null;
  removalTimer?: NodeJS.Timeout;
};

type RoomRecord = {
  roomId: string;
  hostParticipantId: string;
  controlMode: ControlMode;
  participants: Map<string, Participant>;
};

type JoinRoomPayload = {
  roomId: string;
  nickname: string;
  participantId: string;
  controlMode?: ControlMode;
};

type LeaveRoomPayload = {
  roomId: string;
  participantId: string;
};

const roomRegistry = new Map<string, RoomRecord>();
const socketMembership = new Map<string, { roomId: string; participantId: string }>();

// Creates a room code and checks that it's empty
app.get("/create", (res, req) => {
  let valid = false;
  let code = random();
  while (!valid) {
    if (isEmpty(code)) {
      valid = true;
      break;
    }
    code = random();
  }
  res.end(code);
});

app.post("/t", async (res, req) => {
  try {
    res.onAborted(() => {
      res.aborted = true;
    });
    res.writeHeader("Access-Control-Allow-Origin", "*");
    res.writeHeader("Access-Control-Allow-Methods", "OPTIONS, POST");
    res.writeHeader(
      "Access-Control-Allow-Headers",
      "origin, content-type, accept, x-requested-with",
    );
    res.writeHeader("Access-Control-Max-Age", "3600");

    const envelope = await readJson(res);

    const host = process.env.SENTRY_HOST;

    const projectId = process.env.SENTRY_PROJECT_ID;

    const url = `https://${host}/api/${projectId}/envelope/?sentry_key=${process.env.SENTRY_KEY}`;

    const options = {
      headers: {
        "Content-Type": "application/x-sentry-envelope",
      },
    };

    const response = await fetch(url, {
      method: "POST",
      headers: options.headers,
      body: envelope,
    });

    const resData = await response.text();
    if (!res.aborted) {
      res.cork(() => {
        res.writeStatus("201");
        res.end(JSON.stringify({ message: "Success", data: resData }));
      });
    }
  } catch (error) {
    if (!res.aborted) {
      res.cork(() => {
        res.writeStatus("400 Bad Request");
        res.end(JSON.stringify({ message: "invalid request", error }));
      });
    }
  }
});
const POSTHOG_API_HOST = "eu.i.posthog.com";
const POSTHOG_ASSET_HOST = "eu-assets.i.posthog.com";

function corsHeaders(res: HttpResponse) {
  res.writeHeader("Access-Control-Allow-Origin", "*");
  res.writeHeader("Access-Control-Allow-Methods", "OPTIONS, GET, POST");
  res.writeHeader(
    "Access-Control-Allow-Headers",
    "origin, content-type, accept",
  );
  res.writeHeader("Access-Control-Max-Age", "3600");
}

// Collect all request headers from a uWS request into a Headers object.
// uWS exposes headers via req.forEach which iterates (name, value) pairs.
function collectHeaders(req: any): Headers {
  const headers = new Headers();
  req.forEach((name: string, value: string) => {
    headers.append(name, value);
  });
  return headers;
}

function proxyToPostHog(method: "GET" | "POST" | "HEAD") {
  return async (res: HttpResponse, req: any) => {
    let requestPath = "/";
    let requestQuery = "";

    try {
      res.onAborted(() => {
        res.aborted = true;
      });
      corsHeaders(res);

      requestPath = req.getUrl().replace(/^\/m/, "") || "/";
      requestQuery = req.getQuery();
      const posthogHost = requestPath.startsWith("/static/")
        ? POSTHOG_ASSET_HOST
        : POSTHOG_API_HOST;

      // Forward all incoming headers, then override the ones that matter
      const headers = collectHeaders(req);
      const originHost = headers.get("host");
      headers.set("host", posthogHost);

      if (originHost) {
        headers.set("X-Forwarded-Host", originHost);
      }
      const clientIp =
        headers.get("x-forwarded-for") ||
        Buffer.from(res.getRemoteAddressAsText()).toString();
      headers.set("X-Forwarded-For", clientIp);
      headers.set("X-Real-IP", clientIp);

      headers.delete("cookie");
      headers.delete("connection");
      headers.delete("transfer-encoding");
      headers.delete("keep-alive");
      headers.delete("upgrade");

      let body: Buffer | undefined;
      if (method === "POST") {
        body = await readBody(res);
      }

      const target = `https://${posthogHost}${requestPath}${requestQuery ? `?${requestQuery}` : ""}`;
      const response = await fetch(target, {
        method,
        headers,
        body: body ? new Uint8Array(body) : undefined,
      });

      const resHeaders = filterProxyResponseHeaders(response.headers);

      const hasNoBody = method === "HEAD" || response.status === 204 || response.status === 304;
      const resBody = hasNoBody ? "" : await response.text();

      if (hasNoBody) {
        resHeaders.delete("content-length");
        resHeaders.delete("content-type");
        resHeaders.delete("content-encoding");
      } else if (resHeaders.has("content-encoding")) {
        resHeaders.delete("content-encoding");
        resHeaders.delete("content-length");
      }

      if (!res.aborted) {
        res.cork(() => {
          res.writeStatus(`${response.status} ${response.statusText}`);
          resHeaders.forEach((value, name) => {
            res.writeHeader(name, value);
          });
          if (hasNoBody) {
            res.end();
            return;
          }
          res.end(resBody);
        });
      }
    } catch (err) {
      console.error("PostHog proxy error:", {
        method,
        path: requestPath,
        query: requestQuery,
        error: err,
      });
      if (!res.aborted) {
        res.cork(() => {
          res.writeStatus("502 Bad Gateway");
          res.end(JSON.stringify({ error: "proxy error" }));
        });
      }
    }
  };
}

function filterProxyResponseHeaders(headers: Headers): Headers {
  const filtered = new Headers();
  const allowed = new Set([
    "cache-control",
    "content-type",
    "etag",
    "expires",
    "last-modified",
    "vary",
  ]);

  headers.forEach((value, name) => {
    if (allowed.has(name.toLowerCase())) {
      filtered.set(name, value);
    }
  });

  return filtered;
}

app.options("/m/*", (res) => {
  corsHeaders(res);
  res.end();
});
app.head("/m/*", proxyToPostHog("HEAD"));
app.get("/m/*", proxyToPostHog("GET"));
app.post("/m/*", proxyToPostHog("POST"));
app.options("/m", (res) => {
  corsHeaders(res);
  res.end();
});
app.head("/m", proxyToPostHog("HEAD"));
app.get("/m", proxyToPostHog("GET"));
app.post("/m", proxyToPostHog("POST"));

instrument(io, {
  auth: {
    type: "basic",
    username: "admin",
    password: process.env.ADMIN_PASSWORD as string,
  },
});

const port = Number(process.env.PORT || 3000);

app.listen(port, () => {
  console.log(`listening on *:${port}`);
});

function isEmpty(room: string) {
  return io.sockets.adapter.rooms.get(room)?.size ?? 0 === 0;
}

function getRoomState(room: string) {
  const record = roomRegistry.get(room);
  if (!record) return null;

  const participants = Array.from(record.participants.values())
    .sort((a, b) => a.joinedAt - b.joinedAt)
    .map((participant) => ({
      id: participant.id,
      nickname: participant.nickname,
      isHost: participant.id === record.hostParticipantId,
    }));

  return {
    roomId: room,
    hostId: record.hostParticipantId,
    controlMode: record.controlMode,
    participants,
    participantCount: participants.length,
    maxParticipants: MAX_ROOM_PARTICIPANTS,
  };
}

function broadcastRoomState(room: string) {
  const roomState = getRoomState(room);
  if (roomState) {
    io.sockets.in(room).emit("roomUpdated", roomState);
  }
}

function clearParticipantRemoval(participant?: Participant) {
  if (!participant?.removalTimer) return;
  clearTimeout(participant.removalTimer);
  participant.removalTimer = undefined;
}

function upsertParticipant(
  room: string,
  participantId: string,
  socketId: string,
  nickname: string,
  controlMode: ControlMode,
) {
  let record = roomRegistry.get(room);
  if (!record) {
    record = {
      roomId: room,
      hostParticipantId: participantId,
      controlMode,
      participants: new Map(),
    };
    roomRegistry.set(room, record);
  }

  const existingParticipant = record.participants.get(participantId);
  const previousSocketId = existingParticipant?.socketId;
  if (previousSocketId && previousSocketId !== socketId) {
    socketMembership.delete(previousSocketId);
  }

  const participant: Participant = existingParticipant ?? {
    id: participantId,
    nickname,
    joinedAt: Date.now(),
    socketId,
  };

  clearParticipantRemoval(participant);
  participant.nickname = nickname;
  participant.socketId = socketId;
  record.participants.set(participantId, participant);
  socketMembership.set(socketId, { roomId: room, participantId });

  if (!record.participants.has(record.hostParticipantId)) {
    record.hostParticipantId = participantId;
  }

  return record;
}

function removeParticipant(room: string, participantId: string) {
  const record = roomRegistry.get(room);
  if (!record) return null;

  const participant = record.participants.get(participantId);
  clearParticipantRemoval(participant);
  record.participants.delete(participantId);

  if (record.participants.size === 0) {
    roomRegistry.delete(room);
    return null;
  }

  if (!record.participants.has(record.hostParticipantId)) {
    const nextHost = Array.from(record.participants.values()).sort(
      (a, b) => a.joinedAt - b.joinedAt,
    )[0];
    if (nextHost) {
      record.hostParticipantId = nextHost.id;
    }
  }

  return record;
}

function leaveTrackedRooms(socket: Socket) {
  const membership = socketMembership.get(socket.id);
  if (!membership) return;

  socket.leave(membership.roomId);
  socketMembership.delete(socket.id);
  removeParticipant(membership.roomId, membership.participantId);
  broadcastRoomState(membership.roomId);
}

function scheduleParticipantRemoval(room: string, participantId: string) {
  const record = roomRegistry.get(room);
  const participant = record?.participants.get(participantId);
  if (!record || !participant) return;

  clearParticipantRemoval(participant);
  participant.removalTimer = setTimeout(() => {
    const latestRecord = roomRegistry.get(room);
    const latestParticipant = latestRecord?.participants.get(participantId);
    if (!latestRecord || !latestParticipant || latestParticipant.socketId) {
      return;
    }

    removeParticipant(room, participantId);
    broadcastRoomState(room);
  }, PARTICIPANT_RECONNECT_GRACE_MS);
}

function markParticipantDisconnected(socketId: string) {
  const membership = socketMembership.get(socketId);
  if (!membership) return;

  socketMembership.delete(socketId);
  const record = roomRegistry.get(membership.roomId);
  const participant = record?.participants.get(membership.participantId);
  if (!record || !participant || participant.socketId !== socketId) {
    return;
  }

  participant.socketId = null;
  scheduleParticipantRemoval(membership.roomId, membership.participantId);
}

function getHostParticipantId(room: string) {
  return roomRegistry.get(room)?.hostParticipantId;
}

function getParticipantIdForSocket(socketId: string) {
  return socketMembership.get(socketId)?.participantId;
}

function getControlMode(room: string): ControlMode | undefined {
  return roomRegistry.get(room)?.controlMode;
}

io.sockets.on("connection", (socket) => {
  // Convenience function to log server messages to the client
  function log(...messages: string[]) {
    const array = [">>> Message from server: "];
    for (let i = 0; i < messages.length; i++) {
      array.push(arguments[i]);
    }
    socket.emit("log", array);
  }

  socket.on("videoEvent", (room, event, volume, currentTime) => {
    const controlMode = getControlMode(room) ?? "shared";
    if (
      controlMode === "host" &&
      getHostParticipantId(room) !== getParticipantIdForSocket(socket.id)
    ) {
      return;
    }
    // log('Got video event:', room, event, 'from: ', socket.id, volume, currentTime);
    socket.to(room).emit("videoEvent", event, volume, currentTime, Date.now());
  });

  socket.on("chatMessage", (room, message) => {
    socket.to(room).emit("chatMessage", message);
  });

  socket.on("reaction", (room, data) => {
    socket.to(room).emit("reaction", data);
  });

  socket.on("syncPing", (data) => {
    socket.emit("syncPong", {
      clientSendTs: data.clientSendTs,
      serverTs: Date.now(),
    });
  });

  socket.on("join", (payload: string | JoinRoomPayload) => {
    const room =
      typeof payload === "string" ? payload : payload.roomId?.toUpperCase();
    const nickname =
      typeof payload === "string" ? "Anonymous" : payload.nickname?.trim();
    const participantId =
      typeof payload === "string" ? socket.id : payload.participantId?.trim();
    const requestedControlMode =
      typeof payload === "string" ? "shared" : payload.controlMode ?? "shared";

    if (!room || !participantId || !/^[A-Z0-9]{5}$/.test(room)) {
      socket.emit("roomError", {
        roomId: room ?? "",
        code: "invalid_room",
        message: "Invalid room code.",
      });
      return;
    }

    const existingRoom = roomRegistry.get(room);
    const alreadyInRoom = existingRoom?.participants.has(participantId) ?? false;

    log("Room " + room + " has " + (existingRoom?.participants.size ?? 0) + " client(s)");
    log("Request to create or join room " + room);

    if (
      !alreadyInRoom &&
      existingRoom &&
      existingRoom.participants.size >= MAX_ROOM_PARTICIPANTS
    ) {
      socket.emit("roomError", {
        roomId: room,
        code: "full",
        message: `Room is full (${MAX_ROOM_PARTICIPANTS} users max).`,
      });
      socket.emit("full", room);
      return;
    }

    leaveTrackedRooms(socket);

    socket.join(room);
    upsertParticipant(
      room,
      participantId,
      socket.id,
      nickname || "Anonymous",
      requestedControlMode,
    );

    const roomState = getRoomState(room);
    if (!roomState) return;

    socket.emit("roomJoined", roomState);
    io.sockets.in(room).emit("roomUpdated", roomState);
    socket.emit("emit(): client " + socket.id + " joined room " + room);
  });

  socket.on("leaveRoom", (payload: LeaveRoomPayload) => {
    const room = payload.roomId?.toUpperCase();
    const participantId = payload.participantId?.trim();
    if (!room || !participantId) return;

    const membership = socketMembership.get(socket.id);
    if (
      membership?.roomId !== room ||
      membership.participantId !== participantId
    ) {
      return;
    }

    socket.leave(room);
    socketMembership.delete(socket.id);
    removeParticipant(room, participantId);
    broadcastRoomState(room);
  });

  socket.on("disconnecting", () => {
    markParticipantDisconnected(socket.id);
  });
});

function readBody(res: HttpResponse): Promise<Buffer> {
  let buffer: Buffer;
  return new Promise((resolve, reject) => {
    res.onData((ab, isLast) => {
      const chunk = Buffer.from(ab.slice(0));
      if (isLast) {
        resolve(buffer ? Buffer.concat([buffer, chunk]) : chunk);
      } else {
        buffer = buffer ? Buffer.concat([buffer, chunk]) : chunk;
      }
    });
  });
}

function readJson(res: HttpResponse): Promise<string> {
  let buffer: Buffer;
  return new Promise((resolve, reject) => {
    res.onData((ab, isLast) => {
      let chunk = Buffer.from(ab);
      if (isLast) {
        let json;
        if (buffer) {
          try {
            json = Buffer.concat([buffer, chunk]).toString();
          } catch (e) {
            reject(e);
            return;
          }
          resolve(json);
        } else {
          try {
            json = chunk.toString();
          } catch (e) {
            reject(e);
            return;
          }
          resolve(json);
        }
      } else {
        if (buffer) {
          buffer = Buffer.concat([buffer, chunk]);
        } else {
          buffer = Buffer.concat([chunk]);
        }
      }
    });
  });
}
