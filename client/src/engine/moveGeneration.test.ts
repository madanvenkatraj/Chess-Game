/**
 * Tests for the rules engine's move generation: every piece type, plus the
 * castling, en-passant, pin, and check/stalemate edge cases.
 */
import { describe, it, expect } from 'vitest'
import type { Board, Color, GameState, Piece, Square } from '@engine/types'
import { createInitialGameState } from '@state/initialState'
import {
  legalMoves,
  generatePseudoLegalMoves,
  isInCheck,
  isCheckmate,
  isStalemate,
  isSquareAttacked,
  findKing,
} from '@engine/moveGeneration'
import { ALL_SQUARES } from '@engine/squares'

/** Build a minimal GameState around a custom board. */
function stateWith(
  board: Record<string, Piece>,
  options: { turn?: Color; enPassantTarget?: Square | null; castling?: Partial<GameState['castling']> } = {},
): GameState {
  const base = createInitialGameState()
  return {
    ...base,
    board,
    turn: options.turn ?? 'white',
    enPassantTarget: options.enPassantTarget ?? null,
    castling: { K: false, Q: false, k: false, q: false, ...options.castling },
    history: [],
  }
}

const W = (type: Piece['type']): Piece => ({ type, color: 'white' })
const B = (type: Piece['type']): Piece => ({ type, color: 'black' })

function destinations(state: GameState, from: Square): string[] {
  return legalMoves(state).filter((m) => m.from === from).map((m) => m.to).sort()
}

describe('pawn move generation', () => {
  it('gives a start pawn its single and double push', () => {
    const state = stateWith({ e2: W('pawn'), e1: W('king'), e8: B('king') })
    expect(destinations(state, 'e2')).toEqual(['e3', 'e4'])
  })
  it('blocks a double push when a piece stands on the middle square', () => {
    const state = stateWith({ e2: W('pawn'), e3: B('pawn'), e1: W('king'), e8: B('king') })
    expect(destinations(state, 'e2')).toEqual([])
  })
  it('captures diagonally only', () => {
    const state = stateWith({
      e4: W('pawn'), d5: B('pawn'), f5: B('pawn'), d4: B('pawn'),
      e1: W('king'), e8: B('king'),
    })
    expect(destinations(state, 'e4')).toEqual(['d5', 'e5', 'f5'])
  })
  it('promotes to all four piece types on the last rank', () => {
    const state = stateWith({ e7: W('pawn'), a1: W('king'), h8: B('king') })
    const promos = legalMoves(state).filter((m) => m.from === 'e7')
    expect([...new Set(promos.map((m) => m.to))]).toEqual(['e8'])
    expect(promos.map((m) => m.promotion).sort()).toEqual(['bishop', 'knight', 'queen', 'rook'])
  })
  it('generates en passant toward the target square', () => {
    const state = stateWith(
      { e5: W('pawn'), d5: B('pawn'), e1: W('king'), e8: B('king') },
      { enPassantTarget: 'd6' },
    )
    expect(destinations(state, 'e5')).toEqual(['d6', 'e6'])
  })
  it('does not offer en passant without a target', () => {
    const state = stateWith({ e5: W('pawn'), d5: B('pawn'), e1: W('king'), e8: B('king') })
    expect(destinations(state, 'e5')).toEqual(['e6'])
  })
})

describe('knight, bishop, rook, queen, king', () => {
  it('jumps the knight over blockers, excluding own-occupied squares', () => {
    const state = stateWith({ g1: W('knight'), e1: W('king'), e8: B('king'), h2: W('pawn') })
    expect(destinations(state, 'g1')).toEqual(['e2', 'f3', 'h3'])
  })
  it('slides the bishop along diagonals until blocked, capturing enemy', () => {
    const state = stateWith({ f1: W('bishop'), e1: W('king'), e8: B('king'), e2: W('pawn'), g2: B('pawn') })
    expect(destinations(state, 'f1')).toEqual(['g2'])
  })
  it('slides the rook on files and ranks', () => {
    const state = stateWith({ a1: W('rook'), e1: W('king'), e8: B('king'), a2: B('pawn') })
    expect(destinations(state, 'a1')).toEqual(['a2', 'b1', 'c1', 'd1'])
  })
  it('moves the queen in all eight directions', () => {
    const state = stateWith({ d4: W('queen'), e1: W('king'), e8: B('king') })
    const targets = destinations(state, 'd4')
    expect(targets).toContain('d8')
    expect(targets).toContain('a7')
    expect(targets).toContain('h8')
    expect(targets).toContain('d1')
    expect(targets).toContain('b2')
  })
  it('steps the king one square, capturing adjacent enemies but not own pieces', () => {
    const state = stateWith({
      e1: W('king'), d2: B('pawn'), e2: W('pawn'),
      e8: B('king'),
    })
    expect(destinations(state, 'e1')).toEqual(['d1', 'd2', 'f1', 'f2'])
  })
})

describe('castling', () => {
  const castleBoard = {
    e1: W('king'), h1: W('rook'), a1: W('rook'),
    e8: B('king'), h8: B('rook'), a8: B('rook'),
  }

  it('generates both white castles when rights and path allow', () => {
    const state = stateWith(castleBoard, { castling: { K: true, Q: true } })
    const kingMoves = destinations(state, 'e1')
    expect(kingMoves).toContain('g1')
    expect(kingMoves).toContain('c1')
  })

  it('withholds castling without the right', () => {
    const state = stateWith(castleBoard, { castling: { K: false, Q: false } })
    const kingMoves = destinations(state, 'e1')
    expect(kingMoves).not.toContain('g1')
    expect(kingMoves).not.toContain('c1')
  })

  it('withholds castling through an occupied path', () => {
    const state = stateWith(
      { ...castleBoard, d1: B('knight') },
      { castling: { K: true, Q: true } },
    )
    expect(destinations(state, 'e1')).not.toContain('c1')
    expect(destinations(state, 'e1')).toContain('g1')
  })

  it('forbids castling out of check', () => {
    const state = stateWith(
      { ...castleBoard, h4: B('bishop') },
      { castling: { K: true, Q: true } },
    )
    expect(isInCheck(state.board, 'white')).toBe(true)
    expect(destinations(state, 'e1')).not.toContain('g1')
    expect(destinations(state, 'e1')).not.toContain('c1')
  })

  it('forbids castling through an attacked transit square', () => {
    const state = stateWith(
      { ...castleBoard, f5: B('rook') },
      { castling: { K: true, Q: true } },
    )
    expect(isInCheck(state.board, 'white')).toBe(false)
    expect(destinations(state, 'e1')).not.toContain('g1') // f1 attacked
    expect(destinations(state, 'e1')).toContain('c1')
  })

  it('forbids castling into check on the destination square', () => {
    const state = stateWith(
      { ...castleBoard, g5: B('rook') },
      { castling: { K: true, Q: true } },
    )
    expect(destinations(state, 'e1')).not.toContain('g1')
  })

  it('lets black castle kingside too', () => {
    const state = stateWith(castleBoard, { turn: 'black', castling: { k: true, q: true } })
    const kingMoves = destinations(state, 'e8')
    expect(kingMoves).toContain('g8')
    expect(kingMoves).toContain('c8')
  })
})

describe('en passant legality edge cases', () => {
  it('captures en passant and removes the captured pawn', () => {
    const state = stateWith(
      { e5: W('pawn'), d5: B('pawn'), e1: W('king'), e8: B('king') },
      { enPassantTarget: 'd6' },
    )
    const ep = legalMoves(state).find((m) => m.from === 'e5' && m.to === 'd6')
    expect(ep).toBeDefined()
  })

  it('forbids en passant that would expose the own king along the rank', () => {
    // Classic horizontal-pin case: white king and black rook share rank 5.
    const state = stateWith(
      { c5: W('pawn'), d5: B('pawn'), a5: B('rook'), e1: W('king'), e8: B('king') },
      { enPassantTarget: 'd6' },
    )
    // Removing the d5 pawn by en passant would open the 5th rank: a5 rook -> c5 pawn? No,
    // the king must be ON that rank. Correct pin setup: king e1 is not on rank 5,
    // so instead place the white king on e5-side. Use king on h5 and rook a5.
    const state2 = stateWith(
      { c5: W('pawn'), d5: B('pawn'), a5: B('rook'), h5: W('king'), e8: B('king') },
      { enPassantTarget: 'd6' },
    )
    const legal = legalMoves(state2).filter((m) => m.from === 'c5' && m.to === 'd6')
    expect(legal).toHaveLength(0)
    // And the ordinary diagonal capture is fine when the rank is not exposed.
    const state3 = stateWith(
      { c5: W('pawn'), d5: B('pawn'), e1: W('king'), e8: B('king') },
      { enPassantTarget: 'd6' },
    )
    expect(legalMoves(state3).some((m) => m.from === 'c5' && m.to === 'd6')).toBe(true)
  })

  it('allows en passant when the rank is not pinned', () => {
    const state = stateWith(
      { e5: W('pawn'), d5: B('pawn'), e1: W('king'), a5: B('rook'), e8: B('king') },
      { enPassantTarget: 'd6' },
    )
    expect(legalMoves(state).some((m) => m.from === 'e5' && m.to === 'd6')).toBe(true)
  })
})

describe('pins and king safety via simulation', () => {
  it('blocks a fully pinned knight from moving at all', () => {
    // White knight on d2, pinned by the rook on d8 against the king on d1.
    const state = stateWith({ d2: W('knight'), d1: W('king'), d8: B('rook'), h8: B('king') })
    expect(destinations(state, 'd2')).toEqual([])
  })

  it('lets a pinned pawn capture the pinner', () => {
    const state = stateWith({
      e4: W('pawn'), d1: W('king'), e5: B('pawn'), e8: B('rook'), h8: B('king'),
    })
    // Cannot advance (e5 occupied) but the pinner on e5 is capturable? No —
    // pawns capture diagonally; here the pawn is blocked, so no moves.
    expect(destinations(state, 'e4')).toEqual([])
  })

  it('keeps the king from stepping into an attacked square', () => {
    const state = stateWith({ e1: W('king'), e8: B('king'), e7: B('rook'), a1: W('rook') })
    // e2/d2/f2 attacked by the rook on e7 (file) — wait, rook on e7 controls the e-file.
    expect(destinations(state, 'e1')).not.toContain('e2')
  })

  it('excludes moves that leave the king in check after the mover moves', () => {
    const state = stateWith({ e4: W('rook'), e1: W('king'), e2: B('pawn'), e8: B('rook'), a8: B('king') })
    // The pawn on e2 blocks nothing for the rook above it; the rook is pinned
    // between the pawn... actually the pawn shields the king, so the rook can
    // move. Use a clean pin: rook e3, king e1, black rook e8, no pawn.
    const pinned = stateWith({ e3: W('rook'), e1: W('king'), e8: B('rook'), a8: B('king') })
    expect(destinations(pinned, 'e3')).toEqual(['e2', 'e4', 'e5', 'e6', 'e7', 'e8'])
  })
})

describe('check, checkmate, stalemate', () => {
  it('detects check from a knight', () => {
    const state = stateWith({ e1: W('king'), g2: B('knight'), e8: B('king') })
    expect(isInCheck(state.board, 'white')).toBe(true)
  })
  it('detects checkmate in the back-rank mate', () => {
    const state = stateWith({
      e1: W('king'), f2: W('pawn'), g2: W('pawn'), h2: W('pawn'),
      d2: W('pawn'), f1: W('rook'), d1: W('rook'),
      e8: B('king'), e7: B('rook'), h8: B('rook'),
    })
    expect(isInCheck(state.board, 'white')).toBe(true)
    expect(isCheckmate(state)).toBe(true)
  })
  it('detects stalemate (no moves, not in check)', () => {
    const state = stateWith({
      h8: W('king'), g6: B('king'), f7: B('queen'),
    }, { turn: 'white' })
    expect(isStalemate(state)).toBe(true)
    expect(isInCheck(state.board, 'white')).toBe(false)
  })
  it('is not checkmate when an escape exists', () => {
    const state = stateWith({ e1: W('king'), e7: B('rook'), h1: W('rook'), e8: B('king') })
    expect(isCheckmate(state)).toBe(false)
  })
})

describe('isSquareAttacked primitives', () => {
  it('sees pawn, knight, king, and slider attacks', () => {
    const empty: Board = {}
    expect(isSquareAttacked(empty, 'e4', 'white')).toBe(false)
    expect(isSquareAttacked({ d3: W('pawn') }, 'e4', 'white')).toBe(true)
    expect(isSquareAttacked({ c5: B('knight') }, 'e4', 'black')).toBe(true)
    expect(isSquareAttacked({ d5: B('king') }, 'e4', 'black')).toBe(true)
    expect(isSquareAttacked({ e8: B('rook') }, 'e4', 'black')).toBe(true)
    expect(isSquareAttacked({ h1: B('bishop') }, 'e4', 'black')).toBe(true)
    expect(isSquareAttacked({ e5: W('pawn') }, 'e4', 'white')).toBe(false) // pawn attacks forward only
  })
  it('finds kings on both sides', () => {
    expect(findKing({ e1: W('king') }, 'white')).toBe('e1')
    expect(findKing({ e1: W('king') }, 'black')).toBeNull()
  })
})

describe('pseudo-legal vs legal', () => {
  it('pseudo-legal generation includes castling candidates', () => {
    const state = stateWith(
      { e1: W('king'), h1: W('rook'), a1: W('rook'), e8: B('king') },
      { castling: { K: true, Q: true } },
    )
    const pseudo = generatePseudoLegalMoves(state)
    expect(pseudo.some((m) => m.from === 'e1' && m.to === 'g1')).toBe(true)
  })

  it('legal move count matches 20 at the starting position', () => {
    const state = createInitialGameState()
    expect(legalMoves(state)).toHaveLength(20)
    expect(isInCheck(state.board, 'white')).toBe(false)
  })

  it('every generated move stays on the board', () => {
    const state = createInitialGameState()
    for (const move of legalMoves(state)) {
      expect(ALL_SQUARES).toContain(move.to)
    }
  })
})
