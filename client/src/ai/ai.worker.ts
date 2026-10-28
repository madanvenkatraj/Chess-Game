/**
 * AI worker entry — runs the search off the main thread.
 *
 * Bundled by Vite as a module worker (`import AiWorker from '@ai/ai.worker?worker'`).
 * Message protocol (both directions JSON/structured-clone safe — GameState is
 * plain data by contract in @engine/types):
 *
 *   in:  { id: number, difficulty: 'easy' | 'medium' | 'hard',
 *          state: GameState }
 *   out: { id: number, move: Move | null,
 *          reason: 'no-legal-moves' | null, nodesSearched: number }
 *
 * Search failures are reported as `{ id, error }` so the client can reject
 * its promise instead of hanging.
 */
import type { GameState, Move } from '@engine/types'
import { chooseMove, type AiDifficulty, type ChooseMoveResult } from './ai'

interface SearchRequest {
  readonly id: number
  readonly difficulty: AiDifficulty
  readonly state: GameState
}

export interface SearchResponse {
  readonly id: number
  readonly move: Move | null
  readonly reason: ChooseMoveResult['reason']
  readonly difficulty: AiDifficulty
  readonly nodesSearched: number
}

/** Pure handler, exported so tests can drive the exact worker protocol. */
export function handleSearchRequest(request: SearchRequest): SearchResponse {
  const result = chooseMove(request.state, request.difficulty)
  return {
    id: request.id,
    move: result.move,
    reason: result.reason,
    difficulty: result.difficulty,
    nodesSearched: result.nodesSearched,
  }
}

if (typeof self !== 'undefined' && typeof (self as { onmessage?: unknown }).onmessage !== 'function') {
  self.onmessage = (event: MessageEvent<SearchRequest>) => {
    const request = event.data
    if (typeof request?.id !== 'number') return
    try {
      self.postMessage(handleSearchRequest(request))
    } catch (err) {
      self.postMessage({
        id: request.id,
        error: err instanceof Error ? err.message : 'ai-search-failed',
      })
    }
  }
}
