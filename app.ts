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
      "origin, content-type, accept, x-requested-with"
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
    res.writeStatus("201");
    res.end(JSON.stringify({ message: "Success", data: resData }));
  } catch (error) {
    if (!res.aborted) res.writeStatus("400 Bad Request");
    res.end(JSON.stringify({ message: "invalid request", error }));
  }
});

instrument(io, {
  auth: {
    type: "basic",
    username: "admin",
    password: process.env.ADMIN_PASSWORD as string,
  },
});

app.listen(3000, () => {
  console.log("listening on *:3000");
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
    socket.to(room).emit("videoEvent", event, volume, currentTime);
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
