import { it } from 'vitest'
import { generatePseudoLegalMoves } from '@engine/moveGeneration'
import type { GameState, Piece, Square } from '@engine/types'

const W = (type: Piece['type']): Piece => ({ type, color: 'white' })
const B = (type: Piece['type']): Piece => ({ type, color: 'black' })

it('debug castling', () => {
  const board: Record<Square, Piece> = { e1: W('king'), h1: W('rook'), e8: B('king') }
  const state: GameState = {
    board,
    turn: 'white',
    castling: { K: true, Q: false, k: false, q: false },
    enPassantTarget: null,
    halfmoveClock: 0,
    fullmoveNumber: 1,
    clock: null,
    history: [],
  }
  const moves = generatePseudoLegalMoves(state)
  console.log('MOVES', JSON.stringify(moves))
})
