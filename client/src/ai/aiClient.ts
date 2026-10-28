/**
 * Promise-based bridge between the Game Board controller and the AI worker.
 *
 * Spawns the Vite-bundled worker once per page and multiplexes requests by
 * id. Each call resolves with the computed move. A single request at a time
 * is expected (the UI flow serializes turns), so a new request cancels any
 * prior pending one by rejecting it with 'superseded'.
 */
import type { GameState, Move } from '@engine/types'
import type { AiDifficulty } from './ai'

export type { AiDifficulty } from './ai'

export interface AiMoveResult {
  readonly move: Move | null
  readonly reason: 'no-legal-moves' | null
  readonly nodesSearched: number
}

interface WorkerLike {
  postMessage(message: unknown): void
  terminate(): void
  onmessage: ((event: { data: unknown }) => void) | null
  onerror: ((event: { message?: string }) => void) | null
}

let worker: WorkerLike | null = null
let nextId = 1
let pending:
  | {
      readonly id: number
      resolve: (result: AiMoveResult) => void
      reject: (reason: unknown) => void
    }
  | null = null

function spawnWorker(): WorkerLike {
  // In a Vite build this resolves to the bundled worker entry; Node tests
  // inject a fake via setWorkerForTesting and never hit this path.
  const WorkerCtor = (
    globalThis as { Worker?: new (url: string, opts: { type: 'module' }) => WorkerLike }
  ).Worker
  if (!WorkerCtor) throw new Error('aiClient: no Worker constructor available')
  // The worker entry is served at this URL by server.js's static handler and
  // bundled to the same path by Vite's build output.
  return new WorkerCtor('/src/ai/ai.worker.bundle.js', { type: 'module' })
}

/**
 * Replace the underlying worker. Used by tests to install a fake worker
 * implementing the same message protocol.
 */
export function setWorkerForTesting(fake: WorkerLike | null): void {
  if (worker) {
    worker.terminate()
  }
  worker = fake
}

function ensureWorker(): WorkerLike {
  if (!worker) worker = spawnWorker()
  return worker
}

function wireOnce(w: WorkerLike): void {
  if (w.onmessage) return
  w.onmessage = (event) => {
    const data = event.data as { id?: number; move?: Move | null; reason?: AiMoveResult['reason']; nodesSearched?: number; error?: string }
    if (!pending || data.id !== pending.id) return
    const { resolve, reject } = pending
    pending = null
    if (data.error !== undefined) {
      reject(new Error(data.error))
      return
    }
    resolve({
      move: data.move ?? null,
      reason: data.reason ?? null,
      nodesSearched: data.nodesSearched ?? 0,
    })
  }
  w.onerror = (event) => {
    if (!pending) return
    const { reject } = pending
    pending = null
    reject(new Error(event.message || 'ai worker error'))
  }
}

export function requestAiMove(state: GameState, difficulty: AiDifficulty): Promise<AiMoveResult> {
  if (pending) {
    const { reject } = pending
    pending = null
    reject('superseded')
  }
  const w = ensureWorker()
  wireOnce(w)
  const id = nextId++
  return new Promise<AiMoveResult>((resolve, reject) => {
    pending = { id, resolve, reject }
    w.postMessage({ id, difficulty, state })
  })
}

export function hasPendingAiRequest(): boolean {
  return pending !== null
}

export function cancelPendingAiRequest(): void {
  if (pending) {
    const { reject } = pending
    pending = null
    reject('cancelled')
  }
}

export function shutdownAiWorker(): void {
  cancelPendingAiRequest()
  if (worker) {
    worker.terminate()
    worker = null
  }
}
