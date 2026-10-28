import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const C = require('../client/chess-core.js');
const PGN = require('../client/pgn.js');
describe('PGN codec', () => {
  it('exports and validates standard SAN games', () => {
    const source = '[White "A\\"lice"]\n[Black "Bob"]\n[Result "1-0"]\n\n1. e4 e5 2. Nf3 Nc6 1-0';
    const game = PGN.importGame(source, C);
    expect(game.sans).toEqual(['e4','e5','Nf3','Nc6']);
    const exported = PGN.exportGame({ sans: game.sans, white: game.white, black: game.black, result: game.result });
    expect(PGN.importGame(exported, C).sans).toEqual(game.sans);
  });
  it('reports illegal SAN with the move number', () => {
    expect(() => PGN.importGame('1. e5', C)).toThrow(/move 1/);
  });
});
