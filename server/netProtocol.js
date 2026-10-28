// netProtocol.js — message schema validation and dispatch for the room server.
// Every inbound message is validated here; malformed input is rejected, never trusted.
const { ROOM_KEY_RE, MAX_NAME_LEN, TIME_CONTROLS } = require('./roomConstants.js');

function validSquare(sq) {
  return sq && typeof sq === 'object' &&
    Number.isInteger(sq.r) && sq.r >= 0 && sq.r < 8 &&
    Number.isInteger(sq.c) && sq.c >= 0 && sq.c < 8;
}

function validName(name) {
  return typeof name === 'string' && name.length <= MAX_NAME_LEN;
}

function validTimeControl(tc) {
  return TIME_CONTROLS.includes(tc === 'none' ? null : tc);
}

// Returns {type, data, errors:[...]}. data is the sanitized payload or null.
function validate(raw) {
  if (!raw || typeof raw !== 'object') return { errors: ['malformed message'] };
  const type = raw.type;
  const data = raw.data || {};
  const errors = [];
  const out = { type, data: {} };

  switch (type) {
    case 'create': {
      if (!validName(data.name)) errors.push('invalid name');
      out.data.name = data.name;
      if (data.rating != null) out.data.rating = Number(data.rating);
      break;
    }
    case 'join': {
      if (typeof data.code !== 'string' || !ROOM_KEY_RE.test(data.code.trim().toUpperCase())) {
        errors.push('invalid room code');
      } else if (!validName(data.name)) {
        errors.push('invalid name');
      } else {
        out.data.code = data.code.trim().toUpperCase();
        out.data.name = data.name;
        if (data.rating != null) out.data.rating = Number(data.rating);
      }
      break;
    }
    case 'start': {
      if (typeof data.code !== 'string' || !ROOM_KEY_RE.test(data.code.trim().toUpperCase())) {
        errors.push('invalid room code');
      } else {
        out.data.code = data.code.trim().toUpperCase();
        out.data.timeControl = data.timeControl === 'none' ? null : Number(data.timeControl);
        if (!TIME_CONTROLS.includes(out.data.timeControl)) errors.push('invalid time control');
      }
      break;
    }
    case 'move': {
      if (typeof data.code !== 'string' || !ROOM_KEY_RE.test(data.code.trim().toUpperCase())) {
        errors.push('invalid room code');
      } else if (!validSquare(data.from) || !validSquare(data.to)) {
        errors.push('invalid squares');
      } else if (data.promo != null && !['Q', 'R', 'B', 'N'].includes(data.promo)) {
        errors.push('invalid promotion');
      } else {
        out.data.code = data.code.trim().toUpperCase();
        out.data.from = { r: data.from.r, c: data.from.c };
        out.data.to = { r: data.to.r, c: data.to.c };
        out.data.promo = data.promo || null;
      }
      break;
    }
    case 'spectate': {
      if (typeof data.code !== 'string' || !ROOM_KEY_RE.test(data.code.trim().toUpperCase())) {
        errors.push('invalid room code');
      } else {
        out.data.code = data.code.trim().toUpperCase();
      }
      break;
    }
    case 'list-games':
      break; // no payload
    case 'stop-spectating':
      break; // no payload
    case 'heartbeat': {
      if (typeof data.code !== 'string' || !ROOM_KEY_RE.test(data.code.trim().toUpperCase())) {
        errors.push('invalid room code');
      } else {
        out.data.code = data.code.trim().toUpperCase();
      }
      break;
    }
    case 'ping':
      break;
    default:
      errors.push('unknown message type');
  }
  return errors.length ? { errors } : { type, data: out.data, errors: [] };
}

module.exports = { validate };
