/**
 * Square coordinate helpers over the algebraic-string board keys chosen in
 * types.ts (e.g. "e4"). Pure functions only — no board state is mutated
 * anywhere in this module.
 */
import type { Square } from './types'

export const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const
export const RANKS = ['1', '2', '3', '4', '5', '6', '7', '8'] as const

const SQUARES: readonly Square[] = FILES.flatMap((f) =>
  RANKS.map((r) => (f + r) as Square),
)

/** All 64 squares in a1..h8 order. Frozen so callers cannot mutate the list. */
export const ALL_SQUARES: readonly Square[] = Object.freeze(SQUARES)

export function isSquare(value: string): value is Square {
  if (value.length !== 2) return false
  return (FILES as readonly string[]).includes(value[0]!) && (RANKS as readonly string[]).includes(value[1]!)
}

export function fileOf(square: Square): number {
  return square.charCodeAt(0) - 97 // 'a' === 97
}

export function rankOf(square: Square): number {
  return Number.parseInt(square[1]!, 10) - 1
}

export function squareAt(file: number, rank: number): Square | null {
  if (file < 0 || file > 7 || rank < 0 || rank > 7) return null
  return (FILES[file]! + RANKS[rank]!) as Square
}

/** Orthogonal offset in (file, rank) steps, e.g. "e4" -> north is "e5". */
export function step(square: Square, df: number, dr: number): Square | null {
  return squareAt(fileOf(square) + df, rankOf(square) + dr)
}

/** Is a square dark or light? a1 is dark. */
export function isDarkSquare(square: Square): boolean {
  return (fileOf(square) + rankOf(square)) % 2 === 0
}

/** The color of a square's rank-relative row, used for pawn direction logic. */
export function rankIndex(square: Square): number {
  return rankOf(square)
}
