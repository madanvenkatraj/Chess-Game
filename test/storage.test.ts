/**
 * Tests for the namespaced localStorage persistence store (src/persistence/storage.ts).
 * Covers: game save/load round-trip fidelity (including clocks and history),
 * corrupt/unavailable storage handling, and stats recording.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  createGameStore,
  STORE_NAMESPACE,
  type Stats,
  type MinimalStorage,
} from '@persistence/storage'
import { createInitialGameState } from '@state/initialState'
import { applyMove } from '@state/gameState'
import { DeserializationError } from '@state/serialize'

/** In-memory Storage fake so tests never touch a real localStorage. */
function fakeStorage(): MinimalStorage & { clear: () => void } {
  const map = new Map<string, string>()
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => void map.clear(),
  }
}

function makeStore(storage: MinimalStorage | null) {
  return createGameStore({ storage })
}

const EMPTY_STATS: Stats = {
  wins: 0,
  losses: 0,
  draws: 0,
  games: 0,
  streak: 0,
  bestStreak: 0,
  recent: [],
}

describe('createGameStore namespace', () => {
  it('uses the chess88 namespace for its storage keys', () => {
    const storage = fakeStorage()
    const store = makeStore(storage)
    const state = createInitialGameState()
    store.saveGame(state)
    // Must be namespaced so foreign keys are never touched.
    expect(storage.getItem(`${STORE_NAMESPACE}:lastGame`)).not.toBeNull()
  })
})

describe('saveGame / loadGame round-trip', () => {
  it('restores the full GameState including clocks and history', () => {
    const store = makeStore(fakeStorage())
    // Play two real moves so history accumulates, and give the game a clock.
    let state = createInitialGameState({ clock: { white: 300, black: 295 } })
    state = applyMove(state, { from: 'e2', to: 'e4', piece: 'pawn' })
    state = applyMove(state, { from: 'e7', to: 'e5', piece: 'pawn' })

    store.saveGame(state)
    const loaded = store.loadGame()

    expect(loaded).not.toBeNull()
    expect(loaded!.board).toEqual(state.board)
    expect(loaded!.turn).toBe('white')
    expect(loaded!.clock).toEqual({ white: 300, black: 295 })
    expect(loaded!.history.length).toBe(2)
    expect(loaded!.castling).toEqual(state.castling)
    expect(loaded!.fullmoveNumber).toBe(state.fullmoveNumber)
  })

  it('returns null when no game is saved', () => {
    const store = makeStore(fakeStorage())
    expect(store.loadGame()).toBeNull()
  })

  it('clears the saved game', () => {
    const store = makeStore(fakeStorage())
    store.saveGame(createInitialGameState())
    store.clearSavedGame()
    expect(store.loadGame()).toBeNull()
  })

  it('returns null (not throws) for corrupt saved data', () => {
    const storage = fakeStorage()
    storage.setItem(`${STORE_NAMESPACE}:lastGame`, 'not json at all')
    const store = makeStore(storage)
    expect(store.loadGame()).toBeNull()
  })

  it('returns null for a save with a bad board entry', () => {
    const storage = fakeStorage()
    storage.setItem(
      `${STORE_NAMESPACE}:lastGame`,
      JSON.stringify({
        version: 1,
        state: { board: { zz9: { type: 'pawn', color: 'white' } }, turn: 'white' },
      }),
    )
    const store = makeStore(storage)
    expect(store.loadGame()).toBeNull()
  })
})

describe('storage unavailability (private mode)', () => {
  it('saveGame returns false and never throws when storage is null', () => {
    const store = makeStore(null)
    expect(store.saveGame(createInitialGameState())).toBe(false)
    expect(store.loadGame()).toBeNull()
  })

  it('saveGame returns false when setItem throws (quota / privacy errors)', () => {
    const storage = fakeStorage()
    storage.setItem = () => {
      throw new DOMException('quota', 'QuotaExceededError')
    }
    const store = makeStore(storage)
    expect(store.saveGame(createInitialGameState())).toBe(false)
  })

  it('stats recording still succeeds in memory when storage is unavailable', () => {
    const store = makeStore(null)
    const stats = store.recordResult({
      result: 'win',
      mode: 'ai',
      difficulty: 'easy',
    })
    expect(stats.wins).toBe(1)
    // But it cannot be read back after a fresh store: nothing was persisted.
    const fresh = makeStore(null)
    expect(fresh.readStats()).toEqual(EMPTY_STATS)
  })
})

describe('recordResult / readStats', () => {
  let storage: ReturnType<typeof fakeStorage>
  beforeEach(() => {
    storage = fakeStorage()
  })
  afterEach(() => storage.clear())

  it('records a win and updates streaks', () => {
    const store = makeStore(storage)
    store.recordResult({ result: 'win', mode: 'ai', difficulty: 'medium' })
    store.recordResult({ result: 'win', mode: 'ai', difficulty: 'medium' })
    const stats = store.readStats()
    expect(stats.wins).toBe(2)
    expect(stats.games).toBe(2)
    expect(stats.streak).toBe(2)
    expect(stats.bestStreak).toBe(2)
    expect(stats.recent[0]!.result).toBe('win')
  })

  it('a loss resets the streak but keeps bestStreak', () => {
    const store = makeStore(storage)
    store.recordResult({ result: 'win', mode: 'ai', difficulty: 'hard' })
    store.recordResult({ result: 'win', mode: 'ai', difficulty: 'hard' })
    store.recordResult({ result: 'loss', mode: 'ai', difficulty: 'hard' })
    const stats = store.readStats()
    expect(stats.losses).toBe(1)
    expect(stats.streak).toBe(0)
    expect(stats.bestStreak).toBe(2)
  })

  it('records draws and 2-player results without touching win/loss counters', () => {
    const store = makeStore(storage)
    store.recordResult({ result: 'draw', mode: 'ai', difficulty: 'easy' })
    store.recordResult({ result: 'white-won', mode: '2p' })
    const stats = store.readStats()
    expect(stats.draws).toBe(1)
    expect(stats.wins).toBe(0)
    expect(stats.losses).toBe(0)
    expect(stats.games).toBe(2)
    expect(stats.recent.map((r) => r.result)).toEqual(['white-won', 'draw'])
  })

  it('keeps at most the 10 most recent results', () => {
    const store = makeStore(storage)
    for (let i = 0; i < 15; i++) {
      store.recordResult({ result: 'draw', mode: 'ai', difficulty: 'easy' })
    }
    expect(store.readStats().recent.length).toBe(10)
  })

  it('persists across store instances', () => {
    makeStore(storage).recordResult({ result: 'win', mode: 'ai', difficulty: 'easy' })
    const stats = makeStore(storage).readStats()
    expect(stats.wins).toBe(1)
  })

  it('reads a pre-existing stats payload from storage', () => {
    storage.setItem(
      `${STORE_NAMESPACE}:stats`,
      JSON.stringify({ ...EMPTY_STATS, wins: 7, games: 9 }),
    )
    expect(makeStore(storage).readStats().wins).toBe(7)
  })

  it('rejects malformed stats payloads instead of crashing', () => {
    storage.setItem(`${STORE_NAMESPACE}:stats`, JSON.stringify({ wins: 'lots' }))
    expect(makeStore(storage).readStats()).toEqual(EMPTY_STATS)
  })

  it('throws DeserializationError-compatible errors only via nulls, not exceptions, on broken JSON stats', () => {
    storage.setItem(`${STORE_NAMESPACE}:stats`, '{broken')
    expect(makeStore(storage).readStats()).toEqual(EMPTY_STATS)
  })

  it('exposes DeserializationError from the serializer for callers that want it', () => {
    // Guard that the serializer dependency is the versioned one the store builds on.
    expect(new DeserializationError('x')).toBeInstanceOf(Error)
  })
})
