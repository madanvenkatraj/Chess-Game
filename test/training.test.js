// Verifies every training exercise is legal and solvable through the real
// engine (chess-core), plus progress persistence and scoring.
import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const C = require('../client/chess-core.js');

// ES-module import of the training module (vitest transforms it).
import {
  EXERCISES, SKILLS, DIFFICULTIES, getExercise, listBySkill, listByDifficulty,
  deserializeProgress, serializeProgress, saveProgress, loadProgress, clearProgress,
  scoreAttempt, recordCompletion, allCompleted, TrainingDeserializationError
} from '../client/src/training/training.js';

/** Convert engine coords {r,c} to algebraic like 'e4' (r=0 is rank 8). */
function toAlg(sq) {
  return 'abcdefgh'[sq.c] + (8 - sq.r);
}

function findMove(moves, from, to) {
  for (var i = 0; i < moves.length; i++) {
    var m = moves[i];
    if (m.r === to.r && m.c === to.c) return m;
  }
  return null;
}

describe('exercise catalog integrity', () => {
  it('every exercise has required well-formed fields', () => {
    expect(EXERCISES.length).toBeGreaterThanOrEqual(10);
    const ids = new Set();
    EXERCISES.forEach((e) => {
      expect(ids.has(e.id)).toBe(false);
      ids.add(e.id);
      expect(SKILLS).toContain(e.skill);
      expect(DIFFICULTIES).toContain(e.difficulty);
      expect(['checkmate', 'win-material', 'draw', 'promote']).toContain(e.goal);
      expect(typeof e.name).toBe('string');
      expect(e.fen.split('/')).toHaveLength(8);
      expect(typeof e.hint).toBe('string');
      expect(e.hint.length).toBeGreaterThan(10);
      e.solution.forEach((m) => expect(m).toMatch(/^[a-h][1-8][a-h][1-8]$/));
    });
  });

  it('catalog covers all six skills', () => {
    SKILLS.forEach((s) => expect(listBySkill(s).length).toBeGreaterThan(0));
  });
});

describe('every solution line is legal and achieves the goal (engine-verified)', () => {
  EXERCISES.forEach((ex) => {
    it(`${ex.id}: ${ex.name}`, () => {
      const pos = C.parseFen(ex.fen);
      const board = pos.board;
      let turn = pos.turn;
      let castling = pos.castling;
      let ep = pos.enPassant;

      ex.solution.forEach((mv) => {
        const from = { r: 8 - parseInt(mv[1], 10), c: mv.charCodeAt(0) - 97 };
        const to = { r: 8 - parseInt(mv[3], 10), c: mv.charCodeAt(2) - 97 };
        const piece = board[from.r][from.c];
        expect(piece).not.toBeNull();
        expect(piece.color).toBe(turn); // it must be the mover's turn

        const legal = C.legalMoves(board, from.r, from.c, castling, ep);
        const mvObj = findMove(legal, from, to);
        expect(mvObj).not.toBeNull(); // the move must be legal

        const promo = piece.type === 'P' && (to.r === 0 || to.r === 7) ? 'Q' : null;
        C.applyMove(board, from, to, (mvObj && mvObj.extra) || {}, promo);
        if (piece.type === 'K') { castling = { wK: false, wQ: false, bK: false, bQ: false }; }
        ep = (mvObj && mvObj.extra && mvObj.extra.double)
          ? { r: (from.r + to.r) / 2, c: from.c } : null;
        turn = turn === 'w' ? 'b' : 'w';
      });

      if (ex.goal === 'checkmate') {
        const moves = C.allLegalMoves(board, turn, castling, ep);
        expect(moves.length).toBe(0);
        expect(C.inCheck(board, turn)).toBe(true);
      }
      if (ex.goal === 'promote') {
        // A promotion happened in the line: a queen now stands on the target square.
        const last = ex.solution[ex.solution.length - 1];
        const to = { r: 8 - parseInt(last[3], 10), c: last.charCodeAt(2) - 97 };
        expect(board[to.r][to.c]).toMatchObject({ type: 'Q' });
      }
    });
  });
});

describe('scoring', () => {
  it('first-try clean solve awards 100', () => {
    const ex = getExercise('mate-back-rank');
    expect(scoreAttempt(ex, { attempts: 1, hintsUsed: false })).toBe(100);
  });

  it('hint or retries halve the award', () => {
    const ex = getExercise('mate-back-rank');
    expect(scoreAttempt(ex, { attempts: 1, hintsUsed: true })).toBe(50);
    expect(scoreAttempt(ex, { attempts: 2, hintsUsed: false })).toBe(50);
    expect(scoreAttempt(ex, { attempts: 2, hintsUsed: true })).toBe(25);
  });

  it('re-completing an exercise earns nothing new', () => {
    const p = { version: 1, score: 0, completed: {}, attempts: {}, lastDate: null };
    const ex = getExercise('mate-queen');
    expect(recordCompletion(p, ex.id, { attempts: 1, hintsUsed: false })).toBe(100);
    expect(recordCompletion(p, ex.id, { attempts: 1, hintsUsed: false })).toBe(0);
    expect(p.score).toBe(100);
  });

  it('allCompleted flips only when every exercise is done', () => {
    const p = { version: 1, score: 0, completed: {}, attempts: {}, lastDate: null };
    expect(allCompleted(p)).toBe(false);
    EXERCISES.forEach((e) => recordCompletion(p, e.id, { attempts: 1 }));
    expect(allCompleted(p)).toBe(true);
  });
});

describe('progress persistence', () => {
  const mem = () => {
    const m = new Map();
    return {
      getItem: (k) => (m.has(k) ? m.get(k) : null),
      setItem: (k, v) => m.set(k, v),
      removeItem: (k) => m.delete(k)
    };
  };

  it('saves, loads, and clears round-trip', () => {
    const s = mem();
    const p = { version: 1, score: 250, completed: { 'mate-back-rank': { attempts: 1, hintsUsed: false, completedAt: 'x' } }, attempts: {}, lastDate: null };
    expect(saveProgress(p, s)).toBe(true);
    expect(loadProgress(s).score).toBe(250);
    clearProgress(s);
    expect(loadProgress(s)).toBeNull();
  });

  it('fails soft on unavailable storage', () => {
    const p = { version: 1, score: 0, completed: {}, attempts: {}, lastDate: null };
    expect(saveProgress(p, null)).toBe(false);
    expect(loadProgress(null)).toBeNull();
  });

  it('discards corrupt saves with a typed error and clears the key', () => {
    const s = mem();
    expect(() => deserializeProgress('{broken')).toThrow(TrainingDeserializationError);
    s.setItem('chess88:training', '{broken');
    expect(loadProgress(s)).toBeNull();
    expect(s.getItem('chess88:training')).toBeNull();
    expect(() => deserializeProgress(JSON.stringify({ version: 99 }))).toThrow(TrainingDeserializationError);
  });
});
