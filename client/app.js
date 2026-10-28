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
    theme: 'classic',
    pieceDesign: 'classic',
    uiTheme: 'dark',
    playerName: '',
    online: null,
    tournament: null,        // active tournament object (window.Tournament shape)
    tourMatchId: null        // id of the match being played, null for casual games
  };

  // ---------- Persistence (namespaced; never overwrites foreign keys) ----------
  var STORE_KEY = 'chess88.v1';
  // The friends/leaderboard domain modules load as ES-module boots (async), so
  // they may not exist when this classic script parses. Resolve lazily at call
  // time — same approach the tournament/training integration uses.
  function mods() {
    return { f: window.Friends || null, lb: window.Leaderboard || null, spec: window.Spectator || null, screen: window.SpectatorScreen || null };
  }

  function loadStore() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      var data = raw ? JSON.parse(raw) : {};
      if (!data || typeof data !== 'object') data = {};
      return {
        theme: typeof data.theme === 'string' ? data.theme : 'classic',
        pieceDesign: typeof data.pieceDesign === 'string' ? data.pieceDesign : 'classic',
        uiTheme: typeof data.uiTheme === 'string' ? data.uiTheme : 'dark',
        playerName: typeof data.playerName === 'string' ? data.playerName : '',
        lastGame: data.lastGame || null,
        stats: data.stats || { wins: 0, losses: 0, draws: 0, games: 0, recent: [], streak: 0, bestStreak: 0 },
        profile: data.profile || null,
        puzzle: data.puzzle || { score: 0, solved: {}, lastDate: null, todaySolved: false },
        achievements: data.achievements || {},
        savedGames: Array.isArray(data.savedGames) ? data.savedGames : []
      };
    } catch (e) {
      return {
        theme: 'classic', lastGame: null,
        stats: { wins: 0, losses: 0, draws: 0, games: 0, recent: [], streak: 0, bestStreak: 0 },
        puzzle: { score: 0, solved: {}, lastDate: null, todaySolved: false },
        achievements: {},
        profile: null,
        savedGames: []
      };
    }
  }

  var store = loadStore();

  function saveStore() {
    try {
      store.theme = state.theme;
      store.pieceDesign = state.pieceDesign || 'classic';
      store.uiTheme = state.uiTheme || 'dark';
      store.playerName = state.playerName || '';
      localStorage.setItem(STORE_KEY, JSON.stringify(store));
    } catch (e) { /* storage unavailable (private mode) — keep playing */ }
  }

  // ---------- Player profile & Elo rating ----------
  var DEFAULT_PROFILE = {
    name: 'Player',
    rating: 1200,
    peak: 1200,
    bestPerformance: null,   // best single-game rating delta (win)
    games: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    history: []              // [{rating, delta, result, mode, date}]
  };

  // Opponent Elo estimates per difficulty (single-player vs AI).
  var AI_RATINGS = { easy: 800, medium: 1200, hard: 1600 };
  var K_FACTOR = 32;

  function expectedScore(rating, opponentRating) {
    return 1 / (1 + Math.pow(10, (opponentRating - rating) / 400));
  }

  function ensureProfile() {
    if (!store.profile || typeof store.profile !== 'object') {
      store.profile = JSON.parse(JSON.stringify(DEFAULT_PROFILE));
      var pn = state.playerName || (store.playerName || '');
      if (pn) store.profile.name = pn;
    }
    return store.profile;
  }

  // Record one completed casual game into the profile with an Elo update.
  // result: 'win' | 'loss' | 'draw'; opponentRating: number|null (null = unrated, e.g. 2-player).
  function updateProfileRating(result, opponentRating) {
    var p = ensureProfile();
    p.games++;
    if (result === 'win') p.wins++;
    else if (result === 'loss') p.losses++;
    else p.draws++;
    if (opponentRating === null || typeof opponentRating !== 'number') {
      // Unrated games (hotseat or unknown opponents) don't move the rating.
      p.history.unshift({ rating: p.rating, delta: 0, result: result, mode: state.mode, date: new Date().toISOString() });
      p.history = p.history.slice(0, 10);
      return p;
    }
    var expected = expectedScore(p.rating, opponentRating);
    var score = result === 'win' ? 1 : result === 'draw' ? 0.5 : 0;
    var delta = Math.round(K_FACTOR * (score - expected));
    p.rating = Math.max(100, p.rating + delta);
    p.peak = Math.max(p.peak, p.rating);
    if (result === 'win' && (p.bestPerformance === null || delta > p.bestPerformance)) {
      p.bestPerformance = delta;
    }
    p.history.unshift({ rating: p.rating, delta: delta, result: result, mode: state.mode, date: new Date().toISOString() });
    p.history = p.history.slice(0, 10);
    return p;
  }

  function renderProfile() {
    var el = document.getElementById('profile-body');
    if (!el) return;
    var p = ensureProfile();
    var winRate = p.games ? Math.round((p.wins / p.games) * 100) : 0;
    el.innerHTML = '';
    var table = document.createElement('table');
    table.className = 'stats-table';
    [
      ['Player', p.name],
      ['Rating', p.rating],
      ['Peak rating', p.peak],
      ['Games played', p.games],
      ['Wins', p.wins],
      ['Losses', p.losses],
      ['Draws', p.draws],
      ['Win rate', winRate + '%'],
      ['Best performance', p.bestPerformance === null ? '—' : '+' + p.bestPerformance]
    ].forEach(function (row) {
      var tr = document.createElement('tr');
      var td1 = document.createElement('td'); td1.textContent = row[0];
      var td2 = document.createElement('td'); td2.textContent = String(row[1]);
      tr.appendChild(td1); tr.appendChild(td2);
      table.appendChild(tr);
    });
    el.appendChild(table);
    var recent = document.createElement('div');
    recent.className = 'recent-results';
    if (p.history.length) {
      recent.textContent = 'Recent rating changes: ' + p.history.map(function (h) {
        return (h.delta > 0 ? '+' : '') + h.delta + ' (' + h.result + ')';
      }).join(', ');
    } else {
      recent.textContent = 'No rated games yet. Play vs AI to earn a rating.';
    }
    el.appendChild(recent);
  }

  function todayKey() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function sqName(sq) { return 'abcdefgh'[sq.c] + (8 - sq.r); }

  var PIECE_VALUES = { P: 1, N: 3, B: 3, R: 5, Q: 9, K: 0 };

  // ---------- Themes ----------
  var THEMES = ['classic', 'ocean', 'wood', 'midnight', 'slate'];
  var PIECE_DESIGNS = ['classic', 'serif', 'outline'];
  var UI_THEMES = ['dark', 'light'];

  function applyTheme(t) {
    if (THEMES.indexOf(t) < 0) t = 'classic';
    THEMES.forEach(function (name) { document.body.classList.remove('theme-' + name); });
    document.body.classList.add('theme-' + t);
    state.theme = t;
  }

  function applyPieceDesign(d) {
    if (PIECE_DESIGNS.indexOf(d) < 0) d = 'classic';
    PIECE_DESIGNS.forEach(function (name) { document.body.classList.remove('pieces-' + name); });
    document.body.classList.add('pieces-' + d);
    state.pieceDesign = d;
  }

  function applyUiTheme(u) {
    if (UI_THEMES.indexOf(u) < 0) u = 'dark';
    UI_THEMES.forEach(function (name) { document.body.classList.remove('ui-' + name); });
    document.body.classList.add('ui-' + u);
    state.uiTheme = u;
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
        if (opts && opts.useIds) sq.id = 'sq-' + sqName({ r: r, c: c });
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
    if (state.mode === 'online') {
      var sess = net ? net.session() : { code: null };
      net.send('move', { code: sess.code, from: from, to: to, promo: promo || null });
      state.selected = null;
      render();
      return; // server applies and broadcasts; local state updates on move-applied
    }
    state.history.push(snapshot());
    var san = C.sanFor(state.board, from, to, mv.extra, promo, piece);
    var captured = C.applyMove(state.board, from, to, mv.extra, promo);
    if (captured) state.captured[state.turn].push(captured);
    state.castling = C.castlingAfterMove(state.castling, piece, from, to, captured);
    if (mv.extra && mv.extra.castle) state.castled = true;
    state.enPassant = (mv.extra && mv.extra.double) ? { r: (from.r + to.r) / 2, c: from.c } : null;
    state.turn = state.turn === 'w' ? 'b' : 'w';
    if (C.inCheck(state.board, state.turn)) {
      san += C.allLegalMoves(state.board, state.turn, state.castling, state.enPassant).length === 0 ? '#' : '+';
    }
    state.moves.push(san);
    state.moveMeta.push({ from: { r: from.r, c: from.c }, to: { r: to.r, c: to.c }, extra: mv.extra || {}, promotion: promo || 'Q' });
    refreshOpeningRecognition();
    if (C.inCheck(state.board, state.turn)) state.checkCount++;
    state.selected = null;
    updateStatus();
    render();
    checkGameEnd();
    if (!state.gameOver && state.mode === 'ai' && state.turn === state.aiColor) {
      setTimeout(function () {
      if (!state.gameOver && state.mode === 'ai' && state.turn === state.aiColor) aiMove();
    }, 250);
    }
  }

  function checkGameEnd() {
    var moves = C.allLegalMoves(state.board, state.turn, state.castling, state.enPassant);
    if (moves.length === 0) {
      state.gameOver = true;
      stopClock();
      renderTurnIndicator();
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
    renderTurnIndicator();
    if (state.gameOver) return;
    var side = state.turn === 'w' ? 'White' : 'Black';
    setStatus(side + ' to move' + (C.inCheck(state.board, state.turn) ? ' — check!' : ''));
  }

  // ---------- Clock ----------
  function startClock() {
    if (state.mode === 'online') {
      // Display-only ticking between server broadcasts; the server is the authority.
      stopClock();
      state.clockId = setInterval(function () {
        if (state.gameOver || state.timers[state.turn] <= 0) return;
        state.timers[state.turn] = Math.max(0, state.timers[state.turn] - 1);
        renderTimers();
      }, 1000);
      return;
    }
    stopClock();
    state.clockId = setInterval(function () {
      var current = state.timers[state.turn];
      if (state.gameOver || current <= 0) { stopClock(); return; } // freeze at zero, no negative drift
      state.timers[state.turn] = Math.max(0, current - 1);
      if (state.timers[state.turn] === 0) {
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
    var tw = document.getElementById('timer-white');
    var tb = document.getElementById('timer-black');
    tw.textContent = 'White ' + fmt(state.timers.w);
    tb.textContent = 'Black ' + fmt(state.timers.b);
    tw.classList.toggle('active', state.turn === 'w' && !state.gameOver);
    tb.classList.toggle('active', state.turn === 'b' && !state.gameOver);
  }

  // ---------- Rendering ----------
  function render() {
    var boardEl = document.getElementById('board');
    var legal = [];
    if (state.selected) {
      legal = C.legalMoves(state.board, state.selected.r, state.selected.c, state.castling, state.enPassant);
    }
    var last = state.moveMeta.length ? state.moveMeta[state.moveMeta.length - 1] : null;
    renderInto(boardEl, state.board, { legal: legal, selected: state.selected, lastMove: last, onClick: onSquareClick, useIds: true });
    renderTimers();
    renderTurnIndicator();
    renderCaptured();
    renderMoves();
    document.getElementById('undo-btn').disabled =
      state.history.length === 0 || state.gameOver ||
      (state.mode === 'ai' && state.turn === state.aiColor);
  }

  function renderTurnIndicator() {
    var el = document.getElementById('turn-indicator');
    if (!el) return;
    var reviewBtn = document.getElementById('game-review-btn');
    if (reviewBtn) {
      var gameVisible = !document.getElementById('game').classList.contains('hidden');
      reviewBtn.hidden = !(state.gameOver && gameVisible);
      reviewBtn.classList.toggle('hidden', !state.gameOver || !gameVisible);
    }
    if (state.gameOver) { el.textContent = 'Game over'; return; }
    var dot = document.createElement('span');
    dot.className = 'turn-dot ' + state.turn;
    el.textContent = '';
    el.appendChild(dot);
    el.appendChild(document.createTextNode(' ' + (state.turn === 'w' ? "White's turn" : "Black's turn")));
    if (C.inCheck(state.board, state.turn)) {
      var c = document.createElement('span');
      c.className = 'turn-check';
      c.textContent = ' — check!';
      el.appendChild(c);
    }
  }

  function renderCaptured() {
    var vals = { w: 0, b: 0 };
    ['w', 'b'].forEach(function (side) {
      state.captured[side].forEach(function (p) { vals[side] += PIECE_VALUES[p.type]; });
    });
    ['w', 'b'].forEach(function (side) {
      var el = document.getElementById(side === 'w' ? 'captured-white' : 'captured-black');
      var label = side === 'w' ? 'White captured' : 'Black captured';
      el.textContent = '';
      el.appendChild(document.createTextNode(
        label + ': ' + (state.captured[side].map(function (p) { return PIECE_GLYPHS[p.color + p.type]; }).join(' ') || '—')));
      var diff = vals[side] - vals[side === 'w' ? 'b' : 'w'];
      if (diff > 0) {
        var adv = document.createElement('span');
        adv.className = 'material-adv';
        adv.textContent = '+' + diff;
        el.appendChild(adv);
      }
    });
  }

  function renderMoves() {
    var ol = document.getElementById('move-list');
    ol.innerHTML = '';
    if (state.moves.length === 0) {
      var empty = document.createElement('li');
      empty.className = 'move-list-empty';
      empty.textContent = '0. — No moves yet';
      ol.appendChild(empty);
      ol.scrollTop = 0;
      return;
    }
    for (var i = 0; i < state.moves.length; i += 2) {
      var li = document.createElement('li');
      li.textContent = (i / 2 + 1) + '. ' + state.moves[i] + (state.moves[i + 1] ? ' ' + state.moves[i + 1] : '');
      if (i + 1 >= state.moves.length) li.className = 'current';
      ol.appendChild(li);
    }
    ol.scrollTop = ol.scrollHeight;
  }

  function onSquareClick(e) {
    if (state.gameOver) return;
    if (state.mode === 'ai' && state.turn === state.aiColor) return;
    if (state.mode === 'online') {
      var sess = net ? net.session() : { seat: null };
      if (state.turn !== sess.seat) return; // only your pieces on your turn
    }
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
    if (state.mode === 'online') return;
    bumpAiGeneration();
    var snaps = (state.mode === 'ai' && state.history.length >= 2) ? 2 : 1;
    for (var i = 0; i < snaps; i++) {
      if (state.history.length === 0) break;
      var s = state.history.pop();
      state.board = s.board; state.turn = s.turn; state.castling = s.castling;
      state.enPassant = s.enPassant; state.moves = s.moves;
      state.captured = s.captured; state.timers = s.timers;
    }
    state.moveMeta = state.moveMeta.slice(0, Math.max(0, state.moveMeta.length - snaps));
    state.selected = null;
    updateStatus();
    render();
    saveProgress();
  }

  // ---------- AI ----------
  // The heavy search lives in src/ui/ai-search.js and runs in a Web Worker
  // (src/ui/ai.worker.js) so the UI never freezes. Worker replies echo both
  // request id and generation so resets invalidate pending moves.
  var aiGeneration = 0;
  var aiWorker = null;
  var aiRequestId = 0;

  function bumpAiGeneration() {
    aiGeneration++;
  }

  function getAiWorker() {
    if (aiWorker) return aiWorker;
    try {
      aiWorker = new Worker('src/ui/ai.worker.js');
      aiWorker.onmessage = handleAiReply;
      aiWorker.onerror = function () {
        // Worker unavailable (e.g. file:// or old browser): fall back to
        // computing on the main thread so the game still works.
        aiWorker = null;
      };
    } catch (e) {
      aiWorker = null;
    }
    return aiWorker;
  }

  function handleAiReply(event) {
    var msg = event.data;
    if (msg.id !== aiRequestId || msg.generation !== aiGeneration) return; // stale
    if (!msg.move) return; // no legal moves; game end handled elsewhere
    makeMove(msg.move.from, msg.move.to, msg.move.to.extra && msg.move.to.extra.promotion);
  }

  function aiMove() {
    if (state.gameOver || state.mode !== 'ai' || state.turn !== state.aiColor) return;
    var color = state.aiColor;
    var moves = C.allLegalMoves(state.board, color, state.castling, state.enPassant);
    if (moves.length === 0) {
      checkGameEnd();
      return;
    }
    var generation = aiGeneration;
    var requestId = ++aiRequestId;
    var position = {
      board: state.board,
      turn: color,
      castling: state.castling,
      enPassant: state.enPassant,
      difficulty: state.aiLevel,
    };
    var worker = getAiWorker();
    if (worker) {
      worker.postMessage({
        id: requestId,
        generation: generation,
        difficulty: state.aiLevel,
        board: state.board,
        turn: color,
        castling: state.castling,
        enPassant: state.enPassant,
      });
      return;
    }
    // Main-thread fallback (worker unavailable).
    var move = window.AiSearch
      ? window.AiSearch.chooseMove({ core: C, board: state.board, turn: color, castling: state.castling, enPassant: state.enPassant }, state.aiLevel)
      : null;
    if (move && generation === aiGeneration) makeMove(move.from, move.to);
    void position;
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
  // Record a completed game against a friend (challenge games only), keeping
  // the friend's cached stats and rating snapshot fresh for the leaderboard.
  function recordFriendResult(result) {
    if (!state.challenge || !state.challenge.friendCode) return;
    var code = state.challenge.friendCode;
    var me = ensureProfile();
    var m = mods();
    if (!m.f) return;
    friendsList = m.f.loadFriends();
    try {
      friendsList = m.f.updateFriendRating(friendsList, code, me.rating);
    } catch (e) { /* friend not in list — nothing to update */ }
    friendsList = friendsList.map(function (f) {
      if (f.code !== code) return f;
      // From the friend's perspective: local 'win' = friend loss, and vice versa.
      var friendResult = result === 'win' ? 'loss' : result === 'loss' ? 'win' : 'draw';
      return { code: f.code, name: f.name, rating: f.rating, addedAt: f.addedAt,
               games: (f.games || 0) + 1,
               wins: (f.wins || 0) + (friendResult === 'win' ? 1 : 0),
               losses: (f.losses || 0) + (friendResult === 'loss' ? 1 : 0),
               draws: (f.draws || 0) + (friendResult === 'draw' ? 1 : 0) };
    });
    persistFriends();
  }

  function onGameEnd(reason) {
    // Tournament matches branch off here: their result advances the bracket
    // and is NOT double-recorded in casual stats.
    if (finishTournamentMatch(reason)) {
      saveStore();
      renderAchievements();
      return;
    }
    var playerColor = state.mode === 'ai' ? (state.aiColor === 'w' ? 'b' : 'w') : null;
    var loser = state.turn; // side that cannot move or flagged on time
    var winner = loser === 'w' ? 'b' : 'w';
    var isDraw = reason === 'stalemate';
    var aiOpponentRating = state.mode === 'ai' ? AI_RATINGS[state.aiLevel] || 1200 : null;

    var oppCode = null;
    if (state.mode === 'ai') oppCode = 'AI:' + state.aiLevel;
    else if (state.challenge && state.challenge.friendCode) oppCode = state.challenge.friendCode;
    function recentRow(result) {
      return { result: result, mode: state.mode, date: new Date().toISOString(),
               opponentCode: oppCode, opponentRating: aiOpponentRating };
    }

    if (isDraw) {
      store.stats.draws++;
      store.stats.streak = 0;
      store.stats.games++;
      store.stats.recent.unshift(recentRow('draw'));
      updateProfileRating('draw', aiOpponentRating);
      recordFriendResult('draw');
    } else if (playerColor) {
      if (winner === playerColor) {
        store.stats.wins++;
        store.stats.streak++;
        store.stats.games++;
        store.stats.bestStreak = Math.max(store.stats.bestStreak, store.stats.streak);
        store.stats.recent.unshift(recentRow('win'));
        unlock('first-win');
        updateProfileRating('win', aiOpponentRating);
        recordFriendResult('win');
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
        store.stats.recent.unshift(recentRow('loss'));
        updateProfileRating('loss', aiOpponentRating);
        recordFriendResult('loss');
      }
    } else {
      // 2-player mode: record result + an unrated profile game
      store.stats.games++;
      store.stats.recent.unshift({
        result: winner === 'w' ? 'white-won' : 'black-won',
        mode: state.mode, date: new Date().toISOString()
      });
      updateProfileRating('draw', null); // hotseat games are unrated
      if (state.challenge) recordFriendResult(winner === 'w' ? 'win' : 'loss');
      state.challenge = null;
    }
    store.stats.recent = store.stats.recent.slice(0, 10);
    archiveCompletedGame(reason);
    saveStore();
    saveProgress();
    renderAchievements(); // keep cache fresh if user opens screen next
  }

  // ---------- Save / resume ----------
  function saveProgress() {
    if (state.mode === 'online') return; // online state lives on the server
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
      id: 'queen-mate-1',
      name: 'Queen Mate',
      description: 'White to play. Deliver checkmate in one with the queen.',
      fen: '6k1/5ppp/8/8/8/8/8/4Q1K1 w - - 0 1',
      solution: [{ from: { r: 7, c: 4 }, to: { r: 0, c: 4 } }],
      hint: 'The black king is trapped behind its pawns. Bring the queen to the eighth rank.'
    },
    {
      id: 'smothered-1',
      name: 'Knight Mate',
      description: 'White to play. Mate in one with the knight.',
      fen: '6rk/6pp/8/6N1/8/8/8/6K1 w - - 0 1',
      solution: [{ from: { r: 3, c: 6 }, to: { r: 1, c: 5 } }], // Nf7# verified by test
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

  // ---------- Smart Game Review ----------
  var GameReview = window.GameReview || null;
  var review = { entries: [], summary: null, moves: [], meta: [], cursor: 0, board: null };

  function openSmartReview() {
    var infoEl = document.getElementById('review-info');
    var boardEl = document.getElementById('review-board');
    var sumEl = document.getElementById('review-summary');
    var verdictEl = document.getElementById('review-verdict');
    var listEl = document.getElementById('review-list');
    var nav = ['review-first-btn', 'review-prev-btn', 'review-next-btn', 'review-last-btn'];
    if (!GameReview) { // module failed to load — degrade gracefully
      infoEl.textContent = 'Review module failed to load.';
      boardEl.innerHTML = '';
      sumEl.textContent = ''; verdictEl.textContent = ''; listEl.innerHTML = '';
      nav.forEach(function (id) { document.getElementById(id).disabled = true; });
      return;
    }
    var g = store.lastGame;
    if (!g || !g.moves || g.moves.length === 0) {
      infoEl.textContent = 'No completed game to review yet. Finish a game first.';
      boardEl.innerHTML = '';
      sumEl.textContent = ''; verdictEl.textContent = ''; listEl.innerHTML = '';
      nav.forEach(function (id) { document.getElementById(id).disabled = true; });
      return;
    }
    var hasMeta = g.moveMeta && g.moveMeta.length === g.moves.length;
    infoEl.textContent = hasMeta
      ? 'Analyzing ' + g.moves.length + ' moves…'
      : 'This game is missing move details, so a per-move review is not possible.';
    if (!hasMeta) {
      boardEl.innerHTML = ''; sumEl.textContent = ''; verdictEl.textContent = ''; listEl.innerHTML = '';
      nav.forEach(function (id) { document.getElementById(id).disabled = true; });
      return;
    }
    var result;
    try {
      result = GameReview.reviewGame({ moves: g.moves, moveMeta: g.moveMeta });
    } catch (e) {
      infoEl.textContent = 'Review failed unexpectedly. Try another game.';
      return;
    }
    review.entries = result.entries;
    review.summary = result.summary;
    review.moves = g.moves.slice();
    review.meta = g.moveMeta.slice();
    review.cursor = 0;
    review.board = C.initialBoard();

    var s = result.summary;
    sumEl.textContent = 'Accuracy ' + s.accuracy + '% • ' +
      s.excellent + ' excellent • ' + s.missed + ' missed opportunities • ' +
      s.mistake + ' mistakes • ' + s.blunder + ' blunders';
    verdictEl.textContent = 'Use the arrows to step through the game.';
    listEl.innerHTML = '';
    result.entries.forEach(function (e, i) {
      var item = document.createElement('button');
      item.type = 'button';
      item.className = 'review-item review-' + e.cls;
      item.dataset.index = String(i);
      item.textContent = (i % 2 === 0 ? (i / 2 + 1) + '. ' : '') + e.san + ' — ' + e.cls + (e.alternative ? ' (better: ' + e.alternative + ')' : '');
      item.addEventListener('click', function () { review.cursor = i + 1; renderReview(); });
      listEl.appendChild(item);
    });
    nav.forEach(function (id) { document.getElementById(id).disabled = false; });
    infoEl.textContent = 'Review of ' + g.moves.length + ' moves complete.';
    renderReview();
  }

  function replayToReview(cursor) {
    review.cursor = Math.max(0, Math.min(review.moves.length, cursor));
    review.board = C.initialBoard();
    for (var i = 0; i < review.cursor; i++) {
      C.applyMove(review.board, review.meta[i].from, review.meta[i].to, {}, 'Q');
    }
    return review.cursor > 0 ? review.meta[review.cursor - 1] : null;
  }

  function renderReview() {
    var last = replayToReview(review.cursor);
    renderInto(document.getElementById('review-board'), review.board, { lastMove: last });
    var entry = review.cursor > 0 ? review.entries[review.cursor - 1] : null;
    var verdictEl = document.getElementById('review-verdict');
    if (!entry) {
      verdictEl.textContent = 'Start position — step forward to see the review.';
    } else {
      var label = 'Move ' + Math.ceil(review.cursor / 2) + (entry.side === 'w' ? ' (White)' : ' (Black)') + ': ' + entry.san;
      verdictEl.textContent = label + ' — ' + entry.explanation;
    }
    document.getElementById('review-first-btn').disabled = review.cursor === 0;
    document.getElementById('review-prev-btn').disabled = review.cursor === 0;
    document.getElementById('review-next-btn').disabled = review.cursor >= review.moves.length;
    document.getElementById('review-last-btn').disabled = review.cursor >= review.moves.length;
    var listEl = document.getElementById('review-list');
    for (var i = 0; i < listEl.children.length; i++) {
      listEl.children[i].classList.toggle('current', i === review.cursor - 1);
    }
  }

  // ---------- Saved games / Replay & Share ----------
  var SC = window.ShareCode;
  var replay = { moves: [], meta: [], cursor: 0, id: null, imported: null };

  // Archive a completed game (called from onGameEnd before saveProgress clears lastGame).
  function archiveCompletedGame(reason) {
    if (!state.moves || state.moves.length === 0) return;
    if (state.mode === 'online') return; // server owns online games
    var result;
    var loser = state.turn;
    var winner = loser === 'w' ? 'b' : 'w';
    if (reason === 'stalemate') result = 'draw';
    else if (reason === 'time') result = 'time-' + winner;
    else result = winner === 'w' ? 'white-won' : 'black-won';
    store.savedGames.unshift({
      id: 'g' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36),
      date: new Date().toISOString(),
      mode: state.mode,
      white: state.mode === 'ai' && state.aiColor === 'w' ? 'Computer' : (state.playerName || 'White'),
      black: state.mode === 'ai' && state.aiColor === 'b' ? 'Computer' : (state.mode === '2p' ? 'Black' : (state.playerName || 'Black')),
      result: result,
      resultTag: result === 'draw' ? '1/2-1/2' : (winner === 'w' ? '1-0' : '0-1'),
      timestamp: new Date().toISOString(),
      moves: state.moves.slice(),
      moveMeta: state.moveMeta.slice().map(function (m) { return { from: { r: m.from.r, c: m.from.c }, to: { r: m.to.r, c: m.to.c } }; }),
      checkCount: state.checkCount || 0
    });
    if (store.savedGames.length > 20) store.savedGames.length = 20;
  }

  function shareCodeFor(g) {
    return SC.encode(g.moveMeta);
  }

  function replayById(id) {
    var g = null;
    for (var i = 0; i < store.savedGames.length; i++) {
      if (store.savedGames[i].id === id) { g = store.savedGames[i]; break; }
    }
    if (!g || !g.moveMeta || !g.moveMeta.length) return;
    startReplay(g);
    showOnly('replay');
  }

  function startReplay(g) {
    replay.moves = g.moves.slice();
    replay.meta = g.moveMeta.slice();
    replay.cursor = 0;
    replay.id = g.id;
    replay.imported = { white: g.white || 'White', black: g.black || 'Black', result: g.resultTag || '*', timestamp: g.timestamp || g.date || '' };
    replay.board = C.initialBoard();
    replayFromCodeMode = false;
  }

  // Replay a bare share code (works on another device with nothing saved locally).
  var replayFromCodeMode = false;
  var replayCodeJustLoaded = 0; // number of moves from the last loaded code, until first navigation

  function openReplayFromCode(code) {
    var moves;
    try {
      moves = SC.decode(code);
    } catch (err) {
      setReplayInfo('Invalid share code: ' + err.message, true);
      return false;
    }
    if (moves.length === 0) { setReplayInfo('This share code contains no moves.', true); return false; }
    replayFromCodeMode = true;
    replay.id = null;
    replay.moves = moves.map(function (_, i) { return sanPlaceholder(i); });
    replay.meta = moves;
    replay.cursor = 0;
    replay.board = C.initialBoard();
    setReplayInfo('Replaying ' + moves.length + ' moves from share code.', false);
    replayCodeJustLoaded = moves.length;
    renderReplay();
    return true;
  }

  // SAN text is not carried in the share code; label moves by number/side instead.
  function sanPlaceholder(i) {
    var n = Math.floor(i / 2) + 1;
    return (i % 2 === 0 ? n + '. ' : n + '… ');
  }

  function setReplayInfo(msg, isError) {
    var el = document.getElementById('replay-info');
    el.textContent = msg;
    el.className = 'section-info' + (isError ? ' replay-error' : '');
  }

  function renderReplayList() {
    var list = document.getElementById('replay-list');
    list.innerHTML = '';
    var games = store.savedGames;
    if (!games.length) {
      var empty = document.createElement('div');
      empty.className = 'section-info';
      empty.textContent = 'No saved games yet. Finish a game and it will be archived here automatically.';
      list.appendChild(empty);
    }
    games.forEach(function (g) {
      var row = document.createElement('div');
      row.className = 'replay-row';

      var info = document.createElement('div');
      info.className = 'replay-info';
      var title = document.createElement('div');
      title.className = 'replay-title';
      title.textContent = new Date(g.date).toLocaleString() + ' — ' + g.result +
        ' — ' + Math.ceil(g.moves.length / 2) + ' moves';
      var code = document.createElement('div');
      code.className = 'replay-code';
      code.textContent = shareCodeFor(g);
      info.appendChild(title);
      info.appendChild(code);

      var actions = document.createElement('div');
      actions.className = 'replay-actions';
      function btn(id, label, handler) {
        var b = document.createElement('button');
        b.id = id;
        b.type = 'button';
        b.textContent = label;
        b.addEventListener('click', handler);
        actions.appendChild(b);
      }
      btn(null, '▶ Replay', function () { replayById(g.id); });
      btn(null, 'Copy PGN', function () {
        try { copyText(PGN.exportGame({ sans: g.moves, white: g.white, black: g.black, result: g.resultTag, timestamp: g.timestamp || g.date }), 'PGN copied.'); }
        catch (e) { setReplayInfo('Unable to export PGN: ' + e.message, true); }
      });
      btn(null, 'Download PGN', function () {
        try { downloadPgn(g); }
        catch (e) { setReplayInfo('Unable to download PGN: ' + e.message, true); }
      });
      btn(null, 'Copy code', function () {
        copyText(shareCodeFor(g), 'Share code copied.');
      });
      btn(null, 'Delete', function () {
        if (window.confirm('Delete this saved game?')) {
          store.savedGames = store.savedGames.filter(function (x) { return x.id !== g.id; });
          saveStore();
          renderReplayList();
        }
      });
      row.appendChild(info);
      row.appendChild(actions);
      list.appendChild(row);
    });
  }

  function downloadPgn(game) {
    var text = PGN.exportGame({ sans: game.moves || [], white: game.white, black: game.black,
      result: game.resultTag || '*', timestamp: game.timestamp || game.date });
    var blob = new Blob([text], { type: 'application/x-chess-pgn;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = 'chess-game-' + (game.id || 'export') + '.pgn';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    toast('PGN downloaded.');
  }

  function copyText(text, okMsg) {
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); toast(okMsg); } catch (e) { toast('Copy failed — select the code manually.'); }
      document.body.removeChild(ta);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast(okMsg); }, fallback);
    } else {
      fallback();
    }
  }

  function replayTo(cursor) {
    if (cursor !== replay.cursor) replayCodeJustLoaded = 0;
    var position = ReplayPosition.setPosition(cursor, replay.meta, C);
    replay.cursor = position.cursor;
    replay.board = position.board;
    return position.lastMove;
  }

  function renderReplay() {
    var last = replayTo(replay.cursor);
    renderInto(document.getElementById('replay-board'), replay.board, { lastMove: last });
    var label;
    if (replay.cursor === 0) {
      label = 'Start position';
    } else {
      var san = replay.moves[replay.cursor - 1] || sanPlaceholder(replay.cursor - 1);
      label = 'After move ' + Math.ceil(replay.cursor / 2) +
        (replay.cursor % 2 ? ' (White)' : ' (Black)') + ': ' + san;
    }
    var progress = document.getElementById('replay-progress');
    if (progress) {
      progress.textContent = 'Move ' + replay.cursor + ' of ' + replay.meta.length;
      progress.setAttribute('aria-label', 'Replay progress: move ' + replay.cursor + ' of ' + replay.meta.length);
    }
    if (replayFromCodeMode && replayCodeJustLoaded && replay.cursor === 0) {
      setReplayInfo('Replaying ' + replayCodeJustLoaded + ' moves from share code.', false);
      return;
    }
    var modeTag = replayFromCodeMode ? ' [share-code replay]' : '';
    var gameTag = replay.imported ? ' — ' + replay.imported.white + ' vs ' + replay.imported.black + ' (' + replay.imported.result + ')' + (replay.imported.timestamp ? ' · ' + replay.imported.timestamp : '') : '';
    setReplayInfo(label + ' • ' + (replay.cursor % 2 === 0 ? 'White' : 'Black') + ' to move' + modeTag + gameTag, false);
    var progress = document.getElementById('replay-progress');
    if (progress) {
      progress.textContent = 'Move ' + replay.cursor + ' of ' + replay.meta.length;
      progress.setAttribute('aria-label', 'Replay progress: move ' + replay.cursor + ' of ' + replay.meta.length);
    }
    document.getElementById('replay-first-btn').disabled = replay.cursor === 0;
    document.getElementById('replay-prev-btn').disabled = replay.cursor === 0;
    document.getElementById('replay-next-btn').disabled = replay.cursor >= replay.meta.length;
    document.getElementById('replay-last-btn').disabled = replay.cursor >= replay.meta.length;
    document.getElementById('replay-back-to-list-btn').hidden = !replayFromCodeMode && replay.id === null;
  }

  function importPgnFile(file) {
    var status = document.getElementById('pgn-import-status');
    if (!file) return;
    if (!/\\.pgn$/i.test(file.name || '') && file.type !== 'application/x-chess-pgn' && file.type !== 'text/plain') {
      if (status) { status.textContent = 'Choose a .pgn or plain-text PGN file.'; status.classList.add('replay-error'); }
      return;
    }
    var reader = new FileReader();
    reader.onerror = function () {
      if (status) { status.textContent = 'Could not read that file. Please try another PGN file.'; status.classList.add('replay-error'); }
    };
    reader.onload = function () {
      try {
        var game = PGN.importGame(String(reader.result || ''), C);
        if (!game.moves.length) throw new Error('The PGN contains no moves to replay.');
        replay.moves = game.sans.slice();
        replay.meta = game.moves.map(function (m, index) { return { from: m.from, to: m.to, extra: m.extra || {}, promotion: game.sans[index] && /=[QRBN]/.test(game.sans[index]) ? game.sans[index].match(/=([QRBN])/)[1] : 'Q' }; });
        replay.cursor = 0;
        replay.board = C.initialBoard();
        replay.id = null;
        replay.imported = { white: game.white, black: game.black, result: game.result, timestamp: game.timestamp };
        replayFromCodeMode = false;
        replayCodeJustLoaded = 0;
        replayTo(0);
        if (status) { status.textContent = 'Imported ' + game.moves.length + ' validated moves.'; status.classList.remove('replay-error'); }
        renderReplay();
      } catch (err) {
        if (status) { status.textContent = 'Invalid PGN: ' + (err && err.message ? err.message : 'Unable to parse file.'); status.classList.add('replay-error'); }
      }
    };
    reader.readAsText(file);
  }

  function importShareCode() {
    var input = document.getElementById('replay-code-input');
    var code = (input.value || '').trim();
    if (!code) { setReplayInfo('Paste a share code first.', true); return; }
    openReplayFromCode(code);
  }

  // ---------- Friends screen ----------
  function setFallbackInfo(id, msg) {
    var el = document.getElementById(id);
    if (el) el.textContent = msg;
  }

  function myProfile() {
    return ensureProfile();
  }

  function myPlayerCode() {
    var p = myProfile();
    if (!p.code) {
      p.code = mods().f.generatePlayerCode();
      saveStore();
    }
    return p.code;
  }

  var friendsList = [];

  function initFriendsScreen() {
    friendsList = mods().f.loadFriends();
    var me = myPlayerCode();
    document.getElementById('friends-my-code').textContent = me;
    setFriendsInfo('Share your code so friends can add you, or add them below.', false);
    renderFriends();
  }

  function setFriendsInfo(msg, isError) {
    var el = document.getElementById('friends-info');
    el.textContent = msg;
    el.className = 'section-info' + (isError ? ' friends-error' : '');
  }

  function persistFriends() {
    mods().f.saveFriends(friendsList);
  }

  function renderFriends() {
    var listEl = document.getElementById('friends-list');
    listEl.innerHTML = '';
    var q = document.getElementById('friends-search-input').value || '';
    var shown = mods().f.searchFriends(friendsList, q);
    if (!shown.length) {
      var empty = document.createElement('div');
      empty.className = 'section-info';
      empty.textContent = friendsList.length
        ? 'No friends match your search.'
        : 'No friends yet. Add one by player code above.';
      listEl.appendChild(empty);
      return;
    }
    shown.forEach(function (f) {
      var row = document.createElement('div');
      row.className = 'friend-row';

      var main = document.createElement('div');
      main.className = 'friend-main';
      var name = document.createElement('div');
      name.className = 'friend-name';
      var stats = mods().f.friendStats(f);
      name.textContent = f.name + ' — ' + stats.wins + 'W/' + stats.losses + 'L' +
        (f.rating ? ' · rating ' + f.rating : '');
      var sub = document.createElement('div');
      sub.className = 'friend-sub';
      sub.textContent = f.code;
      main.appendChild(name);
      main.appendChild(sub);

      var actions = document.createElement('div');
      actions.className = 'friend-actions';
      var challengeBtn = document.createElement('button');
      challengeBtn.type = 'button';
      challengeBtn.textContent = '⚔ Challenge';
      challengeBtn.addEventListener('click', function () { challengeFriend(f); });
      var removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.textContent = 'Remove';
      removeBtn.addEventListener('click', function () {
        if (!window.confirm('Remove ' + f.name + ' from friends?')) return;
        try {
          friendsList = mods().f.removeFriend(friendsList, f.code);
          persistFriends();
          renderFriends();
          toast(f.name + ' removed.');
        } catch (err) {
          setFriendsInfo(err.message, true);
        }
      });
      actions.appendChild(challengeBtn);
      actions.appendChild(removeBtn);

      row.appendChild(main);
      row.appendChild(actions);
      listEl.appendChild(row);
    });
  }

  function addFriendFromInput() {
    var codeEl = document.getElementById('friend-code-input');
    var nameEl = document.getElementById('friend-name-input');
    var code = mods().f.normalizeCode(codeEl.value);
    if (!code) {
      setFriendsInfo('Enter a valid 8-character player code (letters/digits).', true);
      return;
    }
    try {
      friendsList = mods().f.addFriend(friendsList, { code: code, name: nameEl.value });
      persistFriends();
      codeEl.value = '';
      nameEl.value = '';
      setFriendsInfo('Friend added.', false);
      renderFriends();
    } catch (err) {
      setFriendsInfo(err.message, true);
    }
  }

  function challengeFriend(f) {
    try {
      var ch = mods().f.createChallenge(f, myProfile().name);
      // Offline-first: start a local hotseat game framed as this challenge.
      state.challenge = ch;
      document.getElementById('mode-select').value = 'local';
      var evt = document.createEvent('HTMLEvents');
      evt.initEvent('change', false, true);
      document.getElementById('mode-select').dispatchEvent(evt);
      showOnly('setup');
      setStatus('Challenge ready: ' + ch.challenger + ' vs ' + ch.friendName + '. Press Start Game.');
    } catch (err) {
      setFriendsInfo(err.message, true);
    }
  }

  // ---------- Leaderboard screen ----------
  var lbScope = 'week';
  (function initLbScope() {
    var m = mods();
    if (m.lb) lbScope = m.lb.loadPrefs().scope || 'week';
  })();

  function leaderboardPlayers() {
    var me = myProfile();
    var players = [{
      code: 'LOCAL',
      name: me.name || 'You',
      rating: me.rating || 800,
      games: (store.stats ? store.stats.games : 0) || 0,
      wins: (store.stats ? store.stats.wins : 0) || 0,
      losses: (store.stats ? store.stats.losses : 0) || 0,
      draws: (store.stats ? store.stats.draws : 0) || 0
    }];
    Object.keys(AI_RATINGS).forEach(function (level) {
      players.push({
        code: 'AI:' + level,
        name: 'AI · ' + level.charAt(0).toUpperCase() + level.slice(1),
        rating: AI_RATINGS[level],
        games: 0, wins: 0, losses: 0, draws: 0
      });
    });
    friendsList.forEach(function (f) {
      players.push({
        code: f.code,
        name: f.name,
        rating: f.rating || 0,
        games: f.games || 0, wins: f.wins || 0, losses: f.losses || 0, draws: f.draws || 0
      });
    });
    return players;
  }

  function leaderboardResults() {
    // Result rows carry ISO dates (stats.recent + profile history), satisfying
    // the weekly window requirement without a schema change.
    var rows = [];
    (store.stats.recent || []).forEach(function (r) {
      rows.push({ date: r.date, result: r.result === 'draw' ? 'draw' : (r.result === 'win' ? 'win' : 'loss'), opponentCode: r.opponentCode || null, opponentRating: r.opponentRating });
    });
    ((myProfile() && myProfile().history) || []).forEach(function (h) {
      if (h && h.date) {
        rows.push({ date: h.date, result: h.result, opponentCode: h.opponentCode || null, opponentRating: h.opponentRating });
      }
    });
    return rows;
  }

  function renderLeaderboard() {
    var m = mods();
    if (!m.lb) return;
    friendsList = m.f.loadFriends();
    lbScope = m.lb.loadPrefs().scope || lbScope;
    var players = leaderboardPlayers();
    var results = leaderboardResults();
    var rows = lbScope === 'all'
      ? m.lb.allTimeLeaderboard(players)
      : m.lb.weeklyLeaderboard(players, results);
    var tbody = document.getElementById('leaderboard-rows');
    tbody.innerHTML = '';
    document.getElementById('lb-col-3').textContent = lbScope === 'all' ? 'Games' : 'Points';
    document.getElementById('lb-week-btn').className = 'lb-scope-btn' + (lbScope === 'week' ? ' active' : '');
    document.getElementById('lb-all-btn').className = 'lb-scope-btn' + (lbScope === 'all' ? ' active' : '');
    document.getElementById('leaderboard-info').textContent = lbScope === 'all'
      ? 'All-time rankings by rating.'
      : 'Points earned over the last 7 days.';
    if (!rows.length) {
      var tr = document.createElement('tr');
      var td = document.createElement('td');
      td.colSpan = 5;
      td.textContent = 'No rated players yet. Finish a rated game to appear here.';
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }
    rows.slice(0, 25).forEach(function (r) {
      var tr = document.createElement('tr');
      if (r.code === 'LOCAL') tr.className = 'me-row';
      if (r.rank <= 3) tr.className += ' lb-pos-' + r.rank;
      function cell(text) {
        var td = document.createElement('td');
        td.textContent = text;
        tr.appendChild(td);
      }
      cell(String(r.rank));
      cell(r.name);
      cell(lbScope === 'all' ? String(r.games) : String(r.weekPoints));
      cell(String(r.rating));
      cell(r.wins + '/' + r.losses + '/' + r.draws);
      tbody.appendChild(tr);
    });
  }

  function setLbScope(scope) {
    lbScope = scope;
    mods().lb.savePrefs({ scope: scope });
    renderLeaderboard();
  }

  // ---------- Settings screen ----------
  function initSettings() {
    var uiSel = document.getElementById('ui-theme-select');
    var boardSel = document.getElementById('board-theme-select');
    var pieceSel = document.getElementById('piece-design-select');
    uiSel.value = store.uiTheme || 'dark';
    boardSel.value = store.theme || 'classic';
    pieceSel.value = store.pieceDesign || 'classic';
    function preview() {
      renderInto(document.getElementById('settings-preview'), C.initialBoard(), {});
    }
    uiSel.addEventListener('change', function () {
      applyUiTheme(uiSel.value); saveStore(); preview();
    });
    boardSel.addEventListener('change', function () {
      applyTheme(boardSel.value);
      var setupSel = document.getElementById('theme-select');
      if (setupSel) setupSel.value = boardSel.value;
      saveStore(); preview();
    });
    pieceSel.addEventListener('change', function () {
      applyPieceDesign(pieceSel.value); saveStore(); preview();
    });
    preview();
  }

  // ---------- Online multiplayer ----------
  var net = window.ChessNet;

  function netStatus(msg) {
    document.getElementById('lobby-status').textContent = msg;
  }
  function showConnectionStatus(msg) {
    var el = document.getElementById('connection-status');
    if (!msg) { el.classList.add('hidden'); return; }
    el.textContent = msg;
    el.classList.remove('hidden');
  }

  function showPlayerNames(wName, bName) {
    var el = document.getElementById('player-names');
    if (!wName && !bName) { el.classList.add('hidden'); return; }
    document.getElementById('name-white').textContent = wName || 'White';
    document.getElementById('name-black').textContent = bName || 'Black';
    el.classList.remove('hidden');
  }

  function initMultiplayer() {
    net.on('connection', function (p) {
      var text = p.state === 'connected' ? 'Connected' :
        p.state === 'connecting' ? 'Connecting…' : 'Disconnected — reconnecting…';
      if (state.mode === 'online') showConnectionStatus(text);
      if (!document.getElementById('lobby').classList.contains('hidden')) {
        var roomCode = net.session().code;
        if (roomCode) return;
        netStatus(text);
      }
    });
    net.on('created', function (msg) {
      showCreatedRoom(msg);
    });
    net.on('join-failed', function (msg) { netStatus(msg.error || 'Could not join room.'); });
    net.on('joined', function (msg) {
      net.setSession({ code: msg.code, seat: msg.seat, name: state.playerName });
      netStatus('Joined room ' + msg.code + '. Waiting for the host to start.');
    });
    net.on('opponent-joined', function (msg) {
      netStatus('Opponent joined! Host can start the game.');
      document.getElementById('lobby-room-info').textContent =
        'Code: ' + (net.session().code || '') + ' — ' + (msg.names.w || 'White') + ' vs ' + (msg.names.b || 'Black');
    });
    net.on('game-start', function (msg) { beginOnlineGame(msg.snapshot); });
    net.on('move-applied', function (msg) { applyRemoteSnapshot(msg.snapshot); });
    net.on('move-rejected', function (msg) { setStatus(msg.error || 'Move rejected.'); render(); });
    net.on('opponent-disconnected', function (msg) {
      var who = msg.seat === 'w' ? 'White' : 'Black';
      showConnectionStatus(who + ' disconnected — ' + Math.round(msg.graceMs / 1000) + 's to reconnect…');
    });
    net.on('opponent-reconnected', function (msg) {
      showConnectionStatus('Connected');
      setStatus(updateStatusText());
    });
    net.on('opponent-left', function (msg) {
      var who = msg.seat === 'w' ? 'White' : 'Black';
      showConnectionStatus(who + ' left — ' + Math.round(msg.graceMs / 1000) + 's to reconnect before forfeit…');
    });
    net.on('game-over', function (msg) { endOnlineGame(msg.snapshot); });
    net.on('clock', function (msg) {
      if (state.mode !== 'online' || !msg.clocks) return;
      state.timers = { w: msg.clocks.w, b: msg.clocks.b };
      renderTimers();
    });

    document.getElementById('create-room-btn').addEventListener('click', function () {
      state.playerName = sanitizePlayerName(document.getElementById('player-name-input').value);
      net.connect();
      net.send('create', { name: state.playerName }).then(function (res) {
        if (!res || res.ok === false || (res.type && res.type !== 'created') || !res.code) {
          netStatus((res && res.error) || 'Could not create a room. Please try again.');
          return;
        }
        showCreatedRoom(res);
      }).catch(function (error) {
        netStatus((error && error.message) || 'Could not create a room. Please try again.');
      });
    });
    document.getElementById('join-room-btn').addEventListener('click', function () {
      state.playerName = sanitizePlayerName(document.getElementById('player-name-input').value);
      var code = document.getElementById('join-code-input').value.trim().toUpperCase();
      if (!/^[A-Z0-9]{6}$/.test(code)) { netStatus('Room codes are 6 letters/digits.'); return; }
      net.connect();
      net.send('join', { code: code, name: state.playerName }).then(function (res) {
        if (res.ok === false) netStatus(res.error || 'Could not join.');
      });
    });
    document.getElementById('lobby-start-btn').addEventListener('click', function () {
      var s = net.session();
      net.send('start', {
        code: s.code,
        timeControl: document.getElementById('lobby-timer-select').value
      });
    });
    document.getElementById('lobby-back-btn').addEventListener('click', function () {
      net.close();
      showMainMenu();
    });
  }

  function showCreatedRoom(msg) {
    if (!msg || !msg.code) return;
    net.setSession({ code: msg.code, seat: msg.seat || 'w', name: state.playerName });
    netStatus('Room created. Share this code: ' + msg.code);
    document.getElementById('lobby-room-info').textContent = 'Code: ' + msg.code + ' — waiting for opponent…';
    document.getElementById('lobby-timer-row').classList.remove('hidden');
    document.getElementById('lobby-start-row').classList.remove('hidden');
  }

  function sanitizePlayerName(raw) {
    var s = String(raw || '').replace(/[^\w \-']/g, '').trim();
    return (s || 'Player').slice(0, 24);
  }

  function updateStatusText() {
    if (state.gameOver) return 'Game over';
    var side = state.turn === 'w' ? 'White' : 'Black';
    return side + ' to move' + (C.inCheck(state.board, state.turn) ? ' — check!' : '');
  }

  function beginOnlineGame(snapshot) {
    state.mode = 'online';
    loadSnapshotIntoState(snapshot);
    var s = net.session();
    var myColor = s.seat;
    showOnly('game');
    showPlayerNames(snapshot.names && snapshot.names.w, snapshot.names && snapshot.names.b);
    showConnectionStatus('Connected');
    setStatus('Game started — you play ' + (myColor === 'w' ? 'White' : 'Black') + '. ' + updateStatusText());
    render();
    startClock(); // local display only; the server clock broadcast is the authority
  }

  function applyRemoteSnapshot(snapshot) {
    loadSnapshotIntoState(snapshot);
    state.selected = null;
    updateStatus();
    render();
    checkOnlineGameEnd(snapshot);
  }

  function loadSnapshotIntoState(snapshot) {
    state.board = snapshot.board.map(function (row) {
      return row.map(function (p) { return p ? { type: p.type, color: p.color } : null; });
    });
    state.turn = snapshot.turn;
    state.castling = { wK: snapshot.castling.wK, wQ: snapshot.castling.wQ, bK: snapshot.castling.bK, bQ: snapshot.castling.bQ };
    state.enPassant = snapshot.enPassant || null;
    state.moves = snapshot.moves.slice();
    state.captured = { w: (snapshot.captured && snapshot.captured.w || []).slice(), b: (snapshot.captured && snapshot.captured.b || []).slice() };
    state.timers = { w: snapshot.clocks.w, b: snapshot.clocks.b };
    state.gameOver = !!snapshot.over;
    state.moveMeta = [];
    // Rebuild moveMeta from SAN moves is complex; use moves count for undo disable only.
    state.history = [];
  }

  function checkOnlineGameEnd(snapshot) {
    if (!snapshot.over) return;
    stopClock();
    var r = snapshot.result || {};
    var msg;
    if (r.type === 'checkmate') msg = (r.winner === 'w' ? 'White' : 'Black') + ' wins by checkmate!';
    else if (r.type === 'stalemate') msg = 'Draw by stalemate.';
    else if (r.type === 'time') msg = (r.winner === 'w' ? 'Black' : 'White') + ' ran out of time — ' + (r.winner === 'w' ? 'White' : 'Black') + ' wins on time!';
    else if (r.type === 'forfeit') msg = (r.winner === 'w' ? 'White' : 'Black') + ' wins by forfeit (opponent left).';
    else msg = 'Game over.';
    setStatus(msg);
    showConnectionStatus('');
    recordOnlineResult(r);
  }

  function recordOnlineResult(result) {
    // Statistics for online games keyed on your seat.
    var s = net.session();
    var myColor = s.seat;
    var isDraw = result.type === 'stalemate';
    store.stats.games++;
    if (isDraw) {
      store.stats.draws++;
      store.stats.recent.unshift({ result: 'draw', mode: 'online', date: new Date().toISOString() });
    } else if (result.winner === myColor) {
      store.stats.wins++;
      store.stats.streak++;
      store.stats.bestStreak = Math.max(store.stats.bestStreak, store.stats.streak);
      store.stats.recent.unshift({ result: 'win', mode: 'online', date: new Date().toISOString() });
      unlock('first-win');
    } else {
      store.stats.losses++;
      store.stats.streak = 0;
      store.stats.recent.unshift({ result: 'loss', mode: 'online', date: new Date().toISOString() });
    }
    store.stats.recent = store.stats.recent.slice(0, 10);
    // Profile: online games are unrated for now (no opponent Elo yet — design choice,
    // same policy as hotseat); they still count in games/W/L/D.
    updateProfileRating(isDraw ? 'draw' : (result.winner === myColor ? 'win' : 'loss'), null);
    saveStore();
    renderAchievements();
  }

  // ---------- Tournament ----------
  var T = window.Tournament;
  var AI_NAMES = ['Magnus', 'Talbot', 'Kaspar', 'Fischer', 'Caru-ana', 'Nimbus', 'Rooklin', 'Pawla', 'Zephyr', 'Gambit', 'Endgame', 'Bishop', 'Clockwork', 'Sneaky', 'Ranko'];

  function pickAiNames(count, yourName) {
    var pool = AI_NAMES.filter(function (n) { return n !== yourName; });
    var out = [];
    var i = 0;
    while (out.length < count) { out.push(pool[i % pool.length] + (out.length >= pool.length ? ' ' + (Math.floor(out.length / pool.length) + 1) : '')); i++; }
    return out;
  }

  function initTournamentSetup() {
    var resume = T.loadTournament();
    document.getElementById('tour-resume-btn').classList.toggle('hidden', !resume || T.getChampion(resume));
    if (resume && !T.getChampion(resume)) {
      document.getElementById('tour-setup-info').textContent =
        'A tournament in progress: ' + (resume.rounds.length) + ' rounds, resume from the bracket.';
    } else {
      document.getElementById('tour-setup-info').textContent = 'Opponent names are picked automatically.';
    }
  }

  function createTournamentFromSetup() {
    var size = parseInt(document.getElementById('tour-size-select').value, 10);
    var yourName = sanitizePlayerName(document.getElementById('tour-name-input').value);
    state.playerName = yourName;
    var opponents = pickAiNames(size - 1, yourName);
    var t = T.createTournament({
      players: [yourName].concat(opponents),
      name: size + '-Player Tournament',
      opponentType: document.getElementById('tour-opponent-select').value,
      aiDifficulty: document.getElementById('tour-difficulty-select').value,
      timeControl: document.getElementById('tour-timer-select').value
    });
    state.tournament = t;
    T.saveTournament(t);
    showOnly('tournament-bracket');
  }

  function renderBracket() {
    var t = state.tournament;
    if (!t) return;
    var head = document.getElementById('tour-bracket-head');
    var roundsEl = document.getElementById('tour-rounds');
    roundsEl.innerHTML = '';
    var champion = T.getChampion(t);
    var current = T.getCurrentMatch(t);
    head.textContent = t.name + (champion ? ' — Champion: ' + champion : current ? '' : ' — complete');

    t.rounds.forEach(function (round, ri) {
      var title = document.createElement('div');
      title.className = 'tour-round-title';
      title.textContent = T.roundName(t, ri);
      roundsEl.appendChild(title);
      var matchesEl = document.createElement('div');
      matchesEl.className = 'tour-matches';
      round.forEach(function (match) {
        var row = document.createElement('div');
        row.className = 'tour-match';
        var isCurrent = current && current.id === match.id;
        var winnerName = T.matchWinnerName(t, match);
        [match.a, match.b].forEach(function (name, idx) {
          var slot = document.createElement('span');
          var otherWin = match.winner !== null && match.winner !== (idx === 0 ? 'a' : 'b');
          slot.className = 'tour-slot' +
            (winnerName === name ? ' winner' : otherWin && name !== null ? ' loser' : name === null ? ' pending' : '');
          slot.textContent = name === null ? 'TBD' : name;
          row.appendChild(slot);
        });
        var vs = document.createElement('span');
        vs.className = 'tour-vs';
        vs.textContent = match.winner !== null ? 'final' : 'vs';
        row.appendChild(vs);
        var badge = document.createElement('span');
        badge.className = 'tour-badge' + (isCurrent ? ' live' : winnerName ? ' done' : '');
        badge.textContent = isCurrent ? 'next up' : winnerName ? 'done' : 'waiting';
        row.appendChild(badge);
        matchesEl.appendChild(row);
      });
      roundsEl.appendChild(matchesEl);
    });
    document.getElementById('tour-play-btn').disabled = !current;
  }

  function startTournamentMatch() {
    var t = state.tournament;
    var match = T.getCurrentMatch(t);
    if (!match) return;
    var myColor = tourColorFor(match);
    state.tourMatchId = match.id;
    state.mode = t.opponentType === 'ai' ? 'ai' : '2p';
    state.aiLevel = t.aiDifficulty;
    state.aiColor = myColor === 'w' ? 'b' : 'w';
    var timerVal = t.timeControl;
    state.timeControl = timerVal === 'none' ? 3600 : parseInt(timerVal, 10);
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
    if (state.mode === 'ai' && state.aiColor === 'w') setTimeout(aiMove, 300);
  }

  function tourColorFor(match) {
    // Alternate colors per match for fairness: hash the match id.
    var n = parseInt(match.id.replace(/\D/g, ''), 10) || 0;
    return n % 2 === 0 ? 'w' : 'b';
  }

  function finishTournamentMatch(reason) {
    var t = state.tournament;
    var mid = state.tourMatchId;
    if (!t || !mid) return false; // not a tournament match
    var match = null;
    t.rounds.forEach(function (r) {
      r.forEach(function (m) { if (m.id === mid) match = m; });
    });
    if (!match) { state.tourMatchId = null; return false; }
    var loser = state.turn;
    var winner = loser === 'w' ? 'b' : 'w';
    var isDraw = reason === 'stalemate';
    if (isDraw) {
      T.reportMatchResult(t, mid, 'd'); // draw: the match stays open for a replay
      setStatus('Draw — this tournament match will be replayed.');
    } else {
      // The bracket stores names; map the winning color to a slot by finding
      // which seat the human played, then which slot holds that name.
      var humanColor = state.mode === 'ai' ? (state.aiColor === 'w' ? 'b' : 'w') : null;
      var winnerName;
      if (humanColor && match.a === state.playerName) {
        winnerName = winner === humanColor ? match.a : match.b;
      } else if (state.mode === 'ai') {
        winnerName = winner === humanColor ? match.b : match.a;
      } else {
        // Local 2-player matches: White's slot wins on a white win.
        winnerName = winner === 'w' ? match.a : match.b;
      }
      T.reportMatchResult(t, mid, winnerName === match.a ? 'a' : 'b');
      setStatus(T.getChampion(t) ? 'Tournament complete!' : 'Advancing to the next round!');
    }
    T.saveTournament(t);
    state.tourMatchId = null;
    if (T.getChampion(t)) {
      showTournamentWinner(t);
    } else {
      showOnly('tournament-bracket');
    }
    return true;
  }

  function showTournamentWinner(t) {
    document.getElementById('tour-winner-line').textContent =
      '🏆 ' + T.getChampion(t) + ' wins the tournament!';
    document.getElementById('tour-winner-sub').textContent =
      t.players.length + ' players • ' + t.rounds.length + ' rounds';
    showOnly('tournament-winner');
  }

  function wireTournament() {
    document.getElementById('tournament-btn').addEventListener('click', function () { showOnly('tournament-setup'); });
    document.getElementById('tour-create-btn').addEventListener('click', createTournamentFromSetup);
    document.getElementById('tour-resume-btn').addEventListener('click', function () {
      var resume = T.loadTournament();
      if (!resume) return;
      state.tournament = resume;
      showOnly('tournament-bracket');
    });
    document.getElementById('tour-play-btn').addEventListener('click', startTournamentMatch);
    document.getElementById('tour-setup-back-btn').addEventListener('click', showMainMenu);
    document.getElementById('tour-bracket-back-btn').addEventListener('click', function () {
      showOnly('tournament-setup');
    });
    document.getElementById('tour-winner-again-btn').addEventListener('click', function () {
      T.clearSavedTournament();
      state.tournament = null;
      showOnly('tournament-setup');
    });
    document.getElementById('tour-winner-back-btn').addEventListener('click', function () {
      T.clearSavedTournament();
      state.tournament = null;
      showMainMenu();
    });
    document.getElementById('tour-opponent-select').addEventListener('change', function () {
      document.getElementById('tour-difficulty-row').classList.toggle('hidden', this.value !== 'ai');
    });
  }

  // ---------- Training ----------
  // Resolved lazily: ES-module boot scripts are deferred, so window.Training
  // may not exist yet when app.js itself evaluates.
  function TR() { return window.Training; }
  var training = {
    skill: 'checkmate',
    list: [],           // exercises in the current skill
    idx: 0,
    board: null, castling: null, enPassant: null, turn: 'w',
    step: 0,            // index into exercise.solution
    attempts: 0, hintsUsed: false,
    selected: null, done: false
  };

  function trainingProgress() {
    var p = TR().loadProgress();
    if (!p) p = { version: TR().TRAINING_VERSION, score: 0, completed: {}, attempts: {}, lastDate: null };
    return p;
  }

  function setTrainingFeedback(msg, cls) {
    var el = document.getElementById('training-feedback');
    el.textContent = msg;
    el.className = 'puzzle-feedback' + (cls ? ' ' + cls : '');
  }

  function openTraining() {
    var sel = document.getElementById('training-skill-select');
    if (sel.options.length === 0) {
      TR().SKILLS.forEach(function (s) {
        var opt = document.createElement('option');
        opt.value = s;
        opt.textContent = TR().SKILL_LABELS[s];
        sel.appendChild(opt);
      });
      sel.value = training.skill;
      sel.addEventListener('change', function () {
        training.skill = sel.value;
        loadTrainingExercise(0);
      });
    }
    sel.value = training.skill;
    loadTrainingExercise(training.idx);
  }

  function loadTrainingExercise(idx) {
    training.list = TR().listBySkill(training.skill);
    if (training.list.length === 0) return;
    training.idx = Math.max(0, Math.min(idx, training.list.length - 1));
    var ex = training.list[training.idx];
    var pos = C.parseFen(ex.fen);
    training.board = pos.board;
    training.castling = pos.castling;
    training.enPassant = pos.enPassant;
    training.turn = pos.turn;
    training.step = 0;
    training.attempts = 0;
    training.hintsUsed = false;
    training.selected = null;
    training.done = false;
    document.getElementById('training-info').textContent =
      ex.name + ' (' + ex.difficulty + ') — ' + ex.goal.replace('-', ' ');
    setTrainingFeedback('', '');
    renderTraining();
  }

  function renderTraining() {
    var p = trainingProgress();
    var done = Object.keys(p.completed).length;
    document.getElementById('training-progress').textContent =
      'Score: ' + p.score + ' • Completed: ' + done + ' / ' + TR().EXERCISES.length +
      (TR().allCompleted(p) ? ' • 🏅 All exercises complete!' : '');
    if (!training.board) return;
    var ex = training.list[training.idx];
    var legal = [];
    if (training.selected && !training.done) {
      legal = C.legalMoves(training.board, training.selected.r, training.selected.c, training.castling, training.enPassant);
    }
    renderInto(document.getElementById('training-board'), training.board, {
      legal: legal, selected: training.selected, onClick: onTrainingSquareClick
    });
    void ex;
  }

  function trainingAlg(sq) {
    return 'abcdefgh'[sq.c] + (8 - sq.r);
  }

  function trainingMatchesStep(sq) {
    var ex = training.list[training.idx];
    var expected = ex.solution[training.step];
    return expected === trainingAlg(sq);
  }

  function trainingApplyMove(from, to, mvObj) {
    var piece = training.board[from.r][from.c];
    var promo = piece.type === 'P' && (to.r === 0 || to.r === 7) ? 'Q' : null;
    C.applyMove(training.board, from, to, (mvObj && mvObj.extra) || {}, promo);
    if (piece.type === 'K') training.castling = { wK: false, wQ: false, bK: false, bQ: false };
    training.enPassant = (mvObj && mvObj.extra && mvObj.extra.double)
      ? { r: (from.r + to.r) / 2, c: from.c } : null;
    training.turn = training.turn === 'w' ? 'b' : 'w';
  }

  function completeTrainingExercise() {
    var ex = training.list[training.idx];
    training.done = true;
    var p = trainingProgress();
    var pts = TR().recordCompletion(p, ex.id, { attempts: training.attempts + 1, hintsUsed: training.hintsUsed });
    TR().saveProgress(p);
    setTrainingFeedback('Solved! +' + pts + ' points' +
      (training.attempts === 0 && !training.hintsUsed ? ' (clean solve!)' : ''), 'good');
    renderTraining();
  }

  function onTrainingSquareClick(e) {
    if (training.done) return;
    var r = parseInt(e.currentTarget.dataset.r, 10);
    var c = parseInt(e.currentTarget.dataset.c, 10);
    var ex = training.list[training.idx];
    var piece = training.board[r][c];
    if (training.selected) {
      var legal = C.legalMoves(training.board, training.selected.r, training.selected.c, training.castling, training.enPassant);
      for (var i = 0; i < legal.length; i++) {
        if (legal[i].r === r && legal[i].c === c) {
          var isExpected = trainingMatchesStep({ r: r, c: c });
          if (!isExpected) {
            training.attempts++;
            setTrainingFeedback('Not the move the position calls for — try again.', 'bad');
            training.selected = null;
            renderTraining();
            return;
          }
          // Correct player move: apply, advance; then auto-play opponent reply.
          trainingApplyMove(training.selected, { r: r, c: c }, legal[i]);
          training.step++;
          training.selected = null;
          if (training.step >= ex.solution.length) {
            completeTrainingExercise();
          } else {
            setTrainingFeedback('Correct! Watch the reply…', 'good');
            var reply = ex.solution[training.step];
            var rf = { r: 8 - parseInt(reply[1], 10), c: reply.charCodeAt(0) - 97 };
            var rt = { r: 8 - parseInt(reply[3], 10), c: reply.charCodeAt(2) - 97 };
            var replyMv = null;
            var rLegal = C.legalMoves(training.board, rf.r, rf.c, training.castling, training.enPassant);
            for (var j = 0; j < rLegal.length; j++) {
              if (rLegal[j].r === rt.r && rLegal[j].c === rt.c) { replyMv = rLegal[j]; break; }
            }
            if (replyMv) {
              trainingApplyMove(rf, rt, replyMv);
              training.step++;
              setTrainingFeedback('Correct! Now find the follow-up.', 'good');
            }
          }
          renderTraining();
          return;
        }
      }
      training.selected = (piece && piece.color === training.turn) ? { r: r, c: c } : null;
      renderTraining();
    } else if (piece && piece.color === training.turn) {
      training.selected = { r: r, c: c };
      renderTraining();
    }
  }

  function trainingHint() {
    training.hintsUsed = true;
    var ex = training.list[training.idx];
    var sol = ex.solution[training.step];
    var msg = ex.hint;
    if (sol && !training.done) {
      var from = sol[0] + sol[1];
      msg += ' Try ' + from + '.';
    }
    setTrainingFeedback(msg, '');
  }

  function wireTraining() {
    document.getElementById('training-btn').addEventListener('click', function () { showOnly('training'); });
    document.getElementById('training-hint-btn').addEventListener('click', trainingHint);
    document.getElementById('training-reset-btn').addEventListener('click', function () { loadTrainingExercise(training.idx); });
    document.getElementById('training-next-btn').addEventListener('click', function () {
      loadTrainingExercise(training.idx + 1 < training.list.length ? training.idx + 1 : 0);
    });
    document.getElementById('training-back-btn').addEventListener('click', showMainMenu);
  }

  // ---------- Spectator Mode ----------
  // Watch live online games: game picker, follow-player board orientation,
  // and replay-from-beginning while the game is still running. Read-only —
  // spectators hold no seat and every move source is the server snapshot.
  var spec = {
    watching: null,        // currently watched snapshot (normalized)
    follow: 'both',        // 'both' | 'w' | 'b'
    viewPly: null,         // null = live tail; number = replay ply
    replay: null,          // incremental replay builder (from window.Spectator)
    lastRaw: null          // last raw snapshot, to rebuild replay state cheaply
  };

  function specStatus(text) {
    var el = document.getElementById('spectator-status');
    if (el) el.textContent = text;
  }

  function openSpectator() {
    var m = mods();
    if (!m.spec || !m.screen) {
      specStatus('Spectator module failed to load. Refresh the page and try again.');
      return;
    }
    if (!spec.replay) spec.replay = m.spec.createReplay(C);
    renderSpecGameList([]);
    spec.follow = m.spec.normalizeFollow(spec.follow);
    spec.viewPly = null;
    renderSpecFollow();
    renderSpecGameList([]);
    net.connect();
    net.send('list-games', {}).then(function (res) {
      if (res && res.games) renderSpecGameList(res.games);
      if (!res || !(res.games || []).length) specStatus('No live games right now. Start a game in another tab, then refresh.');
    }).catch(function () {
      specStatus('No live games right now. Could not reach the game server; try again.');
      renderSpecGameList([]);
    });
    renderSpectator();
  }

  function closeSpectator() {
    if (net.session().code && net.session().seat === null) {
      net.send('stop-spectating', {}).catch(function () { /* best effort */ });
    }
    spec.watching = null;
    spec.lastRaw = null;
    spec.viewPly = null;
    net.close();
    showMainMenu();
  }

  function renderSpecGameList(games) {
    var m = mods();
    if (!m.spec || !m.screen) return;
    m.screen.renderGameList(document.getElementById('spectator-game-list'), games || [],
      spec.watching ? spec.watching.code : null, spectateGame);
  }

  function spectateGame(code) {
    var m = mods();
    if (!m.spec) return;
    net.connect();
    net.send('spectate', { code: code }).then(function (res) {
      if (res && res.type === 'spectate-failed') { specStatus(res.error || 'Could not spectate.'); return; }
    }).catch(function () { specStatus('Could not reach the game server.'); });
    // Keep the picker fresh so finished games drop off and new ones appear.
    net.send('list-games', {}).then(function (res) {
      if (res && res.games) renderSpecGameList(res.games);
    }).catch(function () { /* ignore */ });
  }

  function onSpecSnapshot(raw) {
    var m = mods();
    if (!m.spec) return;
    try {
      var snap = m.spec.normalizeSnapshot(raw);
      spec.watching = snap;
      spec.lastRaw = raw;
      if (spec.viewPly !== null) {
        var length = spec.replay.feed(snap).length;
        if (spec.viewPly >= length - 1) spec.viewPly = null; // stay on live tail
      }
      renderSpectator();
      specStatus(m.screen.statusText(snap));
    } catch (e) {
      specStatus('Received a malformed game update.');
    }
  }

  function specFollowLabel() {
    return spec.follow === 'w' ? 'Following White' : spec.follow === 'b' ? 'Following Black' : 'Following both';
  }

  function renderSpecFollow() {
    var el = document.getElementById('spectator-follow');
    if (!el) return;
    el.textContent = specFollowLabel();
    ['w', 'b', 'both'].forEach(function (v) {
      var btn = document.getElementById('spec-follow-' + v);
      if (btn) btn.classList.toggle('active', spec.follow === v);
    });
  }

  function setSpecFollow(v) {
    var m = mods();
    if (!m.spec) return;
    spec.follow = m.spec.normalizeFollow(v);
    renderSpecFollow();
    renderSpectator();
  }

  function specAtLiveTail() { return spec.viewPly === null; }

  function specStep(delta) {
    var m = mods();
    if (!m.spec || !spec.replay || !spec.watching) return;
    var length = spec.replay.feed(spec.watching).length;
    var cur = specAtLiveTail() ? length - 1 : spec.viewPly;
    var next = cur + delta;
    if (next >= length - 1) { spec.viewPly = null; }        // back to live
    else if (next < 0) { spec.viewPly = 0; }                // clamp at start
    else { spec.viewPly = next; }
    renderSpectator();
  }

  function specGotoStart() { spec.viewPly = 0; renderSpectator(); }
  function specGotoLive() { spec.viewPly = null; renderSpectator(); }

  function renderSpectator() {
    var m = mods();
    if (!m.spec || !m.screen) return;
    var snap = spec.watching;
    var boardEl = document.getElementById('spectator-board');
    var playersEl = document.getElementById('spectator-players');
    var movesEl = document.getElementById('spectator-moves');
    var capturedEl = document.getElementById('spectator-captured');
    var titleEl = document.getElementById('spectator-title');
    if (!boardEl || !playersEl || !movesEl || !capturedEl) return;

    if (!snap) {
      boardEl.innerHTML = '';
      boardEl.className = 'spectator-board empty';
      m.screen.renderPlayers(playersEl, null, null, 'w', false);
      m.screen.renderMoves(movesEl, [], -1);
      m.screen.renderCaptured(capturedEl, null);
      if (titleEl) titleEl.textContent = 'Spectator Mode';
      return;
    }

    var view = specAtLiveTail() ? snap : null;
    var ply = null;
    if (!specAtLiveTail()) {
      var length = spec.replay.feed(snap).length;
      ply = Math.max(0, Math.min(spec.viewPly, length - 1));
      var pos = spec.replay.positionAt(ply);
      view = {
        board: pos.board, turn: pos.turn, castling: pos.castling, enPassant: pos.enPassant,
        names: snap.names, ratings: snap.ratings, moves: snap.moves,
        meta: snap.meta.slice(0, ply), captured: specCapturedAt(ply, snap),
        clocks: snap.clocks, over: snap.over && ply >= snap.moves.length - 1, result: snap.result,
        code: snap.code, timeControl: snap.timeControl
      };
    }

    var orient = m.spec.boardOrientation(spec.follow, snap);
    // renderInto renders top-down r=0 at top; flip rows/cols to view from
    // Black's side when following Black.
    var shown = view.board;
    if (orient === 'b') {
      shown = [];
      for (var r = 0; r < 8; r++) {
        var row = [];
        for (var c = 0; c < 8; c++) row.push(view.board[7 - r][7 - c]);
        shown.push(row);
      }
    }

    if (titleEl) titleEl.textContent = snap.code + ' — ' + (snap.names.w || 'White') + ' vs ' + (snap.names.b || 'Black');
    boardEl.className = 'board-grid spectator-board';
    renderInto(boardEl, shown, {
      legal: [], selected: null,
      lastMove: view.meta && view.meta.length ? view.meta[view.meta.length - 1] : null,
      onClick: null, useIds: false
    });
    m.screen.renderPlayers(playersEl, snap.names, snap.clocks, snap.turn, snap.over);
    m.screen.renderMoves(movesEl, view.moves, ply == null ? view.moves.length - 1 : ply - 1);
    m.screen.renderCaptured(capturedEl, view.captured);
    var replayBar = document.getElementById('spectator-replay-bar');
    if (replayBar) replayBar.classList.toggle('hidden', !snap.moves.length);
  }

  function specCapturedAt(ply, snap) {
    // Live tail uses the server's captured trays; replay plies approximate by
    // diffing consecutive cached boards (piece that disappeared was captured).
    if (specAtLiveTail()) return snap.captured;
    var captured = { w: [], b: [] };
    for (var i = 0; i < ply; i++) {
      var pos = spec.replay.positionAt(i);
      var next = spec.replay.positionAt(i + 1);
      for (var r = 0; r < 8; r++) {
        for (var c = 0; c < 8; c++) {
          var before = pos.board[r][c], after = next.board[r][c];
          if (before && !after) captured[i % 2 === 0 ? 'w' : 'b'].push(before);
        }
      }
    }
    return captured;
  }

  function initSpectator() {
    var specBtn = document.getElementById('spectate-btn');
    if (specBtn) specBtn.addEventListener('click', function () { showOnly('spectator'); });
    function bind(id, handler) { var el = document.getElementById(id); if (el) el.addEventListener('click', handler); }
    bind('spectator-back-btn', closeSpectator);
    bind('spec-follow-w', function () { setSpecFollow('w'); });
    bind('spec-follow-b', function () { setSpecFollow('b'); });
    bind('spec-follow-both', function () { setSpecFollow('both'); });
    bind('spec-start-btn', specGotoStart);
    bind('spec-live-btn', specGotoLive);
    bind('spec-prev-btn', function () { specStep(-1); });
    bind('spec-next-btn', function () { specStep(1); });
    bind('spectator-refresh-btn', function () {
      net.connect();
      net.send('list-games', {}).then(function (res) {
        if (res && res.games) renderSpecGameList(res.games);
        if (!res || !(res.games || []).length) specStatus('No live games right now.');
      }).catch(function () { specStatus('Could not reach the game server.'); });
    });
    net.on('spectating', function (msg) {
      if (net.session().seat !== null) return; // player view is unaffected
      net.setSession({ code: msg.code, seat: null, name: 'Spectator' });
      onSpecSnapshot(msg.snapshot);
    });
    net.on('move-applied', function (msg) {
      if (net.session().seat !== null) return;
      onSpecSnapshot(msg.snapshot);
    });
    net.on('game-over', function (msg) {
      if (net.session().seat !== null) return;
      onSpecSnapshot(msg.snapshot);
    });
    net.on('clock', function (msg) {
      if (net.session().seat !== null || !spec.watching || !msg.clocks) return;
      spec.watching.clocks = { w: msg.clocks.w, b: msg.clocks.b };
      var m = mods();
      if (m.screen) m.screen.renderPlayers(document.getElementById('spectator-players'),
        spec.watching.names, spec.watching.clocks, spec.watching.turn, spec.watching.over);
    });
    net.on('spectate-failed', function (msg) { specStatus(msg.error || 'Could not spectate.'); });
    net.on('spectate-ended', function () { specStatus('Left spectator view.'); });
  }

  // ---------- Navigation ----------
  var SCREENS = ['main-menu', 'setup', 'game', 'puzzles', 'analysis', 'opening-explorer', 'achievements', 'stats', 'settings', 'lobby',
    'tournament-setup', 'tournament-bracket', 'tournament-winner', 'replay', 'training', 'friends', 'leaderboard', 'smart-review', 'spectator'];

  function showOnly(id) {
    SCREENS.forEach(function (s) {
      var el = document.getElementById(s);
      if (el) el.classList.toggle('hidden', s !== id);
    });
    if (id === 'achievements') renderAchievements();
    if (id === 'stats') renderStats();
    if (id === 'puzzles') renderPuzzle();
    if (id === 'analysis') openAnalysis();
    if (id === 'smart-review') openSmartReview();
    if (id === 'replay') { replayFromCodeMode = false; replay.id = null; renderReplayList(); setReplayInfo('Pick a saved game to replay, or paste a share code below.', false); }
    var m = mods();
    if (id === 'friends') { if (m.f) initFriendsScreen(); else setFallbackInfo('friends-info', 'Friends module failed to load.'); }
    if (id === 'leaderboard') { if (m.lb) renderLeaderboard(); else setFallbackInfo('leaderboard-info', 'Leaderboard module failed to load.'); }
    if (id === 'spectator') { if (m.spec) openSpectator(); else setFallbackInfo('spectator-status', 'Spectator module failed to load.'); }
    if (id === 'tournament-bracket') renderBracket();
    if (id === 'tournament-setup') initTournamentSetup();
    if (id === 'training') openTraining();
  }

  function showMainMenu() { stopClock(); showOnly('main-menu'); }

  document.getElementById('home-app-play-btn').addEventListener('click', function () {
    document.getElementById('online-btn').click();
  });

  var homeCardActions = {
    training: function () { document.getElementById('training-btn').click(); },
    setup: function () {
      var select = document.getElementById('mode-select');
      select.value = 'ai';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      showOnly('setup');
    },
    puzzles: function () { document.getElementById('puzzle-btn').click(); },
    spectator: function () { document.getElementById('spectate-btn').click(); },
    analysis: function () { document.getElementById('analysis-btn').click(); },
    'opening-explorer': function () { document.getElementById('opening-explorer-btn').click(); },
    friends: function () { document.getElementById('friends-btn').click(); },
    'tournament-setup': function () { document.getElementById('tournament-btn').click(); }
  };

  document.querySelectorAll('[data-target]').forEach(function (card) {
    card.addEventListener('click', function () {
      var target = card.getAttribute('data-target');
      var action = homeCardActions[target];
      if (action) action();
    });
  });

  // Explorer owns all its position data and never touches the live game state.
  var explorer = { board: window.ChessCore.initialBoard(), turn: 'w', castling: {wK:true,wQ:true,bK:true,bQ:true}, enPassant:null, moves:[] };
  function openingApplySan(san) {
    var choices = [];
    for (var r = 0; r < 8; r++) for (var c = 0; c < 8; c++) {
      if (!explorer.board[r][c] || explorer.board[r][c].color !== explorer.turn) continue;
      window.ChessCore.legalMoves(explorer.board, r, c, explorer.castling, explorer.enPassant).forEach(function (move) {
        var promotes = explorer.board[r][c].type === 'P' && (move.r === 0 || move.r === 7);
        (promotes ? ['Q', 'R', 'B', 'N'] : ['Q']).forEach(function (promotion) {
          var generated = window.ChessCore.sanForMove(explorer.board, explorer.turn, explorer.castling, explorer.enPassant,
            { r: r, c: c }, move, move.extra, promotion);
          if (window.OpeningExplorer.normalize(generated) === window.OpeningExplorer.normalize(san)) {
            choices.push({ from: { r: r, c: c }, move: move, promotion: promotion });
          }
        });
      });
    }
    if (choices.length !== 1) return false;
    var item = choices[0];
    var piece = explorer.board[item.from.r][item.from.c];
    var captured = explorer.board[item.move.r][item.move.c];
    window.ChessCore.applyMove(explorer.board, item.from, { r: item.move.r, c: item.move.c }, item.move.extra, item.promotion);
    if (piece.type === 'K') { explorer.castling[piece.color + 'K'] = false; explorer.castling[piece.color + 'Q'] = false; }
    if (piece.type === 'R') {
      var home = piece.color === 'w' ? 7 : 0;
      if (item.from.r === home && item.from.c === 0) explorer.castling[piece.color + 'Q'] = false;
      if (item.from.r === home && item.from.c === 7) explorer.castling[piece.color + 'K'] = false;
    }
    if (captured && captured.type === 'R') {
      var capturedColor = piece.color === 'w' ? 'b' : 'w';
      var capturedHome = capturedColor === 'w' ? 7 : 0;
      if (item.move.r === capturedHome && item.move.c === 0) explorer.castling[capturedColor + 'Q'] = false;
      if (item.move.r === capturedHome && item.move.c === 7) explorer.castling[capturedColor + 'K'] = false;
    }
    explorer.enPassant = item.move.extra && item.move.extra.double
      ? { r: (item.from.r + item.move.r) / 2, c: item.from.c } : null;
    explorer.turn = explorer.turn === 'w' ? 'b' : 'w';
    explorer.moves.push(san);
    return true;
  }
  function renderOpeningExplorer(){
    var id=document.getElementById('opening-board'); if(!id)return;
    renderInto(id,explorer.board,{});
    var recognition=window.OpeningExplorer.recognize(explorer.moves);
    document.getElementById('opening-name').textContent = recognition.matches.length ? recognition.matches.map(function (o) { return o.name; }).join(' / ') : 'No recognized opening yet. Browse the curated catalog below.';
    var openingBoard = document.getElementById('opening-board');
    openingBoard.onclick = function (event) {
      var square = event.target.closest('.square');
      if (!square) return;
      var r = Number(square.dataset.r), c = Number(square.dataset.c);
      if (explorer.selected) {
        var choices = window.ChessCore.legalMoves(explorer.board, explorer.selected.r, explorer.selected.c, explorer.castling, explorer.enPassant);
        var selectedMove = choices.filter(function (move) { return move.r === r && move.c === c; })[0];
        if (selectedMove) {
          var piece = explorer.board[explorer.selected.r][explorer.selected.c];
          var san = window.ChessCore.sanForMove(explorer.board, explorer.turn, explorer.castling, explorer.enPassant, explorer.selected, selectedMove, selectedMove.extra, 'Q');
          openingApplySan(san);
        }
        explorer.selected = null;
      } else if (explorer.board[r][c] && explorer.board[r][c].color === explorer.turn) {
        explorer.selected = { r: r, c: c };
      }
      renderOpeningExplorer();
    };
    document.getElementById('opening-sequence').textContent = explorer.moves.length ? explorer.moves.join(' ') : 'Explore from the starting position.';
    var suggestions = document.getElementById('opening-suggestions');
    suggestions.textContent = '';
    window.OpeningExplorer.continuations(explorer.moves).forEach(function (suggestion) {
      var button = document.createElement('button');
      button.type = 'button';
      button.textContent = suggestion.move + ' — ' + suggestion.explanation;
      button.addEventListener('click', function () { if (openingApplySan(suggestion.move)) renderOpeningExplorer(); });
      suggestions.appendChild(button);
    });
    var results = document.getElementById('opening-results');
    results.textContent = '';
    window.OpeningExplorer.search(document.getElementById('opening-search').value).forEach(function (opening) {
      var button = document.createElement('button');
      button.type = 'button';
      button.textContent = opening.name + ' — ' + opening.moves;
      button.addEventListener('click', function () {
        try {
          loadExplorerLine(opening.moves);
          renderOpeningExplorer();
        } catch (error) {
          document.getElementById('opening-name').textContent = 'Could not load this opening line.';
        }
      });
      results.appendChild(button);
    });
  }
  function resetExplorer() {
    explorer = { board: window.ChessCore.initialBoard(), turn: 'w', castling: { wK: true, wQ: true, bK: true, bQ: true }, enPassant: null, moves: [] };
  }
  function loadExplorerLine(line) {
    resetExplorer();
    var moves = window.OpeningExplorer.tokens(line);
    for (var i = 0; i < moves.length; i++) {
      if (!openingApplySan(moves[i])) break;
    }
  }
  function openOpeningExplorer() {
    resetExplorer();
    (state.moves || []).forEach(function (move) {
      if (!openingApplySan(move)) return;
    });
    renderOpeningExplorer();
    showOnly('opening-explorer');
  }
  function refreshOpeningRecognition() {
    var label = document.getElementById('game-opening-info');
    var suggestions = document.getElementById('game-opening-suggestions');
    if (!label || !suggestions) return;
    var matches = window.OpeningExplorer.matchPrefix(state.moves || []);
    label.textContent = matches.length ? matches.map(function (opening) { return opening.name; }).join(' / ') : 'Opening not in catalog';
    suggestions.textContent = '';
    window.OpeningExplorer.continuations(state.moves || []).forEach(function (item) {
      var row = document.createElement('div');
      row.className = 'opening-live-suggestion';
      row.textContent = item.move + ' — ' + item.explanation;
      suggestions.appendChild(row);
    });
  }

  function backToSetup() { showOnly('setup'); }

  function startGame() {
    state.challenge = null;
    bumpAiGeneration();
    state.mode = document.getElementById('mode-select').value;
    state.aiLevel = document.getElementById('difficulty-select').value;
    var selectedPlayerColor = document.getElementById('color-select').value;
    var playerColor = selectedPlayerColor === 'white' || selectedPlayerColor === 'w' ? 'w' : 'b';
    state.aiColor = playerColor === 'w' ? 'b' : 'w';
    var timerVal = document.getElementById('timer-select').value;
    state.timeControl = timerVal === 'none' ? 3600 : parseInt(timerVal, 10);
    applyTheme(document.getElementById('theme-select').value);
    state.board = C.initialBoard();
    state.turn = 'w';
    refreshOpeningRecognition();
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

  // Wire events
  document.getElementById('start-btn').addEventListener('click', startGame);
  document.getElementById('undo-btn').addEventListener('click', undo);
  document.getElementById('restart-btn').addEventListener('click', restart);
  var modeSelect = document.getElementById('mode-select');
  var aiOptionsRow = document.getElementById('ai-options');
  var colorOptionsRow = document.getElementById('color-options');
  function syncAiOptionRows() {
    var isAI = modeSelect.value === 'ai';
    aiOptionsRow.classList.toggle('hidden', !isAI);
    colorOptionsRow.classList.toggle('hidden', !isAI);
  }
  modeSelect.addEventListener('change', syncAiOptionRows);
  modeSelect.addEventListener('input', syncAiOptionRows);
  document.querySelectorAll('input[name="game-mode"]').forEach(function (choice) {
    choice.addEventListener('change', function () {
      modeSelect.value = choice.value;
      modeSelect.dispatchEvent(new Event('change', { bubbles: true }));
    });
  });
  document.getElementById('theme-select').addEventListener('change', function () {
    applyTheme(this.value);
    saveStore();
  });

  document.getElementById('new-game-btn').addEventListener('click', backToSetup);
  document.getElementById('resume-game-btn').addEventListener('click', resumeGame);
  document.getElementById('stats-btn').addEventListener('click', function () { showOnly('stats'); });
  document.getElementById('profile-btn').addEventListener('click', function () { renderProfile(); showOnly('profile'); });
  document.getElementById('profile-back-btn').addEventListener('click', function () { showMainMenu(); });
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

  var smartReviewButton = document.getElementById('smart-review-btn');
  if (smartReviewButton) smartReviewButton.addEventListener('click', function () { showOnly('smart-review'); });
  var gameReviewButton = document.getElementById('game-review-btn');
  if (gameReviewButton) gameReviewButton.addEventListener('click', function () { showOnly('smart-review'); });
  var reviewBackButton = document.getElementById('review-back-btn');
  if (reviewBackButton) reviewBackButton.addEventListener('click', showMainMenu);
  var reviewControls = [
    ['review-first-btn', function () { review.cursor = 0; renderReview(); }],
    ['review-prev-btn', function () { review.cursor -= 1; renderReview(); }],
    ['review-next-btn', function () { review.cursor += 1; renderReview(); }],
    ['review-last-btn', function () { review.cursor = review.moves.length; renderReview(); }]
  ];
  reviewControls.forEach(function (entry) {
    var control = document.getElementById(entry[0]);
    if (control) control.addEventListener('click', entry[1]);
  });
  document.getElementById('analysis-first-btn').addEventListener('click', function () { analysis.cursor = 0; renderAnalysis(); });
  document.getElementById('analysis-prev-btn').addEventListener('click', function () { analysis.cursor = Math.max(0, analysis.cursor - 1); renderAnalysis(); });
  document.getElementById('analysis-next-btn').addEventListener('click', function () { analysis.cursor = Math.min(analysis.moves.length, analysis.cursor + 1); renderAnalysis(); });
  document.getElementById('analysis-last-btn').addEventListener('click', function () { analysis.cursor = analysis.moves.length; renderAnalysis(); });
  document.getElementById('analysis-back-btn').addEventListener('click', showMainMenu);
  document.getElementById('achievements-back-btn').addEventListener('click', showMainMenu);
  document.getElementById('replays-btn').addEventListener('click', function () { showOnly('replay'); });
  document.getElementById('opening-explorer-btn').addEventListener('click', openOpeningExplorer);
  document.getElementById('opening-back-btn').addEventListener('click', function () { showOnly('main-menu'); });
  document.getElementById('opening-reset-btn').addEventListener('click', function () { resetExplorer(); renderOpeningExplorer(); });
  document.getElementById('opening-search').addEventListener('input', renderOpeningExplorer);
  document.getElementById('game-opening-explore-btn').addEventListener('click', openOpeningExplorer);
  document.getElementById('opening-back-btn').addEventListener('click', showMainMenu);
  document.getElementById('opening-reset-btn').addEventListener('click', function () { resetExplorer(); renderOpeningExplorer(); });
  document.getElementById('opening-search').addEventListener('input', renderOpeningExplorer);
  document.getElementById('game-opening-explore-btn').addEventListener('click', openOpeningExplorer);
  document.getElementById('friends-btn').addEventListener('click', function () { showOnly('friends'); });
  initSpectator();
  document.getElementById('leaderboard-btn').addEventListener('click', function () { showOnly('leaderboard'); });
  document.getElementById('friends-back-btn').addEventListener('click', showMainMenu);
  document.getElementById('leaderboard-back-btn').addEventListener('click', showMainMenu);
  document.getElementById('friends-copy-code-btn').addEventListener('click', function () {
    copyText(myPlayerCode(), 'Player code copied.');
  });
  document.getElementById('friend-add-btn').addEventListener('click', addFriendFromInput);
  document.getElementById('friend-code-input').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') addFriendFromInput();
  });
  document.getElementById('friends-search-input').addEventListener('input', renderFriends);
  document.getElementById('lb-week-btn').addEventListener('click', function () { setLbScope('week'); });
  document.getElementById('lb-all-btn').addEventListener('click', function () { setLbScope('all'); });
  document.getElementById('replay-back-btn').addEventListener('click', showMainMenu);
  document.getElementById('replay-back-to-list-btn').addEventListener('click', function () { showOnly('replay'); });
  document.getElementById('replay-first-btn').addEventListener('click', function () { replay.cursor = 0; renderReplay(); });
  document.getElementById('replay-prev-btn').addEventListener('click', function () { replay.cursor = Math.max(0, replay.cursor - 1); renderReplay(); });
  document.getElementById('replay-next-btn').addEventListener('click', function () { replay.cursor = Math.min(replay.meta.length, replay.cursor + 1); renderReplay(); });
  document.getElementById('replay-last-btn').addEventListener('click', function () { replay.cursor = replay.meta.length; renderReplay(); });
  document.getElementById('replay-import-btn').addEventListener('click', importShareCode);
  document.getElementById('replay-pgn-file').addEventListener('change', function () {
    var input = this;
    importPgnFile(input.files && input.files[0]);
    input.value = '';
  });
  document.getElementById('replay-code-input').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') importShareCode();
  });
  document.getElementById('stats-back-btn').addEventListener('click', showMainMenu);

  // Init
  applyTheme(store.theme || 'classic');
  applyPieceDesign(store.pieceDesign || 'classic');
  applyUiTheme(store.uiTheme || 'dark');
  var themeSelect = document.getElementById('theme-select');
  if (themeSelect && THEMES.indexOf(store.theme) >= 0) themeSelect.value = store.theme;
  document.getElementById('settings-btn').addEventListener('click', function () { showOnly('settings'); });
  document.getElementById('settings-back-btn').addEventListener('click', showMainMenu);
  document.getElementById('online-btn').addEventListener('click', function () {
    document.getElementById('player-name-input').value = store.playerName || '';
    showOnly('lobby');
    net.connect();
  });
  document.getElementById('player-name-input').addEventListener('change', function () {
    state.playerName = sanitizePlayerName(this.value);
    saveStore();
  });
  initSettings();
  initMultiplayer();
  wireTraining();
  wireTournament();
  state.board = C.initialBoard();
  render();
  showMainMenu();
})();
