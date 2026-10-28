/**
 * Immutable GameState model.
 *
 * Every operation returns a NEW state; none mutate their input. Undo is a
 * stack pop off `history`, which stores full snapshots of the position before
 * each move. applyMove here is deliberately STRUCTURAL only — it relocates
 * pieces, flips the turn, and pushes history. Legality, check, castling
 * rights enforcement and en-passant generation belong to the rules-engine
 * task, which will call these primitives.
 */
import type {
  Board,
  Color,
  GameState,
  Move,
  Piece,
  PieceType,
  Square,
} from '@engine/types'
import { fileOf, rankOf } from '@engine/squares'

/** The structural castling-right flags a move may clear. */
export function castlingRightsAfter(
  rights: GameState['castling'],
  mover: Color,
  move: Move,
): GameState['castling'] {
  let next = rights
  if (move.piece === 'king') {
    next = mover === 'white' ? { ...next, K: false, Q: false } : { ...next, k: false, q: false }
  }
  // Rook moves (or a capture on a rook's home square) clear the relevant side.
  const clears = (sq: Square, flag: 'K' | 'Q' | 'k' | 'q') => {
    if (move.from === sq || move.to === sq) next = { ...next, [flag]: false }
  }
  if (move.piece === 'rook') {
    clears('a1', 'Q')
    clears('h1', 'K')
    clears('a8', 'q')
    clears('h8', 'k')
  }
  if (move.to === 'a1') next = { ...next, Q: false }
  if (move.to === 'h1') next = { ...next, K: false }
  if (move.to === 'a8') next = { ...next, q: false }
  if (move.to === 'h8') next = { ...next, k: false }
  return next
}

/** Snap a piece off the board, returning a new board. */
function removePiece(board: Board, square: Square): Board {
  const next: Record<string, Piece> = { ...board }
  delete next[square]
  return next
}

function putPiece(board: Board, square: Square, piece: Piece): Board {
  return { ...board, [square]: piece }
}

export interface ApplyMoveOptions {
  /** Set for pawn promotions; the pawn is replaced by this piece type. */
  readonly promotion?: PieceType
  /** Set when the move is en passant: the square of the pawn being captured. */
  readonly enPassantCapture?: Square
  /** Set for castling: the square of the rook to relocate. */
  readonly rookFrom?: Square
  readonly rookTo?: Square
  /** New en passant target produced by this move (a double pawn push). */
  readonly newEnPassantTarget?: Square | null
}

/**
 * Structurally apply a move that has ALREADY been validated as legal.
 * Never mutates the input state.
 */
export function applyMove(state: GameState, move: Move, options: ApplyMoveOptions = {}): GameState {
  const piece: Piece | undefined = state.board[move.from]
  if (!piece) {
    throw new Error(`applyMove: no piece on ${move.from}`)
  }
  const captured: Piece | undefined = options.enPassantCapture
    ? state.board[options.enPassantCapture]
    : state.board[move.to]

  let board = removePiece(state.board, move.from)
  if (options.enPassantCapture) {
    board = removePiece(board, options.enPassantCapture)
  }
  const placed: Piece =
    options.promotion !== undefined
      ? { type: options.promotion, color: piece.color }
      : piece
  board = putPiece(board, move.to, placed)

  if (options.rookFrom && options.rookTo) {
    const rook: Piece | undefined = state.board[options.rookFrom]
    if (!rook) throw new Error(`applyMove: no rook on ${options.rookFrom}`)
    board = removePiece(board, options.rookFrom)
    board = putPiece(board, options.rookTo, rook)
  }

  const isPawnMove = piece.type === 'pawn'
  const hadCapture = captured !== undefined
  const halfmoveClock = isPawnMove || hadCapture ? 0 : state.halfmoveClock + 1
  const fullmoveNumber = state.turn === 'black' ? state.fullmoveNumber + 1 : state.fullmoveNumber
  const turn: Color = state.turn === 'white' ? 'black' : 'white'

  return {
    board,
    turn,
    castling: castlingRightsAfter(state.castling, state.turn, move),
    enPassantTarget: options.newEnPassantTarget ?? null,
    halfmoveClock,
    fullmoveNumber,
    clock: state.clock,
    history: [
      ...state.history,
      {
        board: state.board,
        turn: state.turn,
        castling: state.castling,
        enPassantTarget: state.enPassantTarget,
        halfmoveClock: state.halfmoveClock,
        fullmoveNumber: state.fullmoveNumber,
      },
    ],
  }
}

/** Undo the last move by popping the history stack. Pure. */
export function undoLastMove(state: GameState): GameState {
  if (state.history.length === 0) return state
  const snapshot = state.history[state.history.length - 1]!
  return {
    board: snapshot.board,
    turn: snapshot.turn,
    castling: snapshot.castling,
    enPassantTarget: snapshot.enPassantTarget,
    halfmoveClock: snapshot.halfmoveClock,
    fullmoveNumber: snapshot.fullmoveNumber,
    clock: state.clock,
    history: state.history.slice(0, -1),
  }
}

export interface ClockTickOptions {
  /** Seconds to decrement the side-to-move's clock by. */
  readonly seconds: number
}

/** Decrement the side-to-move's clock; a no-op for untimed games. Pure. */
export function tickClock(state: GameState, options: ClockTickOptions): GameState {
  if (state.clock === null) return state
  return {
    ...state,
    clock:
      state.turn === 'white'
        ? { white: Math.max(0, state.clock.white - options.seconds), black: state.clock.black }
        : { white: state.clock.white, black: Math.max(0, state.clock.black - options.seconds) },
  }
}

/**
 * True when the game is timed AND the side to move has no time left —
 * i.e. their flag has fallen and they lose on time. Pure.
 */
export function isFlagFall(state: GameState): boolean {
  if (state.clock === null) return false
  return state.turn === 'white' ? state.clock.white <= 0 : state.clock.black <= 0
}

/**
 * The GameResult for a flag fall: the opponent of the side to move wins on
 * time. Throws on an untimed game — callers must guard with isFlagFall.
 */
export function flagFallResult(state: GameState): { winner: Color; reason: 'timeout' } {
  if (state.clock === null) {
    throw new Error('flagFallResult: game is untimed, there is no flag to fall')
  }
  return { winner: state.turn === 'white' ? 'black' : 'white', reason: 'timeout' }
}

export function isWhiteBackRank(square: Square): boolean {
  return fileOf(square) >= 0 && rankOf(square) === 0
}
