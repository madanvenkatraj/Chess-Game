/**
 * Leaderboard domain module — pure ranking logic for weekly and all-time boards.
 * Mirrors the tournament.js/training.js pattern: pure functions, no DOM.
 *
 * Data sources (from app.js store, passed in by the caller):
 * - players: [{ code, name, rating, games, wins, losses, draws }] — the local
 *   player profile plus AI seeds and cached friend snapshots.
 * - results: [{ date: ISO string, mode, result: 'win'|'loss'|'draw',
 *               opponentCode?, opponentName? }] — per-game result log with
 *   timestamps (already stored by stats tracking and profile history).
 *
 * Weekly board ranks players by rating points earned in rated results within
 * the trailing 7 days: win = +delta captured at result time is not stored, so
 * points are recomputed as K=32-based expected deltas against the opponent's
 * rating when known; when opponent rating is unknown, a flat scoring table is
 * used (win 12, draw 4, loss 0) so the weekly board stays meaningful.
 */

export const LEADERBOARD_VERSION = 1;
export const LEADERBOARD_KEY = 'chess88.leaderboard.v1';

export const WEEK_POINTS = { win: 12, draw: 4, loss: 0 };
export const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * @typedef {Object} LeaderPlayer
 * @property {string} code    unique player code ('LOCAL' for the local player)
 * @property {string} name    display name
 * @property {number} rating  current Elo rating
 * @property {number} games   total games
 * @property {number} wins    total wins
 * @property {number} losses  total losses
 * @property {number} draws   total draws
 */

/** Aggregate a rating row into the common shape used by both boards. */
export function toLeaderPlayer(p) {
  return {
    code: String(p.code || 'LOCAL'),
    name: String(p.name || 'Player'),
    rating: Math.round(p.rating || 0),
    games: p.games || 0,
    wins: p.wins || 0,
    losses: p.losses || 0,
    draws: p.draws || 0
  };
}

function winRate(p) {
  if (!p.games) return 0;
  return (p.wins + p.draws * 0.5) / p.games;
}

/** All-time board: rating desc, then win-rate, then games played. */
export function allTimeLeaderboard(players) {
  return (players || [])
    .map(toLeaderPlayer)
    .filter((p) => p.games > 0 || p.rating > 0)
    .sort((a, b) =>
      b.rating - a.rating ||
      winRate(b) - winRate(a) ||
      b.games - a.games ||
      a.name.localeCompare(b.name)
    )
    .map((p, i) => ({ rank: i + 1, ...p }));
}

/**
 * Points earned in one result against an opponent of known rating,
 * mirroring the K=32 Elo update used by the profile module.
 * Returns the rating delta for `result` from the player's perspective.
 */
export function weeklyPoints(result, myRating, opponentRating) {
  const k = 32;
  const mine = Math.max(100, Math.round(myRating || 800));
  const opp = Math.max(100, Math.round(opponentRating || mine));
  const expected = 1 / (1 + Math.pow(10, (opp - mine) / 400));
  const score = result === 'win' ? 1 : result === 'draw' ? 0.5 : 0;
  const delta = Math.round(k * (score - expected));
  return Math.max(0, delta); // never negative contributions
}

/**
 * Weekly board: rank players by rating points earned from `results` within
 * the trailing `now - WEEK_MS` window, then by current rating as tiebreak.
 * Results referencing unknown players are attributed to their opponentCode
 * when that player exists in `players`.
 * @param {LeaderPlayer[]} players
 * @param {Array<{date: string, result: string, opponentCode?: string, opponentRating?: number}>} results
 * @param {number} [now] epoch ms override (for tests)
 */
export function weeklyLeaderboard(players, results, now) {
  const cutoff = (typeof now === 'number' ? now : Date.now()) - WEEK_MS;
  const list = (players || []).map(toLeaderPlayer);
  const byCode = new Map(list.map((p) => [p.code, p]));
  const points = new Map(list.map((p) => [p.code, 0]));

  for (const r of results || []) {
    if (!r || typeof r !== 'object') continue;
    const t = Date.parse(r.date);
    if (!Number.isFinite(t) || t < cutoff) continue;
    const result = r.result === 'win' || r.result === 'loss' || r.result === 'draw' ? r.result : null;
    if (!result) continue;
    // The result row belongs to the local player; also credit the opponent.
    const oppCode = r.opponentCode ? String(r.opponentCode) : null;
    const opp = oppCode ? byCode.get(oppCode) : null;
    const oppRating = typeof r.opponentRating === 'number' ? r.opponentRating : opp ? opp.rating : undefined;

    const localCode = 'LOCAL';
    const me = byCode.get(localCode);
    if (me) {
      let pts;
      if (typeof oppRating === 'number' && oppRating > 0) {
        pts = weeklyPoints(result, me.rating, oppRating);
      } else {
        pts = WEEK_POINTS[result];
      }
      points.set(localCode, (points.get(localCode) || 0) + pts);
    }
    // Mirror the result onto the opponent from their perspective.
    if (opp) {
      const oppResult = result === 'win' ? 'loss' : result === 'loss' ? 'win' : 'draw';
      const myRating = typeof oppRating === 'number' ? oppRating : me ? me.rating : undefined;
      let pts;
      if (typeof myRating === 'number' && myRating > 0 && me) {
        pts = weeklyPoints(oppResult, opp.rating, myRating);
      } else {
        pts = WEEK_POINTS[oppResult];
      }
      points.set(opp.code, (points.get(opp.code) || 0) + pts);
    }
  }

  return list
    .map((p) => ({ ...p, weekPoints: points.get(p.code) || 0 }))
    .sort((a, b) =>
      b.weekPoints - a.weekPoints ||
      b.rating - a.rating ||
      a.name.localeCompare(b.name)
    )
    .map((p, i) => ({ rank: i + 1, ...p }));
}

// ---------- Persistence for board preferences (window length etc.) ----------

export function serializePrefs(prefs) {
  return JSON.stringify({ version: LEADERBOARD_VERSION, ...(prefs || {}) });
}

export function deserializePrefs(json) {
  try {
    const data = JSON.parse(json);
    if (!data || data.version !== LEADERBOARD_VERSION) return { scope: 'week' };
    return { scope: data.scope === 'all' ? 'all' : 'week' };
  } catch (e) {
    return { scope: 'week' };
  }
}

export function savePrefs(prefs, storage) {
  const ls = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
  if (!ls) return false;
  try {
    ls.setItem(LEADERBOARD_KEY, serializePrefs(prefs));
    return true;
  } catch (e) {
    return false;
  }
}

export function loadPrefs(storage) {
  const ls = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
  if (!ls) return { scope: 'week' };
  try {
    const raw = ls.getItem(LEADERBOARD_KEY);
    return raw ? deserializePrefs(raw) : { scope: 'week' };
  } catch (e) {
    return { scope: 'week' };
  }
}
