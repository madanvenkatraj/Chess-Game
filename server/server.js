// server.js — static file server + WebSocket multiplayer rooms.
// Room logic: server/roomServer.js · protocol validation: server/netProtocol.js
// Raw WebSocket framing (RFC 6455, dependency-free): server/wsServer.js
const http = require('http');
const fs = require('fs');
const path = require('path');
const { handshake, createSocket } = require('./server/wsServer.js');
const { validate } = require('./server/netProtocol.js');
const roomServer = require('./server/roomServer.js');
const {
  createRoom, joinRoom, startGame, applyMove, tickClock, heartbeat,
  roomSnapshot, checkGameEndByDisconnection
} = roomServer;
const { HEARTBEAT_INTERVAL_MS, DISCONNECT_GRACE_MS, MIN_HEARTBEAT_MS, sanitizeName }
  = require('./server/roomConstants.js');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png'
};

const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.join(ROOT, path.normalize(urlPath).replace(/^([.][.][/\\])+/, ''));
  const ext = path.extname(filePath).toLowerCase();
  if (Object.prototype.hasOwnProperty.call(MIME, ext) && filePath.startsWith(ROOT)) {
    fs.readFile(filePath, (err, data) => {
      if (err) { serveIndex(res); return; }
      res.writeHead(200, { 'Content-Type': MIME[ext] });
      res.end(data);
    });
  } else {
    serveIndex(res);
  }
});

// --- WebSocket rooms ---
const conns = new Set(); // conn records: { ws, roomCode, seat, name }

server.on('upgrade', (req, socket) => {
  if ((req.url || '').split('?')[0] !== '/ws') { socket.destroy(); return; }
  if (!handshake(req, socket)) return;
  socket.setNoDelay(true);
  const ws = createSocket(socket);
  const conn = { ws, roomCode: null, seat: null, name: 'Player' };
  conns.add(conn);

  ws.on('message', (text) => {
    let msg = null;
    try { msg = JSON.parse(text); } catch (e) { return; }
    const v = validate(msg);
    if (v.errors.length) { ws.send({ type: 'error', error: 'Invalid message.' }); return; }
    handleMessage(conn, v.type, v.data);
  });

  ws.on('close', () => {
    conns.delete(conn);
    handleDisconnect(conn);
  });
});

function findRoom(code) { return roomServer.rooms.get(code) || null; }

function handleMessage(conn, type, data) {
  switch (type) {
    case 'ping':
      conn.ws.send({ type: 'pong' });
      return;

    case 'create': {
      conn.name = sanitizeName(data.name);
      const room = createRoom(conn.ws, conn.name);
      conn.roomCode = room.code;
      conn.seat = 'w';
      room.names.w = conn.name;
      conn.ws.send({ type: 'created', code: room.code, seat: 'w', names: room.names });
      return;
    }

    case 'join': {
      conn.name = sanitizeName(data.name);
      const res = joinRoom(conn.ws, data.code, conn.name);
      if (!res.ok) { conn.ws.send({ type: 'join-failed', error: res.error }); return; }
      conn.roomCode = data.code;
      conn.seat = res.seat;
      conn.ws.send({
        type: 'joined', code: data.code, seat: res.seat,
        names: res.room.names, timeControl: res.room.timeControl, started: res.room.started
      });
      broadcast(data.code, { type: 'opponent-joined', names: res.room.names });
      return;
    }

    case 'start': {
      const room = findRoom(data.code);
      if (!room || conn.seat !== 'w' || conn.roomCode !== data.code) {
        conn.ws.send({ type: 'error', error: 'Only the host can start the game.' });
        return;
      }
      startGame(room, data.timeControl);
      broadcast(data.code, { type: 'game-start', snapshot: roomSnapshot(room) });
      return;
    }

    case 'move': {
      const room = findRoom(data.code);
      if (!room || conn.roomCode !== data.code) {
        conn.ws.send({ type: 'error', error: 'Room not found.' });
        return;
      }
      const result = applyMove(room, conn.seat, data.from, data.to, data.promo);
      if (!result.ok) { conn.ws.send({ type: 'move-rejected', error: result.error }); return; }
      broadcast(data.code, { type: 'move-applied', snapshot: roomSnapshot(room) });
      return;
    }

    case 'heartbeat': {
      const room = findRoom(data.code);
      if (room && conn.roomCode === data.code) heartbeat(room, conn.seat);
      return;
    }

    default:
      conn.ws.send({ type: 'error', error: 'Unsupported message.' });
  }
}

function broadcast(code, payload) {
  for (const conn of conns) {
    if (conn.roomCode === code) conn.ws.send(payload);
  }
}

function handleDisconnect(conn) {
  const room = conn.roomCode ? findRoom(conn.roomCode) : null;
  if (!room) return;
  roomServer.leaveRoom(room, conn.ws);
  if (room.started && !room.over && conn.seat) {
    broadcast(conn.roomCode, {
      type: 'opponent-left', seat: conn.seat,
      graceMs: DISCONNECT_GRACE_MS
    });
  }
}

// Sweep loop: server-side clock tick, disconnect detection, grace window, forfeit.
setInterval(() => {
  const now = Date.now();
  for (const [, room] of roomServer.rooms) {
    if (!room.started || room.over || !room.game) continue;
    tickClock(room);
    if (room.over) {
      broadcast(room.code, { type: 'game-over', snapshot: roomSnapshot(room) });
      continue;
    }
    for (const seat of ['w', 'b']) {
      if (!room.names[seat]) continue;
      const silentFor = now - room.lastHeartbeat[seat];
      if (silentFor > MIN_HEARTBEAT_MS && !room.graceTimers[seat]) {
        room.graceTimers[seat] = setTimeout(() => {
          if (room.over) return;
          checkGameEndByDisconnection(room, seat);
          broadcast(room.code, { type: 'game-over', snapshot: roomSnapshot(room) });
        }, DISCONNECT_GRACE_MS);
        broadcast(room.code, { type: 'opponent-disconnected', seat, graceMs: DISCONNECT_GRACE_MS });
      } else if (silentFor <= MIN_HEARTBEAT_MS && room.graceTimers[seat]) {
        clearTimeout(room.graceTimers[seat]);
        room.graceTimers[seat] = null;
        broadcast(room.code, { type: 'opponent-reconnected', seat });
      }
    }
    broadcast(room.code, { type: 'clock', clocks: room.game.clocks, turn: room.game.turn });
  }
}, HEARTBEAT_INTERVAL_MS);

function serveIndex(res) {
  fs.readFile(path.join(ROOT, 'index.html'), (err, data) => {
    if (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Server error');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(data);
  });
}

server.listen(PORT, '0.0.0.0', () => {
  console.log('Chess server listening on port ' + PORT);
});
