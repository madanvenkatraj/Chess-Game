import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const app = readFileSync(path.join(here, '..', 'client', 'app.js'), 'utf8');
const html = readFileSync(path.join(here, '..', 'client', 'index.html'), 'utf8');
const worker = readFileSync(path.join(here, '..', 'client/src/ui/ai.worker.js'), 'utf8');
const aiSearch = readFileSync(path.join(here, '..', 'client/src/ui/ai-search.js'), 'utf8');

describe('single-player AI integration', () => {
  it('maps both UI player-color choices to the opposite AI color', () => {
    expect(app).toContain("selectedPlayerColor === 'white' || selectedPlayerColor === 'w' ? 'w' : 'b'");
    expect(app).toContain("state.aiColor = playerColor === 'w' ? 'b' : 'w'");
  });

  it('loads the legal-move search before the app for worker fallback', () => {
    const searchIndex = html.indexOf('src/ui/ai-search.js');
    const appIndex = html.indexOf('src="app.js"');
    expect(searchIndex).toBeGreaterThan(-1);
    expect(appIndex).toBeGreaterThan(searchIndex);
    expect(aiSearch).toContain('chooseMove');
  });

  it('returns worker generation and request id for stale-response protection', () => {
    expect(worker).toContain('generation: msg.generation');
    expect(worker).toContain('id: msg.id');
    expect(app).toContain('msg.id !== aiRequestId || msg.generation !== aiGeneration');
  });

  it('only runs an AI move when the active game is waiting for the AI color', () => {
    expect(app).toContain("if (state.gameOver || state.mode !== 'ai' || state.turn !== state.aiColor) return;");
  });

  it('worker returns a legal AI move with matching request tokens and does not mutate the position', () => {
    const require = createRequire(import.meta.url);
    const core = require('../client/chess-core.js');
    const initial = core.initialBoard();
    const boardBefore = JSON.stringify(initial);
    let response = null;
    const sandbox = {
      ChessCore: core,
      importScripts() {},
      postMessage(message) { response = message; },
    };
    vm.createContext(sandbox);
    vm.runInContext('self = globalThis', sandbox);
    vm.runInContext(aiSearch, sandbox);
    vm.runInContext(worker, sandbox);
    sandbox.self.onmessage({ data: {
      id: 17,
      generation: 4,
      difficulty: 'easy',
      board: initial,
      turn: 'b',
      castling: { K: true, Q: true, k: true, q: true },
      enPassant: null,
    } });

    expect(response).not.toBeNull();
    expect(response.id).toBe(17);
    expect(response.generation).toBe(4);
    expect(response.move).not.toBeNull();
    const legal = core.allLegalMoves(initial, 'b', { K: true, Q: true, k: true, q: true }, null);
    expect(legal.some((move) =>
      move.from.r === response.move.from.r && move.from.c === response.move.from.c &&
      move.to.r === response.move.to.r && move.to.c === response.move.to.c
    )).toBe(true);
    expect(JSON.stringify(initial)).toBe(boardBefore);
  });
});
