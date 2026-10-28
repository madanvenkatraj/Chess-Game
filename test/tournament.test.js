import { describe, it, expect } from 'vitest';
import {
  createTournament, reportMatchResult, getCurrentMatch, getChampion,
  roundName, serializeTournament, deserializeTournament,
  TournamentDeserializationError, saveTournament, loadTournament, clearSavedTournament
} from '../client/src/tournament/tournament.js';

describe('createTournament', () => {
  it('builds a full first round for a power-of-two field', () => {
    const t = createTournament({ players: ['Ann', 'Bob', 'Cy', 'Dee'] });
    expect(t.rounds).toHaveLength(2);
    expect(t.rounds[0]).toHaveLength(2);
    expect(t.rounds[0][0]).toMatchObject({ a: 'Ann', b: 'Dee', winner: null });
    expect(t.rounds[0][1]).toMatchObject({ a: 'Bob', b: 'Cy', winner: null });
    expect(getCurrentMatch(t).id).toBe('r0m0');
  });

  it('rejects too few, too many, and duplicate players', () => {
    expect(() => createTournament({ players: ['Only'] })).toThrow();
    expect(() => createTournament({ players: Array.from({ length: 17 }, (_, i) => 'P' + i) })).toThrow();
    expect(() => createTournament({ players: ['Ann', 'Ann'] })).toThrow();
  });

  it('auto-resolves byes for a non-power-of-two field', () => {
    const t = createTournament({ players: ['P1', 'P2', 'P3', 'P4', 'P5'] });
    // size 8: first round has 4 matches; the three bye matches are auto-won.
    expect(t.rounds[0]).toHaveLength(4);
    const byes = t.rounds[0].filter((m) => m.a === null || m.b === null);
    expect(byes).toHaveLength(3);
    byes.forEach((m) => expect(m.winner).not.toBeNull());
    // Round 2 exists with the three bye winners placed plus one live match.
    expect(t.rounds[1]).toHaveLength(2);
    const live = getCurrentMatch(t);
    expect(live).not.toBeNull();
    expect(live.a).not.toBeNull();
    expect(live.b).not.toBeNull();
    expect(roundName(t, 0)).toBe('Quarter-finals');
    expect(roundName(t, 1)).toBe('Semi-finals');
    expect(roundName(t, 2)).toBe('Final');
  });

  it('supports a 2-player final-only event', () => {
    const t = createTournament({ players: ['X', 'Y'] });
    expect(t.rounds).toHaveLength(1);
    expect(roundName(t, 0)).toBe('Final');
    expect(getCurrentMatch(t).id).toBe('r0m0');
  });
});

describe('progression', () => {
  it('advances winners and crowns a champion', () => {
    const t = createTournament({ players: ['Ann', 'Bob', 'Cy', 'Dee'] });
    reportMatchResult(t, 'r0m0', 'a'); // Ann wins
    reportMatchResult(t, 'r0m1', 'b'); // Cy wins
    expect(t.rounds[1][0]).toMatchObject({ a: 'Ann', b: 'Cy', winner: null });
    expect(getChampion(t)).toBeNull();
    reportMatchResult(t, 'r1m0', 'b'); // Cy wins the final
    expect(getChampion(t)).toBe('Cy');
    expect(getCurrentMatch(t)).toBeNull();
  });

  it('rejects unknown matches and bad results', () => {
    const t = createTournament({ players: ['Ann', 'Bob'] });
    expect(() => reportMatchResult(t, 'nope', 'a')).toThrow();
    expect(() => reportMatchResult(t, 'r0m0', 'x')).toThrow();
  });

  it('a draw reopens the match for replay', () => {
    const t = createTournament({ players: ['Ann', 'Bob'] });
    reportMatchResult(t, 'r0m0', 'd');
    expect(t.rounds[0][0].winner).toBeNull();
    expect(getCurrentMatch(t)).not.toBeNull();
    expect(getChampion(t)).toBeNull();
  });
});

describe('serialization', () => {
  it('round-trips a tournament', () => {
    const t = createTournament({ players: ['Ann', 'Bob', 'Cy', 'Dee'], opponentType: 'ai', aiDifficulty: 'hard', timeControl: '300' });
    reportMatchResult(t, 'r0m0', 'a');
    const back = deserializeTournament(serializeTournament(t));
    expect(back.players).toEqual(t.players);
    expect(back.rounds).toEqual(t.rounds);
    expect(back.aiDifficulty).toBe('hard');
    expect(getChampion(back)).toBeNull();
  });

  it('rejects corrupt saves with a typed error', () => {
    expect(() => deserializeTournament('{not json')).toThrow(TournamentDeserializationError);
    expect(() => deserializeTournament(JSON.stringify({ version: 99, tournament: {} }))).toThrow(TournamentDeserializationError);
    expect(() => deserializeTournament(JSON.stringify({ version: 1 }))).toThrow(TournamentDeserializationError);
  });
});

describe('storage', () => {
  it('persists and loads, fails soft on unavailable storage, and clears', () => {
    const mem = new Map();
    const fakeStorage = {
      getItem: (k) => (mem.has(k) ? mem.get(k) : null),
      setItem: (k, v) => mem.set(k, v),
      removeItem: (k) => mem.delete(k)
    };
    const t = createTournament({ players: ['Ann', 'Bob'] });
    expect(saveTournament(t, fakeStorage)).toBe(true);
    expect(loadTournament(fakeStorage).players).toEqual(['Ann', 'Bob']);
    clearSavedTournament(fakeStorage);
    expect(loadTournament(fakeStorage)).toBeNull();
    expect(saveTournament(t, null)).toBe(false);
    expect(loadTournament(null)).toBeNull();
  });

  it('discards a corrupt saved tournament instead of throwing', () => {
    const mem = new Map();
    const fakeStorage = {
      getItem: (k) => (mem.has(k) ? mem.get(k) : null),
      setItem: (k, v) => mem.set(k, v),
      removeItem: (k) => mem.delete(k)
    };
    fakeStorage.setItem('chess88:tournament', '{broken');
    expect(loadTournament(fakeStorage)).toBeNull();
    expect(fakeStorage.getItem('chess88:tournament')).toBeNull();
  });
});
