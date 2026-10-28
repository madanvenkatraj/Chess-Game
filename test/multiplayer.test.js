import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';

function request(port, pathname, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: pathname, method: options.method || 'GET', headers: options.headers }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end(options.body);
  });
}
async function startServer() {
  const port = await new Promise((resolve) => { const server = http.createServer(); server.listen(0, '127.0.0.1', () => { const p = server.address().port; server.close(() => resolve(p)); }); });
  const child = spawn(process.execPath, [path.join(process.cwd(), 'server.js')], { env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
  for (let n = 0; n < 50; n++) { try { await request(port, '/'); return { child, port }; } catch { await new Promise((resolve) => setTimeout(resolve, 100)); } }
  child.kill(); throw new Error('server did not become ready');
}
function browserClient(port) {
  class EventSourceMock {
    constructor(url) {
      this.req = http.get({ hostname: '127.0.0.1', port, path: new URL(url, 'http://localhost').pathname + new URL(url, 'http://localhost').search, headers: { Accept: 'text/event-stream' } }, (res) => {
        res.setEncoding('utf8'); let data = '';
        res.on('data', (chunk) => { data += chunk; let ix; while ((ix = data.indexOf('\n\n')) !== -1) { const block = data.slice(0, ix); data = data.slice(ix + 2); const payload = block.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('\n'); if (payload && this.onmessage) this.onmessage({ data: payload }); } });
        if (this.onopen) this.onopen();
      });
    }
    close() { this.req.destroy(); }
  }
  const context = { window: {}, location: { protocol: 'http:', host: '127.0.0.1:' + port }, EventSource: EventSourceMock, WebSocket: class { constructor() { throw new Error('Use SSE in this test'); } }, fetch: (url, opts) => new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: url, method: opts.method, headers: opts.headers }, (res) => { let body = ''; res.on('data', (chunk) => { body += chunk; }); res.on('end', () => resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, json: () => Promise.resolve(JSON.parse(body)) })); }); req.on('error', reject); req.end(opts.body);
  }), setInterval: () => 1, clearInterval: () => {}, setTimeout, clearTimeout, Math, Date, Promise, JSON, Object, String, Error, URL };
  vm.runInNewContext(readFileSync(new URL('../client/multiplayer.js', import.meta.url), 'utf8'), context);
  return context.window.ChessNet;
}

describe('multiplayer live app contract', () => {
  it('serves a live SSE stream and correlated create response', async () => {
    const { child, port } = await startServer(); const client = browserClient(port);
    try {
      client.connect(); const status = await waitConnected(client); expect(status).toBe('connected');
      const result = await client.send('create', { name: 'Test Player' });
      expect(result.type).toBe('created'); expect(result.code).toMatch(/^[A-Z0-9]{6}$/);
    } finally { client.close(); child.kill(); }
  });
  it('routes Create Room into the exact visible confirmation renderer', () => {
    const app = readFileSync(new URL('../client/app.js', import.meta.url), 'utf8');
    expect(app).toContain("document.getElementById('create-room-btn').addEventListener('click'");
    expect(app).toContain('showCreatedRoom(res)');
    expect(app).toContain("netStatus('Room created. Share this code: ' + msg.code)");
  });
});
function waitConnected(client) { return new Promise((resolve, reject) => { const deadline = Date.now() + 3000; const poll = () => { if (client.state() === 'connected') resolve(client.state()); else if (Date.now() > deadline) reject(new Error('client failed to connect')); else setTimeout(poll, 20); }; poll(); }); }
