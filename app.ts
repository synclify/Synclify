import * as dotenv from 'dotenv'

import { Server } from 'socket.io';
import { createServer } from 'http';
import express from "express"
import {instrument} from "@socket.io/admin-ui"

dotenv.config()

const app = express();
app.set('port', 3000);

const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: '*', methods: ["GET", "POST"] } });
const random = () => (Math.random() + 1).toString(36).substring(7).toUpperCase()

app.get('/', (req, res) => {
  res.send('Hello World!')
})

instrument(io, {
  auth: {
    type: "basic",
    username: "admin",
    password: process.env.ADMIN_PASSWORD as string
  },
});

httpServer.listen(3000, () => {
  console.log('listening on *:3000');
});

io.sockets.on('connection', (socket) => {

  // Convenience function to log server messages to the client
  function log(...messages: string[]) {
    const array = ['>>> Message from server: '];
    for (let i = 0; i < messages.length; i++) {
      array.push(arguments[i]);
    }
    socket.emit('log', array);
  }

  function isEmpty(room: string){
    return io.sockets.adapter.rooms.get(room)?.size ?? 0 === 0
  }

  socket.on('videoEvent', (room, event, volume, currentTime) => {
    log('Got video event:', room, event, 'from: ', socket.id, volume, currentTime);
    socket.to(room).emit('videoEvent', event, volume, currentTime);
  });


  // Creates a room code and checks that it's empty
  socket.on('create', () => {
    let valid = false;
    let code = random()
    while (!valid) {
      if (isEmpty(code)) {
        valid = true
        break
      }
      code = random()
    }
    log('checked code:', code);
    socket.emit("create", code)
  })

  socket.on('join', (room) => {
    const numClients = io.sockets.adapter.rooms.get(room)?.size ?? 0

    log('Room ' + room + ' has ' + numClients + ' client(s)');
    log('Request to create or join room ' + room);

    if (numClients === 0) {
      socket.join(room);
      socket.emit('created', room);
    } else if (numClients === 1) {
      io.sockets.in(room).emit('join', room);
      socket.join(room);
      socket.emit('joined', room);
    } else { // max two clients
      socket.emit('full', room);
    }
    socket.emit('emit(): client ' + socket.id +
      ' joined room ' + room);

  });

});