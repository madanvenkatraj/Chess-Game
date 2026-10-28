// Manual reproduction script for the replay-from-code flow (run: node test/manual-replay-flow.js)
const { JSDOM } = require('jsdom');
const fs = require('fs');

const dom = new JSDOM(fs.readFileSync('client/index.html', 'utf8'), {
  runScripts: 'dangerously',
  url: 'http://localhost/'
});
const w = dom.window;
w.ChessCore = require('../client/chess-core.js');
w.eval(fs.readFileSync('client/multiplayer.js', 'utf8'));
if (!w.ChessNet) w.ChessNet = { on: function () {}, emit: function () {}, connect: function () {}, disconnect: function () {} };
w.localStorage = (() => { const m = {}; return { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: k => { delete m[k]; } }; })();
w.eval(fs.readFileSync('client/share-code.js', 'utf8'));
w.eval(fs.readFileSync('client/app.js', 'utf8'));

w.document.getElementById('replays-btn').click();
const info = () => w.document.getElementById('replay-info').textContent;
const input = w.document.getElementById('replay-code-input');

input.value = 'NOPE1.e2e4';
w.document.getElementById('replay-import-btn').click();
console.log('invalid:', info());

input.value = 'CH881.f2f3e7e5g2g4d8h4';
w.document.getElementById('replay-import-btn').click();
console.log('valid:', info());

w.document.getElementById('replay-last-btn').click();
console.log('after last:', info());
console.log('last disabled?', w.document.getElementById('replay-last-btn').disabled);
