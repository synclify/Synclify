import "./instrument"
import { App } from "uWebSockets.js";
import { Server } from 'socket.io';
import crypto from "crypto"
import { instrument } from "@socket.io/admin-ui"

const app = App();


const io = new Server({ cors: { origin: true, credentials: true, methods: ["GET"] } });
io.attachApp(app)
const random = () => crypto.randomBytes(20).toString('hex').slice(0, 5).toUpperCase();


// Creates a room code and checks that it's empty
app.get("/create", (res, req) => {
  let valid = false;
  let code = random()
  while (!valid) {
    if (isEmpty(code)) {
      valid = true
      break
    }
    code = random()
  }
  res.end(code)
})

instrument(io, {
  auth: {
    type: "basic",
    username: "admin",
    password: process.env.ADMIN_PASSWORD as string
  },
});

app.listen(3000, () => {
  console.log('listening on *:3000');
});

function isEmpty(room: string) {
  return io.sockets.adapter.rooms.get(room)?.size ?? 0 === 0
}

io.sockets.on('connection', (socket) => {

  // Convenience function to log server messages to the client
  function log(...messages: string[]) {
    const array = ['>>> Message from server: '];
    for (let i = 0; i < messages.length; i++) {
      array.push(arguments[i]);
    }
    socket.emit('log', array);
  }

  socket.on('videoEvent', (room, event, volume, currentTime) => {
    // log('Got video event:', room, event, 'from: ', socket.id, volume, currentTime);
    socket.to(room).emit('videoEvent', event, volume, currentTime);
  });

  socket.on('join', (room) => {
    const numClients = io.sockets.adapter.rooms.get(room)?.size ?? 0

    log('Room ' + room + ' has ' + numClients + ' client(s)');
    log('Request to create or join room ' + room);

    if (numClients > 1) {
      socket.emit('full', room);
    }

    // only one room allowed per socket
    for (room in socket.rooms) {
      if (socket.id !== room) socket.leave(room);
    }

    if (numClients === 0) {
      socket.join(room);
      socket.emit('created', room);
    } else if (numClients === 1) {
      io.sockets.in(room).emit('join', room);
      socket.join(room);
      socket.emit('joined', room);
    }
    socket.emit('emit(): client ' + socket.id +
      ' joined room ' + room);

  });

});