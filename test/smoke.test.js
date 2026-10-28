const { test } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');

function freePort() {
  return new Promise((resolve) => {
    const s = http.createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
}
function get(port, p) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: p }, (r) => {
      let body = ''; r.on('data', (d) => (body += d)); r.on('end', () => resolve({ status: r.statusCode, body }));
    }).on('error', reject);
  });
}

test('the server serves the app and the page names the product', async () => {
  const port = await freePort();
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
  try {
    let r = null;
    for (let i = 0; i < 50 && !r; i++) { r = await get(port, '/').catch(() => null); if (!r) await new Promise((w) => setTimeout(w, 100)); }
    assert.ok(r, 'the server did not answer on ' + port);
    assert.strictEqual(r.status, 200);
    assert.ok(r.body.includes('Complete Chess Game Standard 88'), 'the page does not name the product');
    const js = await get(port, '/app.js');
    assert.strictEqual(js.status, 200, 'app.js is not served');
    assert.ok(js.body.includes('renderTurnIndicator'), 'app.js lacks the turn indicator renderer');
    assert.ok(js.body.includes('material-adv'), 'app.js lacks the material advantage display');
    const missing = await get(port, '/missing.js');
    assert.strictEqual(missing.status, 404, 'missing asset should not return the homepage');
    const html = r.body;
    const assetUrls = [...html.matchAll(/<(?:script|link)\b[^>]*?(?:src|href)=["']([^"']+)["'][^>]*>/gi)]
      .map((match) => match[1])
      .filter((url) => url && !/^(?:https?:)?\/\//i.test(url) && !url.startsWith('data:') && !url.startsWith('#'));
    assert.ok(assetUrls.length > 0, 'the page declares no local scripts or stylesheets');
    for (const assetUrl of assetUrls) {
      const assetPath = new URL(assetUrl, 'http://localhost/').pathname;
      const assetResponse = await get(port, assetPath);
      assert.strictEqual(assetResponse.status, 200, `page asset ${assetPath} is not served`);
    }
    assert.ok(html.includes('id="turn-indicator"'), 'the page has no turn indicator element');
    assert.ok(html.includes('id="move-list"'), 'the page has no move history list');
    assert.ok(html.includes('id="captured-white"'), 'the page has no captured pieces display');
    assert.ok(html.includes('id="undo-btn"'), 'the page has no undo button');
    assert.ok(html.includes('id="restart-btn"'), 'the page has no restart button');
  } finally {
    child.kill();
  }
});
