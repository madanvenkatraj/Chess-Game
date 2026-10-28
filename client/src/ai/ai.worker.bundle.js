//#region client/src/engine/squares.ts
var FILES = [
	"a",
	"b",
	"c",
	"d",
	"e",
	"f",
	"g",
	"h"
];
var RANKS = [
	"1",
	"2",
	"3",
	"4",
	"5",
	"6",
	"7",
	"8"
];
var SQUARES = FILES.flatMap((f) => RANKS.map((r) => f + r));
/** All 64 squares in a1..h8 order. Frozen so callers cannot mutate the list. */
var ALL_SQUARES = Object.freeze(SQUARES);
function fileOf(square) {
	return square.charCodeAt(0) - 97;
}
function rankOf(square) {
	return Number.parseInt(square[1], 10) - 1;
}
function squareAt(file, rank) {
	if (file < 0 || file > 7 || rank < 0 || rank > 7) return null;
	return FILES[file] + RANKS[rank];
}
/** Orthogonal offset in (file, rank) steps, e.g. "e4" -> north is "e5". */
function step(square, df, dr) {
	return squareAt(fileOf(square) + df, rankOf(square) + dr);
}
//#endregion
//#region client/src/state/gameState.ts
/** The structural castling-right flags a move may clear. */
function castlingRightsAfter(rights, mover, move) {
	let next = rights;
	if (move.piece === "king") next = mover === "white" ? {
		...next,
		K: false,
		Q: false
	} : {
		...next,
		k: false,
		q: false
	};
	const clears = (sq, flag) => {
		if (move.from === sq || move.to === sq) next = {
			...next,
			[flag]: false
		};
	};
	if (move.piece === "rook") {
		clears("a1", "Q");
		clears("h1", "K");
		clears("a8", "q");
		clears("h8", "k");
	}
	if (move.to === "a1") next = {
		...next,
		Q: false
	};
	if (move.to === "h1") next = {
		...next,
		K: false
	};
	if (move.to === "a8") next = {
		...next,
		q: false
	};
	if (move.to === "h8") next = {
		...next,
		k: false
	};
	return next;
}
/** Snap a piece off the board, returning a new board. */
function removePiece(board, square) {
	const next = { ...board };
	delete next[square];
	return next;
}
function putPiece(board, square, piece) {
	return {
		...board,
		[square]: piece
	};
}
/**
* Structurally apply a move that has ALREADY been validated as legal.
* Never mutates the input state.
*/
function applyMove(state, move, options = {}) {
	const piece = state.board[move.from];
	if (!piece) throw new Error(`applyMove: no piece on ${move.from}`);
	const captured = options.enPassantCapture ? state.board[options.enPassantCapture] : state.board[move.to];
	let board = removePiece(state.board, move.from);
	if (options.enPassantCapture) board = removePiece(board, options.enPassantCapture);
	const placed = options.promotion !== void 0 ? {
		type: options.promotion,
		color: piece.color
	} : piece;
	board = putPiece(board, move.to, placed);
	if (options.rookFrom && options.rookTo) {
		const rook = state.board[options.rookFrom];
		if (!rook) throw new Error(`applyMove: no rook on ${options.rookFrom}`);
		board = removePiece(board, options.rookFrom);
		board = putPiece(board, options.rookTo, rook);
	}
	const halfmoveClock = piece.type === "pawn" || captured !== void 0 ? 0 : state.halfmoveClock + 1;
	const fullmoveNumber = state.turn === "black" ? state.fullmoveNumber + 1 : state.fullmoveNumber;
	const turn = state.turn === "white" ? "black" : "white";
	return {
		board,
		turn,
		castling: castlingRightsAfter(state.castling, state.turn, move),
		enPassantTarget: options.newEnPassantTarget ?? null,
		halfmoveClock,
		fullmoveNumber,
		clock: state.clock,
		history: [...state.history, {
			board: state.board,
			turn: state.turn,
			castling: state.castling,
			enPassantTarget: state.enPassantTarget,
			halfmoveClock: state.halfmoveClock,
			fullmoveNumber: state.fullmoveNumber
		}]
	};
}
//#endregion
//#region client/src/engine/moveGeneration.ts
var ORTHOGONAL = [
	[0, 1],
	[0, -1],
	[1, 0],
	[-1, 0]
];
var DIAGONAL = [
	[1, 1],
	[1, -1],
	[-1, 1],
	[-1, -1]
];
var KNIGHT_JUMPS = [
	[1, 2],
	[2, 1],
	[2, -1],
	[1, -2],
	[-1, -2],
	[-2, -1],
	[-2, 1],
	[-1, 2]
];
var PROMOTION_PIECES = [
	"queen",
	"rook",
	"bishop",
	"knight"
];
function isOccupiedBy(board, square, color) {
	const piece = board[square];
	return piece !== void 0 && piece.color === color;
}
function isOccupiedByOpponent(board, square, color) {
	const piece = board[square];
	return piece !== void 0 && piece.color !== color;
}
/** Find a side's king square; null if absent (corrupt/partial test boards). */
function findKing(board, color) {
	for (const square of ALL_SQUARES) {
		const piece = board[square];
		if (piece && piece.type === "king" && piece.color === color) return square;
	}
	return null;
}
/**
* Is `square` attacked by any piece of `attacker`? Covers pawn, knight, king,
* and slider attacks. The core primitive behind check, castling transit, and
* pin detection via simulation.
*/
function isSquareAttacked(board, square, attacker) {
	const f = fileOf(square);
	const r = rankOf(square);
	const pawnRank = attacker === "white" ? r - 1 : r + 1;
	for (const df of [-1, 1]) {
		const pawnSquare = squareAt(f + df, pawnRank);
		const piece = pawnSquare ? board[pawnSquare] : void 0;
		if (piece && piece.type === "pawn" && piece.color === attacker) return true;
	}
	for (const [df, dr] of KNIGHT_JUMPS) {
		const knightSquare = squareAt(f + df, r + dr);
		const piece = knightSquare ? board[knightSquare] : void 0;
		if (piece && piece.type === "knight" && piece.color === attacker) return true;
	}
	for (const [df, dr] of [...ORTHOGONAL, ...DIAGONAL]) {
		const nearSquare = squareAt(f + df, r + dr);
		const piece = nearSquare ? board[nearSquare] : void 0;
		if (piece && piece.type === "king" && piece.color === attacker) return true;
	}
	for (const [df, dr] of ORTHOGONAL) {
		let cursor = square;
		while ((cursor = step(cursor, df, dr)) !== null) {
			const piece = board[cursor];
			if (piece) {
				if (piece.color === attacker && (piece.type === "rook" || piece.type === "queen")) return true;
				break;
			}
		}
	}
	for (const [df, dr] of DIAGONAL) {
		let cursor = square;
		while ((cursor = step(cursor, df, dr)) !== null) {
			const piece = board[cursor];
			if (piece) {
				if (piece.color === attacker && (piece.type === "bishop" || piece.type === "queen")) return true;
				break;
			}
		}
	}
	return false;
}
/** Is `color`'s king attacked on this board? */
function isInCheck(board, color) {
	const king = findKing(board, color);
	if (!king) return false;
	return isSquareAttacked(board, king, color === "white" ? "black" : "white");
}
/** Pawn direction: white moves up the ranks, black moves down. */
function pawnDirection(color) {
	return color === "white" ? 1 : -1;
}
/** Pawn start rank for the double push. */
function pawnStartRankIndex(color) {
	return color === "white" ? 1 : 6;
}
/** Pawn promotion rank index. */
function promotionRankIndex(color) {
	return color === "white" ? 7 : 0;
}
/** Pseudo-legal (ignores king safety) moves for one piece from one square. */
function generateMovesForPiece(board, from, piece, color, enPassantTarget) {
	const moves = [];
	const push = (to, capture) => {
		if (piece === "pawn" && rankOf(to) === promotionRankIndex(color)) for (const promotion of PROMOTION_PIECES) moves.push({
			from,
			to,
			piece,
			promotion
		});
		else moves.push({
			from,
			to,
			piece
		});
	};
	const f = fileOf(from);
	const r = rankOf(from);
	switch (piece) {
		case "pawn": {
			const dir = pawnDirection(color);
			const oneStep = squareAt(f, r + dir);
			if (oneStep && board[oneStep] === void 0) {
				push(oneStep, false);
				const twoStep = squareAt(f, r + 2 * dir);
				if (r === pawnStartRankIndex(color) && twoStep && board[twoStep] === void 0) moves.push({
					from,
					to: twoStep,
					piece
				});
			}
			for (const df of [-1, 1]) {
				const diagonal = squareAt(f + df, r + dir);
				if (!diagonal) continue;
				if (isOccupiedByOpponent(board, diagonal, color)) push(diagonal, true);
				else if (diagonal === enPassantTarget) moves.push({
					from,
					to: diagonal,
					piece
				});
			}
			break;
		}
		case "knight":
			for (const [df, dr] of KNIGHT_JUMPS) {
				const to = squareAt(f + df, r + dr);
				if (!to) continue;
				if (!isOccupiedBy(board, to, color)) push(to, isOccupiedByOpponent(board, to, color));
			}
			break;
		case "king":
			for (const [df, dr] of [...ORTHOGONAL, ...DIAGONAL]) {
				const to = squareAt(f + df, r + dr);
				if (!to) continue;
				if (!isOccupiedBy(board, to, color)) push(to, isOccupiedByOpponent(board, to, color));
			}
			break;
		case "rook":
			for (const [df, dr] of ORTHOGONAL) slide(board, from, f, r, df, dr, color, push);
			break;
		case "bishop":
			for (const [df, dr] of DIAGONAL) slide(board, from, f, r, df, dr, color, push);
			break;
		case "queen": for (const [df, dr] of [...ORTHOGONAL, ...DIAGONAL]) slide(board, from, f, r, df, dr, color, push);
	}
	return moves;
}
function slide(board, from, f, r, df, dr, color, push) {
	let cursor = squareAt(f + df, r + dr);
	while (cursor) {
		if (isOccupiedBy(board, cursor, color)) break;
		push(cursor, isOccupiedByOpponent(board, cursor, color));
		if (isOccupiedByOpponent(board, cursor, color)) break;
		cursor = step(cursor, df, dr);
	}
}
var CASTLING_DEF = {
	white: {
		K: {
			king: "e1",
			to: "g1",
			rookFrom: "h1",
			rookTo: "f1",
			transit: "f1",
			path: ["f1", "g1"]
		},
		Q: {
			king: "e1",
			to: "c1",
			rookFrom: "a1",
			rookTo: "d1",
			transit: "d1",
			path: ["d1", "c1"]
		}
	},
	black: {
		K: {
			king: "e8",
			to: "g8",
			rookFrom: "h8",
			rookTo: "f8",
			transit: "f8",
			path: ["f8", "g8"]
		},
		Q: {
			king: "e8",
			to: "c8",
			rookFrom: "a8",
			rookTo: "d8",
			transit: "d8",
			path: ["d8", "c8"]
		}
	}
};
function castlingFlag(color, side) {
	return color === "white" ? side : side === "K" ? "k" : "q";
}
function emptyPath(board, path) {
	return path.every((square) => board[square] === void 0);
}
/**
* All moves that follow piece-movement rules, WITHOUT checking whether they
* leave the mover's own king in check. Cheap, reusable by the AI for ordering.
*/
function generatePseudoLegalMoves(state) {
	const moves = [];
	for (const from of ALL_SQUARES) {
		const piece = state.board[from];
		if (!piece || piece.color !== state.turn) continue;
		moves.push(...generateMovesForPiece(state.board, from, piece.type, piece.color, state.enPassantTarget));
	}
	for (const side of ["K", "Q"]) {
		const flag = castlingFlag(state.turn, side);
		if (!state.castling[flag]) continue;
		const def = CASTLING_DEF[state.turn][side];
		const kingPiece = state.board[def.king];
		if (!kingPiece || kingPiece.type !== "king" || kingPiece.color !== state.turn) continue;
		const rook = state.board[def.rookFrom];
		if (!rook || rook.type !== "rook" || rook.color !== state.turn) continue;
		if (!emptyPath(state.board, def.path)) continue;
		moves.push({
			from: def.king,
			to: def.to,
			piece: "king"
		});
	}
	return moves;
}
/**
* Structural options for a pseudo-legal move, so `applyMove` can clone the
* position correctly for the king-safety test.
*/
function applyOptionsFor$1(state, move) {
	if (move.piece === "pawn" && move.to === state.enPassantTarget) {
		const capturedSquare = squareAt(fileOf(move.to), rankOf(move.from));
		if (capturedSquare && state.board[capturedSquare]?.type === "pawn") {
			if (state.board[capturedSquare].color !== state.turn) return { enPassantCapture: capturedSquare };
		}
	}
	if (move.piece === "king" && Math.abs(fileOf(move.to) - fileOf(move.from)) === 2) {
		const side = fileOf(move.to) > fileOf(move.from) ? "K" : "Q";
		const def = CASTLING_DEF[state.turn][side];
		return {
			rookFrom: def.rookFrom,
			rookTo: def.rookTo
		};
	}
	const promotion = move.promotion;
	if (move.piece === "pawn" && promotion === void 0 && Math.abs(rankOf(move.to) - rankOf(move.from)) === 2) return { newEnPassantTarget: squareAt(fileOf(move.from), (rankOf(move.from) + rankOf(move.to)) / 2) };
	return promotion !== void 0 ? { promotion } : {};
}
/**
* Fully legal moves: pseudo-legal moves filtered by playing each one on an
* immutable clone and rejecting any that leave the mover's king attacked.
* This single simulation handles pins, discovered checks, illegal
* en-passant exposure, and the king-walks-into-check case uniformly.
*/
function generateLegalMoves(state) {
	const legal = [];
	for (const move of generatePseudoLegalMoves(state)) if (!isInCheck(applyMove(state, move, applyOptionsFor$1(state, move)).board, state.turn)) legal.push(move);
	return legal;
}
/** Castling has extra king-safety preconditions the simulation can't see:
* the king may not castle out of, through, or into check (FIDE 3.8.2). */
function filterIllegalCastling(state, moves) {
	return moves.filter((move) => {
		if (move.piece !== "king") return true;
		if (Math.abs(fileOf(move.to) - fileOf(move.from)) !== 2) return true;
		const side = fileOf(move.to) > fileOf(move.from) ? "K" : "Q";
		const def = CASTLING_DEF[state.turn][side];
		const enemy = state.turn === "white" ? "black" : "white";
		return !isSquareAttacked(state.board, def.king, enemy) && !isSquareAttacked(state.board, def.transit, enemy) && !isSquareAttacked(state.board, def.to, enemy);
	});
}
/**
* Legal moves with castling's king-safety rules applied. This is the public
* API the UI and AI should consume.
*/
function legalMoves(state) {
	return filterIllegalCastling(state, generateLegalMoves(state));
}
//#endregion
//#region client/src/ai/ai.ts
var MATERIAL = {
	pawn: 100,
	knight: 320,
	bishop: 330,
	rook: 500,
	queen: 900,
	king: 0
};
/** Piece-square tables from white's point of view, rank 8 first. */
var PIECE_SQUARES = {
	pawn: [
		0,
		0,
		0,
		0,
		0,
		0,
		0,
		0,
		50,
		50,
		50,
		50,
		50,
		50,
		50,
		50,
		10,
		10,
		20,
		30,
		30,
		20,
		10,
		10,
		5,
		5,
		10,
		25,
		25,
		10,
		5,
		5,
		0,
		0,
		0,
		20,
		20,
		0,
		0,
		0,
		5,
		-5,
		-10,
		0,
		0,
		-10,
		-5,
		5,
		5,
		10,
		10,
		-20,
		-20,
		10,
		10,
		5,
		0,
		0,
		0,
		0,
		0,
		0,
		0,
		0
	],
	knight: [
		-50,
		-40,
		-30,
		-30,
		-30,
		-30,
		-40,
		-50,
		-40,
		-20,
		0,
		0,
		0,
		0,
		-20,
		-40,
		-30,
		0,
		10,
		15,
		15,
		10,
		0,
		-30,
		-30,
		5,
		15,
		20,
		20,
		15,
		5,
		-30,
		-30,
		0,
		15,
		20,
		20,
		15,
		0,
		-30,
		-30,
		5,
		10,
		15,
		15,
		10,
		5,
		-30,
		-40,
		-20,
		0,
		5,
		5,
		0,
		-20,
		-40,
		-50,
		-40,
		-30,
		-30,
		-30,
		-30,
		-40,
		-50
	],
	bishop: [
		-20,
		-10,
		-10,
		-10,
		-10,
		-10,
		-10,
		-20,
		-10,
		0,
		0,
		0,
		0,
		0,
		0,
		-10,
		-10,
		0,
		5,
		10,
		10,
		5,
		0,
		-10,
		-10,
		5,
		5,
		10,
		10,
		5,
		5,
		-10,
		-10,
		0,
		10,
		10,
		10,
		10,
		0,
		-10,
		-10,
		10,
		10,
		10,
		10,
		10,
		10,
		-10,
		-10,
		5,
		0,
		0,
		0,
		0,
		5,
		-10,
		-20,
		-10,
		-10,
		-10,
		-10,
		-10,
		-10,
		-20
	],
	rook: [
		0,
		0,
		0,
		0,
		0,
		0,
		0,
		0,
		5,
		10,
		10,
		10,
		10,
		10,
		10,
		5,
		-5,
		0,
		0,
		0,
		0,
		0,
		0,
		-5,
		-5,
		0,
		0,
		0,
		0,
		0,
		0,
		-5,
		-5,
		0,
		0,
		0,
		0,
		0,
		0,
		-5,
		-5,
		0,
		0,
		0,
		0,
		0,
		0,
		-5,
		-5,
		0,
		0,
		0,
		0,
		0,
		0,
		-5,
		0,
		0,
		0,
		5,
		5,
		0,
		0,
		0
	],
	queen: [
		-20,
		-10,
		-10,
		-5,
		-5,
		-10,
		-10,
		-20,
		-10,
		0,
		0,
		0,
		0,
		0,
		0,
		-10,
		-10,
		0,
		5,
		5,
		5,
		5,
		0,
		-10,
		-5,
		0,
		5,
		5,
		5,
		5,
		0,
		-5,
		0,
		0,
		5,
		5,
		5,
		5,
		0,
		-5,
		-10,
		5,
		5,
		5,
		5,
		5,
		0,
		-10,
		-10,
		0,
		5,
		0,
		0,
		0,
		0,
		-10,
		-20,
		-10,
		-10,
		-5,
		-5,
		-10,
		-10,
		-20
	],
	king: [
		-30,
		-40,
		-40,
		-50,
		-50,
		-40,
		-40,
		-30,
		-30,
		-40,
		-40,
		-50,
		-50,
		-40,
		-40,
		-30,
		-30,
		-40,
		-40,
		-50,
		-50,
		-40,
		-40,
		-30,
		-30,
		-40,
		-40,
		-50,
		-50,
		-40,
		-40,
		-30,
		-20,
		-30,
		-30,
		-40,
		-40,
		-30,
		-30,
		-20,
		-10,
		-20,
		-20,
		-20,
		-20,
		-20,
		-20,
		-10,
		20,
		20,
		0,
		0,
		0,
		0,
		20,
		20,
		20,
		30,
		10,
		0,
		0,
		10,
		30,
		20
	]
};
/** MATE score: losing side is -MATE + ply so earlier mates score better. */
var MATE = 1e5;
/** Hard node cap shared by every profile — keeps any move under ~2s. */
var MAX_NODES = 5e3;
var PROFILES = {
	easy: {
		depth: 1,
		randomChance: .3,
		ordered: false,
		iterative: false,
		deterministic: false
	},
	medium: {
		depth: 3,
		randomChance: 0,
		ordered: false,
		iterative: false,
		deterministic: false
	},
	hard: {
		depth: 4,
		randomChance: 0,
		ordered: true,
		iterative: true,
		deterministic: true
	}
};
/** Static evaluation from the point of view of `side`. Positive = good. */
function evaluate(board, side) {
	let score = 0;
	for (const square of Object.keys(board)) {
		const piece = board[square];
		const table = PIECE_SQUARES[piece.type];
		const idx = (7 - rankOf(square)) * 8 + fileOf(square);
		const value = MATERIAL[piece.type] + table[idx];
		score += piece.color === "white" ? value : -value;
	}
	return side === "white" ? score : -score;
}
/** All structural options needed to apply `move` legally on `state`. */
function applyOptionsFor(state, move) {
	if (move.piece === "pawn" && move.to === state.enPassantTarget) {
		const captured = `${fileOf(move.to)}${rankOf(move.from)}`;
		if (state.board[captured]?.type === "pawn") return { enPassantCapture: captured };
	}
	const fileDistance = Math.abs(fileOf(move.to) - fileOf(move.from));
	if (move.piece === "king" && fileDistance === 2) {
		const side = fileOf(move.to) > fileOf(move.from) ? "K" : "Q";
		const rank = rankOf(move.from) === 0 ? "1" : "8";
		return {
			rookFrom: `${side === "K" ? "h" : "a"}${rank}`,
			rookTo: `${side === "K" ? "f" : "d"}${rank}`
		};
	}
	if (move.promotion !== void 0) return { promotion: move.promotion };
	if (move.piece === "pawn" && Math.abs(rankOf(move.to) - rankOf(move.from)) === 2) {
		const midRank = (rankOf(move.from) + rankOf(move.to)) / 2;
		return { newEnPassantTarget: `${fileOf(move.from)}${midRank}` };
	}
	return {};
}
/** Quiescence-lite: extend one ply for captures so search doesn't stop mid-exchange. */
function quiescence(state, alpha, beta, side, nodes) {
	const stand = evaluate(state.board, side);
	if (stand >= beta) return beta;
	if (stand > alpha) alpha = stand;
	const captures = legalMoves(state).filter((move) => state.board[move.to] !== void 0);
	for (const move of captures) {
		nodes.count++;
		if (nodes.count > MAX_NODES) break;
		const score = -quiescence(applyMove(state, move, applyOptionsFor(state, move)), -beta, -alpha, side, nodes);
		if (score >= beta) return beta;
		if (score > alpha) alpha = score;
		if (alpha >= beta) break;
	}
	return alpha;
}
function orderedMoves(state, moves) {
	return [...moves].sort((a, b) => captureScore(state, b) - captureScore(state, a));
}
function captureScore(state, move) {
	const victim = state.board[move.to];
	const victimValue = victim ? MATERIAL[victim.type] : 0;
	const attackerValue = MATERIAL[move.piece];
	return victimValue * 10 - attackerValue + (move.promotion ? 800 : 0);
}
/**
* Negamax alpha-beta. Score is always from the point of view of the side
* to move at the current node; the side parameter is the search's root
* perspective used at the leaf.
*/
function negamax(state, depth, alpha, beta, ply, ctx) {
	ctx.nodes.count++;
	const side = state.turn;
	if (ctx.nodes.count > MAX_NODES) return evaluate(state.board, ctx.side);
	if (isInCheck(state.board, side) && depth <= 0) depth = 1;
	if (depth <= 0) return quiescence(state, alpha, beta, ctx.side, ctx.nodes);
	const moves = legalMoves(state);
	if (moves.length === 0) return isInCheck(state.board, side) ? -1e5 + ply : 0;
	const ordered = ctx.ordered ? orderedMoves(state, moves) : moves;
	let best = -Infinity;
	for (const move of ordered) {
		const score = -negamax(applyMove(state, move, applyOptionsFor(state, move)), depth - 1, -beta, -alpha, ply + 1, ctx);
		if (score > best) best = score;
		if (best > alpha) alpha = best;
		if (alpha >= beta) break;
	}
	return best;
}
function searchRoot(state, depth, ctx) {
	const moves = legalMoves(state);
	const ordered = ctx.ordered ? orderedMoves(state, moves) : moves;
	const choices = [];
	let alpha = -Infinity;
	for (const move of ordered) {
		const score = -negamax(applyMove(state, move, applyOptionsFor(state, move)), depth - 1, -Infinity, -alpha, 1, ctx);
		choices.push({
			move,
			score
		});
		if (score > alpha) alpha = score;
	}
	return choices;
}
function shuffle(items) {
	for (let i = items.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		const tmp = items[i];
		items[i] = items[j];
		items[j] = tmp;
	}
	return items;
}
/**
* Choose a move for the side to move in `state` at the given difficulty.
* Pure: never mutates `state`, never mutates the engine's inputs.
*/
function chooseMove(state, difficulty) {
	const profile = PROFILES[difficulty];
	const moves = legalMoves(state);
	if (moves.length === 0) return {
		move: null,
		reason: "no-legal-moves",
		difficulty,
		nodesSearched: 0
	};
	if (profile.randomChance > 0 && Math.random() < profile.randomChance) return {
		move: moves[Math.floor(Math.random() * moves.length)],
		reason: null,
		difficulty,
		nodesSearched: 0
	};
	const ctx = {
		side: state.turn,
		nodes: { count: 0 },
		ordered: profile.ordered
	};
	if (profile.iterative) {
		let best = null;
		for (let depth = 1; depth <= profile.depth; depth++) {
			const choices = searchRoot(state, depth, ctx);
			if (ctx.nodes.count > MAX_NODES && depth > 1) break;
			best = pickBest(choices, moves, profile.deterministic);
			if (Math.abs(best.score) > MATE / 2) break;
		}
		return {
			move: best.move,
			reason: null,
			difficulty,
			nodesSearched: ctx.nodes.count
		};
	}
	return {
		move: pickBest(searchRoot(state, profile.depth, ctx), moves, profile.deterministic).move,
		reason: null,
		difficulty,
		nodesSearched: ctx.nodes.count
	};
}
/** Pick the top choice; hard breaks ties by move order, others randomly. */
function pickBest(choices, moves, deterministic) {
	let bestScore = -Infinity;
	for (const c of choices) if (c.score > bestScore) bestScore = c.score;
	const winners = choices.filter((c) => c.score === bestScore);
	return deterministic ? winners[0] : shuffle(winners)[0];
}
//#endregion
//#region client/src/ai/ai.worker.ts
/** Pure handler, exported so tests can drive the exact worker protocol. */
function handleSearchRequest(request) {
	const result = chooseMove(request.state, request.difficulty);
	return {
		id: request.id,
		move: result.move,
		reason: result.reason,
		difficulty: result.difficulty,
		nodesSearched: result.nodesSearched
	};
}
if (typeof self !== "undefined" && typeof self.onmessage !== "function") self.onmessage = (event) => {
	const request = event.data;
	if (typeof request?.id !== "number") return;
	try {
		self.postMessage(handleSearchRequest(request));
	} catch (err) {
		self.postMessage({
			id: request.id,
			error: err instanceof Error ? err.message : "ai-search-failed"
		});
	}
};
//#endregion
export { handleSearchRequest };
