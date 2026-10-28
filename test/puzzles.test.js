// Verifies every puzzle solution is legal and achieves its stated goal (mate / fork / etc.)
// and that the analysis replay of a saved game round-trips through the engine.
import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const C = require('../client/chess-core.js');

// Mirror of PUZZLES in app.js — keep in sync (validated at build time here).
const PUZZLES = [
  {
    id: 'back-rank-1',
    fen: '6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1',
    solution: [{ from: { r: 7, c: 0 }, to: { r: 0, c: 0 } }],
    expect: 'checkmate'
  },
  {
    id: 'queen-mate-1',
    fen: '6k1/5ppp/8/8/8/8/8/4Q1K1 w - - 0 1',
    solution: [{ from: { r: 7, c: 4 }, to: { r: 0, c: 4 } }],
    expect: 'checkmate'
  },
  {
    id: 'smothered-1',
    fen: '6rk/6pp/8/6N1/8/8/8/6K1 w - - 0 1',
    solution: [{ from: { r: 3, c: 6 }, to: { r: 1, c: 5 } }],
    expect: 'checkmate' // Nf7#
  },
  {
    id: 'promotion-1',
    fen: '8/1P6/8/8/8/1k6/8/6K1 w - - 0 1',
    solution: [{ from: { r: 1, c: 1 }, to: { r: 0, c: 1 } }],
    expect: 'promotion-check' // b8=Q+
  }
];

function sq(fenPos) {
  // "a1" -> {r:7,c:0}
  return { r: 8 - parseInt(fenPos[1], 10), c: fenPos.charCodeAt(0) - 97 };
}

describe('daily puzzles', () => {
  it.each(PUZZLES)('$id solution is legal and achieves its goal', (p) => {
    const pos = C.parseFen(p.fen);
    for (const step of p.solution) {
      const legal = C.legalMoves(pos.board, step.from.r, step.from.c, pos.castling, pos.enPassant);
      const match = legal.find((m) => m.r === step.to.r && m.c === step.to.c);
      expect(match, `${p.id}: move ${JSON.stringify(step)} must be legal`).toBeTruthy();
      C.applyMove(pos.board, step.from, step.to, match.extra, 'Q');
    }
    const b = pos.board;
    if (p.expect === 'checkmate') {
      expect(C.inCheck(b, 'b'), p.id + ' must end in check').toBe(true);
      const replyMoves = C.allLegalMoves(b, 'b', pos.castling, null);
      expect(replyMoves.length, p.id + ' must be mate').toBe(0);
    }
    if (p.expect === 'fork') {
      // Ne6+ must give check and attack a8 rook
      expect(C.inCheck(b, 'b')).toBe(true);
      const knightAttacks = [];
      const kn = [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]];
      const kSq = { r: 4, c: 5 }; // e6 after the move (r=8-6=2? no: e6 => r=2,c=4) -- recompute below
      const e6 = { r: 8 - 6, c: 4 };
      for (const [dr, dc] of kn) {
        knightAttacks.push([e6.r + dr, e6.c + dc]);
      }
      const a8 = { r: 0, c: 0 };
      expect(knightAttacks.some(([r, c]) => r === a8.r && c === a8.c)).toBe(true);
      expect(b[a8.r][a8.c]).toMatchObject({ type: 'R', color: 'b' });
    }
    if (p.expect === 'promotion-check') {
      expect(b[0][1]).toMatchObject({ type: 'Q', color: 'w' });
      expect(C.inCheck(b, 'b')).toBe(true);
    }
  });
});

describe('analysis replay', () => {
  it('replaying a move list from metadata reproduces each intermediate position', () => {
    // Scholar's mate line: 1.e4 e5 2.Bc4 Nc6 3.Qh5 Nf6?? 4.Qxf7#
    const sans = ['e4', 'e5', 'Bc4', 'Nc6', 'Qh5', 'Nf6', 'Qxf7#'];
    // Replay manually from the initial board using the engine by picking legal moves.
    let board = C.initialBoard();
    const castling = { wK: true, wQ: true, bK: true, bQ: true };
    let enPassant = null;
    let turn = 'w';
    const meta = [];
    for (const san of sans) {
      const clean = san.replace(/[+#]/, '');
      const isCastleK = clean === 'O-O';
      const isCastleQ = clean === 'O-O-O';
      let found = null;
      for (let r = 0; r < 8 && !found; r++) {
        for (let c = 0; c < 8 && !found; c++) {
          const p = board[r][c];
          if (!p || p.color !== turn) continue;
          const ms = C.legalMoves(board, r, c, castling, enPassant);
          for (const m of ms) {
            const s = C.sanFor(board, { r, c }, m, m.extra, 'Q', p)
              .replace(/[+#]/, '');
            if (s === clean) {
              found = { from: { r, c }, to: { r: m.r, c: m.c }, extra: m.extra };
              break;
            }
          }
        }
      }
      expect(found, 'move ' + san + ' should be findable').toBeTruthy();
      meta.push(found);
      const piece = board[found.from.r][found.from.c];
      C.applyMove(board, found.from, found.to, found.extra, 'Q');
      if (piece.type === 'K') { castling[piece.color + 'K'] = false; castling[piece.color + 'Q'] = false; }
      enPassant = found.extra && found.extra.double ? { r: (found.from.r + found.to.r) / 2, c: found.from.c } : null;
      turn = turn === 'w' ? 'b' : 'w';
    }
    expect(C.inCheck(board, 'b')).toBe(true);
    expect(C.allLegalMoves(board, 'b', castling, null).length).toBe(0);
    expect(meta.length).toBe(7);
  });
});
