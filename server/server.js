import { createServer } from 'http';
import { WebSocketServer } from 'ws';

const PORT = process.env.PORT || 3001;
const rooms = new Map(); // code -> { host, guests: Map<id, ws>, mode, started }

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous chars
  let code;
  do {
    code = '';
    for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  } while (rooms.has(code));
  return code;
}

let nextId = 1;

const server = createServer((req, res) => {
  // Health check endpoint for Render
  if (req.url === '/health') {
    res.writeHead(200);
    res.end('ok');
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  ws.playerId = null;
  ws.roomCode = null;
  ws.isAlive = true;

  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {
      case 'create_room': {
        const code = generateCode();
        const playerId = `p${nextId++}`;
        ws.playerId = playerId;
        ws.roomCode = code;
        rooms.set(code, {
          host: ws,
          guests: new Map(),
          mode: msg.mode || 'coop',
          started: false,
        });
        send(ws, { type: 'room_created', code, playerId });
        console.log(`Room ${code} created by ${playerId} (${msg.mode || 'coop'})`);
        break;
      }

      case 'join_room': {
        const code = (msg.code || '').toUpperCase();
        const room = rooms.get(code);
        if (!room) {
          send(ws, { type: 'error', message: 'Room not found' });
          return;
        }
        if (room.started) {
          send(ws, { type: 'error', message: 'Game already started' });
          return;
        }
        if (room.guests.size >= 3) {
          send(ws, { type: 'error', message: 'Room is full' });
          return;
        }
        const playerId = `p${nextId++}`;
        ws.playerId = playerId;
        ws.roomCode = code;
        room.guests.set(playerId, ws);

        // Tell the joiner about existing players
        const players = [
          { id: room.host.playerId, isHost: true },
          ...Array.from(room.guests.entries()).map(([id]) => ({ id, isHost: false })),
        ];
        send(ws, { type: 'room_joined', playerId, players, mode: room.mode });

        // Notify everyone else
        broadcast(room, { type: 'player_joined', playerId }, ws);
        console.log(`${playerId} joined room ${code} (${room.guests.size + 1} players)`);
        break;
      }

      case 'select_ship':
      case 'start_game':
        // Forward to all others in the room
        forwardToRoom(ws, msg);
        if (msg.type === 'start_game') {
          const room = rooms.get(ws.roomCode);
          if (room) room.started = true;
        }
        break;

      case 'input':
      case 'state':
      case 'player_sunk':
      case 'game_over':
        // Relay gameplay messages to all others in the room
        forwardToRoom(ws, msg);
        break;
    }
  });

  ws.on('close', () => {
    if (!ws.roomCode) return;
    const room = rooms.get(ws.roomCode);
    if (!room) return;

    if (ws === room.host) {
      // Host left — end game for everyone
      broadcast(room, { type: 'host_disconnected' });
      room.guests.forEach((g) => { g.roomCode = null; });
      rooms.delete(ws.roomCode);
      console.log(`Room ${ws.roomCode} closed (host left)`);
    } else {
      room.guests.delete(ws.playerId);
      broadcast(room, { type: 'player_disconnected', playerId: ws.playerId });
      console.log(`${ws.playerId} left room ${ws.roomCode}`);
    }
    ws.roomCode = null;
  });
});

function send(ws, obj) {
  if (ws.readyState === 1) ws.send(JSON.stringify(obj));
}

function broadcast(room, msg, exclude = null) {
  const data = JSON.stringify(msg);
  if (room.host !== exclude && room.host.readyState === 1) room.host.send(data);
  room.guests.forEach((g) => {
    if (g !== exclude && g.readyState === 1) g.send(data);
  });
}

function forwardToRoom(senderWs, msg) {
  const room = rooms.get(senderWs.roomCode);
  if (!room) return;
  broadcast(room, { ...msg, from: senderWs.playerId }, senderWs);
}

// Heartbeat — clean up dead connections
setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

server.listen(PORT, () => {
  console.log(`Relay server listening on port ${PORT}`);
});
