(() => {
  const { createInitialBoard, getLegalMoves, isLegalMove, applyMove, algebraic } =
    window.ChessGame;

  const boardElement = document.getElementById("board");
  const statusElement = document.getElementById("status");
  const historyElement = document.getElementById("history");

  const state = {
    board: createInitialBoard(),
    currentPlayer: "white",
    selected: null,
    legalMoves: [],
    history: [],
  };

  const PIECE_LABELS = {
    pawn: { white: "P", black: "p" },
    rook: { white: "R", black: "r" },
    knight: { white: "N", black: "n" },
    bishop: { white: "B", black: "b" },
    queen: { white: "Q", black: "q" },
    king: { white: "K", black: "k" },
  };

  const MOVE_LABELS = {
    pawn: "P",
    rook: "R",
    knight: "N",
    bishop: "B",
    queen: "Q",
    king: "K",
  };

  const squares = [];

  function buildBoard() {
    boardElement.innerHTML = "";
    for (let row = 0; row < 8; row += 1) {
      squares[row] = [];
      for (let col = 0; col < 8; col += 1) {
        const square = document.createElement("div");
        square.className = `square ${(row + col) % 2 === 0 ? "light" : "dark"}`;
        square.dataset.row = String(row);
        square.dataset.col = String(col);
        if (row === 7) {
          square.dataset.file = String.fromCharCode("a".charCodeAt(0) + col);
        }
        if (col === 0) {
          square.dataset.rank = String(8 - row);
        }
        square.setAttribute("role", "gridcell");
        square.addEventListener("click", onSquareClick);
        boardElement.appendChild(square);
        squares[row][col] = square;
      }
    }
  }

  function render() {
    for (let row = 0; row < 8; row += 1) {
      for (let col = 0; col < 8; col += 1) {
        const square = squares[row][col];
        const piece = state.board[row][col];
        square.innerHTML = "";
        square.classList.remove("selected", "legal", "capture");

        if (piece) {
          const pieceElement = document.createElement("span");
          pieceElement.className = `piece ${piece.color}`;
          pieceElement.textContent = PIECE_LABELS[piece.type][piece.color];
          square.appendChild(pieceElement);
        }

        if (state.selected && state.selected.row === row && state.selected.col === col) {
          square.classList.add("selected");
        }
      }
    }

    state.legalMoves.forEach((move) => {
      const square = squares[move.row][move.col];
      if (state.board[move.row][move.col]) {
        square.classList.add("capture");
      } else {
        square.classList.add("legal");
      }
    });

    renderHistory();
    updateStatus();
  }

  function updateStatus(message) {
    if (message) {
      statusElement.textContent = message;
      return;
    }
    const label = state.currentPlayer === "white" ? "Blancs" : "Noirs";
    statusElement.textContent = `Tour des ${label}.`;
  }

  function renderHistory() {
    historyElement.innerHTML = "";
    state.history.slice(-14).forEach((entry) => {
      const item = document.createElement("li");
      item.textContent = entry;
      historyElement.appendChild(item);
    });
  }

  function selectSquare(row, col) {
    state.selected = { row, col };
    state.legalMoves = getLegalMoves(state.board, row, col);
    render();
  }

  function clearSelection() {
    state.selected = null;
    state.legalMoves = [];
  }

  function onSquareClick(event) {
    const row = Number(event.currentTarget.dataset.row);
    const col = Number(event.currentTarget.dataset.col);
    const piece = state.board[row][col];

    if (!state.selected) {
      if (piece && piece.color === state.currentPlayer) {
        selectSquare(row, col);
      } else {
        updateStatus("Selectionnez une piece de votre couleur.");
      }
      return;
    }

    if (state.selected.row === row && state.selected.col === col) {
      clearSelection();
      render();
      return;
    }

    if (piece && piece.color === state.currentPlayer) {
      selectSquare(row, col);
      return;
    }

    const isValid = isLegalMove(
      state.board,
      state.selected.row,
      state.selected.col,
      row,
      col,
      state.currentPlayer
    );

    if (!isValid) {
      updateStatus("Coup illegal. Essayez une autre case.");
      return;
    }

    const from = state.selected;
    const movingPiece = state.board[from.row][from.col];
    const capture = state.board[row][col];

    applyMove(state.board, from.row, from.col, row, col);
    recordMove(movingPiece, from, { row, col }, capture);
    state.currentPlayer = state.currentPlayer === "white" ? "black" : "white";
    clearSelection();
    render();
  }

  function recordMove(piece, from, to, capture) {
    const playerLabel = piece.color === "white" ? "Blanc" : "Noir";
    const pieceLabel = MOVE_LABELS[piece.type];
    const captureLabel = capture ? "x" : "-";
    const move = `${playerLabel}: ${pieceLabel} ${algebraic(
      from.row,
      from.col
    )} ${captureLabel} ${algebraic(to.row, to.col)}`;
    state.history.push(move);
  }

  buildBoard();
  render();
})();
