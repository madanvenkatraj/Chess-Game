'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const source = path.join(root, 'client');
const output = path.join(root, 'dist');

if (!fs.existsSync(path.join(source, 'index.html'))) {
  throw new Error('Static build requires client/index.html');
}

fs.rmSync(output, { recursive: true, force: true });
fs.cpSync(source, output, { recursive: true });

const staticCss = `/* Netlify static edition: hide entry points that require the game server. */
#home-online-play-btn,
#online-btn,
#spectate-btn,
#home-events-btn { display: none !important; }
`;

const staticJs = `/* Local-only compatibility layer for the server-backed multiplayer client. */
(function (root) {
  'use strict';
  var handlers = Object.create(null);
  var session = { code: null, seat: null, name: 'Player' };
  var unavailable = 'Online multiplayer is not available in this static edition. Local and AI games work normally.';
  root.ChessNet = {
    connect: function () {
      if (handlers.connection) handlers.connection({ state: 'disconnected' });
    },
    close: function () { session = { code: null, seat: null, name: 'Player' }; },
    send: function () { return Promise.resolve({ ok: false, error: unavailable }); },
    on: function (type, fn) {
      handlers[type] = fn;
      return function () { if (handlers[type] === fn) delete handlers[type]; };
    },
    session: function () { return session; },
    setSession: function (value) { session = value; },
    state: function () { return 'disconnected'; },
    transport: function () { return 'none'; }
  };
  var playLocally = function (event) {
    var button = event.target && event.target.closest && event.target.closest('#home-app-play-btn');
    if (!button) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    var localButton = document.getElementById('new-game-btn');
    if (localButton) localButton.click();
  };
  document.addEventListener('click', playLocally, true);
  var title = document.querySelector('title');
  if (title) title.textContent = 'Play Chess Locally — Chess Club 88';
  var brand = document.querySelector('.brand-online');
  if (brand) brand.textContent = 'LOCAL';
  var menuTitle = document.querySelector('.menu-title');
  if (menuTitle) menuTitle.textContent = 'Play Chess Locally';
  var subtitle = document.querySelector('.menu-subtitle');
  if (subtitle) subtitle.textContent = 'Play a local game, challenge the computer, practice puzzles, and improve your chess.';
  var productLabel = document.querySelector('.home-product-label');
  if (productLabel) productLabel.textContent = 'Chess Club 88 · Local and AI play';
  var appPromo = document.querySelector('.home-app-promo p');
  if (appPromo) appPromo.textContent = 'Play on this device with local games, AI opponents, puzzles, and training. No app download is needed.';
  var friendsCard = document.getElementById('home-friends-btn');
  if (friendsCard) friendsCard.querySelector('small').textContent = 'Manage player profiles saved on this device.';
  var friendsButton = document.getElementById('friends-btn');
  if (friendsButton) friendsButton.textContent = '👥 Local Player Profiles';
  var footer = document.querySelector('.menu-footer');
  if (footer) footer.textContent = 'Chess Club 88 · Local play, AI, puzzles, and training';
})(window);
`;

fs.writeFileSync(path.join(output, 'static-mode.css'), staticCss);
fs.writeFileSync(path.join(output, 'static-mode.js'), staticJs);

const htmlPath = path.join(output, 'index.html');
let html = fs.readFileSync(htmlPath, 'utf8');
html = html.replace('  <script src="multiplayer.js"></script>\n', '');
html = html.replace('</head>', '  <link rel="stylesheet" href="static-mode.css">\n</head>');
html = html.replace('  <script src="app.js"></script>', '  <script src="static-mode.js"></script>\n  <script src="app.js"></script>');
fs.writeFileSync(htmlPath, html);

console.log('Static site built in dist/ (local and AI play; server-dependent multiplayer disabled).');
