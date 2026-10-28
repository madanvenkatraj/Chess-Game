/**
 * Starting-position factory and small state helpers used by setup, tests,
 * and (later) the rules engine.
 */
import type { Board, Color, GameState, Piece, PieceType, Square } from '@engine/types'

const BACK_RANK: readonly PieceType[] = [
  'rook', 'knight', 'bishop', 'queen', 'king', 'bishop', 'knight', 'rook',
]

function backRankPieces(color: Color): Record<string, Piece> {
  const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
  const pieces: Record<string, Piece> = {}
  BACK_RANK.forEach((type, i) => {
    pieces[files[i]! + (color === 'white' ? '1' : '8')] = { type, color }
  })
  return pieces
}

function pawnRank(color: Color): Record<string, Piece> {
  const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
  const rank = color === 'white' ? '2' : '7'
  const pieces: Record<string, Piece> = {}
  for (const f of files) pieces[f + rank] = { type: 'pawn', color }
  return pieces
}

/** Fresh game state at the standard FIDE starting position. */
export function createInitialGameState(options: { clock: GameState['clock'] } = { clock: null }): GameState {
  const board: Board = {
    ...backRankPieces('white'),
    ...pawnRank('white'),
    ...pawnRank('black'),
    ...backRankPieces('black'),
  }
  return {
    board,
    turn: 'white',
    castling: { K: true, Q: true, k: true, q: true },
    enPassantTarget: null,
    halfmoveClock: 0,
    fullmoveNumber: 1,
    clock: options.clock,
    history: [],
  }
}

export function countPieces(state: GameState): number {
  return Object.keys(state.board).length
}

export function pieceAt(state: GameState, square: Square): Piece | undefined {
  return state.board[square]
}
