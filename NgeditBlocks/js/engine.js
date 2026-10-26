/* Block stacking engine, vanilla JS, no DOM.
   Rules implemented, modern guideline style:
   - 10 x 20 visible board, 2 hidden rows on top
   - Full guideline SRS wall kicks (separate tables for JLSTZ and I)
   - 7-bag randomizer
   - Hold, once per piece
   - Ghost piece (computed by the UI from getGhostCells)
   - Lock delay 500 ms, move-reset, max 15 resets
   - T-spin detection: 3-corner rule, Mini vs proper, 5th-kick exception
   - Scoring: guideline base values, Back-to-Back x1.5, combo, perfect clear
   No code, assets, or network calls from any third party game are used here.
   This is a clean-room implementation from the public guideline rules.
*/
(function (global) {
  'use strict';

  var COLS = 10;
  var VISIBLE_ROWS = 20;
  var HIDDEN_ROWS = 2;
  var TOTAL_ROWS = VISIBLE_ROWS + HIDDEN_ROWS;
  var LOCK_DELAY = 500;
  var MAX_LOCK_RESETS = 15;

  var COLORS = {
    I: '#00e8e8',
    O: '#f8d800',
    T: '#b000f0',
    S: '#00e800',
    Z: '#f00000',
    J: '#2050f0',
    L: '#f0a000'
  };

  var PIECES = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];

  // Spawn matrices. JLSTZ live in a 3x3 box, I in a 4x4 box, O in a 2x2 box.
  var SHAPES = {
    I: [
      [0, 0, 0, 0],
      [1, 1, 1, 1],
      [0, 0, 0, 0],
      [0, 0, 0, 0]
    ],
    O: [
      [1, 1],
      [1, 1]
    ],
    T: [
      [0, 1, 0],
      [1, 1, 1],
      [0, 0, 0]
    ],
    S: [
      [0, 1, 1],
      [1, 1, 0],
      [0, 0, 0]
    ],
    Z: [
      [1, 1, 0],
      [0, 1, 1],
      [0, 0, 0]
    ],
    J: [
      [1, 0, 0],
      [1, 1, 1],
      [0, 0, 0]
    ],
    L: [
      [0, 0, 1],
      [1, 1, 1],
      [0, 0, 0]
    ]
  };

  // SRS kick tables, converted to screen coordinates (x right, y down).
  // The published tables use y up, so every y value here is negated.
  var KICKS_JLSTZ = {
    '0>1': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
    '1>0': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
    '1>2': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
    '2>1': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
    '2>3': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
    '3>2': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
    '3>0': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
    '0>3': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]]
  };

  var KICKS_I = {
    '0>1': [[0, 0], [-2, 0], [1, 0], [-2, 1], [1, -2]],
    '1>0': [[0, 0], [2, 0], [-1, 0], [2, -1], [-1, 2]],
    '1>2': [[0, 0], [-1, 0], [2, 0], [-1, -2], [2, 1]],
    '2>1': [[0, 0], [1, 0], [-2, 0], [1, 2], [-2, -1]],
    '2>3': [[0, 0], [2, 0], [-1, 0], [2, -1], [-1, 2]],
    '3>2': [[0, 0], [-2, 0], [1, 0], [-2, 1], [1, -2]],
    '3>0': [[0, 0], [1, 0], [-2, 0], [1, 2], [-2, -1]],
    '0>3': [[0, 0], [-1, 0], [2, 0], [-1, -2], [2, 1]]
  };

  var SCORE_TABLE = {
    single: 100,
    double: 300,
    triple: 500,
    quad: 800,
    tspin: 400,
    tspinMini: 100,
    tspinSingle: 800,
    tspinMiniSingle: 200,
    tspinDouble: 1200,
    tspinMiniDouble: 400,
    tspinTriple: 1600
  };

  var PERFECT_CLEAR_BONUS = {
    1: 800,
    2: 1200,
    3: 1800,
    4: 2000
  };

  function cloneMatrix(m) {
    return m.map(function (row) { return row.slice(); });
  }

  function rotateMatrix(m, dir) {
    var n = m.length;
    var out = [];
    var r, c;
    for (r = 0; r < n; r++) {
      out[r] = [];
      for (c = 0; c < n; c++) {
        if (dir === 1) {
          out[r][c] = m[n - 1 - c][r];
        } else {
          out[r][c] = m[c][n - 1 - r];
        }
      }
    }
    return out;
  }

  function gravityIntervalMs(level) {
    var table = [800, 720, 630, 550, 470, 380, 300, 220, 170, 140, 120, 100, 90, 80, 70, 60, 50, 45, 40, 35];
    if (level <= table.length) return table[level - 1];
    return 35;
  }

  function emptyBoard() {
    var board = [];
    var y, x;
    for (y = 0; y < TOTAL_ROWS; y++) {
      board[y] = [];
      for (x = 0; x < COLS; x++) board[y][x] = 0;
    }
    return board;
  }

  function BlockEngine(options) {
    options = options || {};
    this.rng = options.rng || Math.random;
    this.reset();
  }

  BlockEngine.prototype.reset = function () {
    this.board = emptyBoard();
    this.queue = [];
    this.bag = [];
    this.current = null;
    this.holdType = null;
    this.holdUsed = false;
    this.score = 0;
    this.lines = 0;
    this.level = 1;
    this.combo = -1;
    this.b2b = false;
    this.gameOver = false;
    this.started = false;
    this.gravityTimer = 0;
    this.lockTimer = 0;
    this._softDropping = false;
    this.lockResets = 0;
    this.lastEvent = null;
    this.refillQueue();
    this.spawn();
    this.started = true;
  };

  BlockEngine.prototype.shuffleBag = function () {
    var bag = PIECES.slice();
    var i, j, tmp;
    for (i = bag.length - 1; i > 0; i--) {
      j = Math.floor(this.rng() * (i + 1));
      tmp = bag[i];
      bag[i] = bag[j];
      bag[j] = tmp;
    }
    return bag;
  };

  BlockEngine.prototype.refillQueue = function () {
    while (this.queue.length < 10) {
      if (this.bag.length === 0) this.bag = this.shuffleBag();
      this.queue.push(this.bag.shift());
    }
  };

  // Test helper: force the upcoming queue (tests only, not used by the UI).
  BlockEngine.prototype.setQueue = function (types) {
    this.queue = types.slice();
    this.bag = [];
  };

  BlockEngine.prototype.spawnPosition = function (type) {
    if (type === 'O') return { x: 4, y: 0 };
    return { x: 3, y: 0 };
  };

  BlockEngine.prototype.spawn = function (forcedType) {
    var type = forcedType || this.queue.shift();
    this.refillQueue();
    var pos = this.spawnPosition(type);
    this.current = {
      type: type,
      rotation: 0,
      matrix: cloneMatrix(SHAPES[type]),
      x: pos.x,
      y: pos.y,
      lastAction: null,
      lastKickIndex: -1
    };
    this.gravityTimer = 0;
    this.lockTimer = 0;
    this._softDropping = false;
    this.lockResets = 0;
    if (this.collides(this.current.matrix, this.current.x, this.current.y)) {
      this.gameOver = true;
    }
    return this.current;
  };

  BlockEngine.prototype.cellsFor = function (matrix, x, y) {
    var cells = [];
    var r, c;
    for (r = 0; r < matrix.length; r++) {
      for (c = 0; c < matrix[r].length; c++) {
        if (matrix[r][c]) cells.push([x + c, y + r]);
      }
    }
    return cells;
  };

  BlockEngine.prototype.collides = function (matrix, x, y) {
    var cells = this.cellsFor(matrix, x, y);
    var i, bx, by;
    for (i = 0; i < cells.length; i++) {
      bx = cells[i][0];
      by = cells[i][1];
      if (bx < 0 || bx >= COLS) return true;
      if (by >= TOTAL_ROWS) return true;
      if (by >= 0 && this.board[by][bx]) return true;
    }
    return false;
  };

  BlockEngine.prototype.isGrounded = function () {
    if (!this.current) return false;
    return this.collides(this.current.matrix, this.current.x, this.current.y + 1);
  };

  BlockEngine.prototype.tryMove = function (dx, dy) {
    if (!this.current || this.gameOver) return false;
    var nx = this.current.x + dx;
    var ny = this.current.y + dy;
    if (this.collides(this.current.matrix, nx, ny)) return false;
    this.current.x = nx;
    this.current.y = ny;
    return true;
  };

  BlockEngine.prototype.move = function (dx) {
    var ok = this.tryMove(dx, 0);
    if (ok) {
      this.current.lastAction = 'move';
      this.onGroundedAction();
    }
    return ok;
  };

  BlockEngine.prototype.softDropStep = function () {
    var ok = this.tryMove(0, 1);
    if (ok) {
      this.score += 1;
      this.current.lastAction = 'soft';
      this.lockTimer = 0;
      this.lockResets = 0;
    }
    return ok;
  };

  BlockEngine.prototype.onGroundedAction = function () {
    if (!this.isGrounded()) return;
    if (this.lockResets < MAX_LOCK_RESETS) {
      this.lockTimer = 0;
      this.lockResets += 1;
    }
  };

  BlockEngine.prototype.rotate = function (dir) {
    if (!this.current || this.gameOver) return false;
    var piece = this.current;
    if (piece.type === 'O') return false;
    var to = (piece.rotation + dir + 4) % 4;
    var newMatrix = rotateMatrix(piece.matrix, dir);
    var table = piece.type === 'I' ? KICKS_I : KICKS_JLSTZ;
    var kicks = table[piece.rotation + '>' + to] || [[0, 0]];
    var i, kx, ky;
    for (i = 0; i < kicks.length; i++) {
      kx = kicks[i][0];
      ky = kicks[i][1];
      if (!this.collides(newMatrix, piece.x + kx, piece.y + ky)) {
        piece.matrix = newMatrix;
        piece.rotation = to;
        piece.x += kx;
        piece.y += ky;
        piece.lastAction = 'rotate';
        piece.lastKickIndex = i;
        this.onGroundedAction();
        return true;
      }
    }
    return false;
  };

  BlockEngine.prototype.getGhostCells = function () {
    if (!this.current) return [];
    var y = this.current.y;
    while (!this.collides(this.current.matrix, this.current.x, y + 1)) y += 1;
    return this.cellsFor(this.current.matrix, this.current.x, y);
  };

  BlockEngine.prototype.hold = function () {
    if (!this.current || this.gameOver || this.holdUsed) return false;
    var cur = this.current.type;
    if (!this.holdType) {
      this.holdType = cur;
      this.spawn();
    } else {
      var held = this.holdType;
      this.holdType = cur;
      this.spawn(held);
    }
    this.holdUsed = true;
    return true;
  };

  BlockEngine.prototype.evaluateTSpin = function (piece) {
    if (piece.type !== 'T' || piece.lastAction !== 'rotate') return null;
    // Centre of the 3x3 box.
    var cx = piece.x + 1;
    var cy = piece.y + 1;
    var corners = [
      [cx - 1, cy - 1],
      [cx + 1, cy - 1],
      [cx - 1, cy + 1],
      [cx + 1, cy + 1]
    ];
    var occupied = corners.map(function (corner) {
      var x = corner[0];
      var y = corner[1];
      if (x < 0 || x >= COLS) return true;
      if (y >= TOTAL_ROWS) return true;
      if (y < 0) return false;
      return !!this.board[y][x];
    }, this);
    var filled = 0;
    var i;
    for (i = 0; i < occupied.length; i++) if (occupied[i]) filled += 1;
    if (filled < 3) return null;
    // Front corners follow the protruding mino of the T.
    var front;
    if (piece.rotation === 0) front = [0, 1];
    else if (piece.rotation === 1) front = [1, 3];
    else if (piece.rotation === 2) front = [2, 3];
    else front = [0, 2];
    var frontCount = (occupied[front[0]] ? 1 : 0) + (occupied[front[1]] ? 1 : 0);
    if (frontCount === 2) return 'full';
    // 5th kick (the big 1x2 kick) still counts as a proper T-spin.
    if (piece.lastKickIndex === 4) return 'full';
    return 'mini';
  };

  BlockEngine.prototype.lock = function () {
    if (!this.current) return null;
    var piece = this.current;
    var cells = this.cellsFor(piece.matrix, piece.x, piece.y);
    var i, bx, by;
    var allHidden = true;
    for (i = 0; i < cells.length; i++) {
      bx = cells[i][0];
      by = cells[i][1];
      if (by >= HIDDEN_ROWS) allHidden = false;
      if (by >= 0 && by < TOTAL_ROWS && bx >= 0 && bx < COLS) {
        this.board[by][bx] = piece.type;
      }
    }
    var tspin = this.evaluateTSpin(piece);
    var fullRows = [];
    var y, x, full;
    for (y = 0; y < TOTAL_ROWS; y++) {
      full = true;
      for (x = 0; x < COLS; x++) {
        if (!this.board[y][x]) { full = false; break; }
      }
      if (full) fullRows.push(y);
    }
    var cleared = fullRows.length;
    var remaining = this.board.filter(function (row, idx) {
      return fullRows.indexOf(idx) === -1;
    });
    while (remaining.length < TOTAL_ROWS) remaining.unshift(emptyBoard()[0]);
    this.board = remaining;

    var perfectClear = cleared > 0 && this.board.every(function (row) {
      return row.every(function (cell) { return !cell; });
    });

    var clearKey = null;
    if (tspin) {
      if (cleared === 0) clearKey = 'tspin';
      else if (cleared === 1) clearKey = tspin === 'mini' ? 'tspinMiniSingle' : 'tspinSingle';
      else if (cleared === 2) clearKey = tspin === 'mini' ? 'tspinMiniDouble' : 'tspinDouble';
      else if (cleared === 3) clearKey = 'tspinTriple';
      else clearKey = 'tspinTriple';
    } else if (cleared === 1) clearKey = 'single';
    else if (cleared === 2) clearKey = 'double';
    else if (cleared === 3) clearKey = 'triple';
    else if (cleared === 4) clearKey = 'quad';

    var difficult = cleared > 0 && (cleared === 4 || !!tspin);
    var gained = 0;
    if (clearKey) {
      gained = SCORE_TABLE[clearKey] * this.level;
      if (difficult && this.b2b) gained = Math.floor(gained * 1.5);
    }
    if (cleared > 0) {
      if (this.combo >= 0) this.combo += 1;
      else this.combo = 0;
      if (this.combo >= 1) gained += 50 * this.combo * this.level;
    } else {
      this.combo = -1;
    }
    if (difficult) this.b2b = true;
    else if (cleared > 0) this.b2b = false;
    // A T-spin with no lines keeps the Back-to-Back chain.
    if (tspin && cleared === 0) { /* b2b unchanged */ }
    if (perfectClear) gained += PERFECT_CLEAR_BONUS[cleared] * this.level;

    this.score += gained;
    this.lines += cleared;
    this.level = Math.floor(this.lines / 10) + 1;

    var event = {
      type: piece.type,
      tspin: tspin,
      lines: cleared,
      clearKey: clearKey,
      gained: gained,
      perfectClear: perfectClear,
      combo: this.combo,
      b2b: this.b2b,
      level: this.level,
      // For UI effects only, no gameplay change.
      lockedCells: cells.slice(),
      clearedRows: fullRows.slice()
    };

    this.current = null;
    if (allHidden) {
      this.gameOver = true;
      event.gameOver = true;
      this.lastEvent = event;
      return event;
    }
    // BUGFIX 2026-10-26: hold is once per piece, not once per game.
    // Reset here (on lock), NOT in spawn(), because a hold-spawn must
    // keep holdUsed=true or the player could swap back immediately.
    this.holdUsed = false;
    this.spawn();
    if (this.gameOver) event.gameOver = true;
    this.lastEvent = event;
    return event;
  };

  BlockEngine.prototype.hardDrop = function () {
    if (!this.current || this.gameOver) return null;
    var distance = 0;
    while (this.tryMove(0, 1)) distance += 1;
    this.score += distance * 2;
    return this.lock();
  };

  BlockEngine.prototype.update = function (dtMs, softDropping) {
    if (!this.current || this.gameOver || !this.started) return null;
    if (this.isGrounded()) {
      this.lockTimer += dtMs;
      if (this.lockTimer >= LOCK_DELAY) {
        return this.lock();
      }
      return null;
    }
    this.lockTimer = 0;
    // BUGFIX 2026-10-26: gravityTimer could hold up to ~800ms from normal
    // gravity. Switching the interval to 30ms for soft drop then drained
    // it in one frame (25+ cells), looking exactly like a hard drop.
    // Reset the timer on the soft-drop transition, and cap steps per frame.
    if (softDropping !== this._softDropping) {
      this.gravityTimer = 0;
      this._softDropping = softDropping;
    }
    var interval = softDropping ? 30 : gravityIntervalMs(this.level);
    this.gravityTimer += dtMs;
    var steps = 0;
    while (this.gravityTimer >= interval && steps < 5) {
      steps += 1;
      this.gravityTimer -= interval;
      if (!this.tryMove(0, 1)) {
        this.gravityTimer = 0;
        break;
      }
      if (softDropping) this.score += 1;
      this.lockResets = 0;
      if (this.isGrounded()) break;
    }
    return null;
  };

  BlockEngine.prototype.getNext = function (count) {
    this.refillQueue();
    return this.queue.slice(0, count);
  };

  var api = {
    COLS: COLS,
    VISIBLE_ROWS: VISIBLE_ROWS,
    HIDDEN_ROWS: HIDDEN_ROWS,
    TOTAL_ROWS: TOTAL_ROWS,
    LOCK_DELAY: LOCK_DELAY,
    COLORS: COLORS,
    SHAPES: SHAPES,
    KICKS_JLSTZ: KICKS_JLSTZ,
    KICKS_I: KICKS_I,
    SCORE_TABLE: SCORE_TABLE,
    BlockEngine: BlockEngine,
    rotateMatrix: rotateMatrix,
    gravityIntervalMs: gravityIntervalMs
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.BlockEngineModule = api;
  }
})(typeof window !== 'undefined' ? window : global);
