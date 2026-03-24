import "./instrument";
import { App, HttpResponse } from "uWebSockets.js";
import { Server } from "socket.io";
import crypto from "crypto";
import { instrument } from "@socket.io/admin-ui";

const app = App();

const io = new Server({
  cors: { origin: true, credentials: true, methods: ["GET"] },
});
io.attachApp(app);
const random = () =>
  crypto.randomBytes(20).toString("hex").slice(0, 5).toUpperCase();

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
    try {
      res.onAborted(() => {
        res.aborted = true;
      });
      corsHeaders(res);

      const path = req.getUrl().replace(/^\/m/, "") || "/";
      const query = req.getQuery();
      const posthogHost = path.startsWith("/static/")
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

      const target = `https://${posthogHost}${path}${query ? `?${query}` : ""}`;
      console.log("Proxying PostHog request", {
        method,
        target,
        forwardedFor: clientIp,
        forwardedHost: originHost ?? undefined,
      });
      const response = await fetch(target, {
        method,
        headers,
        body: body ? new Uint8Array(body) : undefined,
      });
      console.log("PostHog upstream response", {
        method,
        target,
        status: response.status,
        statusText: response.statusText,
        contentType: response.headers.get("content-type") ?? undefined,
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
          console.log("Sending PostHog proxy response", {
            method,
            target,
            status: response.status,
            hasNoBody,
            headers: Array.from(resHeaders.entries()),
          });
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
        path: req.getUrl(),
        query: req.getQuery(),
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

  socket.on("join", (room) => {
    const numClients = io.sockets.adapter.rooms.get(room)?.size ?? 0;

    log("Room " + room + " has " + numClients + " client(s)");
    log("Request to create or join room " + room);

    if (numClients > 1) {
      socket.emit("full", room);
    }

    // only one room allowed per socket
    for (room in socket.rooms) {
      if (socket.id !== room) socket.leave(room);
    }

    if (numClients === 0) {
      socket.join(room);
      socket.emit("created", room);
    } else if (numClients === 1) {
      io.sockets.in(room).emit("join", room);
      socket.join(room);
      socket.emit("joined", room);
    }
    socket.emit("emit(): client " + socket.id + " joined room " + room);
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
