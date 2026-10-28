// share-code.js — compact, versioned share-code codec for completed chess games.
// Encodes only the move list (from/to squares) with a version byte; unknown
// versions fail loudly. UMD: usable in the browser (window.ShareCode) and Node tests.
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.ShareCode = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var VERSION = 1;
  var PREFIX = 'CH88';
  var FILES = 'abcdefgh';

  function sqToName(sq) { return FILES[sq.c] + (8 - sq.r); }
  function nameToSq(name) {
    if (typeof name !== 'string' || name.length !== 2) return null;
    var c = FILES.indexOf(name[0]);
    var r = parseInt(name[1], 10);
    if (c < 0 || !(r >= 1 && r <= 8)) return null;
    return { r: 8 - r, c: c };
  }

  // moves: [{ from: {r,c}, to: {r,c} }, ...] — the game's moveMeta list.
  function encode(moveMeta) {
    if (!Array.isArray(moveMeta)) throw new Error('encode: moveMeta must be an array');
    var body = moveMeta.map(function (m) {
      if (!m || !m.from || !m.to) throw new Error('encode: malformed move entry');
      return sqToName(m.from) + sqToName(m.to);
    }).join('');
    return PREFIX + VERSION + '.' + body;
  }

  // Returns [{ from, to }, ...] or throws on malformed input / unknown version.
  function decode(code) {
    var s = String(code || '').trim().toUpperCase();
    if (s.indexOf(PREFIX) !== 0) throw new Error('Invalid share code: missing prefix');
    var rest = s.slice(PREFIX.length);
    var dot = rest.indexOf('.');
    if (dot < 0) throw new Error('Invalid share code: missing body');
    var version = parseInt(rest.slice(0, dot), 10);
    if (version !== VERSION) throw new Error('Unsupported share code version: ' + version);
    var body = rest.slice(dot + 1);
    if (body.length % 4 !== 0) throw new Error('Invalid share code: bad length');
    var moves = [];
    for (var i = 0; i < body.length; i += 4) {
      var from = nameToSq(body.slice(i, i + 2));
      var to = nameToSq(body.slice(i + 2, i + 4));
      if (!from || !to) throw new Error('Invalid share code: bad square at move ' + (i / 4 + 1));
      moves.push({ from: from, to: to });
    }
    return moves;
  }

  return { encode: encode, decode: decode, VERSION: VERSION, PREFIX: PREFIX };
});
