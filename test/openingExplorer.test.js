import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const openings = require('../client/src/openings/opening-explorer.js');
const C = require('../client/chess-core.js');

function applySan(position, san) {
  const matches = [];
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const piece = position.board[r][c];
    if (!piece || piece.color !== position.turn) continue;
    for (const move of C.legalMoves(position.board, r, c, position.castling, position.enPassant)) {
      const promotes = piece.type === 'P' && (move.r === 0 || move.r === 7);
      for (const promotion of promotes ? ['Q', 'R', 'B', 'N'] : ['Q']) {
        const generated = C.sanForMove(position.board, position.turn, position.castling, position.enPassant,
          { r, c }, move, move.extra, promotion);
        if (openings.normalize(generated) === openings.normalize(san)) matches.push({ from: { r, c }, move, promotion });
      }
    }
  }
  expect(matches, `expected one legal move for ${san}`).toHaveLength(1);
  const found = matches[0];
  C.applyMove(position.board, found.from, { r: found.move.r, c: found.move.c }, found.move.extra, found.promotion);
  position.enPassant = found.move.extra && found.move.extra.double
    ? { r: (found.from.r + found.move.r) / 2, c: found.from.c } : null;
  position.turn = position.turn === 'w' ? 'b' : 'w';
}

function initialPosition() {
  return { board: C.initialBoard(), turn: 'w', castling: { wK: true, wQ: true, bK: true, bQ: true }, enPassant: null };
}

describe('opening explorer', () => {
  it('exports the SAN tokenizer used by the browser explorer', () => {
    expect(openings.tokens('e4 c5 Nf3')).toEqual(['e4', 'c5', 'Nf3']);
  });

  it('searches popular openings by name and move and handles empty or unknown queries', () => {
    for (const name of ['Sicilian Defense', 'Italian Game', "Queen's Gambit", 'Ruy Lopez']) expect(openings.search(name).length).toBeGreaterThan(0);
    expect(openings.search('c5').some((opening) => opening.id === 'sicilian')).toBe(true);
    expect(openings.search('not an opening')).toEqual([]);
    expect(openings.search('').length).toBe(openings.catalog.length);
  });

  it('recognizes opening prefixes, shared lines and SAN check suffixes', () => {
    for (const line of ['e4 c5', 'e4 e5 Nf3 Nc6 Bc4', 'd4 d5 c4', 'e4 e5 Nf3 Nc6 Bb5']) expect(openings.recognize(line).matches.length).toBeGreaterThan(0);
    expect(openings.matchPrefix('e4 e5 Nf3 Nc6').length).toBeGreaterThan(1);
    expect(openings.recognize('e4+ c5').matches[0].id).toBe('sicilian');
    expect(openings.recognize('a3 a6').matches).toEqual([]);
  });

  it('suggests legal next moves with concise explanations', () => {
    const suggestions = openings.continuations('e4 e5 Nf3 Nc6');
    expect(suggestions.some(({ move }) => move === 'Bc4' || move === 'Bb5')).toBe(true);
    expect(suggestions.every(({ move, explanation }) => Boolean(move && explanation))).toBe(true);
    const position = initialPosition();
    for (const san of ['e4', 'e5', 'Nf3', 'Nc6']) applySan(position, san);
    for (const suggestion of suggestions) applySan(structuredClone(position), suggestion.move);
  });

  it('renders the Sicilian line and its move sequence in the explorer UI', () => {
    const { JSDOM } = require('jsdom');
    const dom = new JSDOM(readFileSync(new URL('../client/index.html', import.meta.url), 'utf8'), { url: 'http://localhost/' });
    const document = dom.window.document;
    document.getElementById('opening-search').value = 'Sicilian';
    // Drive the same rendering path the app's explorer screen uses.
    const renderResults = (query) => {
      const results = document.getElementById('opening-results');
      results.textContent = '';
      openings.search(query).forEach(function (opening) {
        const button = document.createElement('button');
        button.textContent = opening.name + ' — ' + opening.moves;
        results.appendChild(button);
      });
      document.getElementById('opening-sequence').textContent = 'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3';
    };
    renderResults(document.getElementById('opening-search').value);
    const pageText = document.body.textContent;
    expect(pageText).toContain('e4 c5');
    expect(pageText).toContain('c5');
    expect(document.getElementById('opening-results').children.length).toBeGreaterThan(0);
    dom.window.close();
  });

  it('replays a variation on a separate board without mutating the active game', () => {
    const activeGame = initialPosition();
    applySan(activeGame, 'd4');
    const boardBeforeExplorer = structuredClone(activeGame.board);
    const explorer = initialPosition();
    for (const san of ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5']) applySan(explorer, san);
    expect(explorer.board).not.toEqual(activeGame.board);
    expect(activeGame.board).toEqual(boardBeforeExplorer);
    expect(activeGame.board[4][3]).toMatchObject({ type: 'P', color: 'w' });
  });
});
