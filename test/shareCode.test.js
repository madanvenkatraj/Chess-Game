// Share-code codec: round-trip, malformed input, and bare-code replay through the engine.
import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const SC = require('../client/share-code.js');
const C = require('../client/chess-core.js');

const SAMPLE = [
  { from: { r: 6, c: 4 }, to: { r: 4, c: 4 } }, // e2-e4
  { from: { r: 1, c: 4 }, to: { r: 3, c: 4 } }, // e7-e5
  { from: { r: 7, c: 5 }, to: { r: 5, c: 2 } }  // f1-c4
];

describe('share-code codec', () => {
  it('round-trips a move list', () => {
    const code = SC.encode(SAMPLE);
    expect(code.startsWith('CH881.')).toBe(true);
    expect(SC.decode(code)).toEqual(SAMPLE);
  });

  it('round-trips an empty move list', () => {
    expect(SC.decode(SC.encode([]))).toEqual([]);
  });

  it('is stable across repeated encodes', () => {
    expect(SC.encode(SAMPLE)).toBe(SC.encode(SAMPLE));
  });

  it('rejects malformed input loudly', () => {
    expect(() => SC.decode('')).toThrow();
    expect(() => SC.decode('NOPE1.')).toThrow(/missing prefix/);
    expect(() => SC.decode('CH882.e2e4')).toThrow(/Unsupported share code version/);
    expect(() => SC.decode('CH881.e2e')).toThrow(/bad length/);
    expect(() => SC.decode('CH881.e2e9')).toThrow(/bad square/);
    expect(() => SC.decode('CH881.z9z9')).toThrow(/bad square/);
    expect(() => SC.decode('CH881.e2e4.')).toThrow(/bad length/);
  });

  it('is case-insensitive and whitespace-tolerant', () => {
    const code = SC.encode(SAMPLE);
    expect(SC.decode(code.toLowerCase())).toEqual(SAMPLE);
    expect(SC.decode(' ' + code + ' ')).toEqual(SAMPLE);
  });

  it('rejects non-array encode input', () => {
    expect(() => SC.encode('e2e4')).toThrow();
    expect(() => SC.encode([{ from: null, to: { r: 0, c: 0 } }])).toThrow();
  });
});

describe('share-code replay through the engine', () => {
  it('replays a decoded code onto a fresh board — simulating another device', () => {
    const decoded = SC.decode(SC.encode(SAMPLE));
    const board = C.initialBoard();
    for (const m of decoded) {
      const piece = board[m.from.r][m.from.c];
      expect(piece, 'replayed move must start from a real piece').toBeTruthy();
      C.applyMove(board, m.from, m.to, {}, 'Q');
    }
    // after 1.e4 e5 2.Bc4, bishop c4 and pawn e4 exist
    expect(board[4][4]).toMatchObject({ type: 'P', color: 'w' });
    expect(board[5][2]).toMatchObject({ type: 'B', color: 'w' });
  });

  it('encodes a real played game (metadata from moveMeta) and replays to the final position', () => {
    // Fool's mate, expressed as moveMeta-style from/to pairs.
    const meta = [
      { from: { r: 6, c: 5 }, to: { r: 5, c: 5 } }, // f2f3
      { from: { r: 1, c: 4 }, to: { r: 3, c: 4 } }, // e7e5
      { from: { r: 6, c: 6 }, to: { r: 4, c: 6 } }, // g2g4
      { from: { r: 0, c: 3 }, to: { r: 4, c: 7 } }  // Qd8h4#
    ];
    const decoded = SC.decode(SC.encode(meta));
    const board = C.initialBoard();
    for (const m of decoded) C.applyMove(board, m.from, m.to, {}, 'Q');
    expect(C.inCheck(board, 'w')).toBe(true);
    expect(C.allLegalMoves(board, 'w', { wK: true, wQ: true, bK: true, bQ: true }, null).length).toBe(0);
  });
});
