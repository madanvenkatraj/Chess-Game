/**
 * Chess domain types — the single source of truth shared by the rules engine,
 * the AI layer, persistence, and the UI.
 *
 * All types here are JSON-serializable by construction: no classes, no
 * functions, no Dates. Persistence (Save & Resume) round-trips this data
 * through JSON.stringify, and the AI worker copies it across postMessage,
 * so every field must survive both.
 */

export type Color = 'white' | 'black'

export type PieceType = 'pawn' | 'knight' | 'bishop' | 'rook' | 'queen' | 'king'

export interface Piece {
  readonly type: PieceType
  readonly color: Color
}

/** Board square in algebraic coordinates, e.g. "a1", "e4", "h8". */
export type Square = string

/**
 * Board keyed by square name (e.g. board["e4"]). Chosen over a 0..63 array
 * because string keys keep the model directly JSON-safe, make FIDE move
 * notation trivially derivable, and keep AI evaluation hot paths on cheap
 * object lookups. See squares.ts for the coordinate helpers.
 */
export type Board = Readonly<Record<Square, Piece>>

export type CastlingRight = 'K' | 'Q' | 'k' | 'q'

export interface CastlingRights {
  readonly K: boolean // White kingside
  readonly Q: boolean // White queenside
  readonly k: boolean // Black kingside
  readonly q: boolean // Black queenside
}

/** Clock reading in seconds remaining; null for untimed games. */
export type Clock = { readonly white: number; readonly black: number } | null

/** Result of a finished game; null while the game is in progress. */
export type GameResult =
  | { readonly winner: Color; readonly reason: 'checkmate' | 'timeout' | 'resignation' }
  | { readonly winner: null; readonly reason: 'stalemate' | 'draw-agreement' | 'threefold' | 'fifty-move' | 'insufficient-material' }

export interface GameState {
  readonly board: Board
  /** Whose turn it is to move. */
  readonly turn: Color
  readonly castling: CastlingRights
  /** En passant target square (the square "behind" a just-moved pawn), or null. */
  readonly enPassantTarget: Square | null
  /** Plies since the last capture or pawn move, for the fifty-move rule. */
  readonly halfmoveClock: number
  /** Full move number, starts at 1 and increments after Black moves. */
  readonly fullmoveNumber: number
  readonly clock: Clock
  /** Serializable record of past positions for undo and repetition detection. */
  readonly history: readonly GameSnapshot[]
}

/**
 * A point-in-time copy of the position before a move — the stack element
 * that makes undo a pure pop and enables threefold-repetition checks later.
 */
export interface GameSnapshot {
  readonly board: Board
  readonly turn: Color
  readonly castling: CastlingRights
  readonly enPassantTarget: Square | null
  readonly halfmoveClock: number
  /** Full move number before the move, for exact undo. */
  readonly fullmoveNumber: number
}

export interface Move {
  readonly from: Square
  readonly to: Square
  readonly piece: PieceType
  /** Set only when the move is a pawn promotion. */
  readonly promotion?: PieceType
}

export interface MoveRecord extends Move {
  readonly color: Color
  readonly captured?: Piece
  readonly san: string
}
