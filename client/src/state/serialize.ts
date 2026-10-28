/**
 * JSON (de)serialization for GameState — the persistence boundary for
 * Save & Resume. The schema is explicit and versioned so old saved games
 * keep loading as the model grows.
 */
import type { GameState, Piece, Square } from '@engine/types'
import { isSquare } from '@engine/squares'

export const SERIALIZATION_VERSION = 1

export interface SerializedGameState {
  readonly version: number
  readonly state: GameState
}

export function serialize(state: GameState): string {
  const payload: SerializedGameState = { version: SERIALIZATION_VERSION, state }
  return JSON.stringify(payload)
}

/** Thrown when a saved game cannot be understood. */
export class DeserializationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DeserializationError'
  }
}

function isPiece(value: unknown): value is Piece {
  if (typeof value !== 'object' || value === null) return false
  const p = value as Record<string, unknown>
  return (
    (p['color'] === 'white' || p['color'] === 'black') &&
    ['pawn', 'knight', 'bishop', 'rook', 'queen', 'king'].includes(p['type'] as string)
  )
}

/** Parse and validate a serialized game. Throws DeserializationError on bad input. */
export function deserialize(json: string): GameState {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    throw new DeserializationError('Saved game is not valid JSON')
  }
  const obj = parsed as Record<string, unknown>
  if (typeof obj !== 'object' || obj === null) {
    throw new DeserializationError('Saved game has unexpected shape')
  }
  if (obj['version'] !== SERIALIZATION_VERSION) {
    throw new DeserializationError(`Unsupported save version: ${String(obj['version'])}`)
  }
  const s = obj['state'] as Record<string, unknown>
  if (typeof s !== 'object' || s === null) {
    throw new DeserializationError('Saved game payload missing state')
  }

  const boardRaw = s['board'] as Record<string, unknown>
  if (typeof boardRaw !== 'object' || boardRaw === null) {
    throw new DeserializationError('Saved game board is missing')
  }
  const board: Record<Square, Piece> = {}
  for (const [sq, val] of Object.entries(boardRaw)) {
    if (!isSquare(sq) || !isPiece(val)) {
      throw new DeserializationError(`Saved game board has invalid entry at ${sq}`)
    }
    board[sq] = val
  }

  if (s['turn'] !== 'white' && s['turn'] !== 'black') {
    throw new DeserializationError('Saved game has invalid turn')
  }

  const history = (Array.isArray(s['history']) ? s['history'] : []) as GameState['history']

  return {
    board,
    turn: s['turn'],
    castling: s['castling'] as GameState['castling'],
    enPassantTarget: (s['enPassantTarget'] ?? null) as Square | null,
    halfmoveClock: (s['halfmoveClock'] as number) ?? 0,
    fullmoveNumber: (s['fullmoveNumber'] as number) ?? 1,
    clock: (s['clock'] ?? null) as GameState['clock'],
    history,
  }
}
