// Verifies the pure spectator domain: snapshot normalization, game list,
// follow-player, and the incremental replay builder over the real engine.
import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const C = require('../client/chess-core.js');

import {
  FOLLOW_BOTH, FOLLOW_WHITE, FOLLOW_BLACK, SpectatorDataError,
  normalizeSnapshot, isValidListEntry, sortGameList, updateGameList,
  normalizeFollow, boardOrientation, followedSeat, createReplay
} from '../client/src/spectator/spectator.js';

function snapshotFixture(overrides) {
  const board = C.initialBoard();
  return Object.assign({
    code: 'ABC123',
    names: { w: 'Alice', b: 'Bob' },
    ratings: { w: 1350, b: 1420 },
    turn: 'w',
    board,
    castling: { wK: true, wQ: true, bK: true, bQ: true },
    enPassant: null,
    moves: [],
    meta: [],
    captured: { w: [], b: [] },
    clocks: { w: 600, b: 600 },
    over: false,
    result: null,
    timeControl: 600
  }, overrides || {});
}

describe('normalizeSnapshot', () => {
  it('passes through a well-formed snapshot', () => {
    const s = normalizeSnapshot(snapshotFixture());
    expect(s.names.w).toBe('Alice');
    expect(s.ratings.w).toBe(1350);
    expect(s.turn).toBe('w');
    expect(s.board[7][4]).toMatchObject({ type: 'K', color: 'w' });
  });

  it('coerces missing names/ratings/clocks to safe defaults', () => {
    const raw = snapshotFixture();
    delete raw.names; delete raw.ratings; delete raw.clocks;
    const s = normalizeSnapshot(raw);
    expect(s.names.w).toBeNull();
    expect(s.ratings.w).toBeNull();
    expect(s.clocks.w).toBeNull();
  });

  it('rejects malformed snapshots with a typed error', () => {
    expect(() => normalizeSnapshot(null)).toThrow(SpectatorDataError);
    expect(() => normalizeSnapshot({})).toThrow(SpectatorDataError);
    expect(() => normalizeSnapshot(snapshotFixture({ turn: 'x' }))).toThrow(SpectatorDataError);
    expect(() => normalizeSnapshot(snapshotFixture({ board: [] }))).toThrow(SpectatorDataError);
  });

  it('deep-copies board rows so viewer mutations cannot corrupt the feed', () => {
    const raw = snapshotFixture();
    const s = normalizeSnapshot(raw);
    s.board[0][0].type = 'X';
    expect(raw.board[0][0].type).toBe('R');
  });
});

describe('game list', () => {
  it('validates entries', () => {
    expect(isValidListEntry({ code: 'ABC123', names: {} })).toBe(true);
    expect(isValidListEntry(null)).toBe(false);
    expect(isValidListEntry({ names: {} })).toBe(false);
  });

  it('sorts live games first by activity, then code', () => {
    const sorted = sortGameList([
      { code: 'ZZZ999', over: true, moveCount: 40, names: {} },
      { code: 'MMM333', over: false, moveCount: 2, names: {} },
      { code: 'AAA111', over: false, moveCount: 30, names: {} },
      { code: 'BBB222', over: false, moveCount: 30, names: {} }
    ]);
    expect(sorted.map((g) => g.code)).toEqual(['AAA111', 'BBB222', 'MMM333', 'ZZZ999']);
  });

  it('keeps the current selection stable across refreshes', () => {
    let state = { games: [], currentCode: 'ABC123' };
    state = updateGameList(state, [{ code: 'ABC123', names: {}, over: false, moveCount: 5 }]);
    expect(state.currentCode).toBe('ABC123');
    state = updateGameList(state, [{ code: 'XYZ789', names: {}, over: false, moveCount: 1 }]);
    expect(state.currentCode).toBeNull();
  });
});

describe('follow player', () => {
  it('normalizes preferences', () => {
    expect(normalizeFollow(FOLLOW_WHITE)).toBe(FOLLOW_WHITE);
    expect(normalizeFollow(FOLLOW_BLACK)).toBe(FOLLOW_BLACK);
    expect(normalizeFollow('nonsense')).toBe(FOLLOW_BOTH);
    expect(normalizeFollow(undefined)).toBe(FOLLOW_BOTH);
  });

  it('maps follow preference to board orientation and seat', () => {
    const s = normalizeSnapshot(snapshotFixture());
    expect(boardOrientation(FOLLOW_WHITE, s)).toBe('w');
    expect(boardOrientation(FOLLOW_BLACK, s)).toBe('b');
    expect(boardOrientation(FOLLOW_BOTH, s)).toBe('w');
    expect(followedSeat(FOLLOW_WHITE)).toBe('w');
    expect(followedSeat(FOLLOW_BOTH)).toBeNull();
  });
});

describe('incremental replay builder (real engine)', () => {
  it('extends incrementally: feeding a longer snapshot after a shorter one', () => {
    const replay = createReplay(C);
    const short = snapshotFixture({
      moves: ['e4'],
      meta: [{ from: { r: 6, c: 4 }, to: { r: 4, c: 4 }, promo: null }]
    });
    const long = snapshotFixture({
      moves: ['e4', 'e5'],
      meta: [
        { from: { r: 6, c: 4 }, to: { r: 4, c: 4 }, promo: null },
        { from: { r: 1, c: 4 }, to: { r: 3, c: 4 }, promo: null }
      ]
    });
    expect(replay.feed(short).length).toBe(2);   // initial + 1 ply
    expect(replay.feed(long).length).toBe(3);    // extended, not rebuilt
    const p1 = replay.positionAt(1);
    expect(p1.board[4][4]).toMatchObject({ type: 'P', color: 'w' });
    const p2 = replay.positionAt(2);
    expect(p2.board[3][4]).toMatchObject({ type: 'P', color: 'b' });
  });

  it('rebuilds from scratch when the history rewinds', () => {
    const replay = createReplay(C);
    const long = snapshotFixture({
      moves: ['e4', 'e5'],
      meta: [
        { from: { r: 6, c: 4 }, to: { r: 4, c: 4 }, promo: null },
        { from: { r: 1, c: 4 }, to: { r: 3, c: 4 }, promo: null }
      ]
    });
    replay.feed(long);
    const reset = snapshotFixture({ moves: [], meta: [] });
    expect(replay.feed(reset).length).toBe(1);   // back to initial only
  });

  it('clamps out-of-range ply queries', () => {
    const replay = createReplay(C);
    expect(replay.positionAt(999).board[7][4]).toMatchObject({ type: 'K' });
    expect(replay.positionAt(-5).board[7][4]).toMatchObject({ type: 'K' });
  });

  it('stops extending on inconsistent meta instead of guessing', () => {
    const replay = createReplay(C);
    const bad = snapshotFixture({
      moves: ['e4'],
      meta: [{ from: { r: 6, c: 4 }, to: { r: 3, c: 4 }, promo: null }] // e2-e5 illegal
    });
    expect(replay.feed(bad).length).toBe(1); // no ply applied
  });

  it('tracks castling rights through real plies (king move clears them)', () => {
    const replay = createReplay(C);
    // Seed a custom start (kingside empty) and clear rights with a legal
    // king move — exercises the builder's castling bookkeeping directly.
    const fen = 'r3k3/8/8/8/8/8/8/4K3 w KQ - 0 1';
    const pos = C.parseFen(fen);
    const s = snapshotFixture({ board: pos.board, turn: pos.turn, castling: pos.castling });
    s.moves = ['Kd1'];
    s.meta = [{ from: { r: 7, c: 4 }, to: { r: 7, c: 3 }, promo: null }];
    const res = replay.feed(s);
    expect(res.length).toBe(2); // the ply actually applied
    const pos1 = replay.positionAt(1);
    expect(pos1.castling.wK).toBe(false);
    expect(pos1.castling.wQ).toBe(false);
    expect(pos1.board[7][3]).toMatchObject({ type: 'K', color: 'w' });
  });

  it('seeds position 0 from a snapshot with no history (custom start)', () => {
    const replay = createReplay(C);
    const fen = 'r3k3/8/8/8/8/8/8/4K3 w KQ - 0 1';
    const pos = C.parseFen(fen);
    const s = snapshotFixture({ board: pos.board, turn: pos.turn, castling: pos.castling });
    s.moves = []; s.meta = [];
    replay.feed(s);
    expect(replay.positionAt(0).castling.wK).toBe(true);
    expect(replay.positionAt(0).board[7][4]).toMatchObject({ type: 'K', color: 'w' });
  });
});
