import { describe, it, expect } from 'vitest'
import { createInitialGameState } from '@state/initialState'
import { tickClock, isFlagFall, flagFallResult, applyMove } from '@state/gameState'
import type { GameState, Move } from '@engine/types'

const e2e4: Move = { from: 'e2', to: 'e4', piece: 'pawn' }

function timed(white = 300, black = 300): GameState {
  return createInitialGameState({ clock: { white, black } })
}

describe('flag-fall', () => {
  it('reports false for an untimed game', () => {
    expect(isFlagFall(createInitialGameState())).toBe(false)
  })

  it('reports false while the side to move still has time', () => {
    expect(isFlagFall(timed(5, 0))).toBe(false) // white to move with 5s, black is the one at zero
  })

  it('reports true when the side to move has exactly zero seconds', () => {
    // White is to move with 0 seconds — the flag has fallen.
    const state: GameState = { ...timed(0, 10), turn: 'white' }
    expect(isFlagFall(state)).toBe(true)
  })

  it('reports true only for the side to move, not the opponent', () => {
    const state: GameState = { ...timed(0, 10), turn: 'black' }
    expect(isFlagFall(state)).toBe(false)
  })
})

describe('flagFallResult', () => {
  it('gives the opponent the win by timeout', () => {
    const state: GameState = { ...timed(0, 10), turn: 'white' }
    expect(flagFallResult(state)).toEqual({ winner: 'black', reason: 'timeout' })
  })

  it('is symmetric for black flagging', () => {
    const state: GameState = { ...timed(10, 0), turn: 'black' }
    expect(flagFallResult(state)).toEqual({ winner: 'white', reason: 'timeout' })
  })

  it('throws on an untimed game', () => {
    expect(() => flagFallResult(createInitialGameState())).toThrow(/untimed/i)
  })
})

describe('clock interplay with moves and undo', () => {
  it('applyMove preserves the clock reading (UI charges the mover separately)', () => {
    const moved = applyMove(timed(300, 300), e2e4)
    expect(moved.clock).toEqual({ white: 300, black: 300 })
    expect(moved.turn).toBe('black')
  })

  it('tickClock never goes below zero and keeps the opponent untouched', () => {
    const ticked = tickClock(timed(1, 300), { seconds: 10 })
    expect(ticked.clock).toEqual({ white: 0, black: 300 })
  })

  it('tickClock on an untimed game is the identity', () => {
    const state = createInitialGameState()
    expect(tickClock(state, { seconds: 5 })).toBe(state)
  })

  it('tickClock freezes at zero across repeated ticks (no double-decrement drift)', () => {
    let state = timed(1, 60)
    state = tickClock(state, { seconds: 1 })
    state = tickClock(state, { seconds: 1 })
    state = tickClock(state, { seconds: 1 })
    expect(state.clock).toEqual({ white: 0, black: 60 })
    expect(isFlagFall(state)).toBe(true)
  })
})
