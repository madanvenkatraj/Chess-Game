/**
 * spectator.js — pure Spectator-mode domain logic.
 * No DOM access. In the browser it is exposed via window.Spectator by
 * src/ui/spectatorBoot.js; in tests it is imported directly.
 *
 * Responsibilities:
 *  - normalize/validate snapshots coming off the wire
 *  - game list bookkeeping (live games, picker state)
 *  - follow-player tracking (which side you're "riding" for board flip)
 *  - incremental replay builder over ChessCore (watch-from-move-zero while live)
 *
 * Data shapes:
 *  snapshot = {
 *    code, names: {w,b}, ratings: {w,b}, turn, board, castling, enPassant,
 *    moves: [san], meta: [{from,to,promo}], captured: {w,b}, clocks: {w,b},
 *    over, result, timeControl
 *  }
 */

export const SPECTATOR_VERSION = 1;

export const FOLLOW_BOTH = 'both';
export const FOLLOW_WHITE = 'w';
export const FOLLOW_BLACK = 'b';

/** Thrown when a snapshot can't be normalized for the viewer. */
export class SpectatorDataError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SpectatorDataError';
  }
}

// ---------- Snapshot normalization ----------

function isSquare(sq) {
  return sq && typeof sq === 'object' &&
    Number.isInteger(sq.r) && sq.r >= 0 && sq.r < 8 &&
    Number.isInteger(sq.c) && sq.c >= 0 && sq.c < 8;
}

/**
 * Normalize a raw snapshot from the network into the viewer shape.
 * Throws SpectatorDataError on malformed input — fail loud, per project style.
 */
export function normalizeSnapshot(raw) {
  if (!raw || typeof raw !== 'object') {
    throw new SpectatorDataError('snapshot is not an object');
  }
  if (!Array.isArray(raw.board) || raw.board.length !== 8) {
    throw new SpectatorDataError('snapshot board is missing or malformed');
  }
  const board = raw.board.map((row) => {
    if (!Array.isArray(row) || row.length !== 8) {
      throw new SpectatorDataError('snapshot board row is malformed');
    }
    return row.map((p) => (p ? { type: p.type, color: p.color } : null));
  });
  if (raw.turn !== 'w' && raw.turn !== 'b') {
    throw new SpectatorDataError('snapshot turn is invalid');
  }
  const names = {
    w: typeof raw.names && raw.names && raw.names.w ? String(raw.names.w) : null,
    b: raw.names && raw.names.b ? String(raw.names.b) : null
  };
  const ratings = {
    w: validRating(raw.ratings && raw.ratings.w),
    b: validRating(raw.ratings && raw.ratings.b)
  };
  const meta = Array.isArray(raw.meta) ? raw.meta.map((m) => ({
    from: { r: m.from.r, c: m.from.c },
    to: { r: m.to.r, c: m.to.c },
    promo: m.promo || null
  })) : [];
  return {
    code: typeof raw.code === 'string' ? raw.code : '',
    names,
    ratings,
    turn: raw.turn,
    board,
    castling: {
      wK: !!(raw.castling && raw.castling.wK),
      wQ: !!(raw.castling && raw.castling.wQ),
      bK: !!(raw.castling && raw.castling.bK),
      bQ: !!(raw.castling && raw.castling.bQ)
    },
    enPassant: raw.enPassant ? { r: raw.enPassant.r, c: raw.enPassant.c } : null,
    moves: Array.isArray(raw.moves) ? raw.moves.slice() : [],
    meta,
    captured: {
      w: (raw.captured && raw.captured.w || []).slice(),
      b: (raw.captured && raw.captured.b || []).slice()
    },
    clocks: {
      w: numOrNull(raw.clocks && raw.clocks.w),
      b: numOrNull(raw.clocks && raw.clocks.b)
    },
    over: !!raw.over,
    result: raw.result || null,
    timeControl: raw.timeControl == null ? null : raw.timeControl
  };
}

function validRating(r) {
  return typeof r === 'number' && Number.isFinite(r) && r > 0 ? Math.round(r) : null;
}

function numOrNull(n) {
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

// ---------- Game list ----------

/** True when a live-game entry looks well-formed enough to show. */
export function isValidListEntry(entry) {
  return !!entry && typeof entry === 'object' &&
    typeof entry.code === 'string' && entry.code.length > 0 &&
    entry.names && typeof entry.names === 'object';
}

/** Sort key: prefer in-progress games with more moves, then by code. */
export function sortGameList(games) {
  return games.slice().sort(function (a, b) {
    const aOver = !!a.over, bOver = !!b.over;
    if (aOver !== bOver) return aOver ? 1 : -1;
    const aMoves = typeof a.moveCount === 'number' ? a.moveCount : 0;
    const bMoves = typeof b.moveCount === 'number' ? b.moveCount : 0;
    if (aMoves !== bMoves) return bMoves - aMoves;
    return a.code < b.code ? -1 : a.code > b.code ? 1 : 0;
  });
}

/** Merge a fresh list into current state, keeping viewer selection stable. */
export function updateGameList(state, games) {
  const list = sortGameList((games || []).filter(isValidListEntry));
  const next = {
    games: list,
    // Keep watching the followed game if it still exists; else drop selection.
    currentCode: state.currentCode && list.some((g) => g.code === state.currentCode)
      ? state.currentCode : null
  };
  return next;
}

// ---------- Follow player ----------

/** Normalize a follow preference; unknown values fall back to FOLLOW_BOTH. */
export function normalizeFollow(pref) {
  return pref === FOLLOW_WHITE || pref === FOLLOW_BLACK ? pref : FOLLOW_BOTH;
}

/**
 * Board orientation for the current snapshot. When following one side, we
 * orient the board from that player's point of view.
 */
export function boardOrientation(follow, snapshot) {
  if (follow === FOLLOW_WHITE) return 'w';
  if (follow === FOLLOW_BLACK) return 'b';
  // both: orient from the side to move? No — keep standard white-at-bottom
  // unless the game is over and black delivered mate; simplest stable choice:
  return 'w';
}

/** Which player are we "riding" — null when following both. */
export function followedSeat(follow) {
  return follow === FOLLOW_WHITE || follow === FOLLOW_BLACK ? follow : null;
}

// ---------- Incremental replay builder ----------

/**
 * Build a replay view incrementally from move meta + SAN history.
 * Positions are cached by ply index; a new snapshot only extends the cache
 * (never recomputes from scratch), which keeps long games cheap to scrub.
 */
export function createReplay(core) {
  if (!core || typeof core.initialBoard !== 'function') {
    throw new SpectatorDataError('replay needs a ChessCore-like engine');
  }
  const cache = []; // board states per ply (0 = initial position)
  let built = 0;    // how many plies have been applied
  let base = null;  // snapshot the cache was built against

  cache.push({
    board: core.initialBoard(),
    castling: { wK: true, wQ: true, bK: true, bQ: true },
    enPassant: null
  });
  built = 0;

  /**
   * Feed a live snapshot. Extends the cache only when the snapshot's move
   * history is a continuation of what we've built; resets on anything else.
   */
  function feed(snapshot) {
    const moves = snapshot.moves || [];
    const meta = snapshot.meta || [];
    const sameBase = base && base.code === snapshot.code &&
      base.moves && base.moves.length <= moves.length &&
      base.moves.every((san, i) => san === moves[i]);

    if (!sameBase) {
      // New game or rewound history: rebuild from scratch.
      reset();
    }
    base = { code: snapshot.code, moves: moves.slice() };

    // Position 0 comes from the snapshot itself, not the generic initial
    // board — spectator snapshots always carry the full live position, and
    // mid-game views (or replay seams) may start from a custom position.
    if (snapshot.board) {
      cache[0] = {
        board: core.cloneBoard(snapshot.board),
        castling: snapshot.castling
          ? { wK: !!snapshot.castling.wK, wQ: !!snapshot.castling.wQ, bK: !!snapshot.castling.bK, bQ: !!snapshot.castling.bQ }
          : { wK: true, wQ: true, bK: true, bQ: true },
        enPassant: snapshot.enPassant ? { r: snapshot.enPassant.r, c: snapshot.enPassant.c } : null
      };
    }

    for (let i = built; i < moves.length; i++) {
      const m = meta[i];
      const color = i % 2 === 0 ? 'w' : 'b';
      let from = m && m.from, to = m && m.to;
      if (!isSquare(from) || !isSquare(to)) {
        // Metadata missing — infer from SAN is out of scope; stop extending.
        break;
      }
      const piece = cache[i].board[from.r][from.c];
      if (!piece || piece.color !== color) break; // inconsistent meta; stop
      const legal = core.legalMoves(cache[i].board, from.r, from.c, cache[i].castling, cache[i].enPassant);
      let mv = null;
      for (let k = 0; k < legal.length; k++) {
        if (legal[k].r === to.r && legal[k].c === to.c) { mv = legal[k]; break; }
      }
      if (!mv) break; // inconsistent meta; stop extending rather than guess
      const nextBoard = core.cloneBoard(cache[i].board);
      const promo = (m && m.promo) || (piece.type === 'P' && (to.r === 0 || to.r === 7) ? 'Q' : null);
      core.applyMove(nextBoard, from, to, mv.extra, promo);
      let nextCastling = { wK: cache[i].castling.wK, wQ: cache[i].castling.wQ, bK: cache[i].castling.bK, bQ: cache[i].castling.bQ };
      if (piece.type === 'K') { nextCastling[color + 'K'] = false; nextCastling[color + 'Q'] = false; }
      if (piece.type === 'R') {
        const home = color === 'w' ? 7 : 0;
        if (from.r === home && from.c === 0) nextCastling[color + 'Q'] = false;
        if (from.r === home && from.c === 7) nextCastling[color + 'K'] = false;
      }
      const nextEp = (mv.extra && mv.extra.double)
        ? { r: (from.r + to.r) / 2, c: from.c } : null;
      cache.push({ board: nextBoard, castling: nextCastling, enPassant: nextEp });
      built++;
    }
    return {
      length: cache.length,       // number of positions viewable (plies + 1)
      latestPly: Math.max(0, cache.length - 1)
    };
  }

  /** Position at ply `ply` (0 = initial). Clamps to what's been built. */
  function positionAt(ply) {
    const idx = Math.max(0, Math.min(ply, cache.length - 1));
    return cache[idx];
  }

  function reset() {
    cache.length = 1;
    cache[0] = { board: core.initialBoard(), castling: { wK: true, wQ: true, bK: true, bQ: true }, enPassant: null };
    built = 0;
    base = null;
  }

  return { feed, positionAt, reset };
}

// ---------- Feed subscription (transport-agnostic) ----------

/**
 * Subscribe to a live snapshot feed. `transport` must provide:
 *   subscribe(fn) -> unsubscribe
 * Polling is the safest cross-transport primitive (works with SSE and WS alike,
 * and re-syncs after any missed frame).
 */
export function createFeed(transport, opts) {
  const interval = (opts && opts.intervalMs) || 1500;
  let timer = null;
  let lastSnapshot = null;
  const listeners = [];

  function push(snapshot) {
    if (!snapshot) return;
    lastSnapshot = snapshot;
    for (let i = 0; i < listeners.length; i++) listeners[i](snapshot);
  }

  function start() {
    if (timer) return;
    transport.subscribe(push);
    timer = setInterval(function tick() {
      transport.poll().then(push).catch(function () { /* transient — retry next tick */ });
    }, interval);
  }

  function stop() {
    if (timer) { clearInterval(timer); timer = null; }
    if (lastUnsubscribe) lastUnsubscribe();
  }

  let lastUnsubscribe = null;
  transport.subscribe = transport.subscribe || function (fn) {
    listeners.push(fn);
    lastUnsubscribe = function () {
      const idx = listeners.indexOf(fn);
      if (idx >= 0) listeners.splice(idx, 1);
    };
    return lastUnsubscribe;
  };

  function snapshotNow() { return lastSnapshot; }

  return { start, stop, push, snapshotNow };
}
