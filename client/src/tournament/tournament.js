/**
 * Tournament domain module — pure, UI-independent single-elimination bracket
 * logic plus versioned persistence. Mirrors the patterns of
 * src/state/serialize.ts (versioned JSON, typed deserialization errors) and
 * src/persistence/storage.ts (guarded localStorage, fail-soft on private mode).
 *
 * Model:
 * - A tournament holds ROUNDS of MATCHES. Each match has two slots; a slot is
 *   either a participant name or `null` when the slot is still unfilled
 *   (waiting for an earlier round) or empty due to a bye.
 * - Byes: when the player count is not a power of two, the field is padded to
 *   the next power of two with BYE placeholders. Any match containing a BYE is
 *   auto-resolved immediately at creation (and after each round resolves),
 *   advancing the real participant without playing.
 * - Results: only decisive results advance the bracket ('w' | 'b'). A draw
 *   ('d') leaves the match open for a replay.
 */

export const TOURNAMENT_VERSION = 1;

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 16;

/** Placeholder name for an unplayed bye slot. */
export const BYE = '(bye)';

/** Thrown when a serialized tournament cannot be understood. */
export class TournamentDeserializationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TournamentDeserializationError';
  }
}

/**
 * @typedef {Object} TournamentMatch
 * @property {string} id            Stable id like 'r0m1'.
 * @property {string|null} a        First slot: participant name or null (unfilled).
 * @property {string|null} b        Second slot.
 * @property {string|null} winner   'a' | 'b' | null.
 */

/**
 * @typedef {Object} Tournament
 * @property {number} version
 * @property {string} name
 * @property {string[]} players      Real participant names, in seeding order.
 * @property {TournamentMatch[][]} rounds
 * @property {string|null} opponentType 'human' | 'ai' — how non-player slots behave.
 * @property {string} aiDifficulty        'easy' | 'medium' | 'hard'
 * @property {string} timeControl         'none' | '180' | '300' | '600' | '1800'
 * @property {string} createdAt           ISO date.
 */

function nextPowerOfTwo(n) {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

function matchId(roundIndex, matchIndex) {
  return 'r' + roundIndex + 'm' + matchIndex;
}

function makeMatch(roundIndex, matchIndex, a, b) {
  return { id: matchId(roundIndex, matchIndex), a: a, b: b, winner: null };
}

/**
 * Create a single-elimination tournament. Participants with odd indices get
 * first-round byes when the field is padded (standard seeding so the human
 * player, listed first, never meets a bye twice).
 *
 * @param {Object} options
 * @param {string[]} options.players  2..16 unique names; index 0 is seeded first.
 * @param {string} [options.name]     Display name.
 * @param {string} [options.opponentType] 'human' | 'ai'
 * @param {string} [options.aiDifficulty]
 * @param {string} [options.timeControl]
 * @returns {Tournament}
 */
export function createTournament(options) {
  var players = (options && options.players || []).map(function (p) { return String(p).trim(); })
    .filter(function (p) { return p.length > 0; });
  if (players.length < MIN_PLAYERS) {
    throw new Error('A tournament needs at least ' + MIN_PLAYERS + ' players');
  }
  if (players.length > MAX_PLAYERS) {
    throw new Error('A tournament supports at most ' + MAX_PLAYERS + ' players');
  }
  var seen = {};
  for (var i = 0; i < players.length; i++) {
    if (seen[players[i]]) throw new Error('Duplicate player name: ' + players[i]);
    seen[players[i]] = true;
  }

  var size = nextPowerOfTwo(players.length);
  var slots = players.slice();
  while (slots.length < size) slots.push(null); // null = bye slot

  var firstRound = [];
  for (var m = 0; m < size / 2; m++) {
    // Pair top half against mirrored bottom half for balanced seeding.
    var a = slots[m];
    var b = slots[size - 1 - m];
    firstRound.push(makeMatch(0, m, a, b));
  }

  // Pre-build every round so the bracket shape is fixed from day one: a
  // 4-player event has rounds of 2/1 matches; an 8-player event has 4/2/1.
  var rounds = [firstRound];
  var remaining = size / 2;
  while (remaining > 1) {
    remaining = remaining / 2;
    var next = [];
    for (var n = 0; n < remaining; n++) next.push(makeMatch(rounds.length, n, null, null));
    rounds.push(next);
  }
  resolveByes(rounds);

  return {
    version: TOURNAMENT_VERSION,
    name: (options && options.name) || 'Tournament',
    players: players,
    rounds: rounds,
    opponentType: (options && options.opponentType) === 'ai' ? 'ai' : 'human',
    aiDifficulty: (options && options.aiDifficulty) || 'medium',
    timeControl: (options && options.timeControl) || '600',
    createdAt: new Date().toISOString()
  };
}

/**
 * Auto-resolve any match whose opponent is a bye (null slot in round 0) or an
 * already-eliminated/unfilled walkover, then cascade the winners into the next
 * round, creating round objects as needed. Pure: mutates only the passed array.
 */
function resolveByes(rounds) {
  for (var r = 0; r < rounds.length; r++) {
    var round = rounds[r];
    var advanced = [];
    for (var m = 0; m < round.length; m++) {
      var match = round[m];
      if (match.a !== null && match.b === null && match.winner === null) {
        match.winner = 'a';
      } else if (match.a === null && match.b !== null && match.winner === null) {
        match.winner = 'b';
      }
      if (match.winner) advanced.push(match.winner === 'a' ? match.a : match.b);
    }
    if (rounds.length === r + 1 && advanced.length > 1) {
      var next = [];
      for (var n = 0; n < advanced.length / 2; n++) {
        next.push(makeMatch(r + 1, n, null, null));
      }
      rounds.push(next);
    }
    if (advanced.length > 0 && r + 1 < rounds.length) {
      var nextRound = rounds[r + 1];
      for (var k = 0; k < advanced.length; k++) {
        var target = nextRound[Math.floor(k / 2)];
        if (k % 2 === 0) target.a = advanced[k];
        else target.b = advanced[k];
      }
    }
  }
}

/** Winner name of a match, or null when undecided. */
export function matchWinnerName(t, match) {
  if (!match || match.winner === null) return null;
  return match.winner === 'a' ? match.a : match.b;
}

/** The next match that still needs a result, or null when the event is done. */
export function getCurrentMatch(t) {
  for (var r = 0; r < t.rounds.length; r++) {
    var round = t.rounds[r];
    for (var m = 0; m < round.length; m++) {
      var match = round[m];
      if (match.a !== null && match.b !== null && match.winner === null) return match;
    }
  }
  return null;
}

/** Champion name when every match is decided, else null. */
export function getChampion(t) {
  var last = t.rounds[t.rounds.length - 1];
  if (last.length !== 1 || last[0].winner === null) return null;
  return matchWinnerName(t, last[0]);
}

/**
 * Record a decisive result ('a' or 'b' winner) or a draw ('d', which leaves
 * the match open for replay). Recomputes bracket progression afterwards.
 *
 * @returns {Tournament} the same tournament object, for chaining.
 */
export function reportMatchResult(t, matchIdString, result) {
  if (result !== 'a' && result !== 'b' && result !== 'd') {
    throw new Error('Invalid match result: ' + String(result));
  }
  var match = findMatch(t, matchIdString);
  if (!match) throw new Error('Unknown match: ' + matchIdString);
  if (match.a === null || match.b === null) {
    throw new Error('Cannot report a result for an unfilled match');
  }
  if (result === 'd') {
    match.winner = null; // draw: replay the match
    return t;
  }
  match.winner = result;
  recomputeBracket(t);
  return t;
}

/**
 * Recompute the whole bracket from round 0. Idempotent, so it can be run after
 * any change (load, manual correction) without double-counting.
 */
export function recomputeBracket(t) {
  var rounds = t.rounds;
  // Reset every downstream slot, then rebuild — this makes the pass idempotent
  // (a replayed or corrected match clears its old path through the bracket).
  for (var r = 1; r < rounds.length; r++) {
    var round = rounds[r];
    for (var m = 0; m < round.length; m++) {
      round[m].a = null;
      round[m].b = null;
    }
  }
  // Propagate round by round, auto-resolving byes as we go.
  for (var r2 = 0; r2 < rounds.length; r2++) {
    var roundNow = rounds[r2];
    var winners = [];
    for (var m2 = 0; m2 < roundNow.length; m2++) {
      var match = roundNow[m2];
      // Round 0 null slots are byes from field padding — walkovers. In later
      // rounds a null slot simply waits for its feeder match to decide.
      if (match.winner === null && r2 === 0) {
        if (match.a !== null && match.b === null) match.winner = 'a';
        else if (match.a === null && match.b !== null) match.winner = 'b';
      }
      if (match.a === null || match.b === null) continue; // bye or unfilled
      var w = matchWinnerName(t, match);
      if (w !== null) winners.push(w);
    }
    if (r2 + 1 < rounds.length) {
      var nextRound = rounds[r2 + 1];
      for (var k = 0; k < winners.length; k++) {
        var target = nextRound[Math.floor(k / 2)];
        if (target) {
          if (k % 2 === 0) target.a = winners[k];
          else target.b = winners[k];
        }
      }
    }
  }
}

function findMatch(t, id) {
  for (var r = 0; r < t.rounds.length; r++) {
    var round = t.rounds[r];
    for (var m = 0; m < round.length; m++) {
      if (round[m].id === id) return round[m];
    }
  }
  return null;
}

/** Round display names: Final, Semi-final, Quarter-final, then Round N. */
export function roundName(t, roundIndex) {
  var matchesInRound = t.rounds[roundIndex].length;
  if (matchesInRound === 1) return 'Final';
  if (matchesInRound === 2) return 'Semi-finals';
  if (matchesInRound === 4) return 'Quarter-finals';
  return 'Round ' + (roundIndex + 1);
}

// ---------- Serialization (versioned, mirrors serialize.ts) ----------

/** Serialize a tournament to JSON. Throws on non-object input. */
export function serializeTournament(t) {
  if (!t || typeof t !== 'object') throw new Error('Cannot serialize a non-tournament');
  return JSON.stringify({ version: TOURNAMENT_VERSION, tournament: t });
}

/**
 * Parse a serialized tournament. Throws TournamentDeserializationError on bad
 * input so callers can fail soft.
 */
export function deserializeTournament(json) {
  var parsed;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    throw new TournamentDeserializationError('Saved tournament is not valid JSON');
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new TournamentDeserializationError('Saved tournament has unexpected shape');
  }
  if (parsed.version !== TOURNAMENT_VERSION) {
    throw new TournamentDeserializationError('Unsupported tournament version: ' + String(parsed.version));
  }
  var t = parsed.tournament;
  if (!t || typeof t !== 'object') {
    throw new TournamentDeserializationError('Saved tournament payload missing');
  }
  if (!Array.isArray(t.players) || t.players.length < MIN_PLAYERS || t.players.length > MAX_PLAYERS) {
    throw new TournamentDeserializationError('Saved tournament has invalid players');
  }
  if (!Array.isArray(t.rounds) || t.rounds.length === 0) {
    throw new TournamentDeserializationError('Saved tournament has no rounds');
  }
  for (var r = 0; r < t.rounds.length; r++) {
    var round = t.rounds[r];
    if (!Array.isArray(round)) {
      throw new TournamentDeserializationError('Saved tournament round is not a list');
    }
    for (var m = 0; m < round.length; m++) {
      var match = round[m];
      if (!match || typeof match.id !== 'string' || !('a' in match) || !('b' in match)) {
        throw new TournamentDeserializationError('Saved tournament match is malformed');
      }
    }
  }
  return t;
}

// ---------- Storage (guarded localStorage, mirrors storage.ts) ----------

var STORAGE_KEY = 'chess88:tournament';

/**
 * Persist a tournament. Returns false when storage is unavailable or the write
 * failed — the caller keeps the in-memory state either way.
 */
export function saveTournament(t, storage) {
  var store = storage !== undefined ? storage
    : (typeof window !== 'undefined' && window.localStorage ? window.localStorage : null);
  if (!store) return false;
  try {
    store.setItem(STORAGE_KEY, serializeTournament(t));
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Load the saved tournament, or null when none exists / the save is unusable
 * (corrupt saves are discarded rather than thrown mid-game).
 */
export function loadTournament(storage) {
  var store = storage !== undefined ? storage
    : (typeof window !== 'undefined' && window.localStorage ? window.localStorage : null);
  if (!store) return null;
  var raw = null;
  try {
    raw = store.getItem(STORAGE_KEY);
  } catch (e) {
    return null;
  }
  if (!raw) return null;
  try {
    return deserializeTournament(raw);
  } catch (e) {
    try { store.removeItem(STORAGE_KEY); } catch (e2) { /* nothing to do */ }
    return null;
  }
}

/** Remove the saved tournament. */
export function clearSavedTournament(storage) {
  var store = storage !== undefined ? storage
    : (typeof window !== 'undefined' && window.localStorage ? window.localStorage : null);
  if (!store) return;
  try { store.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ }
}
