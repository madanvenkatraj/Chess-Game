// Leaderboard domain module tests.
import { describe, it, expect } from 'vitest';
import {
  allTimeLeaderboard, weeklyLeaderboard, weeklyPoints, toLeaderPlayer,
  serializePrefs, deserializePrefs, loadPrefs, WEEK_MS
} from '../client/src/leaderboard/leaderboard.js';

const P = (code, name, rating, games, wins, losses, draws = 0) =>
  ({ code, name, rating, games, wins, losses, draws });

const NOW = Date.parse('2026-09-26T12:00:00Z');
const daysAgo = (n) => new Date(NOW - n * 24 * 3600 * 1000).toISOString();

const PLAYERS = [
  P('LOCAL', 'You', 1100, 10, 6, 3, 1),
  P('A1B2C3D4', 'Ada', 1250, 8, 5, 3, 0),
  P('E5F6G7H8', 'Grace', 990, 12, 4, 7, 1)
];

describe('all-time leaderboard', () => {
  it('sorts by rating desc with rank', () => {
    const rows = allTimeLeaderboard(PLAYERS);
    expect(rows.map((r) => r.code)).toEqual(['A1B2C3D4', 'LOCAL', 'E5F6G7H8']);
    expect(rows[0].rank).toBe(1);
  });
  it('uses win rate then games as tiebreakers', () => {
    const tied = [
      P('AAAA1111', 'Low', 1000, 10, 2, 8, 0),
      P('BBBB2222', 'High', 1000, 10, 6, 4, 0),
      P('CCCC3333', 'Most', 1000, 20, 10, 10, 0)
    ];
    const rows = allTimeLeaderboard(tied);
    // High (60%) > Most (50%) > Low (20%)
    expect(rows.map((r) => r.name)).toEqual(['High', 'Most', 'Low']);
  });
  it('excludes unrated players with no games', () => {
    const rows = allTimeLeaderboard([...PLAYERS, P('ZZZZ9999', 'New', 0, 0, 0, 0)]);
    expect(rows.find((r) => r.code === 'ZZZZ9999')).toBeUndefined();
  });
  it('handles empty input', () => {
    expect(allTimeLeaderboard([])).toEqual([]);
    expect(allTimeLeaderboard(null)).toEqual([]);
  });
});

describe('weekly points', () => {
  it('never negative; stronger opponent means more points', () => {
    const easy = weeklyPoints('win', 1200, 1000);
    const hard = weeklyPoints('win', 1000, 1400);
    expect(easy).toBeGreaterThanOrEqual(0);
    expect(hard).toBeGreaterThan(easy);
    expect(weeklyPoints('loss', 1200, 1000)).toBe(0);
    expect(weeklyPoints('draw', 1200, 1200)).toBe(0); // draw vs equal = 0 Elo delta
    expect(weeklyPoints('draw', 1000, 1400)).toBeGreaterThan(0); // draw vs stronger = positive
  });
});

describe('weekly leaderboard', () => {
  it('accumulates points for the local player within the window', () => {
    const results = [
      { date: daysAgo(1), result: 'win', opponentCode: 'A1B2C3D4', opponentRating: 1250 },
      { date: daysAgo(2), result: 'draw', opponentCode: 'E5F6G7H8', opponentRating: 990 }
    ];
    const rows = weeklyLeaderboard(PLAYERS, results, NOW);
    const me = rows.find((r) => r.code === 'LOCAL');
    expect(me.weekPoints).toBeGreaterThan(0);
  });
  it('ignores results older than a week', () => {
    const results = [{ date: daysAgo(8), result: 'win', opponentRating: 1250 }];
    const rows = weeklyLeaderboard(PLAYERS, results, NOW);
    expect(rows.find((r) => r.code === 'LOCAL').weekPoints).toBe(0);
  });
  it('mirrors results onto the opponent', () => {
    const results = [{ date: daysAgo(1), result: 'win', opponentCode: 'A1B2C3D4', opponentRating: 1250 }];
    const rows = weeklyLeaderboard(PLAYERS, results, NOW);
    // Opponent of a loss gets the flat loss value (0) at minimum, not negative.
    const ada = rows.find((r) => r.code === 'A1B2C3D4');
    expect(ada.weekPoints).toBeGreaterThanOrEqual(0);
    expect(rows.find((r) => r.code === 'LOCAL').weekPoints).toBeGreaterThan(ada.weekPoints);
  });
  it('uses flat scoring when opponent rating unknown', () => {
    const results = [{ date: daysAgo(1), result: 'win' }];
    const rows = weeklyLeaderboard(PLAYERS, results, NOW);
    expect(rows.find((r) => r.code === 'LOCAL').weekPoints).toBe(12);
  });
  it('skips malformed result rows', () => {
    const results = [
      { date: 'not-a-date', result: 'win' },
      { date: daysAgo(1), result: 'banana' },
      null
    ];
    const rows = weeklyLeaderboard(PLAYERS, results, NOW);
    expect(rows.find((r) => r.code === 'LOCAL').weekPoints).toBe(0);
  });
  it('ranks by points then rating', () => {
    const results = [
      { date: daysAgo(1), result: 'win', opponentRating: 2000 },
      { date: daysAgo(1), result: 'win', opponentRating: 2000 }
    ];
    const rows = weeklyLeaderboard(PLAYERS, results, NOW);
    expect(rows[0].code).toBe('LOCAL');
    expect(rows[0].rank).toBe(1);
  });
  it('window boundary is exactly WEEK_MS', () => {
    const justInside = [{ date: new Date(NOW - WEEK_MS + 1000).toISOString(), result: 'win' }];
    const justOutside = [{ date: new Date(NOW - WEEK_MS - 1000).toISOString(), result: 'win' }];
    expect(weeklyLeaderboard(PLAYERS, justInside, NOW).find((r) => r.code === 'LOCAL').weekPoints).toBe(12);
    expect(weeklyLeaderboard(PLAYERS, justOutside, NOW).find((r) => r.code === 'LOCAL').weekPoints).toBe(0);
  });
});

describe('prefs persistence', () => {
  it('round-trips and defaults safely', () => {
    expect(deserializePrefs(serializePrefs({ scope: 'all' }))).toEqual({ scope: 'all' });
    expect(deserializePrefs('junk')).toEqual({ scope: 'week' });
    const mem = (() => { const m = {}; return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: (k) => { delete m[k]; } }; })();
    expect(loadPrefs(mem).scope).toBe('week');
  });
});
