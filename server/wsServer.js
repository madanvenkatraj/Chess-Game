// wsServer.js — minimal RFC 6455 WebSocket server on the built-in http module.
// Frames: server→client always unmasked text; client→server masked text accepted.
const crypto = require('crypto');

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function acceptKey(key) {
  return crypto.createHash('sha1').update(key + GUID).digest('base64');
}

function handshake(req, socket) {
  const key = req.headers['sec-websocket-key'];
  if (!key) { socket.destroy(); return false; }
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    'Sec-WebSocket-Accept: ' + acceptKey(key) + '\r\n' +
    '\r\n'
  );
  return true;
}

// Decode one text frame from buf starting at offset. Returns {payload, next} or null.
function decodeFrame(buf, offset) {
  if (buf.length < offset + 2) return null;
  const first = buf[offset];
  const second = buf[offset + 1];
  const opcode = first & 0x0f;
  const masked = (second & 0x80) !== 0;
  let len = second & 0x7f;
  let pos = offset + 2;
  if (len === 126) {
    if (buf.length < pos + 2) return null;
    len = buf.readUInt16BE(pos); pos += 2;
  } else if (len === 127) {
    if (buf.length < pos + 8) return null;
    len = Number(buf.readBigUInt64BE(pos)); pos += 8;
  }
  if (len > 1 << 20) return { close: true, next: buf.length }; // oversized — drop
  let mask = null;
  if (masked) {
    if (buf.length < pos + 4) return null;
    mask = buf.slice(pos, pos + 4); pos += 4;
  }
  if (buf.length < pos + len) return null;
  let payload = buf.slice(pos, pos + len);
  if (mask) {
    payload = Buffer.from(payload);
    for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
  }
  return { opcode, payload, next: pos + len };
}

function encodeFrame(text) {
  const payload = Buffer.from(text, 'utf8');
  let header;
  if (payload.length < 126) {
    header = Buffer.from([0x81, payload.length]);
  } else if (payload.length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81; header[1] = 126;
    header.writeUInt16BE(payload.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81; header[1] = 127;
    header.writeBigUInt64BE(BigInt(payload.length), 2);
  }
  return Buffer.concat([header, payload]);
}

function createSocket(socket) {
  const state = { buf: Buffer.alloc(0), handlers: { message: null, close: null } };
  socket.on('data', (chunk) => {
    state.buf = Buffer.concat([state.buf, chunk]);
    while (true) {
      const frame = decodeFrame(state.buf, 0);
      if (!frame) break;
      state.buf = state.buf.slice(frame.next);
      if (frame.opcode === 0x8) { // close
        try { socket.end(Buffer.from([0x88, 0x00])); } catch (e) { /* ignore */ }
        if (state.handlers.close) state.handlers.close();
        return;
      }
      if (frame.opcode === 0x9) { // ping → pong
        try { socket.write(Buffer.from([0x8a, 0x00])); } catch (e) { /* ignore */ }
        continue;
      }
      if (frame.opcode === 0x1 && state.handlers.message) {
        state.handlers.message(frame.payload.toString('utf8'));
      }
    }
  });
  socket.on('close', () => { if (state.handlers.close) state.handlers.close(); });
  socket.on('error', () => { if (state.handlers.close) state.handlers.close(); });
  return {
    send: (obj) => { try { socket.write(encodeFrame(JSON.stringify(obj))); } catch (e) { /* ignore */ } },
    close: () => { try { socket.end(Buffer.from([0x88, 0x00])); } catch (e) { /* ignore */ } },
    on: (event, fn) => { state.handlers[event] = fn; }
  };
}

module.exports = { handshake, createSocket };
