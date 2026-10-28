/**
 * Namespaced localStorage persistence store — the isolated persistence layer
 * backing Save & Resume and Game Statistics.
 *
 * Design:
 * - All keys live under a single `chess88` namespace so the store never
 *   touches foreign keys in the same origin.
 * - Saved games reuse the versioned GameState serializer (src/state/serialize.ts),
 *   so old saves keep loading and bad saves fail soft (null), never throwing
 *   mid-move.
 * - Every write is guarded: when localStorage is unavailable (private mode,
 *   quota exceeded) the store degrades to in-memory state and reports failure
 *   with a boolean instead of throwing.
 */
import type { GameState } from '@engine/types'
import { deserialize, serialize } from '@state/serialize'

/** Single namespace prefix for every key this store writes. */
export const STORE_NAMESPACE = 'chess88'

/** How many recent results the stats record keeps. */
const MAX_RECENT = 10

export type StatsResult = 'win' | 'loss' | 'draw' | 'white-won' | 'black-won'
export type GameMode = '2p' | 'ai' | 'online'

export interface RecentResult {
  readonly result: StatsResult
  readonly mode: GameMode
  readonly date: string
}

export interface Stats {
  wins: number
  losses: number
  draws: number
  games: number
  streak: number
  bestStreak: number
  recent: RecentResult[]
}

export interface RecordOptions {
  readonly result: StatsResult
  readonly mode: GameMode
  /** AI difficulty, meaningful only for mode 'ai'. */
  readonly difficulty?: 'easy' | 'medium' | 'hard'
}

export const EMPTY_STATS: Stats = {
  wins: 0,
  losses: 0,
  draws: 0,
  games: 0,
  streak: 0,
  bestStreak: 0,
  recent: [],
}

export type MinimalStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

function key(name: string): string {
  return `${STORE_NAMESPACE}:${name}`
}

function isStats(value: unknown): value is Stats {
  if (typeof value !== 'object' || value === null) return false
  const s = value as Record<string, unknown>
  const numeric = ['wins', 'losses', 'draws', 'games', 'streak', 'bestStreak'].every(
    (f) => typeof s[f] === 'number' && Number.isFinite(s[f] as number),
  )
  return numeric && Array.isArray(s['recent'])
}

export interface GameStore {
  /** Persist the in-progress game. Returns false if storage is unavailable. */
  saveGame(state: GameState): boolean
  /** Load the saved game, or null when none exists / the save is unusable. */
  loadGame(): GameState | null
  /** Remove the saved game (e.g. when it finishes). */
  clearSavedGame(): void
  /** True when a resumable game exists. */
  hasSavedGame(): boolean
  /** Record one finished game and return the updated stats. */
  recordResult(options: RecordOptions): Stats
  /** Current stats (persisted when storage allows). */
  readStats(): Stats
}

export function createGameStore(options: {
  /** Injectable storage for tests; defaults to window.localStorage. Pass null to simulate private mode. */
  storage?: MinimalStorage | null
}): GameStore {
  // Degrade to memory-only when storage is missing or throws on access.
  let memoryFallback: Map<string, string> | null = null
  let storage: MinimalStorage | null = options.storage !== undefined ? options.storage : null

  if (!storage && typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.getItem(key('__probe__'))
      storage = window.localStorage
    } catch {
      storage = null
      memoryFallback = new Map()
    }
  } else if (!storage && options.storage === undefined) {
    memoryFallback = new Map()
  }

  function read(keyName: string): string | null {
    if (memoryFallback) return memoryFallback.get(keyName) ?? null
    if (!storage) return null
    try {
      return storage.getItem(keyName)
    } catch {
      return null
    }
  }

  function write(keyName: string, value: string): boolean {
    if (memoryFallback) {
      memoryFallback.set(keyName, value)
      return false // nothing was actually persisted
    }
    if (!storage) return false
    try {
      storage.setItem(keyName, value)
      return true
    } catch {
      return false
    }
  }

  function remove(keyName: string): void {
    if (memoryFallback) {
      memoryFallback.delete(keyName)
      return
    }
    if (!storage) return
    try {
      storage.removeItem(keyName)
    } catch {
      // ignore — nothing we can do; absence is the safe end state
    }
  }

  function readStats(): Stats {
    const raw = read(key('stats'))
    if (!raw) return { ...EMPTY_STATS, recent: [] }
    try {
      const parsed: unknown = JSON.parse(raw)
      if (!isStats(parsed)) return { ...EMPTY_STATS, recent: [] }
      return { ...parsed, recent: parsed.recent.slice(0, MAX_RECENT) }
    } catch {
      return { ...EMPTY_STATS, recent: [] }
    }
  }

  function writeStats(stats: Stats): boolean {
    return write(key('stats'), JSON.stringify(stats))
  }

  return {
    saveGame(state: GameState): boolean {
      return write(key('lastGame'), serialize(state))
    },

    loadGame(): GameState | null {
      const raw = read(key('lastGame'))
      if (!raw) return null
      try {
        return deserialize(raw)
      } catch {
        // Corrupt or unsupported save: fail soft by discarding it.
        remove(key('lastGame'))
        return null
      }
    },

    clearSavedGame(): void {
      remove(key('lastGame'))
    },

    hasSavedGame(): boolean {
      return this.loadGame() !== null
    },

    recordResult(options: RecordOptions): Stats {
      const stats = readStats()
      stats.games++
      if (options.result === 'win') {
        stats.wins++
        stats.streak++
        stats.bestStreak = Math.max(stats.bestStreak, stats.streak)
      } else if (options.result === 'loss') {
        stats.losses++
        stats.streak = 0
      } else if (options.result === 'draw') {
        stats.draws++
        stats.streak = 0
      }
      // 'white-won' / 'black-won' count toward games only.
      stats.recent = [
        { result: options.result, mode: options.mode, date: new Date().toISOString() },
        ...stats.recent,
      ].slice(0, MAX_RECENT)
      writeStats(stats)
      return stats
    },

    readStats,
  }
}
