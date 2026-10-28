// src/ui/ai.worker.js — Web Worker wrapper for the AI search.
//
// A classic (non-module) worker: loads chess-core.js and ai-search.js via
// importScripts, so it works in any browser without a bundler.
// Protocol: postMessage({ id, difficulty, board, turn, castling, enPassant })
//        -> { id, move }  (move is null when there are no legal moves)
importScripts('../../chess-core.js');
importScripts('ai-search.js');

self.onmessage = function (event) {
  var msg = event.data;
  var move = AiSearch.chooseMove(
    {
      core: ChessCore,
      board: msg.board,
      turn: msg.turn,
      castling: msg.castling,
      enPassant: msg.enPassant,
    },
    msg.difficulty,
  );
  self.postMessage({ id: msg.id, generation: msg.generation, move: move });
};
