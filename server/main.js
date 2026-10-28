// server/main.js — multiplayer attach layer. Call attach(server) to enable rooms.
// Two transports, one protocol: WebSocket at /ws and SSE /sse plus POST /send.
const { handshake, createSocket } = require('./wsServer.js');
const { validate } = require('./netProtocol.js');
const roomServer = require('./roomServer.js');
const { createRoom, joinRoom, startGame, applyMove, tickClock, heartbeat, roomSnapshot, checkGameEndByDisconnection, listLiveGames } = roomServer;
const { MIN_HEARTBEAT_MS, HEARTBEAT_INTERVAL_MS, sanitizeName, DISCONNECT_GRACE_MS } = require('./roomConstants.js');
const conns = new Set();
const sseSessions = new Map();
function ratingOrNull(r) { return typeof r === 'number' && Number.isFinite(r) && r > 0 ? Math.round(r) : null; }
function attach(server) {
  server.multiplayerRequestHandler = handleHttpRequest;
  server.on('upgrade', (req, socket) => {
    if ((req.url || '').split('?')[0] !== '/ws') { socket.destroy(); return; }
    if (!handshake(req, socket)) return;
    socket.setNoDelay(true);
    const ws = createSocket(socket);
    const conn = { transport: 'ws', deliver: (obj) => ws.send(obj), roomCode: null, seat: null, name: 'Player' };
    conns.add(conn);
    ws.on('message', (text) => { let msg; try { msg = JSON.parse(text); } catch (_) { return; } const v = validate(msg); if (v.errors.length) { conn.deliver({ type: 'error', error: 'Invalid message.' }); return; } handleMessage(conn, v.type, v.data, msg.id); });
    ws.on('close', () => { conns.delete(conn); handleDisconnect(conn); });
  });
  setInterval(() => {
    const now = Date.now();
    for (const [, room] of roomServer.rooms) {
      if (!room.started || room.over || !room.game) continue;
      tickClock(room);
      if (room.over) { broadcast(room.code, { type: 'game-over', snapshot: roomSnapshot(room) }); continue; }
      for (const seat of ['w', 'b']) {
        if (!room.names[seat]) continue;
        const silentFor = now - room.lastHeartbeat[seat];
        if (silentFor > MIN_HEARTBEAT_MS && !room.graceTimers[seat]) {
          room.graceTimers[seat] = setTimeout(() => { if (room.over) return; checkGameEndByDisconnection(room, seat); broadcast(room.code, { type: 'game-over', snapshot: roomSnapshot(room) }); }, DISCONNECT_GRACE_MS);
          broadcast(room.code, { type: 'opponent-disconnected', seat, graceMs: DISCONNECT_GRACE_MS });
        } else if (silentFor <= MIN_HEARTBEAT_MS && room.graceTimers[seat]) { clearTimeout(room.graceTimers[seat]); room.graceTimers[seat] = null; broadcast(room.code, { type: 'opponent-reconnected', seat }); }
      }
      broadcast(room.code, { type: 'clock', clocks: room.game.clocks, turn: room.game.turn, names: room.names });
    }
  }, HEARTBEAT_INTERVAL_MS);
}
function handleHttpRequest(req, res) {
  const url = new URL(req.url || '/', 'http://localhost');
  if (url.pathname === '/sse' && req.method === 'GET') {
    const sid = url.searchParams.get('sid') || ('s' + Date.now() + Math.floor(Math.random() * 1e6).toString(36));
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
    const conn = { transport: 'sse', deliver: (obj) => { try { res.write('data: ' + JSON.stringify(obj) + '\n\n'); } catch (_) {} }, roomCode: null, seat: null, name: 'Player' };
    sseSessions.set(sid, conn); conns.add(conn);
    res.write('data: ' + JSON.stringify({ type: 'hello', sid }) + '\n\n');
    const ka = setInterval(() => { try { res.write(': ka\n\n'); } catch (_) {} }, 15000);
    res.on('close', () => { clearInterval(ka); sseSessions.delete(sid); conns.delete(conn); handleDisconnect(conn); });
    return true;
  }
  if (url.pathname !== '/send') return false;
  if (req.method !== 'POST') { res.writeHead(405); res.end(JSON.stringify({ error: 'POST required' })); return true; }
  let body = '';
  req.on('data', (chunk) => { body += chunk; if (body.length > 65536) req.destroy(); });
  req.on('end', () => {
    let msg; try { msg = JSON.parse(body); } catch (_) { msg = null; }
    if (!msg) { res.writeHead(400); res.end(JSON.stringify({ error: 'bad json' })); return; }
    const conn = sseSessions.get(msg.sid);
    if (!conn) { res.writeHead(410); res.end(JSON.stringify({ error: 'session gone' })); return; }
    const v = validate(msg); let reply = null;
    if (v.errors.length) { reply = { id: msg.id, type: 'error', error: 'Invalid message.' }; conn.deliver(reply); }
    else {
      const originalDeliver = conn.deliver;
      conn.deliver = (payload) => { if (payload && payload.id === msg.id) reply = payload; originalDeliver(payload); };
      handleMessage(conn, v.type, v.data, msg.id);
      conn.deliver = originalDeliver;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true, reply }));
  });
  return true;
}
function findRoom(code) { return roomServer.rooms.get(code) || null; }
function reply(conn, id, payload) { conn.deliver(Object.assign({ id }, payload)); }
function handleMessage(conn, type, data, id) {
  data = data || {};
  if (type === 'ping') { reply(conn, id, { type: 'pong' }); return; }
  if (type === 'create') {
    const name = sanitizeName(data.name || 'Player');
    const room = createRoom(conn, name, ratingOrNull(data.rating));
    conn.roomCode = room.code; conn.seat = 'w'; conn.name = name;
    room.names.w = name;
    reply(conn, id, { type: 'created', code: room.code, seat: 'w', names: room.names }); return;
  }
  if (type === 'join') {
    const code = String(data.code || '').toUpperCase(); const room = findRoom(code);
    if (!room) { reply(conn, id, { type: 'join-failed', reason: 'Room not found.' }); return; }
    const name = sanitizeName(data.name || 'Player'); const result = joinRoom(conn, code, name, ratingOrNull(data.rating));
    if (!result.ok) { reply(conn, id, { type: 'join-failed', reason: result.error }); return; }
    conn.roomCode = code; conn.seat = result.seat; conn.name = name;
    if (result.reclaimed && room.graceTimers[result.seat]) { clearTimeout(room.graceTimers[result.seat]); room.graceTimers[result.seat] = null; }
    reply(conn, id, { type: 'joined', code, seat: result.seat, names: room.names, timeControl: room.timeControl, started: room.started }); broadcast(code, { type: 'opponent-joined', names: room.names }); return;
  }
  if (type === 'start') { const room = findRoom(data.code); if (!room || conn.seat !== 'w' || conn.roomCode !== data.code) return reply(conn,id,{type:'error',error:'Only the host can start the game.'}); startGame(room, data.timeControl); broadcast(room.code,{type:'game-start',snapshot:roomSnapshot(room)}); return; }
  if (type === 'move') { const room=findRoom(data.code); if(!room || conn.roomCode !== data.code)return reply(conn,id,{type:'move-rejected',error:'Room not found.'}); const result=applyMove(room,conn.seat,data.from,data.to,data.promo); if(!result.ok)return reply(conn,id,{type:'move-rejected',error:result.error}); broadcast(room.code,{type:'move-applied',snapshot:roomSnapshot(room)}); return; }
  if (type === 'heartbeat') { const room=findRoom(data.code); if(room) heartbeat(room,conn.seat); reply(conn,id,{type:'pong'}); return; }
  if (type === 'list-games') { reply(conn,id,{type:'games',games:listLiveGames()}); return; }
  if (type === 'spectate') { const room=findRoom(data.code); if(!room)return reply(conn,id,{type:'error',error:'Game not found.'}); reply(conn,id,{type:'spectating',snapshot:roomSnapshot(room)}); return; }
  if (type === 'leave') { handleDisconnect(conn); reply(conn,id,{type:'left'}); }
}
function broadcast(code, payload) { conns.forEach((conn) => { if (conn.roomCode === code) conn.deliver(payload); }); }
function handleDisconnect(conn) {
  if (!conn.roomCode) return;
  const room=findRoom(conn.roomCode); if(!room)return;
  roomServer.leaveRoom(room,conn);
  const seat = conn.seat;
  if (seat === 'w' && room.hostConn === conn) room.hostConn = null;
  if (seat === 'b' && room.guestConn === conn) room.guestConn = null;
  if(room.started&&!room.over&&seat&&!room.graceTimers[seat]) { room.graceTimers[seat]=setTimeout(()=>{if(room.over)return;checkGameEndByDisconnection(room,seat);broadcast(room.code,{type:'game-over',snapshot:roomSnapshot(room)});},DISCONNECT_GRACE_MS); broadcast(room.code,{type:'opponent-left',seat,graceMs:DISCONNECT_GRACE_MS}); }
}
module.exports = { attach, handleHttpRequest };
