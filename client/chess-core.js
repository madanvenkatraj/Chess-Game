// chess-core.js — pure chess rules engine shared by the UI (app.js) and tests.
// No DOM access. Exposed as window.ChessCore in the browser and module.exports in Node.
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.ChessCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function emptyBoard() {
    var b = [];
    for (var r = 0; r < 8; r++) b.push([null, null, null, null, null, null, null, null]);
    return b;
  }

  function initialBoard() {
    var b = emptyBoard();
    var back = ['R', 'N', 'B', 'Q', 'K', 'B', 'N', 'R'];
    for (var c = 0; c < 8; c++) {
      b[0][c] = { type: back[c], color: 'b' };
      b[1][c] = { type: 'P', color: 'b' };
      b[6][c] = { type: 'P', color: 'w' };
      b[7][c] = { type: back[c], color: 'w' };
    }
    return b;
  }

  function cloneBoard(b) {
    return b.map(function (row) {
      return row.map(function (p) { return p ? { type: p.type, color: p.color } : null; });
    });
  }

  function inBounds(r, c) { return r >= 0 && r < 8 && c >= 0 && c < 8; }

  function findKing(board, color) {
    for (var r = 0; r < 8; r++) for (var c = 0; c < 8; c++) {
      var p = board[r][c];
      if (p && p.type === 'K' && p.color === color) return { r: r, c: c };
    }
    return null;
  }

  function isAttacked(board, r, c, byColor) {
    var dr = byColor === 'w' ? 1 : -1;
    var s, p;
    if (inBounds(r + dr, c - 1)) {
      p = board[r + dr][c - 1];
      if (p && p.color === byColor && p.type === 'P') return true;
    }
    if (inBounds(r + dr, c + 1)) {
      p = board[r + dr][c + 1];
      if (p && p.color === byColor && p.type === 'P') return true;
    }
    var kn = [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]];
    for (var i = 0; i < kn.length; i++) {
      var rr = r + kn[i][0], cc = c + kn[i][1];
      if (inBounds(rr, cc)) {
        p = board[rr][cc];
        if (p && p.color === byColor && p.type === 'N') return true;
      }
    }
    var kd = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
    for (var k = 0; k < kd.length; k++) {
      var kr = r + kd[k][0], kc = c + kd[k][1];
      if (inBounds(kr, kc)) {
        p = board[kr][kc];
        if (p && p.color === byColor && p.type === 'K') return true;
      }
    }
    function slide(dirs, types) {
      for (var d = 0; d < dirs.length; d++) {
        var rr2 = r, cc2 = c;
        while (true) {
          rr2 += dirs[d][0]; cc2 += dirs[d][1];
          if (!inBounds(rr2, cc2)) break;
          var q = board[rr2][cc2];
          if (q) {
            if (q.color === byColor && types.indexOf(q.type) >= 0) return true;
            break;
          }
        }
      }
      return false;
    }
    if (slide([[-1,0],[1,0],[0,-1],[0,1]], ['R', 'Q'])) return true;
    if (slide([[-1,-1],[-1,1],[1,-1],[1,1]], ['B', 'Q'])) return true;
    return false;
  }

  function inCheck(board, color) {
    var k = findKing(board, color);
    if (!k) return false;
    return isAttacked(board, k.r, k.c, color === 'w' ? 'b' : 'w');
  }

  function pseudoMoves(board, r, c, castling, enPassant) {
    var p = board[r][c];
    if (!p) return [];
    var moves = [];
    function push(rr, cc, extra) { moves.push({ r: rr, c: cc, extra: extra || {} }); }
    var dir = p.color === 'w' ? -1 : 1;

    if (p.type === 'P') {
      if (inBounds(r + dir, c) && !board[r + dir][c]) {
        push(r + dir, c);
        var startRow = p.color === 'w' ? 6 : 1;
        if (r === startRow && !board[r + 2 * dir][c]) push(r + 2 * dir, c, { double: true });
      }
      for (var s = -1; s <= 1; s += 2) {
        var rr2 = r + dir, cc2 = c + s;
        if (!inBounds(rr2, cc2)) continue;
        var t = board[rr2][cc2];
        if (t && t.color !== p.color) push(rr2, cc2);
        if (enPassant && enPassant.r === rr2 && enPassant.c === cc2) push(rr2, cc2, { enPassant: true });
      }
    } else if (p.type === 'N') {
      var kn = [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]];
      for (var i = 0; i < kn.length; i++) {
        var nr = r + kn[i][0], nc = c + kn[i][1];
        if (inBounds(nr, nc) && (!board[nr][nc] || board[nr][nc].color !== p.color)) push(nr, nc);
      }
    } else if (p.type === 'K') {
      var kd = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
      for (var j = 0; j < kd.length; j++) {
        var kr = r + kd[j][0], kc = c + kd[j][1];
        if (inBounds(kr, kc) && (!board[kr][kc] || board[kr][kc].color !== p.color)) push(kr, kc);
      }
      var home = p.color === 'w' ? 7 : 0;
      if (r === home && c === 4) {
        var enemy = p.color === 'w' ? 'b' : 'w';
        var rookK = board[home][7], rookQ = board[home][0];
        if (castling[p.color + 'K'] && rookK && rookK.type === 'R' && rookK.color === p.color &&
            !board[home][5] && !board[home][6] &&
            !isAttacked(board, home, 4, enemy) && !isAttacked(board, home, 5, enemy) && !isAttacked(board, home, 6, enemy)) {
          push(home, 6, { castle: 'K' });
        }
        if (castling[p.color + 'Q'] && rookQ && rookQ.type === 'R' && rookQ.color === p.color &&
            !board[home][1] && !board[home][2] && !board[home][3] &&
            !isAttacked(board, home, 4, enemy) && !isAttacked(board, home, 3, enemy) && !isAttacked(board, home, 2, enemy)) {
          push(home, 2, { castle: 'Q' });
        }
      }
    } else {
      var dirs;
      if (p.type === 'R') dirs = [[-1,0],[1,0],[0,-1],[0,1]];
      else if (p.type === 'B') dirs = [[-1,-1],[-1,1],[1,-1],[1,1]];
      else dirs = [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]];
      for (var d = 0; d < dirs.length; d++) {
        var rr3 = r, cc3 = c;
        while (true) {
          rr3 += dirs[d][0]; cc3 += dirs[d][1];
          if (!inBounds(rr3, cc3)) break;
          var q2 = board[rr3][cc3];
          if (q2) {
            if (q2.color !== p.color) push(rr3, cc3);
            break;
          }
          push(rr3, cc3);
        }
      }
    }
    return moves;
  }

  function applyMove(board, from, to, extra, promo) {
    var p = board[from.r][from.c];
    var capturedPiece = board[to.r][to.c];
    if (extra && extra.enPassant) {
      var capRow = p.color === 'w' ? to.r + 1 : to.r - 1;
      capturedPiece = board[capRow][to.c];
      board[capRow][to.c] = null;
    }
    board[to.r][to.c] = p;
    board[from.r][from.c] = null;
    if (extra && extra.castle) {
      var home = p.color === 'w' ? 7 : 0;
      if (extra.castle === 'K') { board[home][5] = board[home][7]; board[home][7] = null; }
      else { board[home][3] = board[home][0]; board[home][0] = null; }
    }
    if (p.type === 'P' && (to.r === 0 || to.r === 7)) {
      p = { type: promo || 'Q', color: p.color };
      board[to.r][to.c] = p;
    }
    return capturedPiece;
  }

  function legalMoves(board, r, c, castling, enPassant) {
    var p = board[r][c];
    if (!p) return [];
    return pseudoMoves(board, r, c, castling, enPassant).filter(function (m) {
      var copy = cloneBoard(board);
      applyMove(copy, { r: r, c: c }, m, m.extra, 'Q');
      return !inCheck(copy, p.color);
    });
  }

  function allLegalMoves(board, color, castling, enPassant) {
    var list = [];
    for (var r = 0; r < 8; r++) for (var c = 0; c < 8; c++) {
      var p = board[r][c];
      if (p && p.color === color) {
        var ms = legalMoves(board, r, c, castling, enPassant);
        for (var i = 0; i < ms.length; i++) list.push({ from: { r: r, c: c }, to: ms[i] });
      }
    }
    return list;
  }

  function castlingAfterMove(rights, mover, from, to, captured) {
    var next = { wK: rights.wK, wQ: rights.wQ, bK: rights.bK, bQ: rights.bQ };
    var home = mover.color === 'w' ? 7 : 0;
    if (mover.type === 'K') {
      next[mover.color + 'K'] = false;
      next[mover.color + 'Q'] = false;
    }
    if (mover.type === 'R' && from.r === home) {
      if (from.c === 0) next[mover.color + 'Q'] = false;
      if (from.c === 7) next[mover.color + 'K'] = false;
    }
    if (captured && captured.type === 'R') {
      var capturedHome = captured.color === 'w' ? 7 : 0;
      if (to.r === capturedHome && to.c === 0) next[captured.color + 'Q'] = false;
      if (to.r === capturedHome && to.c === 7) next[captured.color + 'K'] = false;
    }
    return next;
  }

  function parseFen(fen) {
    var parts = String(fen).trim().split(/\s+/);
    if (parts.length < 2) throw new Error('Invalid FEN: ' + fen);
    var rows = parts[0].split('/');
    if (rows.length !== 8) throw new Error('Invalid FEN board: ' + fen);
    var board = emptyBoard();
    for (var r = 0; r < 8; r++) {
      var row = rows[r], c = 0;
      for (var i = 0; i < row.length; i++) {
        var ch = row[i];
        if (ch >= '1' && ch <= '8') { c += parseInt(ch, 10); continue; }
        var color = ch === ch.toUpperCase() ? 'w' : 'b';
        board[r][c] = { type: ch.toUpperCase(), color: color };
        c++;
      }
      if (c !== 8) throw new Error('Invalid FEN rank: ' + row);
    }
    var turn = parts[1] === 'b' ? 'b' : 'w';
    var castleStr = parts[2] || '-';
    var castling = {
      wK: castleStr.indexOf('K') >= 0, wQ: castleStr.indexOf('Q') >= 0,
      bK: castleStr.indexOf('k') >= 0, bQ: castleStr.indexOf('q') >= 0
    };
    var ep = null;
    if (parts[3] && parts[3] !== '-') {
      ep = { r: 8 - parseInt(parts[3][1], 10), c: parts[3].charCodeAt(0) - 97 };
    }
    return { board: board, turn: turn, castling: castling, enPassant: ep };
  }

  function sanForMove(board, color, castling, enPassant, from, to, extra, promo) {
    var piece = board[from.r][from.c];
    if (!piece) throw new Error('No piece on source square');
    if (extra && extra.castle) return extra.castle === 'K' ? 'O-O' : 'O-O-O';
    var target = board[to.r][to.c];
    var capture = !!target || !!(extra && extra.enPassant);
    var letter = piece.type === 'P' ? '' : piece.type;
    var disambiguation = '';
    if (piece.type !== 'P') {
      var others = allLegalMoves(board, color, castling, enPassant).filter(function (m) {
        return m.to.r === to.r && m.to.c === to.c && (m.from.r !== from.r || m.from.c !== from.c) && board[m.from.r][m.from.c].type === piece.type;
      });
      if (others.length) {
        var sameFile = others.some(function (m) { return m.from.c === from.c; });
        var sameRank = others.some(function (m) { return m.from.r === from.r; });
        if (!sameFile) disambiguation = 'abcdefgh'[from.c];
        else if (!sameRank) disambiguation = String(8 - from.r);
        else disambiguation = 'abcdefgh'[from.c] + (8 - from.r);
      }
    }
    var san = letter + disambiguation + (capture ? 'x' : '') + 'abcdefgh'[to.c] + (8 - to.r);
    if (piece.type === 'P' && capture) san = 'abcdefgh'[from.c] + san;
    if (piece.type === 'P' && (to.r === 0 || to.r === 7)) san += '=' + (promo || 'Q');
    var next = cloneBoard(board);
    applyMove(next, from, to, extra, promo || 'Q');
    var enemy = color === 'w' ? 'b' : 'w';
    if (inCheck(next, enemy)) san += allLegalMoves(next, enemy, castling, null).length ? '+' : '#';
    return san;
  }

  function sanFor(board, from, to, extra, promo, piece) { /* legacy basic helper */
    if (extra && extra.castle) return extra.castle === 'K' ? 'O-O' : 'O-O-O';
    var target = board[to.r][to.c];
    var capture = !!target || (extra && extra.enPassant);
    var letter = piece.type === 'P' ? '' : piece.type;
    var san = letter + (capture ? 'x' : '') + 'abcdefgh'[to.c] + (8 - to.r);
    if (piece.type === 'P' && (to.r === 0 || to.r === 7)) san += '=' + (promo || 'Q');
    return san;
  }

  return {
    emptyBoard: emptyBoard,
    initialBoard: initialBoard,
    cloneBoard: cloneBoard,
    inBounds: inBounds,
    findKing: findKing,
    isAttacked: isAttacked,
    inCheck: inCheck,
    pseudoMoves: pseudoMoves,
    applyMove: applyMove,
    legalMoves: legalMoves,
    allLegalMoves: allLegalMoves,
    castlingAfterMove: castlingAfterMove,
    parseFen: parseFen,
    sanFor: sanFor,
    sanForMove: sanForMove
  };
});
