// pgn.js — standard-start-position PGN codec. Comments and NAGs are ignored;
// variations and SetUp/FEN positions are rejected rather than mis-replayed.
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.PGN = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  function esc(value) { return String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n]/g, ' '); }
  function dateTag(value) {
    var d = value ? new Date(value) : new Date();
    if (isNaN(d.getTime())) d = new Date();
    return d.getUTCFullYear() + '.' + String(d.getUTCMonth() + 1).padStart(2, '0') + '.' + String(d.getUTCDate()).padStart(2, '0');
  }
  function exportGame(game) {
    if (!game || !Array.isArray(game.sans)) throw new Error('PGN export requires SAN moves');
    var result = ['1-0', '0-1', '1/2-1/2'].indexOf(game.result) >= 0 ? game.result : '*';
    var headers = [
      ['Event', game.event || 'Chess Game'], ['Site', game.site || '?'], ['Date', dateTag(game.timestamp)],
      ['White', game.white || 'White'], ['Black', game.black || 'Black'], ['Result', result], ['SetUp', '0']
    ];
    var lines = headers.map(function (h) { return '[' + h[0] + ' "' + esc(h[1]) + '"]'; });
    var tokens = [];
    for (var i = 0; i < game.sans.length; i++) tokens.push((Math.floor(i / 2) + 1) + (i % 2 ? '...' : '.') + ' ' + game.sans[i]);
    tokens.push(result);
    return lines.join('\n') + '\n\n' + tokens.join(' ') + '\n';
  }
  function importGame(text, core) {
    if (!core) throw new Error('PGN import requires ChessCore');
    var source = String(text || '');
    if (/\([^)]*\)/.test(source)) throw new Error('PGN variations are not supported');
    var headers = {};
    source = source.replace(/^\s*\[([^\s]+)\s+"((?:\\.|[^"\\])*)"\s*\]\s*$/gm, function (_, key, val) {
      headers[key] = val.replace(/\\([\\"])/g, '$1'); return '';
    });
    if (/^\s*\[/.test(source)) throw new Error('Malformed PGN header');
    if (headers.SetUp === '1' || headers.FEN) throw new Error('Nonstandard PGN starting positions are not supported');
    source = source.replace(/\{[^}]*\}/g, ' ').replace(/;[^\n]*/g, ' ').replace(/\$\d+/g, ' ');
    if (/[{}]/.test(source)) throw new Error('Malformed PGN comment');
    var tokens = source.replace(/\d+\.(\.\.)?/g, ' ').trim().split(/\s+/).filter(Boolean);
    var result = '*';
    if (tokens.length && /^(1-0|0-1|1\/2-1\/2|\*)$/.test(tokens[tokens.length - 1])) result = tokens.pop();
    var board = core.initialBoard(), turn = 'w', castling = { wK:true,wQ:true,bK:true,bQ:true }, ep = null;
    var sans = [], moves = [], moveNo = 1;
    tokens.forEach(function (token) {
      if (/^(1-0|0-1|1\/2-1\/2|\*)$/.test(token)) throw new Error('Unexpected result marker at move ' + moveNo);
      var wanted = token.replace(/[+#?!]+$/g, '');
      var legal = core.allLegalMoves(board, turn, castling, ep), match = null;
      for (var i = 0; i < legal.length; i++) {
        var m = legal[i], piece = board[m.from.r][m.from.c];
        var notation = core.sanForMove(board, turn, castling, ep, m.from, m.to, m.to.extra, 'Q');
        if (notation.replace(/[+#]+$/g, '') === wanted) { match = { m:m, piece:piece, notation:notation }; break; }
      }
      if (!match) throw new Error('Illegal or invalid SAN at move ' + moveNo + ': ' + token);
      var m = match.m, from = m.from, to = m.to;
      moves.push({ from: from, to: { r: to.r, c: to.c }, extra: to.extra || {} });
      core.applyMove(board, from, to, to.extra, 'Q');
      if (match.piece.type === 'K') { castling[turn+'K'] = false; castling[turn+'Q'] = false; }
      if (match.piece.type === 'R') { if (from.r === (turn==='w'?7:0) && from.c===0) castling[turn+'Q']=false; if(from.r===(turn==='w'?7:0)&&from.c===7)castling[turn+'K']=false; }
      if (to.extra && to.extra.double) ep = { r:(from.r+to.r)/2,c:from.c }; else ep = null;
      sans.push(match.notation); if (turn === 'b') moveNo++; turn = turn === 'w' ? 'b' : 'w';
    });
    return { headers:headers, moves:moves, sans:sans, result:result, white:headers.White || 'White', black:headers.Black || 'Black', timestamp:headers.Date || '' };
  }
  return { exportGame: exportGame, importGame: importGame };
});
