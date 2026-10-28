/**
 * AI layer: difficulty-parameterized move selection for the chess game.
 *
 * Pure module — no DOM, no state mutation. The search advances positions
 * exclusively through the engine's own immutable `applyMove` (via a legal
 * move application helper) so en passant, castling and promotion stay
 * correct inside the search tree.
 *
 * Difficulty profiles:
 * - easy:   depth 1, 30% fully random legal move, random tie-breaking.
 * - medium: depth 3, deterministic search, random tie-breaking among equals.
 * - hard:   depth 4 (iterative deepening under a node cap), capture-first
 *           move ordering, deterministic choice.
 *
 * Every profile respects a hard node cap so a move never blocks the UI
 * budget (see MAX_NODES); hard degrades gracefully by returning the best
 * move found at the last completed depth.
 */
import type { Board, Color, GameState, Move, Piece, PieceType, Square } from '@engine/types'
import { legalMoves, isInCheck } from '@engine/moveGeneration'
import { applyMove } from '@state/gameState'
import { fileOf, rankOf } from '@engine/squares'

export type AiDifficulty = 'easy' | 'medium' | 'hard'

export interface ChooseMoveResult {
  /** The chosen move, or null when there are no legal moves. */
  readonly move: Move | null
  /** Why no move was produced (null when a move exists). */
  readonly reason: 'no-legal-moves' | null
  readonly difficulty: AiDifficulty
  /** Positions visited by the search — diagnostics / budget evidence. */
  readonly nodesSearched: number
}

const MATERIAL: Readonly<Record<PieceType, number>> = {
  pawn: 100,
  knight: 320,
  bishop: 330,
  rook: 500,
  queen: 900,
  king: 0,
}

/** Piece-square tables from white's point of view, rank 8 first. */
const PIECE_SQUARES: Readonly<Record<PieceType, readonly number[]>> = {
  pawn: [
      0,  0,  0,  0,  0,  0,  0,  0,
     50, 50, 50, 50, 50, 50, 50, 50,
     10, 10, 20, 30, 30, 20, 10, 10,
      5,  5, 10, 25, 25, 10,  5,  5,
      0,  0,  0, 20, 20,  0,  0,  0,
      5, -5,-10,  0,  0,-10, -5,  5,
      5, 10, 10,-20,-20, 10, 10,  5,
      0,  0,  0,  0,  0,  0,  0,  0,
  ],
  knight: [
    -50,-40,-30,-30,-30,-30,-40,-50,
    -40,-20,  0,  0,  0,  0,-20,-40,
    -30,  0, 10, 15, 15, 10,  0,-30,
    -30,  5, 15, 20, 20, 15,  5,-30,
    -30,  0, 15, 20, 20, 15,  0,-30,
    -30,  5, 10, 15, 15, 10,  5,-30,
    -40,-20,  0,  5,  5,  0,-20,-40,
    -50,-40,-30,-30,-30,-30,-40,-50,
  ],
  bishop: [
    -20,-10,-10,-10,-10,-10,-10,-20,
    -10,  0,  0,  0,  0,  0,  0,-10,
    -10,  0,  5, 10, 10,  5,  0,-10,
    -10,  5,  5, 10, 10,  5,  5,-10,
    -10,  0, 10, 10, 10, 10,  0,-10,
    -10, 10, 10, 10, 10, 10, 10,-10,
    -10,  5,  0,  0,  0,  0,  5,-10,
    -20,-10,-10,-10,-10,-10,-10,-20,
  ],
  rook: [
      0,  0,  0,  0,  0,  0,  0,  0,
      5, 10, 10, 10, 10, 10, 10,  5,
     -5,  0,  0,  0,  0,  0,  0, -5,
     -5,  0,  0,  0,  0,  0,  0, -5,
     -5,  0,  0,  0,  0,  0,  0, -5,
     -5,  0,  0,  0,  0,  0,  0, -5,
     -5,  0,  0,  0,  0,  0,  0, -5,
      0,  0,  0,  5,  5,  0,  0,  0,
  ],
  queen: [
    -20,-10,-10, -5, -5,-10,-10,-20,
    -10,  0,  0,  0,  0,  0,  0,-10,
    -10,  0,  5,  5,  5,  5,  0,-10,
     -5,  0,  5,  5,  5,  5,  0, -5,
      0,  0,  5,  5,  5,  5,  0, -5,
    -10,  5,  5,  5,  5,  5,  0,-10,
    -10,  0,  5,  0,  0,  0,  0,-10,
    -20,-10,-10, -5, -5,-10,-10,-20,
  ],
  king: [
    -30,-40,-40,-50,-50,-40,-40,-30,
    -30,-40,-40,-50,-50,-40,-40,-30,
    -30,-40,-40,-50,-50,-40,-40,-30,
    -30,-40,-40,-50,-50,-40,-40,-30,
    -20,-30,-30,-40,-40,-30,-30,-20,
    -10,-20,-20,-20,-20,-20,-20,-10,
     20, 20,  0,  0,  0,  0, 20, 20,
     20, 30, 10,  0,  0, 10, 30, 20,
  ],
}

/** MATE score: losing side is -MATE + ply so earlier mates score better. */
const MATE = 100000
/** Hard node cap shared by every profile — keeps any move under ~2s. */
const MAX_NODES = 5_000

interface DifficultyProfile {
  readonly depth: number
  readonly randomChance: number
  readonly ordered: boolean
  readonly iterative: boolean
  /** Hard must be deterministic: ties resolved by move order, not chance. */
  readonly deterministic: boolean
}

const PROFILES: Readonly<Record<AiDifficulty, DifficultyProfile>> = {
  easy: { depth: 1, randomChance: 0.3, ordered: false, iterative: false, deterministic: false },
  medium: { depth: 3, randomChance: 0, ordered: false, iterative: false, deterministic: false },
  hard: { depth: 4, randomChance: 0, ordered: true, iterative: true, deterministic: true },
}

/** Static evaluation from the point of view of `side`. Positive = good. */
export function evaluate(board: Board, side: Color): number {
  let score = 0
  for (const square of Object.keys(board)) {
    const piece = board[square] as Piece
    const table = PIECE_SQUARES[piece.type]
    const idx = (7 - rankOf(square)) * 8 + fileOf(square)
    const value = MATERIAL[piece.type] + table[idx]!
    score += piece.color === 'white' ? value : -value
  }
  return side === 'white' ? score : -score
}

/** All structural options needed to apply `move` legally on `state`. */
function applyOptionsFor(
  state: GameState,
  move: Move,
): Parameters<typeof applyMove>[2] {
  if (move.piece === 'pawn' && move.to === state.enPassantTarget) {
    const captured = `${fileOf(move.to)}${rankOf(move.from)}` as Square
    if (state.board[captured]?.type === 'pawn') return { enPassantCapture: captured }
  }
  const fileDistance = Math.abs(
    fileOf(move.to) - fileOf(move.from),
  )
  if (move.piece === 'king' && fileDistance === 2) {
    const side = fileOf(move.to) > fileOf(move.from) ? 'K' : 'Q'
    const rank = rankOf(move.from) === 0 ? '1' : '8'
    const rookFrom = `${side === 'K' ? 'h' : 'a'}${rank}` as Square
    const rookTo = `${side === 'K' ? 'f' : 'd'}${rank}` as Square
    return { rookFrom, rookTo }
  }
  if (move.promotion !== undefined) return { promotion: move.promotion }
  if (
    move.piece === 'pawn'
    && Math.abs(rankOf(move.to) - rankOf(move.from)) === 2
  ) {
    const midRank = (rankOf(move.from) + rankOf(move.to)) / 2
    return { newEnPassantTarget: `${fileOf(move.from)}${midRank}` as Square }
  }
  return {}
}

/** Quiescence-lite: extend one ply for captures so search doesn't stop mid-exchange. */
function quiescence(
  state: GameState,
  alpha: number,
  beta: number,
  side: Color,
  nodes: { count: number },
): number {
  const stand = evaluate(state.board, side)
  if (stand >= beta) return beta
  if (stand > alpha) alpha = stand
  const captures = legalMoves(state).filter((move) => state.board[move.to] !== undefined)
  for (const move of captures) {
    nodes.count++
    if (nodes.count > MAX_NODES) break
    const next = applyMove(state, move, applyOptionsFor(state, move))
    const score = -quiescence(next, -beta, -alpha, side, nodes)
    if (score >= beta) return beta
    if (score > alpha) alpha = score
    if (alpha >= beta) break
  }
  return alpha
}

interface SearchContext {
  readonly side: Color
  readonly nodes: { count: number }
  readonly ordered: boolean
}

function orderedMoves(state: GameState, moves: readonly Move[]): Move[] {
  return [...moves].sort((a, b) => captureScore(state, b) - captureScore(state, a))
}

function captureScore(state: GameState, move: Move): number {
  const victim = state.board[move.to]
  const victimValue = victim ? MATERIAL[victim.type] : 0
  const attackerValue = MATERIAL[move.piece]
  return victimValue * 10 - attackerValue + (move.promotion ? 800 : 0)
}

/**
 * Negamax alpha-beta. Score is always from the point of view of the side
 * to move at the current node; the side parameter is the search's root
 * perspective used at the leaf.
 */
function negamax(
  state: GameState,
  depth: number,
  alpha: number,
  beta: number,
  ply: number,
  ctx: SearchContext,
): number {
  ctx.nodes.count++
  const side = state.turn
  if (ctx.nodes.count > MAX_NODES) return evaluate(state.board, ctx.side)
  if (isInCheck(state.board, side) && depth <= 0) {
    // Check extension: don't stop the search while in check.
    depth = 1
  }
  if (depth <= 0) return quiescence(state, alpha, beta, ctx.side, ctx.nodes)
  const moves = legalMoves(state)
  if (moves.length === 0) {
    return isInCheck(state.board, side) ? -MATE + ply : 0
  }
  const ordered = ctx.ordered ? orderedMoves(state, moves) : moves
  let best = -Infinity
  for (const move of ordered) {
    const next = applyMove(state, move, applyOptionsFor(state, move))
    const score = -negamax(next, depth - 1, -beta, -alpha, ply + 1, ctx)
    if (score > best) best = score
    if (best > alpha) alpha = best
    if (alpha >= beta) break
  }
  return best
}

interface RootChoice {
  readonly move: Move
  readonly score: number
}

function searchRoot(state: GameState, depth: number, ctx: SearchContext): RootChoice[] {
  const moves = legalMoves(state)
  const ordered = ctx.ordered ? orderedMoves(state, moves) : moves
  const choices: RootChoice[] = []
  let alpha = -Infinity
  for (const move of ordered) {
    const next = applyMove(state, move, applyOptionsFor(state, move))
    const score = -negamax(next, depth - 1, -Infinity, -alpha, 1, ctx)
    choices.push({ move, score })
    if (score > alpha) alpha = score
  }
  return choices
}

/** If a mate in one exists for `side`, return it; otherwise null. */
export function findMateInOne(state: GameState, side: Color): Move | null {
  for (const move of legalMoves(state)) {
    const next = applyMove(state, move, applyOptionsFor(state, move))
    if (next.turn !== side && isInCheck(next.board, next.turn) && legalMoves(next).length === 0) {
      return move
    }
  }
  return null
}

function shuffle<T>(items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const tmp = items[i]!
    items[i] = items[j]!
    items[j] = tmp
  }
  return items
}

/**
 * Choose a move for the side to move in `state` at the given difficulty.
 * Pure: never mutates `state`, never mutates the engine's inputs.
 */
export function chooseMove(state: GameState, difficulty: AiDifficulty): ChooseMoveResult {
  const profile = PROFILES[difficulty]
  const moves = legalMoves(state)
  if (moves.length === 0) {
    return { move: null, reason: 'no-legal-moves', difficulty, nodesSearched: 0 }
  }

  // Easy: sometimes just play something random.
  if (profile.randomChance > 0 && Math.random() < profile.randomChance) {
    const pick = moves[Math.floor(Math.random() * moves.length)]!
    return { move: pick, reason: null, difficulty, nodesSearched: 0 }
  }

  const ctx: SearchContext = {
    side: state.turn,
    nodes: { count: 0 },
    ordered: profile.ordered,
  }

  if (profile.iterative) {
    // Iterative deepening: reuse nothing between depths (positions are
    // cheap to re-search here) but stop as soon as the node cap is hit.
    let best: RootChoice | null = null
    for (let depth = 1; depth <= profile.depth; depth++) {
      const choices = searchRoot(state, depth, ctx)
      if (ctx.nodes.count > MAX_NODES && depth > 1) break
      best = pickBest(choices, moves, profile.deterministic)
      if (Math.abs(best.score) > MATE / 2) break // mate found; stop deepening
    }
    return {
      move: (best as RootChoice).move,
      reason: null,
      difficulty,
      nodesSearched: ctx.nodes.count,
    }
  }

  const choices = searchRoot(state, profile.depth, ctx)
  const best = pickBest(choices, moves, profile.deterministic)
  return { move: best.move, reason: null, difficulty, nodesSearched: ctx.nodes.count }
}

/** Pick the top choice; hard breaks ties by move order, others randomly. */
function pickBest(choices: readonly RootChoice[], moves: readonly Move[], deterministic: boolean): RootChoice {
  let bestScore = -Infinity
  for (const c of choices) if (c.score > bestScore) bestScore = c.score
  const winners = choices.filter((c) => c.score === bestScore)
  const winner = deterministic ? winners[0]! : shuffle(winners)[0]!
  void moves
  return winner
}

/** Convenience for the UI: get just the move, or null. */
export function pickAiMove(state: GameState, difficulty: AiDifficulty): Move | null {
  return chooseMove(state, difficulty).move
}
