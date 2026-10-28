// test/wsDrive2.test.js — drive create then join on separate connections.
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

function makeWs(port, name) {
  return new Promise((resolve, reject) => {
    const key = crypto.randomBytes(16).toString('base64');
    const socket = net.connect(port, '127.0.0.1', () => {
      socket.write('GET /ws HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ' + key + '\r\nSec-WebSocket-Version: 13\r\n\r\n');
    });
    let buf = Buffer.alloc(0);
    let upgraded = false;
    const client = {
      send(obj) {
        const payload = Buffer.from(JSON.stringify(obj), 'utf8');
        let header;
        if (payload.length < 126) header = Buffer.from([0x81, 0x80 | payload.length]);
        else { header = Buffer.alloc(4); header[0] = 0x81; header[1] = 0x80 | 126; header.writeUInt16BE(payload.length, 2); }
        const mask = crypto.randomBytes(4);
        const masked = Buffer.from(payload);
        for (let i = 0; i < masked.length; i++) masked[i] ^= mask[i % 4];
        socket.write(Buffer.concat([header, mask, masked]));
      },
      on(fn) { client._handler = fn; },
      close() { try { socket.end(Buffer.from([0x88, 0x80, 0, 0, 0, 0])); } catch (e) { /* ignore */ } }
    };
    socket.on('data', (chunk) => {
      console.log('[raw]', name || '?', chunk.length, 'bytes, upgraded=', upgraded);
      buf = Buffer.concat([buf, chunk]);
      if (!upgraded) {
        const idx = buf.indexOf('\r\n\r\n');
        if (idx < 0) return;
        const head = buf.slice(0, idx).toString();
        if (!/101/.test(head.split('\r\n')[0])) { reject(new Error('handshake failed')); return; }
        upgraded = true;
        buf = buf.slice(idx + 4);
        resolve(client);
        return;
      }
      while (buf.length >= 2) {
        const len0 = buf[1] & 0x7f;
        let hlen = 2, plen = len0;
        if (len0 === 126) { if (buf.length < 4) return; plen = buf.readUInt16BE(2); hlen = 4; }
        if (buf.length < hlen + plen) return;
        const payload = buf.slice(hlen, hlen + plen).toString('utf8');
        buf = buf.slice(hlen + plen);
        try { if (client._handler) client._handler(JSON.parse(payload)); } catch (e) { console.log('PARSE ERR', e.message); }
      }
    });
    socket.on('error', reject);
  });
}

test('create then join on two connections', async () => {
  const port = await freePort();
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
  try {
    let up = false;
    for (let i = 0; i < 50 && !up; i++) {
      up = await new Promise((r) => { const s = net.connect(port, '127.0.0.1', () => { s.destroy(); r(true); }); s.on('error', () => r(false)); });
      if (!up) await new Promise((w) => setTimeout(w, 100));
    }
    const alice = await makeWs(port, 'alice');
    const bob = await makeWs(port, 'bob');
    const created = new Promise((res) => alice.on((m) => { console.log('alice got', m.type); if (m.type === 'created') res(m); }));
    alice.send({ type: 'create', data: { name: 'Alice' } });
    const c = await created;
    const joined = new Promise((res) => bob.on((m) => { console.log('bob got', m.type); if (m.type === 'joined') res(m); }));
    bob.send({ type: 'join', data: { code: c.code, name: 'Bob' } });
    const j = await joined;
    console.log('JOINED seat', j.seat);
  } finally {
    child.kill();
  }
});
