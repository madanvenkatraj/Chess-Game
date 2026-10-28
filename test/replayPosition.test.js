import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const C = require('../client/chess-core.js');
const PGN = require('../client/pgn.js');
const ReplayPosition = require('../client/src/ui/replay-position.js');

describe('imported replay position', () => {
  it('starts at the initial position and advances through imported moves', () => {
    const game = PGN.importGame('1. e4 e5 2. Nf3 Nc6', C);
    const moves = game.moves.map((move, index) => ({
      from: move.from,
      to: move.to,
      extra: move.extra || {},
      promotion: game.sans[index] && /=[QRBN]/.test(game.sans[index]) ? game.sans[index].match(/=([QRBN])/)[1] : 'Q',
    }));

    const start = ReplayPosition.setPosition(0, moves, C);
    expect(start.cursor).toBe(0);
    expect(start.board).toEqual(C.initialBoard());
    expect(start.lastMove).toBeNull();

    const afterOne = ReplayPosition.setPosition(1, moves, C);
    expect(afterOne.cursor).toBe(1);
    expect(afterOne.board[4][4]).toMatchObject({ type: 'P', color: 'w' });
    expect(afterOne.lastMove).toBe(moves[0]);

    const final = ReplayPosition.setPosition(99, moves, C);
    expect(final.cursor).toBe(4);
    expect(final.board[5][5]).toMatchObject({ type: 'N', color: 'w' });
    expect(final.board[2][2]).toMatchObject({ type: 'N', color: 'b' });
  });

  it('replays castling and promotion with their move metadata', () => {
    const castle = PGN.importGame('1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O', C);
    const castleMoves = castle.moves.map((move, index) => ({
      from: move.from, to: move.to, extra: move.extra || {},
      promotion: castle.sans[index] && /=[QRBN]/.test(castle.sans[index]) ? castle.sans[index].match(/=([QRBN])/)[1] : 'Q',
    }));
    const castled = ReplayPosition.setPosition(castleMoves.length, castleMoves, C);
    expect(castled.board[7][6]).toMatchObject({ type: 'K', color: 'w' });
    expect(castled.board[7][5]).toMatchObject({ type: 'R', color: 'w' });

    const promotion = PGN.importGame('[SetUp "0"]\n\n1. a4 h5 2. a5 h4 3. a6 h3 4. axb7 hxg2 5. bxa8=Q', C);
    const promotionMoves = promotion.moves.map((move, index) => ({
      from: move.from, to: move.to, extra: move.extra || {},
      promotion: promotion.sans[index] && /=[QRBN]/.test(promotion.sans[index]) ? promotion.sans[index].match(/=([QRBN])/)[1] : 'Q',
    }));
    const promoted = ReplayPosition.setPosition(promotionMoves.length, promotionMoves, C);
    expect(promoted.board[0][0]).toMatchObject({ type: 'Q', color: 'w' });
  });
});
