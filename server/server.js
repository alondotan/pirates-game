import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { GameRoom, BROADCAST_INTERVAL } from '../shared/gameLogic.js';

const PORT = process.env.PORT || 3001;
const rooms = new Map(); // code -> RoomState

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = '';
    for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  } while (rooms.has(code));
  return code;
}

let nextId = 1;

// ─── HTTP server ────────────────────────────────────────────────────────────

const server = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200);
    res.end('ok');
    return;
  }
  res.writeHead(404);
  res.end();
});

// ─── WebSocket server ───────────────────────────────────────────────────────

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
          shipSelections: new Map(), // playerId -> shipType
          gameRoom: null,
          gameInterval: null,
          tickCount: 0,
        });
        // Store host's ship selection if provided
        const room = rooms.get(code);
        if (msg.shipType) room.shipSelections.set(playerId, msg.shipType);
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

        const players = [
          { id: room.host.playerId, isHost: true },
          ...Array.from(room.guests.entries()).map(([id]) => ({ id, isHost: false })),
        ];
        send(ws, { type: 'room_joined', playerId, players, mode: room.mode });
        broadcast(room, { type: 'player_joined', playerId }, ws);
        console.log(`${playerId} joined room ${code} (${room.guests.size + 1} players)`);
        break;
      }

      case 'select_ship': {
        const room = rooms.get(ws.roomCode);
        if (!room) return;
        room.shipSelections.set(ws.playerId, msg.shipType || 'sloop');
        // Forward to all others so UI can update
        broadcast(room, { type: 'select_ship', playerId: ws.playerId, shipType: msg.shipType }, ws);
        break;
      }

      case 'start_game': {
        const room = rooms.get(ws.roomCode);
        if (!room || room.started) return;
        // Only the host can start
        if (ws !== room.host) return;

        room.started = true;

        // Build player list with ship selections
        const players = [];
        // Host
        players.push({
          id: room.host.playerId,
          shipType: room.shipSelections.get(room.host.playerId) || msg.shipType || 'sloop',
        });
        // Guests
        for (const [guestId] of room.guests) {
          players.push({
            id: guestId,
            shipType: room.shipSelections.get(guestId) || 'sloop',
          });
        }

        // Create the authoritative game room
        const seed = msg.seed || Math.floor(Math.random() * 999999);
        room.gameRoom = new GameRoom(seed, players, room.mode);

        // Notify all clients that the game is starting
        const startMsg = {
          type: 'game_started',
          seed,
          players,
          mode: room.mode,
        };
        broadcast(room, startMsg);

        // Send initial state including islands (only once, they don't change)
        const initialState = room.gameRoom.getState();
        broadcast(room, initialState);

        console.log(`Room ${ws.roomCode} game started — ${players.length} players, seed=${seed}, mode=${room.mode}`);

        // Start the game loop at ~60fps
        room.tickCount = 0;
        room.gameInterval = setInterval(() => {
          if (!room.gameRoom) return;

          room.gameRoom.tick();
          room.tickCount++;

          // Broadcast state every BROADCAST_INTERVAL ticks
          if (room.tickCount % BROADCAST_INTERVAL === 0) {
            const state = room.gameRoom.getState();
            broadcast(room, state);
          }

          // Check game over
          if (room.gameRoom.gameOver) {
            const finalState = room.gameRoom.getState();
            broadcast(room, finalState);
            broadcast(room, {
              type: 'game_over',
              reason: room.gameRoom.gameOverReason,
              score: room.gameRoom.score,
            });
            clearInterval(room.gameInterval);
            room.gameInterval = null;
            room.gameRoom = null;
            console.log(`Room ${ws.roomCode} game over — ${room.gameRoom ? '' : 'cleaned up'}`);
          }
        }, 16); // ~60fps

        break;
      }

      case 'input': {
        // Player sends their input; apply it to the authoritative simulation
        const room = rooms.get(ws.roomCode);
        if (!room || !room.gameRoom) return;
        room.gameRoom.applyInput(ws.playerId, msg.data || msg);
        break;
      }

      // Legacy relay messages — forward if needed during transition
      case 'state':
      case 'player_sunk':
      case 'game_over':
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
      if (room.gameInterval) {
        clearInterval(room.gameInterval);
        room.gameInterval = null;
      }
      room.gameRoom = null;
      broadcast(room, { type: 'host_disconnected' });
      room.guests.forEach((g) => { g.roomCode = null; });
      rooms.delete(ws.roomCode);
      console.log(`Room ${ws.roomCode} closed (host left)`);
    } else {
      room.guests.delete(ws.playerId);
      // If game is running, mark the player's ship as sinking
      if (room.gameRoom) {
        room.gameRoom.markPlayerDisconnected(ws.playerId);
      }
      broadcast(room, { type: 'player_disconnected', playerId: ws.playerId });
      console.log(`${ws.playerId} left room ${ws.roomCode}`);
    }
    ws.roomCode = null;
  });
});

// ─── Helpers ────────────────────────────────────────────────────────────────

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

// ─── Heartbeat — clean up dead connections ──────────────────────────────────

setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

// ─── Start ──────────────────────────────────────────────────────────────────

server.listen(PORT, () => {
  console.log(`Authoritative game server listening on port ${PORT}`);
});
