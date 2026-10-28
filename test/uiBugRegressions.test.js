import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = new URL('../', import.meta.url);
const html = readFileSync(new URL('../client/index.html', import.meta.url), 'utf8');
const app = readFileSync(new URL('../client/app.js', import.meta.url), 'utf8');
const openingCatalog = require('../client/src/openings/opening-explorer.js');

function domFrom(source = html) {
  return new JSDOM(source, { url: 'http://localhost/', runScripts: 'outside-only' });
}

describe('reported UI regressions', () => {
  it('has live screens, empty-state targets and the matching game review button', () => {
    const dom = domFrom();
    const document = dom.window.document;
    for (const id of ['spectator', 'spectate-btn', 'spectator-status', 'spectator-game-list', 'spectator-refresh-btn', 'smart-review', 'game-review-btn', 'review-info', 'review-board', 'review-summary', 'review-verdict', 'review-list', 'review-back-btn']) {
      expect(document.getElementById(id), `missing #${id}`).not.toBeNull();
    }
    expect(app).toContain("'spectator'");
    expect(app).toContain("'smart-review'");
    expect(app).toContain('renderTurnIndicator');
    dom.window.close();
  });

  it('has an isolated opening sequence display and can replay the Sicilian starter', () => {
    const sicilian = openingCatalog.search('Sicilian').find((entry) => entry.id === 'sicilian');
    expect(sicilian).toBeDefined();
    expect(sicilian.moves.split(/\s+/).slice(0, 2).join(' ')).toBe('e4 c5');
    const dom = domFrom();
    expect(dom.window.document.getElementById('opening-sequence')).not.toBeNull();
    expect(app).toContain('loadExplorerLine(opening.moves)');
    expect(app).toContain('explorer.moves.join');
    dom.window.close();
  });

  it('replays the Sicilian opening line through the chess core without truncating it', () => {
    const core = require('../client/chess-core.js');
    const tokens = openingCatalog.tokens ? openingCatalog.tokens('e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3') : 'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3'.split(/\s+/);
    let board = core.initialBoard();
    let turn = 'w';
    const castling = { wK: true, wQ: true, bK: true, bQ: true };
    let enPassant = null;
    const played = [];
    for (const san of tokens) {
      let selected = null;
      for (let r = 0; r < 8 && !selected; r++) for (let c = 0; c < 8 && !selected; c++) {
        const piece = board[r][c];
        if (!piece || piece.color !== turn) continue;
        for (const move of core.legalMoves(board, r, c, castling, enPassant)) {
          const generated = core.sanForMove(board, turn, castling, enPassant, { r, c }, move, move.extra, 'Q');
          if (openingCatalog.normalize(generated) === openingCatalog.normalize(san)) { selected = { from: { r, c }, move }; break; }
        }
      }
      expect(selected, `legal replay step exists for ${san}`).not.toBeNull();
      const mover = board[selected.from.r][selected.from.c];
      core.applyMove(board, selected.from, { r: selected.move.r, c: selected.move.c }, selected.move.extra, 'Q');
      enPassant = selected.move.extra && selected.move.extra.double ? { r: (selected.from.r + selected.move.r) / 2, c: selected.from.c } : null;
      if (mover.type === 'K') { castling[mover.color + 'K'] = false; castling[mover.color + 'Q'] = false; }
      turn = turn === 'w' ? 'b' : 'w';
      played.push(san);
    }
    expect(played).toHaveLength(tokens.length);
    expect(played).toContain('c5');
  });

  it('renders a truthful empty state in move history before the first move', () => {
    expect(app).toContain("if (state.moves.length === 0)");
    expect(app).toContain("empty.textContent = '0. — No moves yet'");
  });

  it('keeps replay code message at initial cursor and labels final ply by move number', () => {
    expect(app).toContain("'Replaying ' + moves.length + ' moves from share code.'");
    expect(app).toContain("'After move ' + Math.ceil(replay.cursor / 2)");
    expect(app).toContain('replay.cursor = position.cursor');
  });

  it('handles room creation response with the code and reveals controls only on success', () => {
    const document = domFrom().window.document;
    expect(document.getElementById('create-room-btn')).not.toBeNull();
    expect(document.getElementById('lobby-status')).not.toBeNull();
    expect(document.getElementById('lobby-room-info')).not.toBeNull();
    expect(app).toContain("net.on('created'");
    expect(app).toContain("netStatus('Room created. Share this code: ' + msg.code)");
    expect(app).toContain("net.send('create'");
    expect(app).toContain(".then(function (res)");
  });
});
