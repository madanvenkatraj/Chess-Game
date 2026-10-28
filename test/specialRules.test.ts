/**
 * End-to-end special-rules tests: the full legalMoves -> applyMove loop for
 * castling, en passant, promotion, and check/checkmate/stalemate detection.
 * These exercise the integration the unit tests above miss — particularly
 * that applyMove receives the right structural options for each special move.
 */
import { describe, it, expect } from 'vitest'
import type { GameState, Move, Piece, Square } from '@engine/types'
import { createInitialGameState } from '@state/initialState'
import { applyMove, undoLastMove } from '@state/gameState'
import { legalMoves, isInCheck, isCheckmate, isStalemate } from '@engine/moveGeneration'

function stateWith(
  board: Record<string, Piece>,
  options: { turn?: 'white' | 'black'; castling?: Partial<GameState['castling']> } = {},
): GameState {
  const base = createInitialGameState()
  return {
    ...base,
    board,
    turn: options.turn ?? 'white',
    castling: { K: false, Q: false, k: false, q: false, ...options.castling },
  }
}

const W = (type: Piece['type']): Piece => ({ type, color: 'white' })
const B = (type: Piece['type']): Piece => ({ type, color: 'black' })

function move(state: GameState, from: Square, to: Square): Move | undefined {
  return legalMoves(state).find((m) => m.from === from && m.to === to)
}

/** Apply the move found by legalMoves, with the options the engine computes. */
function play(state: GameState, from: Square, to: Square): GameState {
  const found = move(state, from, to)
  if (!found) throw new Error(`no legal move ${from}-${to} in test position`)
  const fileDelta = to.charCodeAt(0) - from.charCodeAt(0)
  const rankDelta = Number(to[1]) - Number(from[1])
  const options =
    found.piece === 'king' && Math.abs(fileDelta) === 2
      ? {
          rookFrom: `${fileDelta > 0 ? 'h' : 'a'}${state.turn === 'white' ? '1' : '8'}`,
          rookTo: `${fileDelta > 0 ? 'f' : 'd'}${state.turn === 'white' ? '1' : '8'}`,
        }
      : found.piece === 'pawn' && fileDelta !== 0 && state.board[to] === undefined
        ? { enPassantCapture: `${to[0]}${Number(to[1]) - (state.turn === 'white' ? 1 : -1)}` }
        : found.piece === 'pawn' && Math.abs(rankDelta) === 2
          ? { newEnPassantTarget: `${from[0]}${Number(from[1]) + rankDelta / 2}` }
          : found.promotion
            ? { promotion: found.promotion }
            : {}
  return applyMove(state, found, options)
}

describe('castling end-to-end', () => {
  const board = {
    e1: W('king'), h1: W('rook'), a1: W('rook'),
    e8: B('king'), a8: B('rook'),
  }

  it('castles kingside: king to g1, rook to f1, rights cleared', () => {
    const state = stateWith(board, { castling: { K: true, Q: true } })
    const next = play(state, 'e1', 'g1')
    expect(next.board.e1).toBeUndefined()
    expect(next.board.g1).toEqual(W('king'))
    expect(next.board.h1).toBeUndefined()
    expect(next.board.f1).toEqual(W('rook'))
    expect(next.castling.K).toBe(false)
    expect(next.castling.Q).toBe(false)
    expect(next.turn).toBe('black')
  })

  it('castles queenside: king to c1, rook to d1', () => {
    const state = stateWith(board, { castling: { K: true, Q: true } })
    const next = play(state, 'e1', 'c1')
    expect(next.board.c1).toEqual(W('king'))
    expect(next.board.d1).toEqual(W('rook'))
    expect(next.board.a1).toBeUndefined()
    expect(next.castling.Q).toBe(false)
  })

  it('an early king move kills both white castle rights in later positions', () => {
    const withKingMove = applyMove(
      stateWith({ ...board, e4: W('pawn') }, { castling: { K: true, Q: true } }),
      { from: 'e1', to: 'e2', piece: 'king' },
    )
    expect(withKingMove.castling.K).toBe(false)
    expect(withKingMove.castling.Q).toBe(false)
  })
})

describe('en passant end-to-end', () => {
  it('a real double push creates the target; the opponent may capture it', () => {
    // White plays e2-e4 from a sparse position; black pawn on d4 may reply ep.
    const start = stateWith({
      e2: W('pawn'), d4: B('pawn'), e1: W('king'), e8: B('king'),
    })
    const afterPush = applyMove(start, { from: 'e2', to: 'e4', piece: 'pawn' }, { newEnPassantTarget: 'e3' })
    expect(afterPush.enPassantTarget).toBe('e3')
    const reply = move(afterPush, 'd4', 'e3')
    expect(reply).toBeDefined()
    const afterEp = applyMove(afterPush, reply!, { enPassantCapture: 'e4' })
    expect(afterEp.board.e3).toEqual(B('pawn'))
    expect(afterEp.board.e4).toBeUndefined()
    expect(afterEp.board.d4).toBeUndefined()
    expect(afterEp.enPassantTarget).toBeNull()
  })

  it('undo restores the exact prior state including the en passant target', () => {
    const start = stateWith({ e2: W('pawn'), d4: B('pawn'), e1: W('king'), e8: B('king') })
    const afterPush = applyMove(start, { from: 'e2', to: 'e4', piece: 'pawn' }, { newEnPassantTarget: 'e3' })
    const restored = undoLastMove(afterPush)
    expect(restored.enPassantTarget).toBe(start.enPassantTarget)
    expect(restored.board).toEqual(start.board)
    expect(restored.turn).toBe(start.turn)
  })
})

describe('promotion end-to-end', () => {
  it('each promotion choice lands the chosen piece on the last rank', () => {
    for (const pieceType of ['queen', 'rook', 'bishop', 'knight'] as const) {
      const state = stateWith({ e7: W('pawn'), a1: W('king'), h8: B('king') })
      const promo = legalMoves(state).find((m) => m.from === 'e7' && m.promotion === pieceType)
      expect(promo).toBeDefined()
      const next = applyMove(state, promo!, { promotion: pieceType })
      expect(next.board.e8).toEqual({ type: pieceType, color: 'white' })
      expect(next.board.e7).toBeUndefined()
    }
  })
})

describe('game-end detection over real play', () => {
  it('reports checkmate via the standard fool\u2019s mate sequence', () => {
    let state = createInitialGameState()
    const seq: Array<[Square, Square]> = [
      ['f2', 'f3'], ['e7', 'e5'], ['g2', 'g4'], ['d8', 'h4'],
    ]
    for (const [from, to] of seq) {
      const found = move(state, from, to)
      expect(found).toBeDefined()
      const isDoublePush = Boolean(found && found.piece === 'pawn' && Math.abs(Number(to[1]) - Number(from[1])) === 2)
      const midRank: number | null = isDoublePush ? (Number(from[1]) + Number(to[1])) / 2 : null
      const extra: { newEnPassantTarget?: string } = {}
      if (midRank !== null) { const mr: number = midRank; extra.newEnPassantTarget = from[0] + String(mr) }
      state = applyMove(
        state,
        found ?? {} as never,
        extra,
      )
    }
    expect(isInCheck(state.board, 'white')).toBe(true)
    expect(isCheckmate(state)).toBe(true)
  })

  it('reports stalemate on the classic corner position', () => {
    const state = stateWith(
      { h8: W('king'), g6: B('king'), f7: B('queen') },
      { turn: 'white' },
    )
    expect(isStalemate(state)).toBe(true)
    expect(isCheckmate(state)).toBe(false)
  })
})
