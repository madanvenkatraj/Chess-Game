const C = require('./chess-core.js');
function tryLine(fen, line) {
  const pos = C.parseFen(fen);
  const board = pos.board; let turn = pos.turn, castling = pos.castling, ep = pos.enPassant;
  let captured = null;
  for (const mv of line) {
    const from = { r: 8 - parseInt(mv[1], 10), c: mv.charCodeAt(0) - 97 };
    const to = { r: 8 - parseInt(mv[3], 10), c: mv.charCodeAt(2) - 97 };
    const piece = board[from.r][from.c];
    if (!piece || piece.color !== turn) { console.log('BAD turn', mv); return; }
    const legal = C.legalMoves(board, from.r, from.c, castling, ep); let mo = null;
    for (const m of legal) if (m.r === to.r && m.c === to.c) mo = m;
    if (!mo) { console.log('ILLEGAL', mv); return; }
    captured = C.applyMove(board, from, to, mo.extra || {}, null);
    ep = (mo.extra && mo.extra.double) ? { r: (from.r + to.r) / 2, c: from.c } : null;
    turn = turn === 'w' ? 'b' : 'w';
  }
  console.log(JSON.stringify(line), '| cap:', captured && captured.type, '| check:', C.inCheck(board, turn));
}
tryLine('4k3/8/4q3/8/3N4/8/8/R2K4 w - - 0 1', ['d4f6', 'e8d7', 'e1e6']);
tryLine('4k3/8/4q3/8/3N4/8/8/R2K4 w - - 0 1', ['d4f6', 'e8f8', 'e1e6']);
tryLine('4k3/8/4q3/8/3N4/8/8/R2K4 w - - 0 1', ['d4f6', 'e8e7', 'e1e6']);
