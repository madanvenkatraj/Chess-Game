/**
 * Friends domain module — pure, UI-independent friend-list logic.
 * Mirrors the tournament.js/training.js pattern: pure functions, versioned
 * persistence helpers, guarded localStorage, fail-soft on private mode.
 *
 * Model:
 * - A friend is identified by a unique player code (8 chars, e.g. 'AB12CD34')
 *   plus a display username. Codes are the stable identity; usernames can
 *   collide between different players, codes cannot.
 * - Challenge: this is a local/offline-first game, so "challenge a friend"
 *   records a challenge record the caller (app.js) resolves — e.g. start a
 *   local hotseat/online room game against that friend.
 */

export const FRIENDS_VERSION = 1;
export const FRIENDS_KEY = 'chess88.friends.v1';

export const CODE_RE = /^[A-Z0-9]{8}$/;
export const MAX_FRIENDS = 50;
export const MAX_NAME = 24;

/** Thrown when serialized friend data cannot be understood. */
export class FriendsDeserializationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'FriendsDeserializationError';
  }
}

/** Generate a fresh unique player code (uppercase letters + digits). */
export function generatePlayerCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/1, O/0 lookalikes
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

/** Normalize user input into a valid code, or null when unparseable. */
export function normalizeCode(raw) {
  const s = String(raw || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  return CODE_RE.test(s) ? s : null;
}

/** Sanitize a username: word chars/spaces/hyphens/apostrophes, cap length. */
export function sanitizeUsername(raw) {
  const s = String(raw || '').replace(/[^\w \-']/g, '').trim();
  return (s || 'Player').slice(0, MAX_NAME);
}

/**
 * @typedef {Object} Friend
 * @property {string} code    8-char unique player code.
 * @property {string} name    Display username.
 * @property {string} addedAt ISO date added.
 * @property {number} rating  Last-known rating snapshot (0 = unknown).
 */

/** Add a friend. Throws on invalid code, duplicate, or full list. Pure. */
export function addFriend(friends, input) {
  if (!Array.isArray(friends)) throw new Error('friends must be an array');
  const code = typeof input.code === 'string' ? input.code.trim().toUpperCase() : '';
  if (!CODE_RE.test(code)) throw new Error('Player code must be 8 letters/digits.');
  if (friends.some((f) => f.code === code)) {
    throw new Error('Already friends with code ' + code + '.');
  }
  if (friends.length >= MAX_FRIENDS) throw new Error('Friend list is full (' + MAX_FRIENDS + ' max).');
  const name = sanitizeUsername(input.name);
  const rating = typeof input.rating === 'number' && input.rating > 0 ? Math.round(input.rating) : 0;
  const out = friends.slice();
  out.push({ code, name, rating, addedAt: new Date().toISOString() });
  return out;
}

/** Remove a friend by code. Returns a new array; throws when not found. */
export function removeFriend(friends, code) {
  const c = String(code || '').toUpperCase();
  const idx = friends.findIndex((f) => f.code === c);
  if (idx === -1) throw new Error('Friend not found.');
  return friends.filter((f) => f.code !== c);
}

/** Find a friend by code (case-insensitive on input). */
export function findFriend(friends, code) {
  const c = String(code || '').toUpperCase();
  return friends.find((f) => f.code === c) || null;
}

/** Case-insensitive substring search over names and codes; empty = all. */
export function searchFriends(friends, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return friends.slice();
  return friends.filter(
    (f) => f.name.toLowerCase().includes(q) || f.code.toLowerCase().includes(q)
  );
}

/** Update a friend's cached rating snapshot (used when a rated game ends). */
export function updateFriendRating(friends, code, rating) {
  if (typeof rating !== 'number' || rating <= 0) return friends.slice();
  return friends.map((f) =>
    f.code === String(code).toUpperCase() ? { ...f, rating: Math.round(rating) } : f
  );
}

/** Create a challenge record for a friend. Pure — caller acts on it. */
export function createChallenge(friend, myName) {
  if (!friend) throw new Error('Cannot challenge an unknown friend.');
  return {
    friendCode: friend.code,
    friendName: friend.name,
    challenger: sanitizeUsername(myName),
    createdAt: new Date().toISOString()
  };
}

/** Total games / W/L snapshot for a friend (0 when unset). */
export function friendStats(friend) {
  return { games: friend.games || 0, wins: friend.wins || 0, losses: friend.losses || 0 };
}

// ---------- Persistence (guarded localStorage, fail-soft) ----------

export function serializeFriends(friends) {
  return JSON.stringify({ version: FRIENDS_VERSION, friends: friends || [] });
}

export function deserializeFriends(json) {
  let data;
  try {
    data = JSON.parse(json);
  } catch (e) {
    throw new FriendsDeserializationError('Corrupt friends data');
  }
  if (!data || data.version !== FRIENDS_VERSION || !Array.isArray(data.friends)) {
    throw new FriendsDeserializationError('Unsupported friends data');
  }
  // Drop malformed rows instead of failing hard.
  return data.friends.filter((f) => f && typeof f.code === 'string' && CODE_RE.test(f.code));
}

export function saveFriends(friends, storage) {
  const ls = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
  if (!ls) return false; // private mode — keep playing without persistence
  try {
    ls.setItem(FRIENDS_KEY, serializeFriends(friends));
    return true;
  } catch (e) {
    return false;
  }
}

export function loadFriends(storage) {
  const ls = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
  if (!ls) return [];
  try {
    const raw = ls.getItem(FRIENDS_KEY);
    if (!raw) return [];
    return deserializeFriends(raw);
  } catch (e) {
    return []; // fail-soft
  }
}

export function clearFriends(storage) {
  const ls = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
  if (!ls) return;
  try {
    ls.removeItem(FRIENDS_KEY);
  } catch (e) { /* fail-soft */ }
}
