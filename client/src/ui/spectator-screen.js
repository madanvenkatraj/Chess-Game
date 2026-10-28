/**
 * spectator-screen.js — Spectator Mode screen rendering.
 * UMD: browser global SpectatorScreen, CommonJS for tests.
 * Read-only board renderer shared with the game screen via callback, so the
 * module itself stays DOM-light and testable with a fake DOM.
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.SpectatorScreen = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var PIECE_GLYPHS = {
    wK: '\u2654', wQ: '\u2655', wR: '\u2656', wB: '\u2657', wN: '\u2658', wP: '\u2659',
    bK: '\u265A', bQ: '\u265B', bR: '\u265C', bB: '\u265D', bN: '\u265E', bP: '\u265F'
  };

  function fmtClock(s) {
    if (s == null) return '—';
    var m = Math.floor(s / 60), sec = Math.floor(s % 60);
    return m + ':' + (sec < 10 ? '0' : '') + sec;
  }

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }

  /**
   * Render the player card row.
   * players = { w: {name, rating}, b: {name, rating} }
   * clocks  = { w, b } seconds or null; turn = 'w' | 'b'
   */
  function renderPlayers(container, players, clocks, turn, over) {
    container.innerHTML = '';
    var row = el('div', 'spectator-players');
    ['w', 'b'].forEach(function (seat) {
      var card = el('div', 'spectator-player-card' + (turn === seat && !over ? ' active-turn' : ''));
      var nameLine = el('div', 'spectator-player-name');
      var dot = el('span', 'spectator-dot ' + (seat === 'w' ? 'dot-white' : 'dot-black'));
      nameLine.appendChild(dot);
      nameLine.appendChild(document.createTextNode(
        (players && players[seat] && players[seat].name) || (seat === 'w' ? 'White' : 'Black')));
      card.appendChild(nameLine);
      var rating = players && players[seat] && players[seat].rating;
      var sub = el('div', 'spectator-player-sub',
        (rating != null ? 'Rating ' + rating : 'Unrated') + ' · ' + fmtClock(clocks && clocks[seat]));
      card.appendChild(sub);
      row.appendChild(card);
    });
    container.appendChild(row);
  }

  /**
   * Render the move list. moves = [san...]; highlights the current replay ply.
   * currentPly = index into moves of the ply being viewed (-1 = before move 1).
   */
  function renderMoves(container, moves, currentPly) {
    container.innerHTML = '';
    if (!moves || moves.length === 0) {
      container.appendChild(el('div', 'spectator-empty', 'No moves yet — the game just started.'));
      return;
    }
    var table = el('div', 'spectator-movelist');
    for (var i = 0; i < moves.length; i += 2) {
      var row = el('div', 'spectator-move-row');
      row.appendChild(el('span', 'spectator-move-num', String(i / 2 + 1) + '.'));
      var white = el('span', 'spectator-move' + (currentPly === i ? ' current' : ''), moves[i]);
      row.appendChild(white);
      var black = el('span', 'spectator-move' + (currentPly === i + 1 ? ' current' : ''), moves[i + 1] || '');
      row.appendChild(black);
      table.appendChild(row);
    }
    container.appendChild(table);
  }

  /** Render captured pieces trays. captured = { w: [pieces taken BY white], b: [...] } */
  function renderCaptured(container, captured) {
    container.innerHTML = '';
    var wrap = el('div', 'spectator-captured');
    var wTray = el('div', 'spectator-tray');
    wTray.appendChild(el('span', 'spectator-tray-label', 'White took:'));
    var wGlyphs = (captured && captured.w || []).map(function (p) {
      return PIECE_GLYPHS['b' + p.type] || '';
    }).join(' ');
    wTray.appendChild(el('span', 'spectator-tray-pieces', wGlyphs || '—'));
    var bTray = el('div', 'spectator-tray');
    bTray.appendChild(el('span', 'spectator-tray-label', 'Black took:'));
    var bGlyphs = (captured && captured.b || []).map(function (p) {
      return PIECE_GLYPHS['w' + p.type] || '';
    }).join(' ');
    bTray.appendChild(el('span', 'spectator-tray-pieces', bGlyphs || '—'));
    wrap.appendChild(wTray);
    wrap.appendChild(bTray);
    container.appendChild(wrap);
  }

  /**
   * Render the game picker list. games = sorted list entries;
   * currentCode = the game being watched (or null).
   * onPick(code) is called when a game row is clicked.
   */
  function renderGameList(container, games, currentCode, onPick) {
    container.innerHTML = '';
    if (!games || games.length === 0) {
      container.appendChild(el('div', 'spectator-empty spectator-gamelist-empty',
        'No live games right now. Start an online game and it will appear here.'));
      return;
    }
    var list = el('div', 'spectator-gamelist');
    games.forEach(function (g) {
      var row = el('button', 'spectator-game-row' + (g.code === currentCode ? ' current' : ''));
      row.type = 'button';
      var title = el('span', 'spectator-game-title',
        (g.names && g.names.w || 'White') + ' vs ' + (g.names && g.names.b || 'Black'));
      var sub = el('span', 'spectator-game-sub',
        g.code + ' · ' + (g.moveCount || 0) + ' moves' +
        (g.over ? ' · finished' : ' · live'));
      row.appendChild(title);
      row.appendChild(sub);
      row.addEventListener('click', function () { onPick(g.code); });
      list.appendChild(row);
    });
    container.appendChild(list);
  }

  /** Status line: result text or "Live — White to move". */
  function statusText(snapshot) {
    if (!snapshot) return 'Pick a game to watch.';
    if (snapshot.over && snapshot.result) {
      var r = snapshot.result;
      if (r.type === 'checkmate') return 'Game over — ' + (r.winner === 'w' ? 'White' : 'Black') + ' wins by checkmate.';
      if (r.type === 'stalemate') return 'Game over — draw by stalemate.';
      if (r.type === 'time') return 'Game over — ' + (r.winner === 'w' ? 'White' : 'Black') + ' wins on time.';
      if (r.type === 'forfeit') return 'Game over — ' + (r.winner === 'w' ? 'White' : 'Black') + ' wins by forfeit.';
      return 'Game over.';
    }
    return 'Live — ' + (snapshot.turn === 'w' ? 'White' : 'Black') + ' to move';
  }

  return {
    renderPlayers: renderPlayers,
    renderMoves: renderMoves,
    renderCaptured: renderCaptured,
    renderGameList: renderGameList,
    statusText: statusText,
    fmtClock: fmtClock,
    PIECE_GLYPHS: PIECE_GLYPHS
  };
});
