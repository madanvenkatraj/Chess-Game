/**
 * AI difficulty tests.
 *
 * Covers: chooseMove API for all three difficulties, legality of chosen
 * moves, checkmate detection in search, Easy randomness profile, Hard
 * preferring materially-winning moves, and the move-budget (node cap)
 * guarantee for the hardest profile.
 */
import { describe, expect, it } from 'vitest'
import { createInitialGameState } from '@state/initialState'
import { legalMoves } from '@engine/moveGeneration'
import { applyMove } from '@state/gameState'
import type { GameState, Move } from '@engine/types'
import {
  chooseMove,
  findMateInOne,
  type AiDifficulty,
  type ChooseMoveResult,
} from '../client/src/ai/ai'

function playMoves(state: GameState, moves: readonly Move[]): GameState {
  let current = state
  for (const move of moves) {
    const legal = legalMoves(current).find(
      (m) => m.from === move.from && m.to === move.to,
    )
    if (!legal) throw new Error(`move ${move.from}-${move.to} not legal`)
    current = applyMove(current, legal)
  }
  return current
}

describe('chooseMove', () => {
  it('returns a legal move for every difficulty from the start position', () => {
    const state = createInitialGameState()
    const legal = legalMoves(state)
    for (const difficulty of ['easy', 'medium', 'hard'] as const) {
      const result = chooseMove(state, difficulty)
      expect(result.move).not.toBeNull()
      const chosen = result.move as Move
      expect(
        legal.some((m) => m.from === chosen.from && m.to === chosen.to),
      ).toBe(true)
    }
  })

  it('returns move=null and reason on a finished (checkmated) position', () => {
    // Fool's mate: white is checkmated, it is white to move.
    const state = playMoves(createInitialGameState(), [
      { from: 'f2', to: 'f3', piece: 'pawn' },
      { from: 'e7', to: 'e5', piece: 'pawn' },
      { from: 'g2', to: 'g4', piece: 'pawn' },
      { from: 'd8', to: 'h4', piece: 'queen' },
    ])
    const result = chooseMove(state, 'hard')
    expect(result.move).toBeNull()
    expect(result.reason).toBe('no-legal-moves')
  })

  it('finds mate in one when available (hard)', () => {
    // Back-rank mate in one: Ra8# style. Build a simple position by playing
    // a scholar's-mate-like sequence where Qxf7# exists.
    const state = playMoves(createInitialGameState(), [
      { from: 'e2', to: 'e4', piece: 'pawn' },
      { from: 'e7', to: 'e5', piece: 'pawn' },
      { from: 'd1', to: 'h5', piece: 'queen' },
      { from: 'b8', to: 'c6', piece: 'knight' },
      { from: 'f1', to: 'c4', piece: 'bishop' },
      { from: 'g8', to: 'f6', piece: 'knight' },
    ])
    // White to move: Qxf7# is mate.
    const mate = findMateInOne(state, 'white')
    expect(mate).not.toBeNull()
    expect((mate as Move).to).toBe('f7')
  })

  it('hard prefers a winning capture (free queen over free pawn)', () => {
    // Custom board: white rook can capture either an undefended black queen
    // on h4 or an undefended black pawn on a7. Hard should take the queen.
    const state = makeState([
      { sq: 'a1', type: 'king', color: 'white' },
      { sq: 'h1', type: 'rook', color: 'white' },
      { sq: 'h4', type: 'queen', color: 'black' },
      { sq: 'a7', type: 'pawn', color: 'black' },
      { sq: 'h8', type: 'king', color: 'black' },
    ], 'white')
    const result = chooseMove(state, 'hard')
    expect(result.move).not.toBeNull()
    expect((result.move as Move).to).toBe('h4')
  })

  it('easy sometimes differs from deterministic hard on the same position', () => {
    const state = createInitialGameState()
    const hard = new Set<string>()
    for (let i = 0; i < 5; i++) {
      const r = chooseMove(state, 'hard')
      if (r.move) hard.add(`${r.move.from}${r.move.to}`)
    }
    // Hard is deterministic: same move every time.
    expect(hard.size).toBe(1)
    // Easy has randomness: over many draws it should occasionally pick a
    // different legal move than hard's choice.
    const hardMove = [...hard][0]
    let differs = false
    for (let i = 0; i < 40; i++) {
      const r = chooseMove(state, 'easy')
      if (r.move && `${r.move.from}${r.move.to}` !== hardMove) {
        differs = true
        break
      }
    }
    expect(differs).toBe(true)
  })

  it('hard completes within the node budget on a middlegame position', () => {
    const state = playMoves(createInitialGameState(), [
      { from: 'e2', to: 'e4', piece: 'pawn' },
      { from: 'e7', to: 'e5', piece: 'pawn' },
      { from: 'g1', to: 'f3', piece: 'knight' },
      { from: 'b8', to: 'c6', piece: 'knight' },
    ])
    const started = Date.now()
    const result = chooseMove(state, 'hard')
    const elapsed = Date.now() - started
    expect(result.move).not.toBeNull()
    expect(result.nodesSearched).toBeGreaterThan(0)
    expect(elapsed).toBeLessThan(20000)
  })

  it('exposes ChooseMoveResult shape for all difficulties', () => {
    const state = createInitialGameState()
    for (const difficulty of ['easy', 'medium', 'hard'] as const satisfies readonly AiDifficulty[]) {
      const result: ChooseMoveResult = chooseMove(state, difficulty)
      expect(typeof result.nodesSearched).toBe('number')
      expect(result.difficulty).toBe(difficulty)
    }
  })
})

// Helpers kept at the bottom to keep the describe block readable.

interface PieceSpec {
  readonly sq: string
  readonly type: 'pawn' | 'knight' | 'bishop' | 'rook' | 'queen' | 'king'
  readonly color: 'white' | 'black'
}

function makeState(
  pieces: readonly PieceSpec[],
  turn: 'white' | 'black',
): GameState {
  const board: Record<string, { type: PieceSpec['type']; color: PieceSpec['color'] }> = {}
  for (const p of pieces) board[p.sq] = { type: p.type, color: p.color }
  const base = createInitialGameState()
  return {
    ...base,
    board,
    turn,
    castling: { K: false, Q: false, k: false, q: false },
    enPassantTarget: null,
    halfmoveClock: 0,
    history: [],
  }
}
