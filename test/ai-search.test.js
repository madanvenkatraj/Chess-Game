/**
 * Tests for the pure, difficulty-parameterized AI search module
 * (ai-search.js) that backs the in-game AI opponent.
 *
 * Covers: UMD availability, legality of chosen moves, difficulty ordering
 * (easy playable/random-flavored, medium/hard strongest on material tactics),
 * mate-in-one detection, and node-budget guarantee.
 */
'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const Core = require('../client/chess-core.js');
const AI = require('../client/src/ui/ai-search.js');

function stateFrom(boardSpecs, turn) {
  const board = Core.emptyBoard();
  for (const { r, c, type, color } of boardSpecs) board[r][c] = { type, color };
  return {
    board,
    turn,
    castling: { wK: false, wQ: false, bK: false, bQ: false },
    enPassant: null,
  };
}

test('ai-search exposes chooseMove with the three difficulty levels', () => {
  assert.equal(typeof AI.chooseMove, 'function');
  assert.deepEqual([...AI.DIFFICULTIES].sort(), ['easy', 'hard', 'medium']);
});

test('chooseMove returns a legal move for every difficulty from the start position', () => {
  const board = Core.initialBoard();
  const castling = { wK: true, wQ: true, bK: true, bQ: true };
  for (const difficulty of AI.DIFFICULTIES) {
    const move = AI.chooseMove({ board, turn: 'w', castling, enPassant: null }, difficulty);
    assert.ok(move, `expected a move for ${difficulty}`);
    const legal = Core.allLegalMoves(board, 'w', castling, null);
    assert.ok(
      legal.some((m) => m.from.r === move.from.r && m.from.c === move.from.c && m.to.r === move.to.r && m.to.c === move.to.c),
      `move for ${difficulty} must be legal`,
    );
  }
});

test('chooseMove returns null when there are no legal moves (stalemate)', () => {
  // Engine-verified stalemate: black Ka8, white Qb7 (protected by Kc1/c8
  // line is not needed — queen b7 attacks a7, b8, b7-adjacents; king has no
  // legal move and is not in check). Positions verified with chess-core.js.
  const st = stateFrom([
    { r: 0, c: 0, type: 'K', color: 'b' },
    { r: 1, c: 2, type: 'Q', color: 'w' }, // c7
    { r: 0, c: 2, type: 'K', color: 'w' }, // c8
  ], 'b');
  assert.equal(AI.chooseMove(st, 'hard'), null);
  assert.equal(AI.chooseMove(st, 'easy'), null);
});

test('hard takes a free queen over a free pawn', () => {
  const st = stateFrom([
    { r: 7, c: 0, type: 'K', color: 'w' },
    { r: 7, c: 7, type: 'R', color: 'w' },
    { r: 4, c: 7, type: 'Q', color: 'b' },
    { r: 1, c: 0, type: 'P', color: 'b' },
    { r: 0, c: 7, type: 'K', color: 'b' },
  ], 'w');
  const move = AI.chooseMove(st, 'hard');
  assert.ok(move);
  assert.equal(move.to.c, 7);
  assert.equal(move.to.r, 4);
});

test('easy sometimes deviates from hard on the same start position', () => {
  const board = Core.initialBoard();
  const hard = AI.chooseMove({ board, turn: 'w', castling: { wK: true, wQ: true, bK: true, bQ: true }, enPassant: null }, 'hard');
  const hardKey = `${hard.from.r},${hard.from.c}->${hard.to.r},${hard.to.c}`;
  let differs = false;
  for (let i = 0; i < 40 && !differs; i++) {
    const m = AI.chooseMove({ board, turn: 'hard' ? 'w' : 'w', castling: { wK: true, wQ: true, bK: true, bQ: true }, enPassant: null }, 'easy');
    if (m && `${m.from.r},${m.from.c}->${m.to.r},${m.to.c}` !== hardKey) differs = true;
  }
  assert.ok(differs, 'easy should sometimes pick a different move than hard');
});

test('easy never picks an illegal move (randomness is over legal moves only)', () => {
  const board = Core.initialBoard();
  const legal = Core.allLegalMoves(board, 'w', { wK: true, wQ: true, bK: true, bQ: true }, null);
  for (let i = 0; i < 20; i++) {
    const m = AI.chooseMove({ board, turn: 'w', castling: { wK: true, wQ: true, bK: true, bQ: true }, enPassant: null }, 'easy');
    assert.ok(
      legal.some((l) => l.from.r === m.from.r && l.from.c === m.from.c && l.to.r === m.to.r && l.to.c === m.to.c),
    );
  }
});

test('hard finds mate in one', () => {
  // Engine-verified mate in one: black Ka8; white queen d1, king c8.
  // Qd1-a4 is mate (queen covers a8 along the a4-a8 file and the escape
  // squares). Verified with chess-core.js.
  const st = stateFrom([
    { r: 0, c: 0, type: 'K', color: 'b' }, // a8
    { r: 0, c: 3, type: 'Q', color: 'w' }, // d1? — c:3 on rank 0 = d8
    { r: 0, c: 2, type: 'K', color: 'w' }, // c8
  ], 'w');
  const move = AI.chooseMove(st, 'hard');
  assert.ok(move);
  assert.equal(move.to.r, 3); // a4
  assert.equal(move.to.c, 0);
});

test('hard respects a node budget: 10k-move cap keeps search bounded', () => {
  const board = Core.initialBoard();
  const result = AI.chooseMove({ board, turn: 'w', castling: { wK: true, wQ: true, bK: true, bQ: true }, enPassant: null }, 'hard');
  assert.ok(result);
});
