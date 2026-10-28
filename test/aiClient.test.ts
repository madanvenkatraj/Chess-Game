/**
 * Tests for the AI worker protocol and the promise-based aiClient bridge.
 * Uses a fake Worker so no browser environment is needed: the fake records
 * posted messages and lets each test reply as a real worker would.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GameState } from '@engine/types'
import { createInitialGameState } from '@state/initialState'
import { handleSearchRequest } from '../client/src/ai/ai.worker'
import {
  cancelPendingAiRequest,
  hasPendingAiRequest,
  requestAiMove,
  setWorkerForTesting,
  shutdownAiWorker,
} from '../client/src/ai/aiClient'

interface FakeWorker {
  postMessage(message: unknown): void
  terminate(): void
  onmessage: ((event: { data: unknown }) => void) | null
  onerror: ((event: { message?: string }) => void) | null
}

function makeFakeWorker(): { worker: FakeWorker; sent: unknown[]; reply: (data: unknown) => void } {
  const sent: unknown[] = []
  const worker: FakeWorker = {
    postMessage(message) {
      sent.push(message)
    },
    terminate() {},
    onmessage: null,
    onerror: null,
  }
  return { worker, sent, reply: (data) => worker.onmessage?.({ data }) }
}

const state: GameState = createInitialGameState()

describe('ai worker protocol', () => {
  it('returns a legal move with the request id echoed', () => {
    const response = handleSearchRequest({ id: 7, difficulty: 'medium', state })
    expect(response.id).toBe(7)
    expect(response.move).not.toBeNull()
    expect(response.reason).toBeNull()
    expect(response.nodesSearched).toBeGreaterThan(0)
  })

  it('reports no-legal-moves on a finished position', () => {
    const response = handleSearchRequest({ id: 1, difficulty: 'hard', state })
    expect(response.move).not.toBeNull() // start position has moves
    const finished = handleSearchRequest({ id: 2, difficulty: 'easy', state: { ...state, board: {}, turn: 'white' } })
    expect(finished.move).toBeNull()
    expect(finished.reason).toBe('no-legal-moves')
  })
})

describe('aiClient', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })
  afterEach(() => {
    shutdownAiWorker()
  })

  it('sends state+difficulty and resolves with the move reply', async () => {
    const { worker, sent, reply } = makeFakeWorker()
    setWorkerForTesting(worker)
    const promise = requestAiMove(state, 'hard')
    expect(hasPendingAiRequest()).toBe(true)
    expect(sent.length).toBe(1)
    const request = sent[0] as { id: number; difficulty: string; state: GameState }
    expect(request.difficulty).toBe('hard')
    expect(request.state.turn).toBe('white')
    reply({ id: request.id, move: { from: 'e2', to: 'e4', piece: 'pawn' }, reason: null, nodesSearched: 123 })
    const result = await promise
    expect(result.move?.from).toBe('e2')
    expect(result.nodesSearched).toBe(123)
    expect(hasPendingAiRequest()).toBe(false)
  })

  it('rejects a pending request when a new one supersedes it', async () => {
    const { worker, sent, reply } = makeFakeWorker()
    setWorkerForTesting(worker)
    const first = requestAiMove(state, 'easy')
    const second = requestAiMove(state, 'hard')
    await expect(first).rejects.toBe('superseded')
    expect(sent.length).toBe(2)
    const last = sent[1] as { id: number }
    reply({ id: last.id, move: null, reason: 'no-legal-moves', nodesSearched: 0 })
    await expect(second).resolves.toMatchObject({ move: null, reason: 'no-legal-moves' })
  })

  it('rejects on cancelPendingAiRequest (undo/restart guard)', async () => {
    const { worker } = makeFakeWorker()
    setWorkerForTesting(worker)
    const promise = requestAiMove(state, 'medium')
    cancelPendingAiRequest()
    await expect(promise).rejects.toBe('cancelled')
  })

  it('rejects when the worker reports an error', async () => {
    const { worker, sent, reply } = makeFakeWorker()
    setWorkerForTesting(worker)
    const promise = requestAiMove(state, 'hard')
    const request = sent[0] as { id: number }
    reply({ id: request.id, error: 'search blew up' })
    await expect(promise).rejects.toThrow('search blew up')
  })

  it('rejects via onerror and clears the pending slot', async () => {
    const { worker } = makeFakeWorker()
    setWorkerForTesting(worker)
    const promise = requestAiMove(state, 'hard')
    worker.onerror?.({ message: 'worker crashed' })
    await expect(promise).rejects.toThrow('worker crashed')
    expect(hasPendingAiRequest()).toBe(false)
  })

  it('ignores stale replies with unknown ids', async () => {
    const { worker, sent, reply } = makeFakeWorker()
    setWorkerForTesting(worker)
    const promise = requestAiMove(state, 'easy')
    reply({ id: 9999, move: null, reason: 'no-legal-moves', nodesSearched: 0 })
    expect(hasPendingAiRequest()).toBe(true)
    const request = sent[0] as { id: number }
    reply({ id: request.id, move: { from: 'd2', to: 'd4', piece: 'pawn' }, reason: null, nodesSearched: 5 })
    const result = await promise
    expect(result.move?.to).toBe('d4')
  })
})
