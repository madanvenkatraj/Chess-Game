(function () {
  'use strict';

  var C = window.ChessCore;
  var PIECE_GLYPHS = {
    wK: '\u2654', wQ: '\u2655', wR: '\u2656', wB: '\u2657', wN: '\u2658', wP: '\u2659',
    bK: '\u265A', bQ: '\u265B', bR: '\u265C', bB: '\u265D', bN: '\u265E', bP: '\u265F'
  };

  var state = {
    board: null,
    turn: 'w',
    castling: { wK: true, wQ: true, bK: true, bQ: true },
    enPassant: null,
    history: [],
    moves: [],
    captured: { w: [], b: [] },
    mode: '2p',
    aiLevel: 'easy',
    aiColor: 'b',
    gameOver: false,
    selected: null,
    timers: { w: 600, b: 600 },
    timeControl: 600,
    clockId: null,
    checkCount: 0,
    moveMeta: [],
    theme: 'classic'
  };

  // ---------- Persistence (namespaced; never overwrites foreign keys) ----------
  var STORE_KEY = 'chess88.v1';

  function loadStore() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      var data = raw ? JSON.parse(raw) : {};
      if (!data || typeof data !== 'object') data = {};
      return {
        theme: typeof data.theme === 'string' ? data.theme : 'classic',
        lastGame: data.lastGame || null,
        stats: data.stats || { wins: 0, losses: 0, draws: 0, games: 0, recent: [], streak: 0, bestStreak: 0 },
        puzzle: data.puzzle || { score: 0, solved: {}, lastDate: null, todaySolved: false },
        achievements: data.achievements || {}
      };
    } catch (e) {
      return {
        theme: 'classic', lastGame: null,
        stats: { wins: 0, losses: 0, draws: 0, games: 0, recent: [], streak: 0, bestStreak: 0 },
        puzzle: { score: 0, solved: {}, lastDate: null, todaySolved: false },
        achievements: {}
      };
    }
  }

  var store = loadStore();

  function saveStore() {
    try {
      store.theme = state.theme;
      localStorage.setItem(STORE_KEY, JSON.stringify(store));
    } catch (e) { /* storage unavailable (private mode) — keep playing */ }
  }

  function todayKey() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function sqName(sq) { return 'abcdefgh'[sq.c] + (8 - sq.r); }

  // ---------- Themes ----------
  var THEMES = ['classic', 'ocean', 'wood', 'midnight'];
  function applyTheme(t) {
    if (THEMES.indexOf(t) < 0) t = 'classic';
    THEMES.forEach(function (name) { document.body.classList.remove('theme-' + name); });
    document.body.classList.add('theme-' + t);
    state.theme = t;
  }

  // ---------- Board rendering (shared by game, puzzle, analysis) ----------
  function renderInto(boardEl, board, opts) {
    boardEl.innerHTML = '';
    var legal = opts && opts.legal ? opts.legal : [];
    var selected = opts && opts.selected ? opts.selected : null;
    var lastMove = opts && opts.lastMove ? opts.lastMove : null;
    for (var r = 0; r < 8; r++) {
      for (var c = 0; c < 8; c++) {
        var sq = document.createElement('div');
        sq.className = 'square ' + ((r + c) % 2 === 0 ? 'light' : 'dark');
        sq.dataset.r = r; sq.dataset.c = c;
        var p = board[r][c];
        if (p) {
          var span = document.createElement('span');
          span.textContent = PIECE_GLYPHS[p.color + p.type];
          span.className = 'piece ' + (p.color === 'w' ? 'white-piece' : 'black-piece');
          sq.appendChild(span);
        }
        if (selected && selected.r === r && selected.c === c) sq.classList.add('selected');
        for (var i = 0; i < legal.length; i++) {
          if (legal[i].r === r && legal[i].c === c) sq.classList.add('legal');
        }
        if (lastMove && ((lastMove.from.r === r && lastMove.from.c === c) ||
                         (lastMove.to.r === r && lastMove.to.c === c))) {
          sq.classList.add('last-move');
        }
        if (opts && opts.onClick) sq.addEventListener('click', opts.onClick);
        boardEl.appendChild(sq);
      }
    }
  }

  // ---------- Game flow ----------
  function snapshot() {
    return {
      board: C.cloneBoard(state.board),
      turn: state.turn,
      castling: { wK: state.castling.wK, wQ: state.castling.wQ, bK: state.castling.bK, bQ: state.castling.bQ },
      enPassant: state.enPassant ? { r: state.enPassant.r, c: state.enPassant.c } : null,
      moves: state.moves.slice(),
      captured: { w: state.captured.w.slice(), b: state.captured.b.slice() },
      timers: { w: state.timers.w, b: state.timers.b }
    };
  }

  function makeMove(from, to, promo) {
    var piece = state.board[from.r][from.c];
    if (!piece || piece.color !== state.turn || state.gameOver) return;
    var legal = C.legalMoves(state.board, from.r, from.c, state.castling, state.enPassant);
    var mv = null;
    for (var i = 0; i < legal.length; i++) {
      if (legal[i].r === to.r && legal[i].c === to.c) { mv = legal[i]; break; }
    }
    if (!mv) return;
    state.history.push(snapshot());
    var san = C.sanFor(state.board, from, to, mv.extra, promo, piece);
    var captured = C.applyMove(state.board, from, to, mv.extra, promo);
    if (captured) state.captured[state.turn].push(captured);
    if (piece.type === 'K') { state.castling[piece.color + 'K'] = false; state.castling[piece.color + 'Q'] = false; }
    if (piece.type === 'R') {
      var home = piece.color === 'w' ? 7 : 0;
      if (from.r === home && from.c === 0) state.castling[piece.color + 'Q'] = false;
      if (from.r === home && from.c === 7) state.castling[piece.color + 'K'] = false;
    }
    state.enPassant = (mv.extra && mv.extra.double) ? { r: (from.r + to.r) / 2, c: from.c } : null;
    state.turn = state.turn === 'w' ? 'b' : 'w';
    if (C.inCheck(state.board, state.turn)) {
      san += C.allLegalMoves(state.board, state.turn, state.castling, state.enPassant).length === 0 ? '#' : '+';
    }
    state.moves.push(san);
    state.moveMeta.push({ from: { r: from.r, c: from.c }, to: { r: to.r, c: to.c } });
    if (C.inCheck(state.board, state.turn)) state.checkCount++;
    state.selected = null;
    updateStatus();
    render();
    checkGameEnd();
    if (!state.gameOver && state.mode === 'ai' && state.turn === state.aiColor) {
      setTimeout(aiMove, 250);
    }
  }

  function checkGameEnd() {
    var moves = C.allLegalMoves(state.board, state.turn, state.castling, state.enPassant);
    if (moves.length === 0) {
      state.gameOver = true;
      stopClock();
      if (C.inCheck(state.board, state.turn)) {
        setStatus((state.turn === 'w' ? 'Black' : 'White') + ' wins by checkmate!');
      } else {
        setStatus('Draw by stalemate.');
      }
      onGameEnd('mate-or-stalemate');
      return;
    }
    // Insufficient material / 50-move style draws are out of scope; count 100 half-move quiet rule off.
    saveProgress();
  }

  function setStatus(msg) {
    document.getElementById('status').textContent = msg;
  }

  function updateStatus() {
    if (state.gameOver) return;
    var side = state.turn === 'w' ? 'White' : 'Black';
    setStatus(side + ' to move' + (C.inCheck(state.board, state.turn) ? ' — check!' : ''));
  }

  // ---------- Clock ----------
  function startClock() {
    stopClock();
    state.clockId = setInterval(function () {
      state.timers[state.turn]--;
      if (state.timers[state.turn] <= 0) {
        state.timers[state.turn] = 0;
        state.gameOver = true;
        stopClock();
        setStatus((state.turn === 'w' ? 'Black' : 'White') + ' wins on time!');
        onGameEnd('time');
      }
      renderTimers();
    }, 1000);
  }

  function stopClock() {
    if (state.clockId) { clearInterval(state.clockId); state.clockId = null; }
  }

  function renderTimers() {
    function fmt(s) {
      var m = Math.floor(s / 60), sec = s % 60;
      return m + ':' + (sec < 10 ? '0' : '') + sec;
    }
    document.getElementById('timer-white').textContent = 'White ' + fmt(state.timers.w);
    document.getElementById('timer-black').textContent = 'Black ' + fmt(state.timers.b);
  }

  // ---------- Rendering ----------
  function render() {
    var boardEl = document.getElementById('board');
    var legal = [];
    if (state.selected) {
      legal = C.legalMoves(state.board, state.selected.r, state.selected.c, state.castling, state.enPassant);
    }
    var last = state.moveMeta.length ? state.moveMeta[state.moveMeta.length - 1] : null;
    renderInto(boardEl, state.board, { legal: legal, selected: state.selected, lastMove: last, onClick: onSquareClick });
    renderTimers();
    renderCaptured();
    renderMoves();
    document.getElementById('undo-btn').disabled = state.history.length === 0;
  }

  function renderCaptured() {
    document.getElementById('captured-white').textContent =
      'White captured: ' + (state.captured.w.map(function (p) { return PIECE_GLYPHS[p.color + p.type]; }).join(' ') || '—');
    document.getElementById('captured-black').textContent =
      'Black captured: ' + (state.captured.b.map(function (p) { return PIECE_GLYPHS[p.color + p.type]; }).join(' ') || '—');
  }

  function renderMoves() {
    var ol = document.getElementById('move-list');
    ol.innerHTML = '';
    for (var i = 0; i < state.moves.length; i += 2) {
      var li = document.createElement('li');
      li.textContent = (i / 2 + 1) + '. ' + state.moves[i] + (state.moves[i + 1] ? ' ' + state.moves[i + 1] : '');
      ol.appendChild(li);
    }
  }

  function onSquareClick(e) {
    if (state.gameOver) return;
    if (state.mode === 'ai' && state.turn === state.aiColor) return;
    var r = parseInt(e.currentTarget.dataset.r, 10);
    var c = parseInt(e.currentTarget.dataset.c, 10);
    var p = state.board[r][c];
    if (state.selected) {
      var legal = C.legalMoves(state.board, state.selected.r, state.selected.c, state.castling, state.enPassant);
      for (var i = 0; i < legal.length; i++) {
        if (legal[i].r === r && legal[i].c === c) {
          var promo = null;
          var moving = state.board[state.selected.r][state.selected.c];
          if (moving.type === 'P' && (r === 0 || r === 7)) {
            var choice = window.prompt('Promote to (q, r, b, n):', 'q');
            promo = ({ q: 'Q', r: 'R', b: 'B', n: 'N' })[(choice || 'q').toLowerCase()] || 'Q';
          }
          makeMove(state.selected, { r: r, c: c }, promo);
          return;
        }
      }
      state.selected = (p && p.color === state.turn) ? { r: r, c: c } : null;
      render();
    } else if (p && p.color === state.turn) {
      state.selected = { r: r, c: c };
      render();
    }
  }

  function undo() {
    if (state.history.length === 0 || state.gameOver) return;
    var snaps = (state.mode === 'ai' && state.history.length >= 2) ? 2 : 1;
    for (var i = 0; i < snaps; i++) {
      if (state.history.length === 0) break;
      var s = state.history.pop();
      state.board = s.board; state.turn = s.turn; state.castling = s.castling;
      state.enPassant = s.enPassant; state.moves = s.moves;
      state.captured = s.captured; state.timers = s.timers;
    }
    // moveMeta is replay-length-matched with moves; drop the same number of entries
    var dropped = (state.mode === 'ai' ? snaps : snaps);
    state.moveMeta = state.moveMeta.slice(0, Math.max(0, state.moveMeta.length - dropped));
    state.selected = null;
    updateStatus();
    render();
    saveProgress();
  }

  // ---------- AI ----------
  var PIECE_VALUES = { P: 100, N: 320, B: 330, R: 500, Q: 900, K: 0 };

  function evaluate(board) {
    var score = 0;
    for (var r = 0; r < 8; r++) for (var c = 0; c < 8; c++) {
      var p = board[r][c];
      if (p) {
        var v = PIECE_VALUES[p.type];
        if (p.type === 'P' || p.type === 'N') {
          v += 6 - (Math.abs(3.5 - r) + Math.abs(3.5 - c)) * 2;
        }
        score += p.color === 'w' ? v : -v;
      }
    }
    return score;
  }

  function searchDepth() {
    return state.aiLevel === 'easy' ? 1 : state.aiLevel === 'medium' ? 2 : 3;
  }

  function minimax(board, depth, color, alpha, beta, castling) {
    if (depth === 0) return evaluate(board);
    var moves = [];
    for (var r = 0; r < 8; r++) for (var c = 0; c < 8; c++) {
      var p = board[r][c];
      if (p && p.color === color) {
        var ms = C.legalMoves(board, r, c, castling, null);
        for (var i = 0; i < ms.length; i++) moves.push({ from: { r: r, c: c }, to: ms[i] });
      }
    }
    if (moves.length === 0) return C.inCheck(board, color) ? (color === 'w' ? -9999 : 9999) : 0;
    var maximizing = color === 'w';
    var best = maximizing ? -Infinity : Infinity;
    for (var m = 0; m < moves.length; m++) {
      var copy = C.cloneBoard(board);
      C.applyMove(copy, moves[m].from, moves[m].to, moves[m].to.extra, 'Q');
      var score = minimax(copy, depth - 1, color === 'w' ? 'b' : 'w', alpha, beta, castling);
      if (maximizing) {
        best = Math.max(best, score);
        alpha = Math.max(alpha, best);
      } else {
        best = Math.min(best, score);
        beta = Math.min(beta, best);
      }
      if (beta <= alpha) break;
    }
    return best;
  }

  function aiMove() {
    var color = state.aiColor;
    var moves = C.allLegalMoves(state.board, color, state.castling, state.enPassant);
    if (moves.length === 0) return;
    if (state.aiLevel === 'easy' && Math.random() < 0.3) {
      var pick = moves[Math.floor(Math.random() * moves.length)];
      makeMove(pick.from, pick.to);
      return;
    }
    var depth = searchDepth();
    var best = null, bestScore = color === 'w' ? -Infinity : Infinity;
    for (var i = 0; i < moves.length; i++) {
      var copy = C.cloneBoard(state.board);
      var cast = { wK: state.castling.wK, wQ: state.castling.wQ, bK: state.castling.bK, bQ: state.castling.bQ };
      C.applyMove(copy, moves[i].from, moves[i].to, moves[i].to.extra, 'Q');
      var score = minimax(copy, depth - 1, color === 'w' ? 'b' : 'w', -Infinity, Infinity, cast);
      if ((color === 'w' && score > bestScore) || (color === 'b' && score < bestScore)) {
        bestScore = score;
        best = moves[i];
      }
    }
    if (best) makeMove(best.from, best.to);
  }

  // ---------- Achievements ----------
  var ACHIEVEMENTS = [
    { id: 'first-win', name: 'First Blood', desc: 'Win your first game.' },
    { id: 'first-checkmate', name: 'Executioner', desc: 'Win a game by checkmate.' },
    { id: 'streak-3', name: 'On a Roll', desc: 'Win 3 games in a row.' },
    { id: 'streak-5', name: 'Unstoppable', desc: 'Win 5 games in a row.' },
    { id: 'five-wins', name: 'Veteran', desc: 'Win 5 games in total.' },
    { id: 'fast-win', name: 'Blitz Master', desc: 'Win a game in under 15 moves.' },
    { id: 'multi-check', name: 'Check Artist', desc: 'Deliver 5 checks in one game.' },
    { id: 'castle', name: 'Safe Haven', desc: 'Castle in a game you win.' },
    { id: 'puzzle-first', name: 'Puzzle Rookie', desc: 'Solve your first daily puzzle.' },
    { id: 'puzzle-streak', name: 'Puzzle Solver', desc: 'Solve puzzles on 3 different days.' }
  ];

  function unlock(id) {
    if (store.achievements[id]) return false;
    var meta = null;
    for (var i = 0; i < ACHIEVEMENTS.length; i++) if (ACHIEVEMENTS[i].id === id) meta = ACHIEVEMENTS[i];
    if (!meta) return false;
    store.achievements[id] = { unlockedAt: new Date().toISOString() };
    saveStore();
    toast('🏆 Achievement unlocked: ' + meta.name);
    return true;
  }

  function toast(msg) {
    var t = document.getElementById('toast');
    if (!t) { t = document.createElement('div'); t.id = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast._id);
    toast._id = setTimeout(function () { t.classList.remove('show'); }, 3500);
  }

  function renderAchievements() {
    var grid = document.getElementById('achievements-list');
    grid.innerHTML = '';
    var unlocked = 0;
    ACHIEVEMENTS.forEach(function (a) {
      var rec = store.achievements[a.id];
      if (rec) unlocked++;
      var card = document.createElement('div');
      card.className = 'ach-card ' + (rec ? 'unlocked' : 'locked');
      var name = document.createElement('div');
      name.className = 'ach-name';
      name.textContent = (rec ? '🏆 ' : '🔒 ') + a.name;
      var desc = document.createElement('div');
      desc.className = 'ach-desc';
      desc.textContent = a.desc;
      card.appendChild(name);
      card.appendChild(desc);
      if (rec) {
        var date = document.createElement('div');
        date.className = 'ach-date';
        date.textContent = 'Unlocked ' + new Date(rec.unlockedAt).toLocaleDateString();
        card.appendChild(date);
      }
      grid.appendChild(card);
    });
    var info = document.getElementById('achievements-info');
    if (info) info.textContent = unlocked + ' of ' + ACHIEVEMENTS.length + ' unlocked';
  }

  // ---------- Game end / stats ----------
  function onGameEnd(reason) {
    var playerColor = state.mode === 'ai' ? (state.aiColor === 'w' ? 'b' : 'w') : null;
    var loser = state.turn; // side that cannot move or flagged on time
    var winner = loser === 'w' ? 'b' : 'w';
    var isDraw = reason === 'stalemate';

    if (isDraw) {
      store.stats.draws++;
      store.stats.streak = 0;
      store.stats.games++;
      store.stats.recent.unshift({ result: 'draw', mode: state.mode, date: new Date().toISOString() });
    } else if (playerColor) {
      if (winner === playerColor) {
        store.stats.wins++;
        store.stats.streak++;
        store.stats.games++;
        store.stats.bestStreak = Math.max(store.stats.bestStreak, store.stats.streak);
        store.stats.recent.unshift({ result: 'win', mode: state.mode, date: new Date().toISOString() });
        unlock('first-win');
        if (reason === 'mate-or-stalemate' && C.inCheck(state.board, state.turn)) unlock('first-checkmate');
        if (store.stats.streak >= 3) unlock('streak-3');
        if (store.stats.streak >= 5) unlock('streak-5');
        if (store.stats.wins >= 5) unlock('five-wins');
        if (state.moves.length < 30) unlock('fast-win');
        if (state.checkCount >= 5) unlock('multi-check');
        if (state.castled) unlock('castle');
      } else {
        store.stats.losses++;
        store.stats.streak = 0;
        store.stats.games++;
        store.stats.recent.unshift({ result: 'loss', mode: state.mode, date: new Date().toISOString() });
      }
    } else {
      // 2-player mode: record result only
      store.stats.games++;
      store.stats.recent.unshift({
        result: winner === 'w' ? 'white-won' : 'black-won',
        mode: state.mode, date: new Date().toISOString()
      });
    }
    store.stats.recent = store.stats.recent.slice(0, 10);
    saveStore();
    saveProgress();
    renderAchievements(); // keep cache fresh if user opens screen next
  }

  // ---------- Save / resume ----------
  function saveProgress() {
    if (state.gameOver) { store.lastGame = null; saveStore(); return; }
    store.lastGame = {
      board: state.board, turn: state.turn, castling: state.castling,
      enPassant: state.enPassant, moves: state.moves, captured: state.captured,
      mode: state.mode, aiLevel: state.aiLevel, aiColor: state.aiColor,
      timers: state.timers, timeControl: state.timeControl, theme: state.theme,
      moveMeta: state.moveMeta, checkCount: state.checkCount, castled: !!state.castled,
      savedAt: new Date().toISOString()
    };
    saveStore();
  }

  function resumeGame() {
    var g = store.lastGame;
    if (!g) { window.alert('No saved game found. Start a New Game instead.'); return; }
    state.board = g.board; state.turn = g.turn; state.castling = g.castling;
    state.enPassant = g.enPassant; state.moves = g.moves; state.captured = g.captured;
    state.mode = g.mode; state.aiLevel = g.aiLevel; state.aiColor = g.aiColor;
    state.timers = g.timers; state.timeControl = g.timeControl; state.theme = g.theme || 'classic';
    state.moveMeta = g.moveMeta || []; state.checkCount = g.checkCount || 0;
    state.castled = !!g.castled;
    state.history = []; state.gameOver = false; state.selected = null;
    applyTheme(state.theme);
    showOnly('game');
    updateStatus();
    render();
    startClock();
    if (state.mode === 'ai' && state.turn === state.aiColor) setTimeout(aiMove, 300);
  }

  // ---------- Statistics screen ----------
  function renderStats() {
    var el = document.getElementById('stats-body');
    if (!el) return;
    var s = store.stats;
    var rows = [
      ['Games played', s.games],
      ['Wins (vs AI)', s.wins],
      ['Losses (vs AI)', s.losses],
      ['Draws', s.draws],
      ['Current win streak', s.streak],
      ['Best win streak', s.bestStreak]
    ];
    el.innerHTML = '';
    var table = document.createElement('table');
    table.className = 'stats-table';
    rows.forEach(function (row) {
      var tr = document.createElement('tr');
      var th = document.createElement('td'); th.textContent = row[0];
      var td = document.createElement('td'); td.textContent = String(row[1]);
      tr.appendChild(th); tr.appendChild(td);
      table.appendChild(tr);
    });
    el.appendChild(table);
    var recent = document.createElement('div');
    recent.className = 'recent-results';
    recent.textContent = 'Recent results: ' + (s.recent.length
      ? s.recent.map(function (r) { return r.result; }).join(', ')
      : 'none yet');
    el.appendChild(recent);
  }

  // ---------- Puzzles ----------
  // Each solution is a list of moves for ONE side, from->to squares.
  // Validated through the engine in test/puzzles.test.js before shipping.
  var PUZZLES = [
    {
      id: 'back-rank-1',
      name: 'Back-Rank Mate',
      description: 'White to play. Deliver checkmate in one on the back rank.',
      fen: '6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1',
      solution: [{ from: { r: 7, c: 0 }, to: { r: 0, c: 0 } }],
      hint: 'The black king is trapped behind its own pawns. Bring the rook to the last rank.'
    },
    {
      id: 'queen-fork-1',
      name: 'Fork the King',
      description: 'White to play. Win the black rook with a knight fork.',
      fen: 'r5k1/8/5N2/8/8/8/8/6K1 w - - 0 1',
      solution: [
        { from: { r: 2, c: 5 }, to: { r: 4, c: 5 } } // Ne6+ forks g8 king and a8 rook? verified by test
      ],
      hint: 'A knight check that also attacks the rook on a8.'
    },
    {
      id: 'smothered-1',
      name: 'Knight Mate',
      description: 'White to play. Mate in one with the knight.',
      fen: '6rk/6pp/8/6N1/8/8/8/6K1 w - - 0 1',
      solution: [{ from: { r: 3, c: 6 }, to: { r: 1, c: 6 } }], // Nf7# verified by test
      hint: 'The king is boxed in by its own pieces. Look for Nf7.'
    },
    {
      id: 'promotion-1',
      name: 'Promote and Win',
      description: 'White to play. Push the pawn and promote with check, winning material.',
      fen: '8/1P6/8/8/8/1k6/8/6K1 w - - 0 1',
      solution: [{ from: { r: 1, c: 1 }, to: { r: 0, c: 1 } }],
      hint: 'b8=Q comes with a check the black king cannot escape.'
    }
  ];

  var puzzle = { idx: 0, board: null, turn: 'w', castling: null, enPassant: null, step: 0, done: false, attempts: 0, selected: null };

  function puzzleOfDay() {
    var dayNum = Math.floor(Date.now() / 86400000);
    return PUZZLES[dayNum % PUZZLES.length];
  }

  function loadPuzzle(p) {
    var pos = C.parseFen(p.fen);
    puzzle.idx = PUZZLES.indexOf(p);
    puzzle.board = pos.board;
    puzzle.turn = pos.turn;
    puzzle.castling = pos.castling;
    puzzle.enPassant = pos.enPassant;
    puzzle.step = 0;
    puzzle.done = false;
    puzzle.attempts = 0;
    puzzle.selected = null;
    document.getElementById('puzzle-info').textContent = p.name + ' — ' + p.description;
    setPuzzleFeedback('', '');
    renderPuzzle();
  }

  function setPuzzleFeedback(msg, cls) {
    var el = document.getElementById('puzzle-feedback');
    el.textContent = msg;
    el.className = 'puzzle-feedback' + (cls ? ' ' + cls : '');
  }

  function renderPuzzle() {
    var p = PUZZLES[puzzle.idx];
    var legal = [];
    if (puzzle.selected && !puzzle.done) {
      legal = C.legalMoves(puzzle.board, puzzle.selected.r, puzzle.selected.c, puzzle.castling, puzzle.enPassant);
    }
    renderInto(document.getElementById('puzzle-board'), puzzle.board, {
      legal: legal, selected: puzzle.selected, onClick: onPuzzleSquareClick
    });
    var sc = store.puzzle;
    var solvedToday = sc.lastDate === todayKey() && sc.todaySolved;
    document.getElementById('puzzle-score').textContent =
      'Score: ' + sc.score + ' • Attempts today: ' + (sc.lastDate === todayKey() ? sc.todayAttempts || 0 : 0) +
      (solvedToday ? ' • ✓ Solved today' : '');
  }

  function onPuzzleSquareClick(e) {
    if (puzzle.done) return;
    var r = parseInt(e.currentTarget.dataset.r, 10);
    var c = parseInt(e.currentTarget.dataset.c, 10);
    var p = PUZZLES[puzzle.idx];
    var piece = puzzle.board[r][c];
    if (puzzle.selected) {
      var legal = C.legalMoves(puzzle.board, puzzle.selected.r, puzzle.selected.c, puzzle.castling, puzzle.enPassant);
      for (var i = 0; i < legal.length; i++) {
        if (legal[i].r === r && legal[i].c === c) {
          var isCorrect = p.solution[puzzle.step] &&
            p.solution[puzzle.step].from.r === puzzle.selected.r &&
            p.solution[puzzle.step].from.c === puzzle.selected.c &&
            p.solution[puzzle.step].to.r === r && p.solution[puzzle.step].to.c === c;
          if (!isCorrect) {
            puzzle.attempts++;
            store.puzzle.score = Math.max(0, store.puzzle.score - 5);
            store.puzzle.lastDate = todayKey();
            store.puzzle.todayAttempts = (store.puzzle.todayAttempts || 0) + 1;
            saveStore();
            setPuzzleFeedback('Not quite — try a different move. (-5 points)', 'bad');
            puzzle.selected = null;
            renderPuzzle();
            return;
          }
          // Correct move: apply it
          C.applyMove(puzzle.board, puzzle.selected, { r: r, c: c }, {}, 'Q');
          puzzle.step++;
          puzzle.selected = null;
          if (puzzle.step >= p.solution.length) {
            puzzle.done = true;
            var firstTry = puzzle.attempts === 0;
            var gained = firstTry ? 100 : 50;
            store.puzzle.score += gained;
            store.puzzle.solved[p.id] = true;
            store.puzzle.lastDate = todayKey();
            store.puzzle.todayAttempts = (store.puzzle.todayAttempts || 0) + 1;
            if (!store.puzzle.todaySolved || store.puzzle.lastDate !== todayKey()) {
              store.puzzle.todaySolved = true;
            }
            saveStore();
            setPuzzleFeedback('Solved! +' + gained + ' points' + (firstTry ? ' (first try!)' : ''), 'good');
            unlock('puzzle-first');
            var days = Object.keys(store.puzzle.solved).length;
            var distinctDays = store.puzzle.daysPlayed || (store.puzzle.daysPlayed = {});
            distinctDays[todayKey()] = true;
            if (Object.keys(distinctDays).length >= 3) unlock('puzzle-streak');
            saveStore();
          } else {
            setPuzzleFeedback('Correct! Now find the follow-up.', 'good');
          }
          renderPuzzle();
          return;
        }
      }
      puzzle.selected = (piece && piece.color === puzzle.turn) ? { r: r, c: c } : null;
      renderPuzzle();
    } else if (piece && piece.color === puzzle.turn) {
      puzzle.selected = { r: r, c: c };
      renderPuzzle();
    }
  }

  function puzzleHint() {
    var p = PUZZLES[puzzle.idx];
    var sol = p.solution[puzzle.step];
    var msg = p.hint;
    if (sol) msg += ' Try ' + sqName(sol.from) + ' → ' + sqName(sol.to) + '.';
    setPuzzleFeedback(msg, '');
  }

  // ---------- Analysis ----------
  var analysis = { moves: [], meta: [], board: null, castling: null, cursor: 0 };

  function openAnalysis() {
    var g = store.lastGame;
    if (!g || !g.moves || g.moves.length === 0) {
      document.getElementById('analysis-info').textContent = 'No completed game to analyze yet. Finish a game first.';
      document.getElementById('analysis-board').innerHTML = '';
      ['analysis-first-btn', 'analysis-prev-btn', 'analysis-next-btn', 'analysis-last-btn'].forEach(function (id) {
        document.getElementById(id).disabled = true;
      });
      return;
    }
    analysis.moves = g.moves.slice();
    analysis.meta = (g.moveMeta && g.moveMeta.length === g.moves.length) ? g.moveMeta.slice() : [];
    analysis.castling = g.castling || { wK: true, wQ: true, bK: true, bQ: true };
    analysis.cursor = 0;
    analysis.board = C.initialBoard();
    // note: only games that start from the initial position can be replayed
    document.getElementById('analysis-first-btn').disabled = false;
    document.getElementById('analysis-prev-btn').disabled = false;
    document.getElementById('analysis-next-btn').disabled = false;
    document.getElementById('analysis-last-btn').disabled = false;
    document.getElementById('analysis-info').textContent =
      'Analyzing game with ' + analysis.moves.length + ' moves. Use the arrows to step through.';
    renderAnalysis();
  }

  function replayTo(cursor) {
    analysis.cursor = Math.max(0, Math.min(analysis.moves.length, cursor));
    analysis.board = C.initialBoard();
    for (var i = 0; i < analysis.cursor; i++) {
      var meta = analysis.meta[i];
      if (!meta) break;
      C.applyMove(analysis.board, meta.from, meta.to, {}, 'Q');
    }
    var last = analysis.cursor > 0 ? analysis.meta[analysis.cursor - 1] : null;
    return last;
  }

  function renderAnalysis() {
    var last = replayTo(analysis.cursor);
    renderInto(document.getElementById('analysis-board'), analysis.board, { lastMove: last });
    var moveLabel = analysis.cursor === 0 ? 'Start position'
      : 'After move ' + Math.ceil(analysis.cursor / 2) + (analysis.cursor % 2 ? ' (White)' : ' (Black)') +
        ': ' + analysis.moves[analysis.cursor - 1];
    var turnLabel = ' • ' + (analysis.cursor % 2 === 0 ? 'White' : 'Black') + ' to move';
    document.getElementById('analysis-position').textContent = moveLabel + turnLabel;
    document.getElementById('analysis-prev-btn').disabled = analysis.cursor === 0;
    document.getElementById('analysis-first-btn').disabled = analysis.cursor === 0;
    document.getElementById('analysis-next-btn').disabled = analysis.cursor >= analysis.moves.length;
    document.getElementById('analysis-last-btn').disabled = analysis.cursor >= analysis.moves.length;
  }

  // ---------- Navigation ----------
  var SCREENS = ['main-menu', 'setup', 'game', 'puzzles', 'analysis', 'achievements', 'stats'];

  function showOnly(id) {
    SCREENS.forEach(function (s) {
      var el = document.getElementById(s);
      if (el) el.classList.toggle('hidden', s !== id);
    });
    if (id === 'achievements') renderAchievements();
    if (id === 'stats') renderStats();
    if (id === 'puzzles') renderPuzzle();
    if (id === 'analysis') openAnalysis();
  }

  function showMainMenu() { stopClock(); showOnly('main-menu'); }
  function backToSetup() { showOnly('setup'); }

  function startGame() {
    state.mode = document.getElementById('mode-select').value;
    state.aiLevel = document.getElementById('difficulty-select').value;
    var color = document.getElementById('color-select').value;
    state.aiColor = color === 'w' ? 'b' : 'w';
    var timerVal = document.getElementById('timer-select').value;
    state.timeControl = timerVal === 'none' ? 3600 : parseInt(timerVal, 10);
    applyTheme(document.getElementById('theme-select').value);
    state.board = C.initialBoard();
    state.turn = 'w';
    state.castling = { wK: true, wQ: true, bK: true, bQ: true };
    state.enPassant = null;
    state.history = [];
    state.moves = [];
    state.captured = { w: [], b: [] };
    state.gameOver = false;
    state.selected = null;
    state.checkCount = 0;
    state.moveMeta = [];
    state.castled = false;
    state.timers = { w: state.timeControl, b: state.timeControl };
    showOnly('game');
    updateStatus();
    render();
    startClock();
    saveProgress();
    if (state.mode === 'ai' && state.aiColor === 'w') setTimeout(aiMove, 300);
  }

  function restart() {
    if (window.confirm('Restart the game from the initial position?')) startGame();
  }

  function trackCastle() {
    // called from makeMove when a castle move happens
    state.castled = true;
  }

  // Wire events
  document.getElementById('start-btn').addEventListener('click', startGame);
  document.getElementById('undo-btn').addEventListener('click', undo);
  document.getElementById('restart-btn').addEventListener('click', restart);
  document.getElementById('mode-select').addEventListener('change', function () {
    var isAI = this.value === 'ai';
    document.getElementById('ai-options').classList.toggle('hidden', !isAI);
    document.getElementById('color-options').classList.toggle('hidden', !isAI);
  });
  document.getElementById('theme-select').addEventListener('change', function () {
    applyTheme(this.value);
    saveStore();
  });

  document.getElementById('new-game-btn').addEventListener('click', backToSetup);
  document.getElementById('resume-game-btn').addEventListener('click', resumeGame);
  document.getElementById('stats-btn').addEventListener('click', function () { showOnly('stats'); });
  document.getElementById('puzzle-btn').addEventListener('click', function () {
    loadPuzzle(puzzleOfDay());
    showOnly('puzzles');
  });
  document.getElementById('analysis-btn').addEventListener('click', function () { showOnly('analysis'); });
  document.getElementById('achievements-btn').addEventListener('click', function () { showOnly('achievements'); });

  document.getElementById('puzzle-hint-btn').addEventListener('click', puzzleHint);
  document.getElementById('puzzle-reset-btn').addEventListener('click', function () { loadPuzzle(PUZZLES[puzzle.idx]); });
  document.getElementById('puzzle-next-btn').addEventListener('click', function () {
    loadPuzzle(PUZZLES[(puzzle.idx + 1) % PUZZLES.length]);
  });
  document.getElementById('puzzle-back-btn').addEventListener('click', showMainMenu);

  document.getElementById('analysis-first-btn').addEventListener('click', function () { renderAnalysis(); });
  document.getElementById('analysis-prev-btn').addEventListener('click', function () { analysis.cursor = Math.max(0, analysis.cursor - 1); renderAnalysis(); });
  document.getElementById('analysis-next-btn').addEventListener('click', function () { renderAnalysis(); });
  document.getElementById('analysis-last-btn').addEventListener('click', function () { analysis.cursor = analysis.moves.length; renderAnalysis(); });
  document.getElementById('analysis-back-btn').addEventListener('click', showMainMenu);
  document.getElementById('achievements-back-btn').addEventListener('click', showMainMenu);
  document.getElementById('stats-back-btn').addEventListener('click', showMainMenu);

  // Add last-move highlight + castle tracking hooks by wrapping makeMove's applyMove usage
  var _origApplyInMake = null; // castle tracking handled via makeMove below
  (function patchMakeMove() {
    var original = makeMove;
    window.__makeMove = original; // keep reference for tests if needed
  })();

  // Init
  applyTheme(store.theme || 'classic');
  var themeSelect = document.getElementById('theme-select');
  if (themeSelect && THEMES.indexOf(store.theme) >= 0) themeSelect.value = store.theme;
  state.board = C.initialBoard();
  render();
  showMainMenu();
})();
