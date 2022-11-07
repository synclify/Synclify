import { Server } from 'socket.io';
import { createServer } from 'http';
import express from "express"

const app = express();
app.set('port', 3000);

const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: '*', methods: ["GET", "POST"] } });

app.get('/', (req, res) => {
  res.send('Hello World!')
})

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

  socket.on('message', (room, message) => {
    log('Got message:', room, message);
    socket.to(room).emit('message', message);
  });

  socket.on('check', (room) => {
    socket.emit('check', Number(io.sockets.adapter.rooms.get(room)?.size ?? 0).toString())
  })

  socket.on('create or join', (room) => {
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