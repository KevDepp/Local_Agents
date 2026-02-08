(() => {
  const BOARD_SIZE = 8;
  const TYPES = {
    king: "king",
    queen: "queen",
    rook: "rook",
    bishop: "bishop",
    knight: "knight",
    pawn: "pawn",
  };

  const BACK_RANK = [
    TYPES.rook,
    TYPES.knight,
    TYPES.bishop,
    TYPES.queen,
    TYPES.king,
    TYPES.bishop,
    TYPES.knight,
    TYPES.rook,
  ];

  function createEmptyBoard() {
    return Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(null));
  }

  function createPiece(type, color) {
    return { type, color, moved: false };
  }

  function createInitialBoard() {
    const board = createEmptyBoard();

    BACK_RANK.forEach((type, col) => {
      board[0][col] = createPiece(type, "black");
      board[7][col] = createPiece(type, "white");
    });

    for (let col = 0; col < BOARD_SIZE; col += 1) {
      board[1][col] = createPiece(TYPES.pawn, "black");
      board[6][col] = createPiece(TYPES.pawn, "white");
    }

    return board;
  }

  function cloneBoard(board) {
    return board.map((row) =>
      row.map((piece) => (piece ? { ...piece } : null))
    );
  }

  function isInside(row, col) {
    return row >= 0 && row < BOARD_SIZE && col >= 0 && col < BOARD_SIZE;
  }

  function algebraic(row, col) {
    const file = String.fromCharCode("a".charCodeAt(0) + col);
    const rank = BOARD_SIZE - row;
    return `${file}${rank}`;
  }

  function isOpponent(piece, other) {
    return other && piece && piece.color !== other.color;
  }

  function collectRay(board, piece, row, col, dRow, dCol) {
    const moves = [];
    let r = row + dRow;
    let c = col + dCol;

    while (isInside(r, c)) {
      const occupant = board[r][c];
      if (!occupant) {
        moves.push({ row: r, col: c });
      } else {
        if (isOpponent(piece, occupant)) {
          moves.push({ row: r, col: c });
        }
        break;
      }
      r += dRow;
      c += dCol;
    }

    return moves;
  }

  function getLegalMoves(board, row, col) {
    if (!isInside(row, col)) {
      return [];
    }

    const piece = board[row][col];
    if (!piece) {
      return [];
    }

    const moves = [];

    if (piece.type === TYPES.rook || piece.type === TYPES.queen) {
      moves.push(
        ...collectRay(board, piece, row, col, -1, 0),
        ...collectRay(board, piece, row, col, 1, 0),
        ...collectRay(board, piece, row, col, 0, -1),
        ...collectRay(board, piece, row, col, 0, 1)
      );
    }

    if (piece.type === TYPES.bishop || piece.type === TYPES.queen) {
      moves.push(
        ...collectRay(board, piece, row, col, -1, -1),
        ...collectRay(board, piece, row, col, -1, 1),
        ...collectRay(board, piece, row, col, 1, -1),
        ...collectRay(board, piece, row, col, 1, 1)
      );
    }

    if (piece.type === TYPES.knight) {
      const jumps = [
        [-2, -1],
        [-2, 1],
        [-1, -2],
        [-1, 2],
        [1, -2],
        [1, 2],
        [2, -1],
        [2, 1],
      ];
      jumps.forEach(([dRow, dCol]) => {
        const r = row + dRow;
        const c = col + dCol;
        if (!isInside(r, c)) {
          return;
        }
        const occupant = board[r][c];
        if (!occupant || isOpponent(piece, occupant)) {
          moves.push({ row: r, col: c });
        }
      });
    }

    if (piece.type === TYPES.king) {
      for (let dRow = -1; dRow <= 1; dRow += 1) {
        for (let dCol = -1; dCol <= 1; dCol += 1) {
          if (dRow === 0 && dCol === 0) {
            continue;
          }
          const r = row + dRow;
          const c = col + dCol;
          if (!isInside(r, c)) {
            continue;
          }
          const occupant = board[r][c];
          if (!occupant || isOpponent(piece, occupant)) {
            moves.push({ row: r, col: c });
          }
        }
      }
    }

    if (piece.type === TYPES.pawn) {
      const direction = piece.color === "white" ? -1 : 1;
      const startRow = piece.color === "white" ? 6 : 1;
      const forwardRow = row + direction;
      if (isInside(forwardRow, col) && !board[forwardRow][col]) {
        moves.push({ row: forwardRow, col });

        const doubleRow = row + direction * 2;
        if (row === startRow && !board[doubleRow][col]) {
          moves.push({ row: doubleRow, col });
        }
      }

      const captureCols = [col - 1, col + 1];
      captureCols.forEach((captureCol) => {
        if (!isInside(forwardRow, captureCol)) {
          return;
        }
        const occupant = board[forwardRow][captureCol];
        if (isOpponent(piece, occupant)) {
          moves.push({ row: forwardRow, col: captureCol });
        }
      });
    }

    return moves;
  }

  function isLegalMove(board, fromRow, fromCol, toRow, toCol, currentPlayer) {
    const piece = board[fromRow]?.[fromCol];
    if (!piece) {
      return false;
    }
    if (currentPlayer && piece.color !== currentPlayer) {
      return false;
    }
    const moves = getLegalMoves(board, fromRow, fromCol);
    return moves.some((move) => move.row === toRow && move.col === toCol);
  }

  function applyMove(board, fromRow, fromCol, toRow, toCol) {
    const piece = board[fromRow][fromCol];
    const captured = board[toRow][toCol] || null;
    board[toRow][toCol] = piece ? { ...piece, moved: true } : null;
    board[fromRow][fromCol] = null;
    return { captured };
  }

  const ChessGame = {
    BOARD_SIZE,
    TYPES,
    createInitialBoard,
    cloneBoard,
    getLegalMoves,
    isLegalMove,
    applyMove,
    algebraic,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = ChessGame;
  }

  if (typeof window !== "undefined") {
    window.ChessGame = ChessGame;
  } else if (typeof globalThis !== "undefined") {
    globalThis.ChessGame = ChessGame;
  }
})();
