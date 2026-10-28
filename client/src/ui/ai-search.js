// src/ui/ai-search.js — pure, difficulty-parameterized chess AI search.
//
// UMD: loads in the browser (global `AiSearch`, including inside a Web
// Worker over chess-core.js) and as a CommonJS module in Node tests.
// No DOM access. Operates on ChessCore's board shape:
//   board[r][c] = { type: 'P'|'N'|'B'|'R'|'Q'|'K', color: 'w'|'b' } | null
//
// Difficulty profiles:
//   easy   depth 1, 30% fully random legal move, random tie-breaking.
//   medium depth 2, deterministic search, random tie-breaking among equals.
//   hard   depth 4 with alpha-beta, capture-first ordering, and a node cap;
//          returns the best move found at the last completed depth.
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.AiSearch = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DIFFICULTIES = ['easy', 'medium', 'hard'];

  var PIECE_VALUES = { P: 100, N: 320, B: 330, R: 500, Q: 900, K: 0 };
  var MATE = 100000;
  var MAX_NODES = 120000;

  var PROFILES = {
    easy: { depth: 1, randomChance: 0.3, ordered: false },
    medium: { depth: 2, randomChance: 0, ordered: false },
    hard: { depth: 4, randomChance: 0, ordered: true },
  };

  function evaluate(board) {
    var score = 0;
    for (var r = 0; r < 8; r++) {
      for (var c = 0; c < 8; c++) {
        var p = board[r][c];
        if (!p) continue;
        var v = PIECE_VALUES[p.type];
        // Small centralization/push bonus for pawns and knights.
        if (p.type === 'P' || p.type === 'N') {
          v += 6 - (Math.abs(3.5 - r) + Math.abs(3.5 - c)) * 2;
        }
        score += p.color === 'w' ? v : -v;
      }
    }
    return score; // white's point of view
  }

  function captureScore(board, move) {
    var victim = board[move.to.r][move.to.c];
    var victimValue = victim ? PIECE_VALUES[victim.type] : 0;
    return victimValue * 10 - PIECE_VALUES[board[move.from.r][move.from.c].type];
  }

  function orderedMoves(board, moves) {
    return moves.slice().sort(function (a, b) {
      return captureScore(board, b) - captureScore(board, a);
    });
  }

  // Negamax from white's point of view is awkward with a w/b color model,
  // so use plain minimax with alpha-beta from the mover's perspective.
  function minimax(core, board, depth, color, alpha, beta, castling, enPassant, ctx) {
    ctx.nodes++;
    if (ctx.nodes > ctx.maxNodes) return color === 'w' ? evaluate(board) : -evaluate(board);
    var moves = core.allLegalMoves(board, color, castling, enPassant);
    if (moves.length === 0) {
      return core.inCheck(board, color) ? (color === 'w' ? -MATE : MATE) : 0;
    }
    if (depth <= 0) return color === 'w' ? evaluate(board) : -evaluate(board);
    if (ctx.ordered) moves = orderedMoves(board, moves);
    var maximizing = color === 'w';
    var best = maximizing ? -Infinity : Infinity;
    for (var i = 0; i < moves.length; i++) {
      var copy = core.cloneBoard(board);
      core.applyMove(copy, moves[i].from, moves[i].to, moves[i].to.extra, 'Q');
      var cast = { wK: castling.wK, wQ: castling.wQ, bK: castling.bK, bQ: castling.bQ };
      // Rights that could be affected: moving a king or rook, or the rook being captured.
      if (moves[i].from.r === (color === 'w' ? 7 : 0)) {
        if (moves[i].from.c === 4) { cast[color + 'K'] = false; cast[color + 'Q'] = false; }
        if (moves[i].from.c === 0) cast[color + 'Q'] = false;
        if (moves[i].from.c === 7) cast[color + 'K'] = false;
      }
      var toR = moves[i].to.r, toC = moves[i].to.c;
      if (toR === 7 && toC === 0) cast.wQ = false;
      if (toR === 7 && toC === 7) cast.wK = false;
      if (toR === 0 && toC === 0) cast.bQ = false;
      if (toR === 0 && toC === 7) cast.bK = false;
      var nextEp = moves[i].to.extra && moves[i].to.extra.double
        ? { r: (moves[i].from.r + toR) / 2, c: moves[i].from.c }
        : null;
      var score = minimax(core, copy, depth - 1, color === 'w' ? 'b' : 'w', alpha, beta, cast, nextEp, ctx);
      if (maximizing) {
        if (score > best) best = score;
        if (best > alpha) alpha = best;
      } else {
        if (score < best) best = score;
        if (best < beta) beta = best;
      }
      if (beta <= alpha) break;
    }
    return best;
  }

  function rootMoves(core, board, color, castling, enPassant) {
    return core.allLegalMoves(board, color, castling, enPassant);
  }

  function shuffle(items) {
    for (var i = items.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = items[i]; items[i] = items[j]; items[j] = t;
    }
    return items;
  }

  function searchRoot(core, board, color, castling, enPassant, depth, ctx) {
    var moves = rootMoves(core, board, color, castling, enPassant);
    if (moves.length === 0) return [];
    if (ctx.ordered) moves = orderedMoves(board, moves);
    var choices = [];
    var alpha = -Infinity, beta = Infinity;
    var maximizing = color === 'w';
    var best = maximizing ? -Infinity : Infinity;
    for (var i = 0; i < moves.length; i++) {
      var copy = core.cloneBoard(board);
      core.applyMove(copy, moves[i].from, moves[i].to, moves[i].to.extra, 'Q');
      var cast = { wK: castling.wK, wQ: castling.wQ, bK: castling.bK, bQ: castling.bQ };
      if (moves[i].from.r === (color === 'w' ? 7 : 0)) {
        if (moves[i].from.c === 4) { cast[color + 'K'] = false; cast[color + 'Q'] = false; }
        if (moves[i].from.c === 0) cast[color + 'Q'] = false;
        if (moves[i].from.c === 7) cast[color + 'K'] = false;
      }
      var toR = moves[i].to.r, toC = moves[i].to.c;
      if (toR === 7 && toC === 0) cast.wQ = false;
      if (toR === 7 && toC === 7) cast.wK = false;
      if (toR === 0 && toC === 0) cast.bQ = false;
      if (toR === 0 && toC === 7) cast.bK = false;
      var nextEp = moves[i].to.extra && moves[i].to.extra.double
        ? { r: (moves[i].from.r + toR) / 2, c: moves[i].from.c }
        : null;
      var score = minimax(core, copy, depth - 1, color === 'w' ? 'b' : 'w', alpha, beta, cast, nextEp, ctx);
      choices.push({ move: moves[i], score: score });
      if (maximizing) {
        if (score > best) best = score;
        if (best > alpha) alpha = best;
      } else {
        if (score < best) best = score;
        if (best < beta) beta = best;
      }
    }
    return choices;
  }

  function pickBestFor(choices, color) {
    if (choices.length === 0) return null;
    var white = color === 'w';
    var bestScore = choices[0].score;
    for (var i = 1; i < choices.length; i++) {
      var s = choices[i].score;
      if (white ? s > bestScore : s < bestScore) bestScore = s;
    }
    var winners = choices.filter(function (c) { return c.score === bestScore; });
    return shuffle(winners)[0];
  }

  function resolveCore(position) {
    if (position && position.core) return position.core;
    if (typeof ChessCore !== 'undefined') return ChessCore;
    if (typeof require === 'function') {
      try { return require('../../chess-core.js'); } catch (e) { /* no engine available */ }
    }
    return null;
  }

  function chooseMove(position, difficulty) {
    var core = resolveCore(position);
    var board = position.board, color = position.turn;
    var castling = position.castling, enPassant = position.enPassant;
    if (!core) throw new Error('ai-search: no ChessCore engine provided (pass position.core)');
    var profile = PROFILES[difficulty] || PROFILES.medium;

    var moves = rootMoves(core, board, color, castling, enPassant);
    if (moves.length === 0) return null;

    // Easy: sometimes play a fully random legal move.
    if (profile.randomChance > 0 && Math.random() < profile.randomChance) {
      return moves[Math.floor(Math.random() * moves.length)];
    }

    var ctx = { nodes: 0, maxNodes: MAX_NODES, ordered: profile.ordered };
    var choices = searchRoot(core, board, color, castling, enPassant, profile.depth, ctx);
    var best = pickBestFor(choices, color);
    return best ? best.move : null;
  }

  return {
    DIFFICULTIES: DIFFICULTIES,
    chooseMove: chooseMove,
    MAX_NODES: MAX_NODES,
  };
});
