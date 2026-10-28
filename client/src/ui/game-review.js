// src/ui/game-review.js — Smart Game Review.
// UMD: browser global `GameReview`, CommonJS for tests.
// Given a completed game (moves + moveMeta, from the initial position),
// replays it with ChessCore and annotates each move:
//   excellent — played move was as good as (or nearly) the engine's best
//   good      — small loss, nothing notable
//   mistake   — meaningful eval loss
//   blunder   — large eval loss
//   missed    — a much better opportunity existed (capture or mate)
// Explanations are plain-language and quote the better alternative in SAN.
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.GameReview = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MATE = 100000;

  // Classification thresholds in centipawns of eval loss for the mover.
  var THRESHOLDS = { blunder: 200, mistake: 90, excellent: 15 };

  function resolveCore(core) {
    if (core) return core;
    if (typeof ChessCore !== 'undefined') return ChessCore;
    if (typeof require === 'function') {
      try { return require('../../chess-core.js'); } catch (e) { /* not available */ }
    }
    return null;
  }

  // Shallow minimax evaluation of the best move for `color` from this board.
  // Depth 2 keeps a full-game review fast (<1s for typical games).
  function bestScore(core, board, color, castling, enPassant, depth) {
    var moves = core.allLegalMoves(board, color, castling, enPassant);
    if (moves.length === 0) return core.inCheck(board, color) ? (color === 'w' ? -MATE : MATE) : 0;
    var best = color === 'w' ? -Infinity : Infinity;
    for (var i = 0; i < moves.length; i++) {
      var copy = core.cloneBoard(board);
      core.applyMove(copy, moves[i].from, moves[i].to, moves[i].to.extra, 'Q');
      var score = negamax(core, copy, color === 'w' ? 'b' : 'w', castling, depth - 1);
      if (color === 'w' ? score > best : score < best) best = score;
    }
    return best;
  }

  // Returns the value of the position from the perspective of the side to move.
  function negamax(core, board, color, castling, depth) {
    var moves = core.allLegalMoves(board, color, castling, null);
    if (moves.length === 0) return core.inCheck(board, color) ? -MATE : 0;
    if (depth <= 0) return staticEval(board, color);
    var best = -Infinity;
    for (var i = 0; i < moves.length; i++) {
      var copy = approxApply(core, board, moves[i]);
      // Child value is from the opponent's perspective — negate for ours.
      var score = -negamax(core, copy, color === 'w' ? 'b' : 'w', castling, depth - 1);
      if (score > best) best = score;
    }
    return best;
  }

  // Apply a move to a board copy and return it (castling rights only matter at
  // review depth 2, and only the pawn double-push flag feeds the next ply).
  function approxApply(core, board, move) {
    var copy = core.cloneBoard(board);
    core.applyMove(copy, move.from, move.to, move.to.extra, 'Q');
    return copy;
  }

  function staticEval(board, color) {
    var VALUES = { P: 100, N: 320, B: 330, R: 500, Q: 900, K: 0 };
    var score = 0;
    for (var r = 0; r < 8; r++) {
      for (var c = 0; c < 8; c++) {
        var p = board[r][c];
        if (!p) continue;
        var v = VALUES[p.type];
        if (p.type === 'P' || p.type === 'N') {
          v += 6 - (Math.abs(3.5 - r) + Math.abs(3.5 - c)) * 2;
        }
        score += p.color === 'w' ? v : -v;
      }
    }
    return color === 'w' ? score : -score;
  }

  function colorAt(index) { return index % 2 === 0 ? 'w' : 'b'; }

  // Best alternative move for the mover in this position (for explanations).
  // All candidate moves with their value from the mover's perspective, best first.
  function bestMoveFor(core, board, color, castling, enPassant) {
    var moves = core.allLegalMoves(board, color, castling, enPassant);
    for (var i = 0; i < moves.length; i++) {
      var copy = core.cloneBoard(board);
      core.applyMove(copy, moves[i].from, moves[i].to, moves[i].to.extra, 'Q');
      moves[i]._score = -negamax(core, copy, color === 'w' ? 'b' : 'w', castling, 1);
    }
    moves.sort(function (a, b) { return b._score - a._score; });
    return { best: moves[0] || null, all: moves };
  }

  function explain(entry, altSan, delta) {
    if (entry.cls === 'excellent') return 'Strong move — it was one of the best in the position.';
    if (entry.cls === 'good') return 'Reasonable move, nothing wrong here.';
    if (entry.cls === 'missed') {
      if (entry.mate) return 'A forced mate was available: ' + altSan + ' would have won the game.';
      return 'A stronger option was ' + altSan + ' — it would have gained material or position.';
    }
    if (entry.cls === 'mistake') return 'A mistake — ' + altSan + ' was better, this lets the opponent back in.';
    return 'A blunder — ' + altSan + ' was much better and keeps the game balanced.';
  }

  function sanOrCoord(core, board, color, castling, enPassant, move) {
    try {
      var san = core.sanFor(board, move.from, move.to, color, castling, enPassant);
      if (san) return san;
    } catch (e) { /* fall through to coordinates */ }
    var L = 'abcdefgh';
    return L[move.from.c] + (8 - move.from.r) + '-' + L[move.to.c] + (8 - move.to.r);
  }

  // Analyze a game. game = { moves: [san...], moveMeta: [{from,to}...] }.
  // Returns { entries: [...], summary: {...} }.
  function reviewGame(game, coreArg) {
    var core = resolveCore(coreArg);
    if (!core) throw new Error('game-review: no ChessCore engine available');
    var metas = game.moveMeta || [];
    var sans = game.moves || [];
    var board = core.initialBoard();
    var castling = { wK: true, wQ: true, bK: true, bQ: true };
    var enPassant = null;
    var entries = [];
    var counts = { excellent: 0, good: 0, mistake: 0, blunder: 0, missed: 0 };

    for (var i = 0; i < metas.length; i++) {
      var color = colorAt(i);
      var meta = metas[i];
      var san = sans[i] || '';
      // Best available score in the position BEFORE the move.
      var pre = bestMoveFor(core, board, color, castling, enPassant);

      // Match the played move by from/to.
      var playedMove = null;
      for (var k = 0; k < pre.all.length; k++) {
        var mv = pre.all[k];
        if (mv.from.r === meta.from.r && mv.from.c === meta.from.c &&
            mv.to.r === meta.to.r && mv.to.c === meta.to.c) { playedMove = mv; break; }
      }
      // Scores are from the mover's perspective; pre.all is best-first.
      var bestScoreV = pre.all.length ? pre.all[0]._score : 0;
      var playedScore = playedMove ? playedMove._score : bestScoreV;
      var bestAlt = null;
      for (var a = 0; a < pre.all.length; a++) {
        if (playedMove && pre.all[a] === playedMove) continue;
        bestAlt = pre.all[a]; break;
      }
      // A move that delivers checkmate is always excellent.
      var copyAfter = core.cloneBoard(board);
      core.applyMove(copyAfter, meta.from, meta.to, meta.to && meta.to.extra, 'Q');
      var oppColor = color === 'w' ? 'b' : 'w';
      var isMate = core.inCheck(copyAfter, oppColor) &&
        core.allLegalMoves(copyAfter, oppColor, castling, null).length === 0;
      var delta = isMate ? 0 : (bestScoreV - playedScore); // loss vs best (>= 0)

      // "Missed opportunity": a clearly better alternative existed.
      var missed = !isMate && playedMove && bestAlt && delta >= THRESHOLDS.mistake;

      var cls = 'good';
      if (isMate) cls = 'excellent';
      else if (pre.all.length === 0) cls = 'good';
      else if (missed) cls = 'missed';
      else if (delta <= THRESHOLDS.excellent) cls = 'excellent';
      else if (delta >= THRESHOLDS.blunder) cls = 'blunder';
      else if (delta >= THRESHOLDS.mistake) cls = 'mistake';

      entries.push({
        index: i,
        san: san,
        side: color,
        cls: cls,
        delta: delta,
        alternative: bestAlt ? sanOrCoord(core, board, color, castling, enPassant, bestAlt) : null,
        mate: isMate,
        explanation: '',
        from: meta.from, to: meta.to
      });
      var entry = entries[entries.length - 1];
      entry.explanation = isMate
        ? 'Checkmate — the game ends here.'
        : explain(entry, entry.alternative, delta);
      counts[cls]++;

      // Advance the real position (castling/en-passant tracked correctly here).
      core.applyMove(board, meta.from, meta.to, meta.to && meta.to.extra, 'Q');
      if (meta.from.r === (color === 'w' ? 7 : 0)) {
        if (meta.from.c === 4) { castling[color + 'K'] = false; castling[color + 'Q'] = false; }
        if (meta.from.c === 0) castling[color + 'Q'] = false;
        if (meta.from.c === 7) castling[color + 'K'] = false;
      }
      var toR = meta.to.r, toC = meta.to.c;
      if (toR === 7 && toC === 0) castling.wQ = false;
      if (toR === 7 && toC === 7) castling.wK = false;
      if (toR === 0 && toC === 0) castling.bQ = false;
      if (toR === 0 && toC === 7) castling.bK = false;
      enPassant = meta.to && meta.to.extra && meta.to.extra.double
        ? { r: (meta.from.r + toR) / 2, c: meta.from.c } : null;
    }

    var summary = {
      excellent: counts.excellent, good: counts.good,
      mistake: counts.mistake, blunder: counts.blunder, missed: counts.missed,
      accuracy: entries.length
        ? Math.round(entries.filter(function (e) { return e.cls === 'excellent' || e.cls === 'good'; }).length / entries.length * 100)
        : 100
    };
    return { entries: entries, summary: summary };
  }

  return { reviewGame: reviewGame, THRESHOLDS: THRESHOLDS };
});
