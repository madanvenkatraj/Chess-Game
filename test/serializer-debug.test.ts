import { describe, it, expect } from 'vitest'
import { createInitialGameState } from '@state/initialState'
import { applyMove } from '@state/gameState'
import { serialize, deserialize } from '@state/serialize'

describe('serializer debug', () => {
  it('turn after two moves', () => {
    let state = createInitialGameState()
    state = applyMove(state, { from: 'e2', to: 'e4', piece: 'pawn' })
    console.log('after e4, turn =', state.turn, 'history =', state.history.length)
    state = applyMove(state, { from: 'e7', to: 'e5', piece: 'pawn' })
    console.log('after e5, turn =', state.turn, 'history =', state.history.length)
    const rt = deserialize(serialize(state))
    console.log('roundtrip turn =', rt.turn, 'history =', rt.history.length)
    expect(rt.turn).toBe(state.turn)
  })
})
