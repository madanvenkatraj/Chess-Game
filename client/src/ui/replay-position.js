(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.ReplayPosition = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function setPosition(cursor, moves, core) {
    var position = Math.max(0, Math.min(moves.length, cursor));
    var board = core.initialBoard();
    for (var i = 0; i < position; i++) {
      var move = moves[i];
      core.applyMove(board, move.from, move.to, move.extra || {}, move.promotion || 'Q');
    }
    return { cursor: position, board: board, lastMove: position > 0 ? moves[position - 1] : null };
  }

  return { setPosition: setPosition };
});
