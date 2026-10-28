// roomServer.js — WebSocket multiplayer room server.
// Validates every move with the shared pure engine (chess-core.js) and is the
// single clock authority (client clocks are display-only in online play).
const ChessCore = require('./chess-core.js');
const {
  ROOM_KEY_RE, MAX_NAME_LEN, HEARTBEAT_INTERVAL_MS, DISCONNECT_GRACE_MS,
  MIN_HEARTBEAT_MS, TIME_CONTROLS, sanitizeName, makeRoomCode
} = require('./roomConstants.js');

const rooms = new Map(); // code -> room
const socketRooms = new Map(); // ws -> { roomCode, seat, name }

function roomSnapshot(room) {
  return {
    code: room.code,
    timeControl: room.timeControl,
    started: room.started,
    over: room.over,
    names: { w: room.names.w, b: room.names.b },
    ratings: { w: room.ratings.w, b: room.ratings.b },
    turn: room.game.turn,
    board: room.game.board,
    castling: room.game.castling,
    enPassant: room.game.enPassant,
    moves: room.game.moves,
    meta: room.game.meta,
    captured: room.game.captured,
    clocks: room.game.clocks,
    result: room.result
  };
}

function createRoom(ws, name, rating) {
  const code = makeRoomCode(rooms);
  const room = {
    code,
    names: { w: null, b: null },
    ratings: { w: rating != null ? rating : null, b: null },
    timeControl: 600,
    started: false,
    over: false,
    result: null,
    game: null,
    hostConn: ws,
    guestConn: null,
    lastHeartbeat: { w: Date.now(), b: Date.now() },
    graceTimers: { w: null, b: null }
  };
  rooms.set(code, room);
  return room;
}

function seatOf(room, conn) {
  if (room.hostConn === conn) return 'w';
  if (room.guestConn === conn) return 'b';
  return null;
}

function joinRoom(conn, code, name, rating) {
  const room = rooms.get(code);
  if (!room) return { ok: false, error: 'Room not found. Check the code and try again.' };
  // Rating binds to the seat the joiner takes, which is determined below;
  // record it once the seat is known (both reclaim and fresh-join paths).
  let pendingRating = rating != null ? rating : null;
  // Reclaim: a disconnected player rejoining mid-game keeps their seat.
  if (room.started && !room.over) {
    const seat = room.names.w === name ? 'w' : (room.names.b === name ? 'b' : null);
    if (!seat) return { ok: false, error: 'Game already in progress.' };
    if (seat === 'b') room.guestConn = conn; else room.hostConn = conn;
    if (pendingRating != null) room.ratings[seat] = pendingRating;
    room.lastHeartbeat[seat] = Date.now();
    return { ok: true, seat, room, reclaimed: true };
  }
  const seat = room.names.w === null ? 'w' : (room.names.b === null ? 'b' : null);
  if (seat === null) return { ok: false, error: 'Room is full.' };
  room.names[seat] = name;
  if (pendingRating != null) room.ratings[seat] = pendingRating;
  if (seat === 'b') room.guestConn = conn;
  else room.hostConn = conn;
  room.lastHeartbeat[seat] = Date.now();
  return { ok: true, seat, room };
}

function startGame(room, timeControl) {
  room.timeControl = TIME_CONTROLS.includes(timeControl) ? timeControl : 600;
  room.started = true;
  room.over = false;
  room.result = null;
  room.game = {
    board: ChessCore.initialBoard(),
    turn: 'w',
    castling: { wK: true, wQ: true, bK: true, bQ: true },
    enPassant: null,
    moves: [],
    captured: { w: [], b: [] },
    clocks: { w: room.timeControl, b: room.timeControl },
    lastTick: Date.now(),
    meta: []
  };
}

/** Spectator list entry: minimal per-room live info. */
function roomListEntry(room) {
  if (!room.started || !room.game) return null;
  return {
    code: room.code,
    names: { w: room.names.w, b: room.names.b },
    ratings: { w: room.ratings.w, b: room.ratings.b },
    turn: room.game.turn,
    moveCount: room.game.moves.length,
    over: room.over,
    result: room.result,
    timeControl: room.timeControl
  };
}

/** List of live games for the spectator picker. */
function listLiveGames() {
  const list = [];
  for (const [, room] of rooms) {
    const entry = roomListEntry(room);
    if (entry && entry.names.w && entry.names.b) list.push(entry);
  }
  return list;
}

function tickClock(room) {
  if (!room.started || room.over || !room.game) return;
  if (room.timeControl == null) return; // untimed game — no clock
  const now = Date.now();
  const elapsed = Math.floor((now - room.game.lastTick) / 1000);
  if (elapsed <= 0) return;
  room.game.lastTick = now;
  room.game.clocks[room.game.turn] = Math.max(0, room.game.clocks[room.game.turn] - elapsed);
  if (room.game.clocks[room.game.turn] <= 0) {
    const loser = room.game.turn;
    room.over = true;
    room.result = { type: 'time', winner: loser === 'w' ? 'b' : 'w' };
  }
}

function applyMove(room, seat, from, to, promo) {
  tickClock(room);
  const g = room.game;
  if (!g || room.over) return { ok: false, error: 'Game is not active.' };
  if (!seat) return { ok: false, error: 'You are a spectator.' };
  if (g.turn !== seat) return { ok: false, error: 'Not your turn.' };
  const piece = g.board[from.r] && g.board[from.r][from.c];
  if (!piece || piece.color !== seat) return { ok: false, error: 'Not your piece.' };
  const legal = ChessCore.legalMoves(g.board, from.r, from.c, g.castling, g.enPassant);
  let mv = null;
  for (let i = 0; i < legal.length; i++) {
    if (legal[i].r === to.r && legal[i].c === to.c) { mv = legal[i]; break; }
  }
  if (!mv) return { ok: false, error: 'Illegal move.' };

  const san = ChessCore.sanFor(g.board, from, to, mv.extra, promo, piece);
  g.meta.push({ from: { r: from.r, c: from.c }, to: { r: to.r, c: to.c }, promo: promo || null });
  const captured = ChessCore.applyMove(g.board, from, to, mv.extra, promo);
  if (captured) g.captured[seat].push(captured);
  if (piece.type === 'K') { g.castling[seat + 'K'] = false; g.castling[seat + 'Q'] = false; }
  if (piece.type === 'R') {
    const home = seat === 'w' ? 7 : 0;
    if (from.r === home && from.c === 0) g.castling[seat + 'Q'] = false;
    if (from.r === home && from.c === 7) g.castling[seat + 'K'] = false;
  }
  g.enPassant = (mv.extra && mv.extra.double) ? { r: (from.r + to.r) / 2, c: from.c } : null;
  g.turn = seat === 'w' ? 'b' : 'w';
  if (ChessCore.inCheck(g.board, g.turn)) {
    san += ChessCore.allLegalMoves(g.board, g.turn, g.castling, g.enPassant).length === 0 ? '#' : '+';
  }
  g.moves.push(san);
  g.lastTick = Date.now();

  if (ChessCore.allLegalMoves(g.board, g.turn, g.castling, g.enPassant).length === 0) {
    room.over = true;
    if (ChessCore.inCheck(g.board, g.turn)) {
      room.result = { type: 'checkmate', winner: seat };
    } else {
      room.result = { type: 'stalemate' };
    }
  }
  return { ok: true, room };
}

function checkGameEndByDisconnection(room, seat) {
  // Called when grace expires without reconnect.
  if (room.over) return;
  room.over = true;
  room.result = { type: 'forfeit', winner: seat === 'w' ? 'b' : 'w' };
}

function heartbeat(room, seat) {
  if (seat) room.lastHeartbeat[seat] = Date.now();
  return { ok: true };
}

function leaveRoom(room, ws) {
  const seat = seatOf(room, ws);
  if (seat === 'w') room.hostSocket = null;
  if (seat === 'b') room.guestSocket = null;
}

function seatOfBySocket(ws) {
  for (const [code, room] of rooms) {
    const seat = seatOf(room, ws);
    if (seat) return { room, seat, code };
  }
  return null;
}

module.exports = {
  rooms, socketRooms, roomSnapshot, createRoom, joinRoom, startGame, tickClock,
  applyMove, checkGameEndByDisconnection, heartbeat, leaveRoom, seatOfBySocket,
  seatOf, listLiveGames
};
module.exports.CONSTANTS = require('./roomConstants.js');
