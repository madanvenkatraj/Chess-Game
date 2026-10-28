// test/roomServer.test.js — end-to-end WebSocket room protocol tests.
const { test } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const net = require('node:net');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const path = require('node:path');

function freePort() {
  return new Promise((resolve) => {
    const s = http.createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
}

// Minimal WebSocket client for tests (RFC 6455, no deps).
function wsConnect(port) {
  return new Promise((resolve, reject) => {
    const key = crypto.randomBytes(16).toString('base64');
    const socket = net.connect(port, '127.0.0.1', () => {
      socket.write(
        'GET /ws HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\n' +
        'Connection: Upgrade\r\nSec-WebSocket-Key: ' + key + '\r\nSec-WebSocket-Version: 13\r\n\r\n'
      );
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
        try { if (client._handler) client._handler(JSON.parse(payload)); } catch (e) { /* ignore */ }
      }
    });
    socket.on('error', reject);
  });
}

function waitFor(client, type, timeoutMs) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout waiting for ' + type)), timeoutMs || 5000);
    const prev = client._handler;
    client.on((msg) => {
      if (msg.type === type) {
        clearTimeout(t);
        client.on(prev);
        resolve(msg);
      } else if (prev) prev(msg);
    });
  });
}

test('full online game: create, join, start, moves sync, illegal move rejected', async () => {
  const port = await freePort();
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')],
    { env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
  try {
    let up = false;
    for (let i = 0; i < 50 && !up; i++) {
      up = await new Promise((r) => {
        const s = net.connect(port, '127.0.0.1', () => { s.destroy(); r(true); });
        s.on('error', () => r(false));
      });
      if (!up) await new Promise((w) => setTimeout(w, 100));
    }
    assert.ok(up, 'server did not start');

    const alice = await wsConnect(port);
    const bob = await wsConnect(port);
    const created = waitFor(alice, 'created');
    alice.send({ type: 'create', data: { name: 'Alice' } });
    const c = await created;
    assert.ok(/^[A-Z0-9]{6}$/.test(c.code), 'room code format');

    const joined = waitFor(bob, 'joined');
    bob.send({ type: 'join', data: { code: c.code, name: 'Bob' } });
    const j = await joined;
    assert.strictEqual(j.seat, 'b');

    const startMsg = waitFor(bob, 'game-start');
    alice.send({ type: 'start', data: { code: c.code, timeControl: 300 } });
    const s = await startMsg;
    assert.strictEqual(s.snapshot.turn, 'w');
    assert.strictEqual(s.snapshot.clocks.w, 300);

    // Alice (white) plays e4 — legal.
    const applied = waitFor(bob, 'move-applied');
    alice.send({ type: 'move', data: { code: c.code, from: { r: 6, c: 4 }, to: { r: 4, c: 4 } } });
    const m1 = await applied;
    assert.strictEqual(m1.snapshot.turn, 'b');
    assert.strictEqual(m1.snapshot.moves[0], 'e4');

    // Bob tries an illegal move — must be rejected.
    const rejected = waitFor(bob, 'move-rejected');
    bob.send({ type: 'move', data: { code: c.code, from: { r: 1, c: 0 }, to: { r: 4, c: 0 } } });
    const rej = await rejected;
    assert.ok(rej.error, 'illegal move was rejected with an error');

    // Bob plays out of turn — rejected.
    const rejected2 = waitFor(bob, 'move-rejected');
    bob.send({ type: 'move', data: { code: c.code, from: { r: 0, c: 0 }, to: { r: 1, c: 0 } } });
    const rej2 = await rejected2;
    assert.ok(rej2.error, 'out-of-turn move rejected');

    // Bob plays e5 — legal, and Alice receives it.
    const applied2 = waitFor(alice, 'move-applied');
    bob.send({ type: 'move', data: { code: c.code, from: { r: 1, c: 4 }, to: { r: 3, c: 4 } } });
    const m2 = await applied2;
    assert.strictEqual(m2.snapshot.moves[1], 'e5');

    // Malformed input rejected without crashing.
    alice.send({ type: 'move', data: { code: c.code, from: { r: 99, c: 0 }, to: { r: 0, c: 0 } } });
    const rej3 = await waitFor(alice, 'error');
    assert.ok(rej3.error);

    alice.close();
    bob.close();
  } finally {
    child.kill();
  }
});

test('disconnecting player is given a grace window then forfeits', async () => {
  const port = await freePort();
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')],
    { env: { ...process.env, PORT: String(port), CHESS_TEST_FAST_SWEEP: '1' }, stdio: 'ignore' });
  try {
    let up = false;
    for (let i = 0; i < 50 && !up; i++) {
      up = await new Promise((r) => {
        const s = net.connect(port, '127.0.0.1', () => { s.destroy(); r(true); });
        s.on('error', () => r(false));
      });
      if (!up) await new Promise((w) => setTimeout(w, 100));
    }
    assert.ok(up, 'server did not start');

    const alice = await wsConnect(port);
    const bob = await wsConnect(port);
    alice.send({ type: 'create', data: { name: 'Alice' } });
    const c = await waitFor(alice, 'created');
    bob.send({ type: 'join', data: { code: c.code, name: 'Bob' } });
    await waitFor(bob, 'joined');
    alice.send({ type: 'start', data: { code: c.code, timeControl: 'none' } });
    await waitFor(bob, 'game-start');

    // Alice drops without closing gracefully (hard socket destroy).
    alice._socket && alice._socket.destroy && alice._socket.destroy();
    // Fallback: just close — the sweep treats silence the same way.
    alice.close();

    // Bob should see opponent-left, then game-over (forfeit) within the grace window.
    const over = await waitFor(bob, 'game-over', 15000);
    assert.strictEqual(over.snapshot.result.type, 'forfeit');
    assert.strictEqual(over.snapshot.result.winner, 'b');
    bob.close();
  } finally {
    child.kill();
  }
});
