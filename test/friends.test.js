// Friends domain module tests.
import { describe, it, expect } from 'vitest';
import {
  CODE_RE, generatePlayerCode, normalizeCode, sanitizeUsername,
  addFriend, removeFriend, findFriend, searchFriends, updateFriendRating,
  createChallenge, friendStats, serializeFriends, deserializeFriends,
  FriendsDeserializationError, saveFriends, loadFriends
} from '../client/src/friends/friends.js';

const F = (code, name, rating = 0) => ({ code, name, rating, addedAt: '2026-01-01T00:00:00Z' });

describe('player codes', () => {
  it('generates valid 8-char codes', () => {
    for (let i = 0; i < 20; i++) {
      expect(generatePlayerCode()).toMatch(CODE_RE);
    }
  });
  it('normalizes sloppy input', () => {
    expect(normalizeCode(' ab12cd34 ')).toBe('AB12CD34');
    expect(normalizeCode('ab-12cd34')).toBe('AB12CD34');
    expect(normalizeCode('short')).toBeNull();
    expect(normalizeCode('ab12cd34x')).toBeNull();
  });
  it('sanitizes usernames', () => {
    expect(sanitizeUsername('  Ada <script> L "  ')).toBe('Ada script L');
    expect(sanitizeUsername('')).toBe('Player');
    expect(sanitizeUsername('x'.repeat(40))).toHaveLength(24);
  });
});

describe('add / remove / find / search', () => {
  it('adds and deduplicates by code', () => {
    let list = [];
    list = addFriend(list, { code: 'AB12CD34', name: 'Ada' });
    expect(list).toHaveLength(1);
    expect(() => addFriend(list, { code: 'ab12cd34', name: 'X' })).toThrow(/Already friends/);
    expect(() => addFriend(list, { code: 'BAD' })).toThrow(/8 letters/);
    expect(() => addFriend(list, { code: 'ZZ99ZZ99', name: 'Ok' })).not.toThrow();
  });
  it('removes by code and throws when missing', () => {
    const list = [F('AB12CD34', 'Ada')];
    expect(removeFriend(list, 'ab12cd34')).toHaveLength(0);
    expect(() => removeFriend(list, 'ZZ99ZZ99')).toThrow(/not found/i);
  });
  it('finds case-insensitively', () => {
    const list = [F('AB12CD34', 'Ada')];
    expect(findFriend(list, 'ab12cd34').name).toBe('Ada');
    expect(findFriend(list, 'ZZ99ZZ99')).toBeNull();
  });
  it('searches names and codes, empty query = all', () => {
    const list = [F('AB12CD34', 'Ada'), F('ZZ99ZZ99', 'Grace')];
    expect(searchFriends(list, 'ada')).toHaveLength(1);
    expect(searchFriends(list, 'ZZ99')).toHaveLength(1);
    expect(searchFriends(list, '')).toHaveLength(2);
  });
  it('updates rating snapshots only for valid ratings', () => {
    let list = [F('AB12CD34', 'Ada', 800)];
    list = updateFriendRating(list, 'AB12CD34', 913.4);
    expect(list[0].rating).toBe(913);
    expect(updateFriendRating(list, 'AB12CD34', -5)[0].rating).toBe(913);
    expect(updateFriendRating(list, 'ZZ99ZZ99', 1000)).toHaveLength(1);
  });
});

describe('challenge + stats', () => {
  it('creates a challenge record', () => {
    const c = createChallenge(F('AB12CD34', 'Ada'), 'Bo');
    expect(c).toMatchObject({ friendCode: 'AB12CD34', friendName: 'Ada', challenger: 'Bo' });
    expect(() => createChallenge(null, 'Bo')).toThrow();
  });
  it('reads stats with defaults', () => {
    expect(friendStats({})).toEqual({ games: 0, wins: 0, losses: 0 });
  });
});

describe('persistence', () => {
  it('round-trips through serialize/deserialize', () => {
    const list = [F('AB12CD34', 'Ada', 800)];
    const back = deserializeFriends(serializeFriends(list));
    expect(back).toHaveLength(1);
    expect(back[0]).toMatchObject({ code: 'AB12CD34', name: 'Ada', rating: 800 });
  });
  it('throws typed errors on corrupt data', () => {
    expect(() => deserializeFriends('{nope')).toThrow(FriendsDeserializationError);
    expect(() => deserializeFriends('{"version":2,"friends":[]}')).toThrow(FriendsDeserializationError);
  });
  it('drops malformed rows but keeps valid ones', () => {
    const raw = serializeFriends([F('AB12CD34', 'Ada')]);
    const data = JSON.parse(raw);
    data.friends.push({ code: 'nope', name: 'Bad' });
    const back = deserializeFriends(JSON.stringify(data));
    expect(back).toHaveLength(1);
  });
  it('fails soft against a broken storage', () => {
    const bad = { getItem() { throw new Error('boom'); }, setItem() { throw new Error('boom'); }, removeItem() {} };
    expect(loadFriends(bad)).toEqual([]);
    expect(saveFriends([F('AB12CD34', 'Ada')], bad)).toBe(false);
  });
  it('persists through saveFriends/loadFriends with a stub storage', () => {
    const mem = (() => { const m = {}; return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: (k) => { delete m[k]; } }; })();
    saveFriends([F('AB12CD34', 'Ada')], mem);
    expect(loadFriends(mem)).toHaveLength(1);
  });
});
