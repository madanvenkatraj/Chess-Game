const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const CLIENT_ROOT = path.resolve(__dirname, '../client');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.mjs': 'text/javascript; charset=utf-8'
};

const netMain = require('./main.js');

const server = http.createServer();
server.on('request', (req, res) => {
  const rawUrl = req.url || '/';
  if (netMain.handleHttpRequest(req, res)) return;
  let urlPath;
  try { urlPath = decodeURIComponent(rawUrl.split('?')[0]); } catch (_) { res.writeHead(400); res.end('Bad request'); return; }
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.resolve(CLIENT_ROOT, '.' + path.normalize(urlPath));
  if (!filePath.startsWith(CLIENT_ROOT + path.sep) && filePath !== path.join(CLIENT_ROOT, 'index.html')) { res.writeHead(403); res.end('Forbidden'); return; }
  const ext = path.extname(filePath).toLowerCase();
  if (Object.prototype.hasOwnProperty.call(MIME, ext) && filePath.startsWith(CLIENT_ROOT + path.sep)) {
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': MIME[ext] });
      res.end(data);
    });
  } else if (!path.extname(urlPath)) {
    serveIndex(res);
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  }
});

function serveIndex(res) {
  fs.readFile(path.join(CLIENT_ROOT, 'index.html'), (err, data) => {
    if (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Server error');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(data);
  });
}

netMain.attach(server);

server.listen(PORT, '0.0.0.0', () => {
  console.log('Chess server listening on port ' + PORT);
});
