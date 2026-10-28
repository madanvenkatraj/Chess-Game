// test/wsDrive.test.js — raw handshake + single-frame drive for debugging.
const { test } = require('node:test');
const net = require('node:net');
const crypto = require('node:crypto');
const http = require('node:http');
const { spawn } = require('node:child_process');
const path = require('node:path');

function freePort() {
  return new Promise((resolve) => {
    const s = http.createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
}

test('raw ws drive: create gets a created reply', async () => {
  const port = await freePort();
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
  try {
    // wait for server up
    let up = false;
    for (let i = 0; i < 50 && !up; i++) {
      up = await new Promise((r) => { const s = net.connect(port, '127.0.0.1', () => { s.destroy(); r(true); }); s.on('error', () => r(false)); });
      if (!up) await new Promise((w) => setTimeout(w, 100));
    }

    const reply = await new Promise((resolve, reject) => {
      const key = crypto.randomBytes(16).toString('base64');
      const socket = net.connect(port, '127.0.0.1', () => {
        socket.write('GET /ws HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ' + key + '\r\nSec-WebSocket-Version: 13\r\n\r\n');
      });
      let buf = Buffer.alloc(0);
      let upgraded = false;
      socket.on('data', (chunk) => {
        buf = Buffer.concat([buf, chunk]);
        if (!upgraded) {
          const idx = buf.indexOf('\r\n\r\n');
          if (idx < 0) return;
          const head = buf.slice(0, idx).toString();
          if (!/101/.test(head.split('\r\n')[0])) { reject(new Error('handshake failed: ' + head.split('\r\n')[0])); return; }
          upgraded = true;
          buf = buf.slice(idx + 4);
          const payload = Buffer.from(JSON.stringify({ type: 'create', data: { name: 'Alice' } }), 'utf8');
          const mask = crypto.randomBytes(4);
          const masked = Buffer.from(payload);
          for (let i = 0; i < masked.length; i++) masked[i] ^= mask[i % 4];
          socket.write(Buffer.concat([Buffer.from([0x81, 0x80 | payload.length]), mask, masked]));
          return;
        }
        // decode one unmasked text frame
        if (buf.length < 2) return;
        const len = buf[1] & 0x7f;
        const plen = len === 126 ? buf.readUInt16BE(2) : len;
        const hlen = len === 126 ? 4 : 2;
        if (buf.length < hlen + plen) return;
        const t = setTimeout(() => reject(new Error('no reply')), 4000);
        clearTimeout(t);
        resolve(JSON.parse(buf.slice(hlen, hlen + plen).toString('utf8')));
      });
      socket.on('error', reject);
      setTimeout(() => reject(new Error('drive timeout')), 8000);
    });
    console.log('REPLY:', JSON.stringify(reply));
  } finally {
    child.kill();
  }
});
