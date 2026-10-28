// roomConstants.js — shared multiplayer tuning values and small helpers.
const ROOM_KEY_RE = /^[A-Z0-9]{6}$/;
const MAX_NAME_LEN = 24;
const HEARTBEAT_INTERVAL_MS = 8000;      // client sends ping every 8s
const MIN_HEARTBEAT_MS = 10000;          // server considers a player silent after 10s
const DISCONNECT_GRACE_MS = process.env.CHESS_TEST_FAST_SWEEP === '1' ? 5000 : 60000; // shorter only in regression tests
const TIME_CONTROLS = [null, 180, 300, 600, 1800]; // null = untimed

function sanitizeName(raw) {
  const s = String(raw || '').replace(/[^\w \-']/g, '').trim();
  if (!s) return 'Player';
  return s.slice(0, MAX_NAME_LEN);
}

function makeRoomCode(existing) {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no I/L/O/0/1 — hard to confuse
  let code = '';
  do {
    code = '';
    for (let i = 0; i < 6; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
  } while (existing.has(code));
  return code;
}

module.exports = {
  ROOM_KEY_RE, MAX_NAME_LEN, HEARTBEAT_INTERVAL_MS, MIN_HEARTBEAT_MS,
  DISCONNECT_GRACE_MS, TIME_CONTROLS, sanitizeName, makeRoomCode
};
