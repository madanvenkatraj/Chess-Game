/**
 * Training domain module — pure, UI-independent exercise catalog, validation,
 * scoring, hints, and versioned progress persistence. Mirrors the proven shape
 * of src/tournament/tournament.js (pure logic + typed deserialization error +
 * guarded localStorage) so tests can verify it without a DOM.
 *
 * An EXERCISE is a tactical or endgame position (FEN) with:
 * - a solution: the exact move line the player must find, as coordinate moves
 *   like 'e2e4' (from-square + to-square). Even indices are the player's moves
 *   (all exercises are White to play), odd indices are the scripted opponent
 *   replies the app plays automatically.
 * - a goal ('checkmate' | 'win-material' | 'promote'),
 * - a skill tag ('checkmate' | 'fork' | 'pin' | 'skewer' | 'discovered' | 'endgame').
 *
 * Every solution line is verified against the real engine (chess-core) by
 * test/training.test.js before shipping.
 */

export const TRAINING_VERSION = 1;

/** Storage namespace — same family as the chess88 store. */
export const TRAINING_KEY = 'chess88:training';

export const SKILLS = ['checkmate', 'fork', 'pin', 'skewer', 'discovered', 'endgame'];

export const DIFFICULTIES = ['easy', 'medium', 'hard'];

export const SKILL_LABELS = {
  checkmate: 'Checkmates',
  fork: 'Forks',
  pin: 'Pins',
  skewer: 'Skewers',
  discovered: 'Discovered Attacks',
  endgame: 'Basic Endgames'
};

/** Thrown when a saved progress record cannot be understood. */
export class TrainingDeserializationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TrainingDeserializationError';
  }
}

export const EXERCISES = [
  // ---------- Checkmates ----------
  {
    id: 'mate-back-rank',
    skill: 'checkmate',
    difficulty: 'easy',
    goal: 'checkmate',
    name: 'Back-Rank Mate',
    fen: '6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1',
    solution: ['a1a8'],
    hint: 'The black king is trapped behind its own pawns. Bring the rook to the last rank.'
  },
  {
    id: 'mate-queen',
    skill: 'checkmate',
    difficulty: 'easy',
    goal: 'checkmate',
    name: 'Queen Mate',
    fen: '6k1/5ppp/8/8/8/8/8/4Q1K1 w - - 0 1',
    solution: ['e1e8'],
    hint: 'The king is boxed in behind its pawns. The queen delivers mate on the eighth rank.'
  },
  {
    id: 'mate-knight',
    skill: 'checkmate',
    difficulty: 'easy',
    goal: 'checkmate',
    name: 'Knight Mate',
    fen: '6rk/6pp/8/6N1/8/8/8/6K1 w - - 0 1',
    solution: ['g5f7'],
    hint: 'The king is boxed in by its own pieces. Look for Nf7.'
  },
  {
    id: 'mate-two-rooks',
    skill: 'checkmate',
    difficulty: 'medium',
    goal: 'checkmate',
    name: 'Two-Rook Ladder',
    fen: '6k1/R7/8/8/8/8/8/1R4K1 w - - 0 1',
    solution: ['b1b8'],
    hint: 'One rook cuts off the seventh rank, the other delivers mate on the eighth.'
  },

  // ---------- Forks ----------
  {
    id: 'fork-knight-royal',
    skill: 'fork',
    difficulty: 'medium',
    goal: 'win-material',
    name: 'Royal Knight Fork',
    fen: '3k3r/8/8/6N1/8/8/8/4K3 w - - 0 1',
    solution: ['g5f7', 'd8c7', 'f7h8'],
    hint: 'Nf7+ jumps with check, forking king and rook. After the king steps aside, take the rook.'
  },
  {
    id: 'fork-pawn',
    skill: 'fork',
    difficulty: 'medium',
    goal: 'win-material',
    name: 'Pawn Fork',
    fen: '8/8/8/2q1k3/8/8/3P4/4K3 w - - 0 1',
    solution: ['d2d4', 'e5d6', 'd4c5'],
    hint: 'One pawn push attacks the king and the queen at once — and c3 keeps the pawn safe.'
  },

  // ---------- Pins ----------
  {
    id: 'pin-rook',
    skill: 'pin',
    difficulty: 'easy',
    goal: 'win-material',
    name: 'Pinned Queen',
    fen: '1k6/8/8/1q6/8/8/8/1R2K3 w - - 0 1',
    solution: ['b1b5'],
    hint: 'The queen is pinned on the b-file in front of its king — it cannot run. Take it.'
  },

  // ---------- Skewers ----------
  {
    id: 'skewer-rook',
    skill: 'skewer',
    difficulty: 'easy',
    goal: 'win-material',
    name: 'Rook Skewer',
    fen: '6k1/8/8/8/8/6q1/8/R6K w - - 0 1',
    solution: ['a1g1', 'g8h8', 'g1g3'],
    hint: 'Check along the g-file: the king must step off the line, and the queen behind falls.'
  },

  // ---------- Discovered attacks ----------
  {
    id: 'discovered-knight',
    skill: 'discovered',
    difficulty: 'hard',
    goal: 'win-material',
    name: 'Discovered Check Wins the Queen',
    fen: '2q1k3/8/8/8/4N3/8/8/4R2K w - - 0 1',
    solution: ['e4d6', 'e8d7', 'd6c8'],
    hint: 'Moving the knight unmasks the rook check on the e-file. While the king deals with the check, the knight grabs the queen on c8.'
  },

  // ---------- Basic endgames ----------
  {
    id: 'endgame-krmate',
    skill: 'endgame',
    difficulty: 'medium',
    goal: 'checkmate',
    name: 'King and Rook Mate',
    fen: '7k/8/6K1/8/8/8/8/R7 w - - 0 1',
    solution: ['a1a8'],
    hint: 'Your king already confines the enemy king to the back rank. The rook delivers mate on the eighth.'
  },
  {
    id: 'endgame-promotion',
    skill: 'endgame',
    difficulty: 'easy',
    goal: 'promote',
    name: 'Promote to Win',
    fen: '8/1P6/8/8/8/1k6/8/6K1 w - - 0 1',
    solution: ['b7b8'],
    hint: 'The pawn promotes with check — the black king cannot reach the queening square in time.'
  }
];

// ---------- Lookup helpers ----------

export function getExercise(id) {
  for (var i = 0; i < EXERCISES.length; i++) {
    if (EXERCISES[i].id === id) return EXERCISES[i];
  }
  return null;
}

export function listBySkill(skill) {
  return EXERCISES.filter(function (e) { return e.skill === skill; });
}

export function listByDifficulty(level) {
  return EXERCISES.filter(function (e) { return e.difficulty === level; });
}

// ---------- Progress persistence ----------

function emptyProgress() {
  return {
    version: TRAINING_VERSION,
    score: 0,
    completed: {},   // exercise id -> { attempts, hintsUsed, completedAt }
    attempts: {},    // exercise id -> total attempt count
    lastDate: null
  };
}

function isProgress(value) {
  if (!value || typeof value !== 'object') return false;
  return typeof value.score === 'number' && Number.isFinite(value.score) &&
    typeof value.completed === 'object' && value.completed !== null &&
    typeof value.attempts === 'object' && value.attempts !== null;
}

/** Parse and validate a serialized progress record. Throws on bad input. */
export function deserializeProgress(json) {
  var parsed;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    throw new TrainingDeserializationError('Saved training progress is not valid JSON');
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new TrainingDeserializationError('Saved training progress has unexpected shape');
  }
  if (parsed.version !== TRAINING_VERSION) {
    throw new TrainingDeserializationError('Unsupported training version: ' + String(parsed.version));
  }
  if (!isProgress(parsed)) {
    throw new TrainingDeserializationError('Saved training progress is malformed');
  }
  return parsed;
}

export function serializeProgress(progress) {
  return JSON.stringify(progress);
}

/** Guarded localStorage save. Returns false when storage is unavailable. */
export function saveProgress(progress, storage) {
  var store = storage !== undefined ? storage
    : (typeof window !== 'undefined' && window.localStorage ? window.localStorage : null);
  if (!store) return false;
  try {
    store.setItem(TRAINING_KEY, serializeProgress(progress));
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Load progress, or null when none exists. Corrupt saves are discarded
 * (fail-soft) rather than thrown mid-session.
 */
export function loadProgress(storage) {
  var store = storage !== undefined ? storage
    : (typeof window !== 'undefined' && window.localStorage ? window.localStorage : null);
  if (!store) return null;
  var raw = null;
  try {
    raw = store.getItem(TRAINING_KEY);
  } catch (e) {
    return null;
  }
  if (!raw) return null;
  try {
    return deserializeProgress(raw);
  } catch (e) {
    try { store.removeItem(TRAINING_KEY); } catch (e2) { /* nothing to do */ }
    return null;
  }
}

export function clearProgress(storage) {
  var store = storage !== undefined ? storage
    : (typeof window !== 'undefined' && window.localStorage ? window.localStorage : null);
  if (!store) return;
  try { store.removeItem(TRAINING_KEY); } catch (e) { /* ignore */ }
}

// ---------- Session scoring ----------

/**
 * Score an exercise attempt. First-try clean solve 100; a hint or a retry
 * halves the award; both quarter it. Failed attempts cost nothing.
 */
export function scoreAttempt(exercise, opts) {
  var attempts = (opts && opts.attempts) || 1;
  var hintsUsed = !!(opts && opts.hintsUsed);
  if (!exercise) return 0;
  if (attempts === 1 && !hintsUsed) return 100;
  if (attempts === 1) return 50;
  return hintsUsed ? 25 : 50;
}

/**
 * Record a completed exercise into the progress record. Returns the points
 * awarded (0 when it was already completed — replays earn nothing new).
 */
export function recordCompletion(progress, exerciseId, opts) {
  if (progress.completed[exerciseId]) return 0;
  var exercise = getExercise(exerciseId);
  if (!exercise) return 0;
  var pts = scoreAttempt(exercise, { attempts: opts && opts.attempts, hintsUsed: opts && opts.hintsUsed });
  progress.score += pts;
  progress.completed[exerciseId] = {
    attempts: (opts && opts.attempts) || 1,
    hintsUsed: !!(opts && opts.hintsUsed),
    completedAt: new Date().toISOString()
  };
  return pts;
}

/** True when the player has completed every exercise. */
export function allCompleted(progress) {
  return EXERCISES.every(function (e) { return !!progress.completed[e.id]; });
}
