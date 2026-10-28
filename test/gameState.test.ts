import { describe, it, expect } from 'vitest'
import { createInitialGameState, countPieces, pieceAt } from '@state/initialState'
import { applyMove, undoLastMove, tickClock } from '@state/gameState'
import { serialize, deserialize, DeserializationError } from '@state/serialize'
import { ALL_SQUARES, isSquare, squareAt, step, isDarkSquare } from '@engine/squares'

describe('squares', () => {
  it('exposes exactly 64 unique squares', () => {
    expect(ALL_SQUARES).toHaveLength(64)
    expect(new Set(ALL_SQUARES).size).toBe(64)
  })
  it('validates square names', () => {
    expect(isSquare('e4')).toBe(true)
    expect(isSquare('i1')).toBe(false)
    expect(isSquare('a9')).toBe(false)
    expect(isSquare('e')).toBe(false)
  })
  it('computes neighbors and null off-board', () => {
    expect(step('a1', -1, 0)).toBeNull()
    expect(step('e4', 0, 1)).toBe('e5')
    expect(squareAt(7, 7)).toBe('h8')
    expect(squareAt(8, 0)).toBeNull()
  })
  it('knows square colors (a1 dark)', () => {
    expect(isDarkSquare('a1')).toBe(true)
    expect(isDarkSquare('b1')).toBe(false)
  })
})

describe('initial state factory', () => {
  it('creates the standard 32-piece starting position with White to move', () => {
    const state = createInitialGameState()
    expect(countPieces(state)).toBe(32)
    expect(state.turn).toBe('white')
    expect(pieceAt(state, 'e1')).toEqual({ type: 'king', color: 'white' })
    expect(pieceAt(state, 'a8')).toEqual({ type: 'rook', color: 'black' })
    expect(pieceAt(state, 'h7')).toEqual({ type: 'pawn', color: 'black' })
    expect(state.castling).toEqual({ K: true, Q: true, k: true, q: true })
    expect(state.history).toHaveLength(0)
  })
})

describe('applyMove immutability', () => {
  it('does not mutate the input state', () => {
    const before = createInitialGameState()
    const snapshot = structuredClone(before)
    applyMove(before, { from: 'e2', to: 'e4', piece: 'pawn' })
    expect(before).toEqual(snapshot)
  })
  it('relocates the piece, flips the turn, and pushes history', () => {
    const state = createInitialGameState()
    const next = applyMove(state, { from: 'e2', to: 'e4', piece: 'pawn' }, { newEnPassantTarget: 'e3' })
    expect(pieceAt(next, 'e4')).toEqual({ type: 'pawn', color: 'white' })
    expect(pieceAt(next, 'e2')).toBeUndefined()
    expect(next.turn).toBe('black')
    expect(next.history).toHaveLength(1)
    expect(next.enPassantTarget).toBe('e3')
    expect(pieceAt(next, 'e1')).toEqual({ type: 'king', color: 'white' })
  })
  it('handles en passant capture and promotion structurally', () => {
    let state = createInitialGameState()
    const board: Record<string, { type: string; color: string }> = {}
    for (const sq of ALL_SQUARES) board[sq] = state.board[sq] as never
    // Custom mid-game position: white pawn on e5, black pawn just played d7-d5.
    state = {
      ...state,
      board: {
        ...state.board,
        e5: { type: 'pawn', color: 'white' },
        d5: { type: 'pawn', color: 'black' },
        a1: { type: 'king', color: 'white' },
        h8: { type: 'king', color: 'black' },
      },
      turn: 'white',
    }
    const after = applyMove(
      state,
      { from: 'e5', to: 'd6', piece: 'pawn' },
      { enPassantCapture: 'd5' },
    )
    expect(pieceAt(after, 'd6')).toEqual({ type: 'pawn', color: 'white' })
    expect(pieceAt(after, 'd5')).toBeUndefined()
    expect(pieceAt(after, 'e5')).toBeUndefined()

    const promoted = applyMove(
      { ...after, turn: 'white', board: { ...after.board, e7: { type: 'pawn', color: 'white' } } },
      { from: 'e7', to: 'e8', piece: 'pawn' },
      { promotion: 'queen' },
    )
    expect(pieceAt(promoted, 'e8')).toEqual({ type: 'queen', color: 'white' })
  })
  it('undo restores the exact prior state', () => {
    const state = createInitialGameState()
    const moved = applyMove(state, { from: 'e2', to: 'e4', piece: 'pawn' })
    expect(undoLastMove(moved)).toEqual(state)
  })
  it('undoing a black move restores the previous fullmove number', () => {
    const initial = createInitialGameState()
    const afterWhite = applyMove(initial, { from: 'e2', to: 'e4', piece: 'pawn' })
    const afterBlack = applyMove(afterWhite, { from: 'e7', to: 'e5', piece: 'pawn' })
    expect(afterBlack.fullmoveNumber).toBe(2)
    expect(undoLastMove(afterBlack)).toEqual(afterWhite)
  })
  it('undo on a fresh state is a no-op', () => {
    const state = createInitialGameState()
    expect(undoLastMove(state)).toBe(state)
  })
})

describe('clocks', () => {
  it('ticks only the side to move', () => {
    const state = createInitialGameState({ clock: { white: 300, black: 300 } })
    const ticked = tickClock(state, { seconds: 10 })
    expect(ticked.clock).toEqual({ white: 290, black: 300 })
    expect(ticked.turn).toBe('white')
  })
  it('is a no-op for untimed games and never goes negative', () => {
    const untimed = createInitialGameState()
    expect(tickClock(untimed, { seconds: 5 })).toBe(untimed)
    const state = createInitialGameState({ clock: { white: 2, black: 100 } })
    expect(tickClock(state, { seconds: 10 })!.clock!.white).toBe(0)
  })
})

describe('serialization round-trip', () => {
  it('round-trips a mid-game state with full fidelity', () => {
    const start = createInitialGameState({ clock: { white: 600, black: 600 } })
    const after1 = applyMove(start, { from: 'e2', to: 'e4', piece: 'pawn' }, { newEnPassantTarget: 'e3' })
    const midGame = applyMove(after1, { from: 'e7', to: 'e5', piece: 'pawn' }, { newEnPassantTarget: 'e6' })

    const restored = deserialize(serialize(midGame))
    expect(restored).toEqual(midGame)
    // Edge fields that later features depend on must survive.
    expect(restored.enPassantTarget).toBe('e6')
    expect(restored.clock).toEqual({ white: 600, black: 600 })
    expect(restored.castling).toEqual({ K: true, Q: true, k: true, q: true })
    expect(restored.history).toHaveLength(2)
    expect(restored.fullmoveNumber).toBe(2)
  })
  it('round-trips a state with null enPassant and null clock', () => {
    const state = createInitialGameState()
    expect(deserialize(serialize(state))).toEqual(state)
  })
  it('rejects corrupt saves with a typed error', () => {
    expect(() => deserialize('not json')).toThrow(DeserializationError)
    expect(() => deserialize(JSON.stringify({ version: 99, state: {} }))).toThrow(DeserializationError)
    expect(() =>
      deserialize(JSON.stringify({ version: 1, state: { board: { zz: {} }, turn: 'white' } })),
    ).toThrow(DeserializationError)
    expect(() =>
      deserialize(JSON.stringify({ version: 1, state: { board: {}, turn: 'purple' } })),
    ).toThrow(DeserializationError)
  })
})
