/**
 * Rules engine: legal move generation for every piece type, plus the special
 * moves (castling, en passant, promotion), check detection, and the
 * checkmate/stalemate hooks used for game-end detection.
 *
 * Architecture contract (see Chess Engine Layer):
 * - Pure functions only: nothing here mutates a board or a state. Legality is
 *   checked by cloning the position via the immutable `applyMove` from
 *   @state/gameState and testing the king's safety on the clone, which keeps
 *   this module free of board-application logic of its own.
 * - Pseudo-legal generation is separated from legality filtering so the AI
 *   layer can reuse the cheap pass for move ordering.
 */
import type {
  Board,
  Color,
  GameState,
  Move,
  PieceType,
  Square,
} from '@engine/types'
import { ALL_SQUARES, fileOf, rankOf, squareAt, step } from '@engine/squares'
import { applyMove, type ApplyMoveOptions } from '@state/gameState'

const ORTHOGONAL: ReadonlyArray<readonly [number, number]> = [
  [0, 1], [0, -1], [1, 0], [-1, 0],
]
const DIAGONAL: ReadonlyArray<readonly [number, number]> = [
  [1, 1], [1, -1], [-1, 1], [-1, -1],
]
const KNIGHT_JUMPS: ReadonlyArray<readonly [number, number]> = [
  [1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2],
]

const PROMOTION_PIECES: readonly PieceType[] = ['queen', 'rook', 'bishop', 'knight']

function isOccupiedBy(board: Board, square: Square, color: Color): boolean {
  const piece = board[square]
  return piece !== undefined && piece.color === color
}

function isOccupiedByOpponent(board: Board, square: Square, color: Color): boolean {
  const piece = board[square]
  return piece !== undefined && piece.color !== color
}

/** Find a side's king square; null if absent (corrupt/partial test boards). */
export function findKing(board: Board, color: Color): Square | null {
  for (const square of ALL_SQUARES) {
    const piece = board[square]
    if (piece && piece.type === 'king' && piece.color === color) return square
  }
  return null
}

/**
 * Is `square` attacked by any piece of `attacker`? Covers pawn, knight, king,
 * and slider attacks. The core primitive behind check, castling transit, and
 * pin detection via simulation.
 */
export function isSquareAttacked(board: Board, square: Square, attacker: Color): boolean {
  const f = fileOf(square)
  const r = rankOf(square)

  // Pawn attacks: a white pawn on e4 attacks d5/f5, so a square is attacked by
  // white if a white pawn sits one rank below (and diagonally adjacent).
  const pawnRank = attacker === 'white' ? r - 1 : r + 1
  for (const df of [-1, 1]) {
    const pawnSquare = squareAt(f + df, pawnRank)
    const piece = pawnSquare ? board[pawnSquare] : undefined
    if (piece && piece.type === 'pawn' && piece.color === attacker) return true
  }

  // Knights
  for (const [df, dr] of KNIGHT_JUMPS) {
    const knightSquare = squareAt(f + df, r + dr)
    const piece = knightSquare ? board[knightSquare] : undefined
    if (piece && piece.type === 'knight' && piece.color === attacker) return true
  }

  // King adjacency
  for (const [df, dr] of [...ORTHOGONAL, ...DIAGONAL]) {
    const nearSquare = squareAt(f + df, r + dr)
    const piece = nearSquare ? board[nearSquare] : undefined
    if (piece && piece.type === 'king' && piece.color === attacker) return true
  }

  // Sliders: walk each ray until blocked; a matching slider means attacked.
  for (const [df, dr] of ORTHOGONAL) {
    let cursor: Square | null = square
    while ((cursor = step(cursor, df, dr)) !== null) {
      const piece = board[cursor]
      if (piece) {
        if (piece.color === attacker && (piece.type === 'rook' || piece.type === 'queen')) {
          return true
        }
        break
      }
    }
  }
  for (const [df, dr] of DIAGONAL) {
    let cursor: Square | null = square
    while ((cursor = step(cursor, df, dr)) !== null) {
      const piece = board[cursor]
      if (piece) {
        if (piece.color === attacker && (piece.type === 'bishop' || piece.type === 'queen')) {
          return true
        }
        break
      }
    }
  }
  return false
}

/** Is `color`'s king attacked on this board? */
export function isInCheck(board: Board, color: Color): boolean {
  const king = findKing(board, color)
  if (!king) return false
  return isSquareAttacked(board, king, color === 'white' ? 'black' : 'white')
}

/** Pawn direction: white moves up the ranks, black moves down. */
function pawnDirection(color: Color): number {
  return color === 'white' ? 1 : -1
}

/** Pawn start rank for the double push. */
function pawnStartRankIndex(color: Color): number {
  return color === 'white' ? 1 : 6
}

/** Pawn promotion rank index. */
function promotionRankIndex(color: Color): number {
  return color === 'white' ? 7 : 0
}

/** Pseudo-legal (ignores king safety) moves for one piece from one square. */
function generateMovesForPiece(
  board: Board,
  from: Square,
  piece: PieceType,
  color: Color,
  enPassantTarget: Square | null,
): Move[] {
  const moves: Move[] = []
  const push = (to: Square, capture: boolean) => {
    if (piece === 'pawn' && rankOf(to) === promotionRankIndex(color)) {
      for (const promotion of PROMOTION_PIECES) moves.push({ from, to, piece, promotion })
    } else {
      moves.push({ from, to, piece })
    }
    void capture
  }

  const f = fileOf(from)
  const r = rankOf(from)

  switch (piece) {
    case 'pawn': {
      const dir = pawnDirection(color)
      const oneStep = squareAt(f, r + dir)
      if (oneStep && board[oneStep] === undefined) {
        push(oneStep, false)
        const twoStep = squareAt(f, r + 2 * dir)
        if (r === pawnStartRankIndex(color) && twoStep && board[twoStep] === undefined) {
          moves.push({ from, to: twoStep, piece })
        }
      }
      for (const df of [-1, 1]) {
        const diagonal = squareAt(f + df, r + dir)
        if (!diagonal) continue
        if (isOccupiedByOpponent(board, diagonal, color)) {
          push(diagonal, true)
        } else if (diagonal === enPassantTarget) {
          // En passant: the target square is empty but capturable.
          moves.push({ from, to: diagonal, piece })
        }
      }
      break
    }
    case 'knight': {
      for (const [df, dr] of KNIGHT_JUMPS) {
        const to = squareAt(f + df, r + dr)
        if (!to) continue
        if (!isOccupiedBy(board, to, color)) push(to, isOccupiedByOpponent(board, to, color))
      }
      break
    }
    case 'king': {
      for (const [df, dr] of [...ORTHOGONAL, ...DIAGONAL]) {
        const to = squareAt(f + df, r + dr)
        if (!to) continue
        if (!isOccupiedBy(board, to, color)) push(to, isOccupiedByOpponent(board, to, color))
      }
      break
    }
    case 'rook': {
      for (const [df, dr] of ORTHOGONAL) slide(board, from, f, r, df, dr, color, push)
      break
    }
    case 'bishop': {
      for (const [df, dr] of DIAGONAL) slide(board, from, f, r, df, dr, color, push)
      break
    }
    case 'queen': {
      for (const [df, dr] of [...ORTHOGONAL, ...DIAGONAL]) slide(board, from, f, r, df, dr, color, push)
      break
    }
  }
  return moves
}

function slide(
  board: Board,
  from: Square,
  f: number,
  r: number,
  df: number,
  dr: number,
  color: Color,
  push: (to: Square, capture: boolean) => void,
): void {
  let cursor: Square | null = squareAt(f + df, r + dr)
  while (cursor) {
    if (isOccupiedBy(board, cursor, color)) break
    push(cursor, isOccupiedByOpponent(board, cursor, color))
    if (isOccupiedByOpponent(board, cursor, color)) break
    cursor = step(cursor, df, dr)
  }
  void from
}

/** Squares the king passes through for each castling side. */
interface CastlingSideDef {
  readonly king: Square
  readonly to: Square
  readonly rookFrom: Square
  readonly rookTo: Square
  readonly transit: Square
  readonly path: readonly Square[]
}

const CASTLING_DEF: Readonly<Record<Color, Readonly<{ K: CastlingSideDef; Q: CastlingSideDef }>>> = {
  white: {
    K: { king: 'e1', to: 'g1', rookFrom: 'h1', rookTo: 'f1', transit: 'f1', path: ['f1', 'g1'] },
    Q: { king: 'e1', to: 'c1', rookFrom: 'a1', rookTo: 'd1', transit: 'd1', path: ['d1', 'c1'] },
  },
  black: {
    K: { king: 'e8', to: 'g8', rookFrom: 'h8', rookTo: 'f8', transit: 'f8', path: ['f8', 'g8'] },
    Q: { king: 'e8', to: 'c8', rookFrom: 'a8', rookTo: 'd8', transit: 'd8', path: ['d8', 'c8'] },
  },
}

function castlingFlag(color: Color, side: 'K' | 'Q'): 'K' | 'Q' | 'k' | 'q' {
  return color === 'white' ? side : side === 'K' ? 'k' : 'q'
}

function emptyPath(board: Board, path: readonly Square[]): boolean {
  return path.every((square) => board[square] === undefined)
}

/**
 * All moves that follow piece-movement rules, WITHOUT checking whether they
 * leave the mover's own king in check. Cheap, reusable by the AI for ordering.
 */
export function generatePseudoLegalMoves(state: GameState): Move[] {
  const moves: Move[] = []
  for (const from of ALL_SQUARES) {
    const piece = state.board[from]
    if (!piece || piece.color !== state.turn) continue
    moves.push(
      ...generateMovesForPiece(state.board, from, piece.type, piece.color, state.enPassantTarget),
    )
  }
  // Castling: generate only when all movement-rule preconditions hold; king
  // safety (current check, transit attack) is still filtered below so both
  // halves of FIDE 3.8.2 live in one place.
  for (const side of ['K', 'Q'] as const) {
    const flag = castlingFlag(state.turn, side)
    if (!state.castling[flag]) continue
    const def = CASTLING_DEF[state.turn][side]
    const kingPiece = state.board[def.king]
    if (!kingPiece || kingPiece.type !== 'king' || kingPiece.color !== state.turn) continue
    const rook = state.board[def.rookFrom]
    if (!rook || rook.type !== 'rook' || rook.color !== state.turn) continue
    if (!emptyPath(state.board, def.path)) continue
    moves.push({ from: def.king, to: def.to, piece: 'king' })
  }
  return moves
}

/**
 * Structural options for a pseudo-legal move, so `applyMove` can clone the
 * position correctly for the king-safety test.
 */
function applyOptionsFor(state: GameState, move: Move): ApplyMoveOptions {
  if (move.piece === 'pawn' && move.to === state.enPassantTarget) {
    // En passant: the captured pawn sits beside the destination.
    const capturedFile = fileOf(move.to)
    const capturedRank = rankOf(move.from)
    const capturedSquare = squareAt(capturedFile, capturedRank)
    if (capturedSquare && state.board[capturedSquare]?.type === 'pawn') {
      const victim = state.board[capturedSquare]!
      if (victim.color !== state.turn) return { enPassantCapture: capturedSquare }
    }
  }
  if (move.piece === 'king' && Math.abs(fileOf(move.to) - fileOf(move.from)) === 2) {
    // Castling: relocate the rook too.
    const side = fileOf(move.to) > fileOf(move.from) ? 'K' : 'Q'
    const def = CASTLING_DEF[state.turn][side]
    return { rookFrom: def.rookFrom, rookTo: def.rookTo }
  }
  const promotion = move.promotion
  // Double pawn push: create the en passant target on the square the pawn
  // jumped over, so the opponent can reply with an en passant capture.
  if (
    move.piece === 'pawn'
    && promotion === undefined
    && Math.abs(rankOf(move.to) - rankOf(move.from)) === 2
  ) {
    const mid = squareAt(fileOf(move.from), (rankOf(move.from) + rankOf(move.to)) / 2)
    return { newEnPassantTarget: mid }
  }
  return promotion !== undefined ? { promotion } : {}
}

/**
 * Fully legal moves: pseudo-legal moves filtered by playing each one on an
 * immutable clone and rejecting any that leave the mover's king attacked.
 * This single simulation handles pins, discovered checks, illegal
 * en-passant exposure, and the king-walks-into-check case uniformly.
 */
export function generateLegalMoves(state: GameState): Move[] {
  const legal: Move[] = []
  for (const move of generatePseudoLegalMoves(state)) {
    const options = applyOptionsFor(state, move)
    const next = applyMove(state, move, options)
    // After applyMove the turn has flipped; the mover is the previous turn.
    if (!isInCheck(next.board, state.turn)) legal.push(move)
  }
  return legal
}

/** Castling has extra king-safety preconditions the simulation can't see:
 * the king may not castle out of, through, or into check (FIDE 3.8.2). */
export function filterIllegalCastling(state: GameState, moves: readonly Move[]): Move[] {
  return moves.filter((move) => {
    if (move.piece !== 'king') return true
    const files = Math.abs(fileOf(move.to) - fileOf(move.from))
    if (files !== 2) return true
    const side = fileOf(move.to) > fileOf(move.from) ? 'K' : 'Q'
    const def = CASTLING_DEF[state.turn][side]
    const enemy: Color = state.turn === 'white' ? 'black' : 'white'
    return !isSquareAttacked(state.board, def.king, enemy)
      && !isSquareAttacked(state.board, def.transit, enemy)
      && !isSquareAttacked(state.board, def.to, enemy)
  })
}

/**
 * Legal moves with castling's king-safety rules applied. This is the public
 * API the UI and AI should consume.
 */
export function legalMoves(state: GameState): Move[] {
  return filterIllegalCastling(state, generateLegalMoves(state))
}

/** Game-end hooks: does the side to move have any legal move at all? */
export function hasAnyLegalMove(state: GameState): boolean {
  return legalMoves(state).length > 0
}

/** Checkmate: the side to move is in check with no legal escape. */
export function isCheckmate(state: GameState): boolean {
  return isInCheck(state.board, state.turn) && !hasAnyLegalMove(state)
}

/** Stalemate: no legal move while NOT in check. */
export function isStalemate(state: GameState): boolean {
  return !isInCheck(state.board, state.turn) && !hasAnyLegalMove(state)
}
