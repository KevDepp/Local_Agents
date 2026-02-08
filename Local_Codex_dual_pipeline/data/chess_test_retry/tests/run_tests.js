const assert = require("assert");
const {
  createInitialBoard,
  cloneBoard,
  getLegalMoves,
  isLegalMove,
  applyMove,
} = require("../game.js");

function pos(square) {
  const file = square[0].toLowerCase().charCodeAt(0) - "a".charCodeAt(0);
  const rank = Number(square[1]);
  return { row: 8 - rank, col: file };
}

function hasMove(moves, target) {
  return moves.some((move) => move.row === target.row && move.col === target.col);
}

function test(name, fn) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    console.error(error.message);
    process.exitCode = 1;
  }
}

test("initial board has kings", () => {
  const board = createInitialBoard();
  assert.strictEqual(board[7][4].type, "king");
  assert.strictEqual(board[7][4].color, "white");
  assert.strictEqual(board[0][4].type, "king");
  assert.strictEqual(board[0][4].color, "black");
});

test("white pawn single and double move from start", () => {
  const board = createInitialBoard();
  const start = pos("e2");
  const moves = getLegalMoves(board, start.row, start.col);
  assert.ok(hasMove(moves, pos("e3")));
  assert.ok(hasMove(moves, pos("e4")));
});

test("pawn cannot jump over occupied square", () => {
  const board = createInitialBoard();
  const start = pos("e2");
  const block = pos("e3");
  board[block.row][block.col] = { type: "pawn", color: "white", moved: false };
  const moves = getLegalMoves(board, start.row, start.col);
  assert.ok(!hasMove(moves, pos("e4")));
});

test("knight jumps over pieces", () => {
  const board = createInitialBoard();
  const start = pos("b1");
  const moves = getLegalMoves(board, start.row, start.col);
  assert.ok(hasMove(moves, pos("a3")));
  assert.ok(hasMove(moves, pos("c3")));
});

test("rook blocked by pawn", () => {
  const board = createInitialBoard();
  const start = pos("a1");
  const moves = getLegalMoves(board, start.row, start.col);
  assert.strictEqual(moves.length, 0);
});

test("bishop blocked by pawn", () => {
  const board = createInitialBoard();
  const start = pos("c1");
  const moves = getLegalMoves(board, start.row, start.col);
  assert.strictEqual(moves.length, 0);
});

test("pawn capture diagonally", () => {
  const board = createInitialBoard();
  const pawn = pos("e4");
  board[pawn.row][pawn.col] = { type: "pawn", color: "white", moved: true };
  const enemy = pos("d5");
  board[enemy.row][enemy.col] = { type: "pawn", color: "black", moved: true };
  const moves = getLegalMoves(board, pawn.row, pawn.col);
  assert.ok(hasMove(moves, enemy));
});

test("applyMove captures and clears origin", () => {
  const board = createInitialBoard();
  const from = pos("e2");
  const to = pos("e4");
  applyMove(board, from.row, from.col, to.row, to.col);
  assert.strictEqual(board[from.row][from.col], null);
  assert.strictEqual(board[to.row][to.col].type, "pawn");
});

test("isLegalMove respects turn", () => {
  const board = createInitialBoard();
  const from = pos("e7");
  const to = pos("e5");
  assert.strictEqual(isLegalMove(board, from.row, from.col, to.row, to.col, "white"), false);
  assert.strictEqual(isLegalMove(board, from.row, from.col, to.row, to.col, "black"), true);
});

if (process.exitCode) {
  console.error("Tests failed.");
} else {
  console.log("All tests passed.");
}
