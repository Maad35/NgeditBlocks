/* UI for the CEP block stacking panel. Vanilla JS, canvas rendering, WebAudio soft synth.
   Keyboard focus note: click the panel once so After Effects sends keys here,
   not to the timeline. */
(function () {
  'use strict';

  var M = window.BlockEngineModule;
  var engine = new M.BlockEngine();

  var boardCanvas = document.getElementById('board');
  var boardCtx = boardCanvas.getContext('2d');
  var holdCanvas = document.getElementById('hold');
  var holdCtx = holdCanvas.getContext('2d');
  var nextCanvas = document.getElementById('next');
  var nextCtx = nextCanvas.getContext('2d');

  var scoreEl = document.getElementById('score');
  var linesEl = document.getElementById('lines');
  var levelEl = document.getElementById('level');
  var bestEl = document.getElementById('best');
  var timeEl = document.getElementById('time');
  var comboEl = document.getElementById('combo');
  var b2bEl = document.getElementById('b2b');
  var messageEl = document.getElementById('message');
  var overlayEl = document.getElementById('overlay');
  var overlayTitle = document.getElementById('overlayTitle');
  var overlayText = document.getElementById('overlayText');
  var startBtn = document.getElementById('startBtn');
  var pauseBtn = document.getElementById('pauseBtn');
  var restartBtn = document.getElementById('restartBtn');
  var soundBtn = document.getElementById('soundBtn');
  var bgmBtn = document.getElementById('bgmBtn');
  var helpBtn = document.getElementById('helpBtn');
  var dasInput = document.getElementById('dasInput');
  var arrInput = document.getElementById('arrInput');

  var CELL = 30;
  var running = false;
  var paused = false;
  var soundOn = true;
  var bgmOn = false;
  var dasMs = 133;
  var arrMs = 33;
  var best = 0;
  var elapsedMs = 0;
  var lastFrame = 0;

  try {
    best = parseInt(window.localStorage.getItem('ngeditblocks-best') || '0', 10) || 0;
    var saved = JSON.parse(window.localStorage.getItem('ngeditblocks-settings') || '{}');
    if (saved.das) dasMs = saved.das;
    if (saved.arr) arrMs = saved.arr;
    if (typeof saved.sound === 'boolean') soundOn = saved.sound;
    if (typeof saved.bgm === 'boolean') bgmOn = saved.bgm;
  } catch (e) { /* localStorage may be unavailable in some CEP builds */ }

  dasInput.value = dasMs;
  arrInput.value = arrMs;
  updateSoundButton();
  updateBgmButton();

  // ---- Sound, WebAudio only, no audio files ----
  var audioCtx = null;
  function ensureAudio() {
    if (!audioCtx) {
      try {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (AC) audioCtx = new AC();
      } catch (e) { audioCtx = null; }
    }
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  }
  function beep(freq, dur, type, vol, delay) {
    if (!soundOn || !audioCtx) return;
    try {
      var t = audioCtx.currentTime + (delay || 0);
      var osc = audioCtx.createOscillator();
      var gain = audioCtx.createGain();
      osc.type = type || 'sine';
      osc.frequency.setValueAtTime(freq, t);
      // Tema Lembut: attack 5 ms, bukan 0 ms, supaya tidak ada bunyi klik
      // robotik di awal tiap nada.
      gain.gain.setValueAtTime(0.001, t);
      gain.gain.linearRampToValueAtTime(vol || 0.05, t + 0.005);
      gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(t);
      osc.stop(t + dur + 0.02);
    } catch (e) { /* ignore */ }
  }
  // Sweep putar (v1.0.7): nada meluncur, bukan beep datar, supaya terasa
  // seperti balok berputar. CW naik, CCW turun, jadi arahnya bisa dibedakan.
  function sweepBeep(freqFrom, freqTo, dur, type, vol) {
    if (!soundOn || !audioCtx) return;
    try {
      var t = audioCtx.currentTime;
      var osc = audioCtx.createOscillator();
      var gain = audioCtx.createGain();
      osc.type = type || 'triangle';
      osc.frequency.setValueAtTime(freqFrom, t);
      osc.frequency.exponentialRampToValueAtTime(freqTo, t + dur);
      gain.gain.setValueAtTime(0.001, t);
      gain.gain.linearRampToValueAtTime(vol || 0.04, t + 0.005);
      gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(t);
      osc.stop(t + dur + 0.02);
    } catch (e) { /* ignore */ }
  }
  // Tema Lembut (v1.0.8): tidak ada lagi gelombang square. Kunci biasa jadi
  // debuk lembut (sweep sine turun), clear 4 baris jadi chime sine, dan
  // game over jadi nada sine turun yang pelan.
  function soundForEvent(ev) {
    if (!ev) return;
    if (ev.gameOver) { beep(280, 0.25, 'sine', 0.07, 0); beep(190, 0.25, 'sine', 0.07, 0.2); beep(120, 0.45, 'sine', 0.07, 0.4); return; }
    if (ev.clearKey === 'quad') { beep(523, 0.12, 'sine', 0.07, 0); beep(659, 0.12, 'sine', 0.07, 0.1); beep(784, 0.18, 'sine', 0.07, 0.2); return; }
    if (ev.tspin) { beep(440, 0.12, 'sine', 0.07, 0); beep(660, 0.18, 'sine', 0.07, 0.1); return; }
    if (ev.lines > 0) { beep(523, 0.12, 'sine', 0.06, 0); beep(784, 0.12, 'sine', 0.06, 0.08); return; }
    sweepBeep(170, 90, 0.09, 'sine', 0.06);
  }

  // ---- BGM klasik synth (v1.1.0): Korobeiniki, melodi rakyat Rusia domain
  // publik, disintesis di sini dengan WebAudio, bukan rekaman. Loop hanya
  // saat game jalan dan tidak pause, dan toggle-nya terpisah dari SFX.
  // Default OFF, jadi panel tidak langsung bunyi saat dibuka.
  var BGM_BEAT = 0.30;
  var BGM_NOTES = [
    [659.25, 1], [493.88, 0.5], [523.25, 0.5], [587.33, 1], [523.25, 0.5], [493.88, 0.5],
    [440, 1], [440, 0.5], [523.25, 0.5], [659.25, 1], [587.33, 0.5], [523.25, 0.5],
    [493.88, 1.5], [523.25, 0.5], [587.33, 1], [659.25, 1],
    [523.25, 1], [440, 1], [440, 0.5], [440, 1], [493.88, 0.5], [523.25, 0.5],
    [587.33, 1.5], [698.46, 0.5], [880, 1], [783.99, 0.5], [698.46, 0.5],
    [659.25, 1.5], [523.25, 0.5], [659.25, 1], [587.33, 0.5], [523.25, 0.5],
    [493.88, 1], [493.88, 0.5], [523.25, 0.5], [587.33, 1], [659.25, 1],
    [523.25, 1], [440, 1], [440, 1], [0, 1]
  ];
  var bgmTimer = null;
  var bgmNoteIndex = 0;
  var bgmNextTime = 0;
  function playBgmNote(freq, startTime, dur) {
    if (!freq || !audioCtx) return;
    try {
      var osc = audioCtx.createOscillator();
      var gain = audioCtx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, startTime);
      gain.gain.setValueAtTime(0.001, startTime);
      gain.gain.linearRampToValueAtTime(0.035, startTime + 0.005);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + dur * 0.92);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(startTime);
      osc.stop(startTime + dur);
    } catch (e) { /* ignore */ }
  }
  function scheduleBgm() {
    if (!audioCtx) return;
    try {
      while (bgmNextTime < audioCtx.currentTime + 0.35) {
        var note = BGM_NOTES[bgmNoteIndex % BGM_NOTES.length];
        playBgmNote(note[0], bgmNextTime, note[1] * BGM_BEAT);
        bgmNextTime += note[1] * BGM_BEAT;
        bgmNoteIndex += 1;
      }
    } catch (e) { /* ignore */ }
  }
  function startBgm() {
    if (bgmTimer || !audioCtx) return;
    bgmNextTime = audioCtx.currentTime + 0.1;
    bgmTimer = setInterval(scheduleBgm, 100);
  }
  function stopBgm() {
    if (bgmTimer) { clearInterval(bgmTimer); bgmTimer = null; }
  }
  function resetBgm() {
    stopBgm();
    bgmNoteIndex = 0;
  }
  function updateBgm() {
    if (bgmOn && running && !paused && !engine.gameOver) startBgm();
    else stopBgm();
  }
  function updateBgmButton() {
    if (bgmBtn) bgmBtn.textContent = bgmOn ? 'BGM: ON' : 'BGM: OFF';
  }

  // ---- Adaptive sizing: no scrollbars, board shrinks with the panel ----
  var mainEl = document.querySelector('main');
  var boardWrap = document.querySelector('.board-wrap');
  function resizeBoard() {
    if (!mainEl) return;
    var mainW = mainEl.clientWidth || 560;
    var mainH = mainEl.clientHeight || 600;
    // Side panels shrink on narrow docks instead of pushing the board out.
    var sideW = Math.max(64, Math.min(108, Math.floor((mainW - 20) / 5)));
    document.documentElement.style.setProperty('--side-w', sideW + 'px');
    var boardMaxW = Math.max(80, mainW - 2 * sideW - 20);
    var boardMaxH = Math.max(100, mainH - 30); // room for the message line
    var cell = Math.floor(Math.min(boardMaxW / 10, boardMaxH / 20, 30));
    cell = Math.max(8, cell);
    boardCanvas.style.width = (cell * 10) + 'px';
    boardCanvas.style.height = (cell * 20) + 'px';
    if (boardWrap) boardWrap.style.width = (cell * 10) + 'px';
  }
  window.addEventListener('resize', resizeBoard);
  if (typeof ResizeObserver !== 'undefined') {
    try {
      new ResizeObserver(resizeBoard).observe(document.getElementById('app'));
    } catch (e) { /* window resize is enough */ }
  }

  // ---- Drawing ----
  function drawCell(ctx, x, y, size, color, alpha) {
    ctx.save();
    ctx.globalAlpha = (typeof alpha === 'number') ? alpha : 1;
    ctx.fillStyle = color;
    ctx.fillRect(x * size + 1, y * size + 1, size - 2, size - 2);
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    ctx.fillRect(x * size + 1, y * size + 1, size - 2, 3);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(x * size + 1, y * size + size - 4, size - 2, 3);
    ctx.restore();
  }

  // ---- Effects: canvas only, short, capped, no external assets ----
  // Tier 1: clear flash, lock flash, hard-drop impact, floating text, score pop.
  // Tier 2: T-spin glow, level banner, perfect-clear burst, danger pulse, game-over fade.
  var particles = [];
  var floatingTexts = [];
  var flashRows = [];
  var flashUntil = 0;
  var flashColor = '#ffffff';
  var lockFlashCells = [];
  var lockFlashUntil = 0;
  var tspinGlowUntil = 0;
  var prevLevel = 1;
  var PARTICLE_COLORS = ['#00e8e8', '#f8d800', '#b000f0', '#00e800', '#f00000', '#2050f0', '#f0a000'];

  function spawnParticles(cx, cy, colors, count, speed) {
    var i;
    for (i = 0; i < count && particles.length < 60; i++) {
      var angle = Math.random() * Math.PI * 2;
      var v = speed * (0.4 + Math.random() * 0.8);
      particles.push({
        x: cx + (Math.random() - 0.5) * 20,
        y: cy + (Math.random() - 0.5) * 10,
        vx: Math.cos(angle) * v,
        vy: Math.sin(angle) * v - 40,
        life: 0,
        maxLife: 350 + Math.random() * 250,
        size: 3 + Math.random() * 4,
        color: colors[i % colors.length]
      });
    }
  }
  function addFloatingText(text, color, size, y) {
    floatingTexts.push({
      text: text, color: color || '#ffffff', size: size || 20,
      x: boardCanvas.width / 2, y: (typeof y === 'number') ? y : 300,
      life: 0, maxLife: 950
    });
    if (floatingTexts.length > 4) floatingTexts.shift();
  }
  function updateEffects(dt) {
    var i;
    for (i = particles.length - 1; i >= 0; i--) {
      var pt = particles[i];
      pt.life += dt;
      pt.x += pt.vx * dt / 1000;
      pt.y += pt.vy * dt / 1000;
      pt.vy += 180 * dt / 1000;
      if (pt.life >= pt.maxLife) particles.splice(i, 1);
    }
    for (i = floatingTexts.length - 1; i >= 0; i--) {
      var ft = floatingTexts[i];
      ft.life += dt;
      ft.y -= dt * 0.045;
      if (ft.life >= ft.maxLife) floatingTexts.splice(i, 1);
    }
  }
  function drawEffects(now) {
    var ctx = boardCtx;
    // Clear flash on the rows that were cleared (drawn over the shifted board,
    // which is why it stays short: 180ms, fading out).
    if (flashRows.length && now < flashUntil) {
      var fade = (flashUntil - now) / 180;
      ctx.save();
      ctx.globalAlpha = 0.75 * fade;
      ctx.fillStyle = flashColor;
      flashRows.forEach(function (row) {
        var vy = row - M.HIDDEN_ROWS;
        if (vy >= 0 && vy < M.VISIBLE_ROWS) ctx.fillRect(0, vy * CELL, boardCanvas.width, CELL);
      });
      ctx.restore();
    }
    // Lock flash on the just-locked cells.
    if (lockFlashCells.length && now < lockFlashUntil) {
      var lf = (lockFlashUntil - now) / 120;
      ctx.save();
      ctx.globalAlpha = 0.55 * lf;
      ctx.fillStyle = '#ffffff';
      lockFlashCells.forEach(function (c) {
        var vy = c[1] - M.HIDDEN_ROWS;
        if (vy >= 0 && vy < M.VISIBLE_ROWS) ctx.fillRect(c[0] * CELL + 1, vy * CELL + 1, CELL - 2, CELL - 2);
      });
      ctx.restore();
    }
    // T-spin glow over the whole board, purple, fading.
    if (now < tspinGlowUntil) {
      var gf = (tspinGlowUntil - now) / 400;
      ctx.save();
      ctx.globalAlpha = 0.22 * gf;
      ctx.fillStyle = '#b000f0';
      ctx.fillRect(0, 0, boardCanvas.width, boardCanvas.height);
      ctx.restore();
    }
    // Danger pulse: stack in the top 5 visible rows, slow red border only.
    if (running && !paused && !engine.gameOver) {
      var top = M.TOTAL_ROWS;
      var yy, xx;
      for (yy = 0; yy < M.TOTAL_ROWS && top === M.TOTAL_ROWS; yy++) {
        for (xx = 0; xx < M.COLS; xx++) {
          if (engine.board[yy][xx]) { top = yy; break; }
        }
      }
      if (top - M.HIDDEN_ROWS <= 4) {
        var pulse = 0.25 + 0.25 * Math.sin(now / 300);
        ctx.save();
        ctx.globalAlpha = pulse;
        ctx.strokeStyle = '#f00000';
        ctx.lineWidth = 3;
        ctx.strokeRect(2, 2, boardCanvas.width - 4, boardCanvas.height - 4);
        ctx.restore();
      }
    }
    // Game-over fade over the board (the overlay div sits on top of this).
    if (engine.gameOver) {
      ctx.save();
      ctx.globalAlpha = 0.45;
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, boardCanvas.width, boardCanvas.height);
      ctx.restore();
    }
    // Particles.
    particles.forEach(function (pt) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - pt.life / pt.maxLife);
      ctx.fillStyle = pt.color;
      ctx.fillRect(pt.x, pt.y, pt.size, pt.size);
      ctx.restore();
    });
    // Floating texts.
    floatingTexts.forEach(function (ft) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - ft.life / ft.maxLife);
      ctx.font = 'bold ' + ft.size + 'px Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.lineWidth = 4;
      ctx.strokeStyle = '#000000';
      ctx.strokeText(ft.text, ft.x, ft.y);
      ctx.fillStyle = ft.color;
      ctx.fillText(ft.text, ft.x, ft.y);
      ctx.restore();
    });
  }

  function drawBoard() {
    var ctx = boardCtx;
    ctx.clearRect(0, 0, boardCanvas.width, boardCanvas.height);
    ctx.fillStyle = '#0a0a14';
    ctx.fillRect(0, 0, boardCanvas.width, boardCanvas.height);
    ctx.strokeStyle = '#1c1c2e';
    ctx.lineWidth = 1;
    var x, y;
    for (x = 0; x <= M.COLS; x++) {
      ctx.beginPath(); ctx.moveTo(x * CELL + 0.5, 0); ctx.lineTo(x * CELL + 0.5, boardCanvas.height); ctx.stroke();
    }
    for (y = 0; y <= M.VISIBLE_ROWS; y++) {
      ctx.beginPath(); ctx.moveTo(0, y * CELL + 0.5); ctx.lineTo(boardCanvas.width, y * CELL + 0.5); ctx.stroke();
    }
    // Locked cells, visible rows only.
    for (y = M.HIDDEN_ROWS; y < M.TOTAL_ROWS; y++) {
      for (x = 0; x < M.COLS; x++) {
        var cell = engine.board[y][x];
        if (cell) drawCell(ctx, x, y - M.HIDDEN_ROWS, CELL, M.COLORS[cell], 1);
      }
    }
    if (engine.current && running && !paused) {
      var ghost = engine.getGhostCells();
      var activeKey = {};
      engine.cellsFor(engine.current.matrix, engine.current.x, engine.current.y).forEach(function (c) {
        activeKey[c[0] + ',' + c[1]] = true;
      });
      ghost.forEach(function (c) {
        if (activeKey[c[0] + ',' + c[1]]) return;
        var gy = c[1] - M.HIDDEN_ROWS;
        if (gy < 0) return;
        ctx.save();
        ctx.globalAlpha = 0.22;
        ctx.fillStyle = M.COLORS[engine.current.type];
        ctx.fillRect(c[0] * CELL + 1, gy * CELL + 1, CELL - 2, CELL - 2);
        ctx.globalAlpha = 0.55;
        ctx.strokeStyle = M.COLORS[engine.current.type];
        ctx.strokeRect(c[0] * CELL + 1.5, gy * CELL + 1.5, CELL - 3, CELL - 3);
        ctx.restore();
      });
      engine.cellsFor(engine.current.matrix, engine.current.x, engine.current.y).forEach(function (c) {
        var ay = c[1] - M.HIDDEN_ROWS;
        if (ay < 0) return;
        drawCell(ctx, c[0], ay, CELL, M.COLORS[engine.current.type], 1);
      });
    }
    drawEffects(performance.now());
  }

  function drawPreview(ctx, canvas, type) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!type) return;
    var matrix = M.SHAPES[type];
    var size = 18;
    var w = matrix[0].length * size;
    var h = matrix.length * size;
    var ox = (canvas.width - w) / 2;
    var oy = (canvas.height - h) / 2;
    var r, c;
    for (r = 0; r < matrix.length; r++) {
      for (c = 0; c < matrix[r].length; c++) {
        if (!matrix[r][c]) continue;
        ctx.fillStyle = M.COLORS[type];
        ctx.fillRect(ox + c * size + 1, oy + r * size + 1, size - 2, size - 2);
      }
    }
  }

  function drawSide() {
    drawPreview(holdCtx, holdCanvas, engine.holdType);
    holdCanvas.style.opacity = engine.holdUsed ? '0.35' : '1';
    nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
    var next = engine.getNext(5);
    var i;
    for (i = 0; i < next.length; i++) {
      var sub = document.createElement('canvas');
      // Draw into slices of the next canvas by using a temp canvas.
      var tmp = nextCanvas;
      var matrix = M.SHAPES[next[i]];
      var size = 16;
      var w = matrix[0].length * size;
      var h = matrix.length * size;
      var ox = (tmp.width - w) / 2;
      var oy = i * 56 + (56 - h) / 2;
      var r, c;
      for (r = 0; r < matrix.length; r++) {
        for (c = 0; c < matrix[r].length; c++) {
          if (!matrix[r][c]) continue;
          nextCtx.fillStyle = M.COLORS[next[i]];
          nextCtx.fillRect(ox + c * size + 1, oy + r * size + 1, size - 2, size - 2);
        }
      }
      sub = null;
    }
  }

  function clearNameFor(ev) {
    if (!ev) return '';
    if (ev.perfectClear) return 'PERFECT CLEAR!';
    if (ev.tspin) {
      var label = ev.tspin === 'mini' ? 'MINI T-SPIN' : 'T-SPIN';
      if (ev.lines === 0) return label;
      if (ev.lines === 1) return label + ' SINGLE';
      if (ev.lines === 2) return label + ' DOUBLE';
      if (ev.lines === 3) return label + ' TRIPLE';
    }
    if (ev.lines === 1) return 'SINGLE';
    if (ev.lines === 2) return 'DOUBLE';
    if (ev.lines === 3) return 'TRIPLE';
    if (ev.lines === 4) return 'QUAD!';
    return '';
  }

  function updateStats() {
    scoreEl.textContent = engine.score;
    linesEl.textContent = engine.lines;
    levelEl.textContent = engine.level;
    bestEl.textContent = best;
    comboEl.textContent = engine.combo >= 1 ? ('Combo x' + engine.combo) : '-';
    b2bEl.textContent = engine.b2b ? 'B2B AKTIF' : '-';
    b2bEl.className = engine.b2b ? 'badge on' : 'badge';
    var totalSec = Math.floor(elapsedMs / 1000);
    var mm = ('0' + Math.floor(totalSec / 60)).slice(-2);
    var ss = ('0' + (totalSec % 60)).slice(-2);
    timeEl.textContent = mm + ':' + ss;
  }

  function showOverlay(title, text) {
    overlayTitle.textContent = title;
    overlayText.textContent = text;
    overlayEl.classList.remove('hidden');
  }
  function hideOverlay() {
    overlayEl.classList.add('hidden');
  }

  // Controls live on the start screen and behind the ? button, not in the
  // footer, so the footer stays two short lines and the board keeps its room.
  var CONTROLS_TEXT = '← → / A D: gerak\n↓ / S: soft drop\n↑ / X: putar kanan\nZ: putar kiri\nSpasi: hard drop\nC / Shift: hold\nP: pause\nR: restart';
  var INITIAL_TEXT = 'Tekan Start, Spasi, atau Enter untuk mulai.\n' + CONTROLS_TEXT;
  var helpShowing = false;
  var helpPausedGame = false;
  function showHelp() {
    helpShowing = true;
    if (running && !paused) {
      paused = true;
      helpPausedGame = true;
      updateBgm();
    }
    showOverlay('KONTROL', CONTROLS_TEXT + '\nKlik ? lagi untuk kembali.');
  }
  function hideHelp() {
    var wasPausedByHelp = helpPausedGame;
    helpShowing = false;
    helpPausedGame = false;
    if (wasPausedByHelp) {
      paused = false;
      updateBgm();
    }
    hideOverlay();
    if (!running) showOverlay('Ngedit Blocks', INITIAL_TEXT);
    else if (paused) showOverlay('PAUSED', 'Tekan P atau tombol Pause lagi untuk lanjut.');
  }

  function handleLockEvent(ev, isHardDrop) {
    if (!ev) return;
    var name = clearNameFor(ev);
    if (name) messageEl.textContent = name + (ev.gained ? ('  +' + ev.gained) : '');
    soundForEvent(ev);
    // Effects, all short and capped.
    var now = performance.now();
    if (ev.lockedCells) {
      lockFlashCells = ev.lockedCells.slice();
      lockFlashUntil = now + 120;
    }
    if (ev.lines > 0 && ev.clearedRows) {
      flashRows = ev.clearedRows.slice();
      flashColor = ev.clearKey === 'quad' ? '#ffd166' : '#ffffff';
      flashUntil = now + 180;
      var clearY = 300;
      if (ev.clearedRows.length) {
        var sum = 0, ri;
        for (ri = 0; ri < ev.clearedRows.length; ri++) sum += ev.clearedRows[ri];
        clearY = (sum / ev.clearedRows.length - M.HIDDEN_ROWS) * CELL + CELL / 2;
      }
      spawnParticles(150, clearY, PARTICLE_COLORS, Math.min(8 * ev.lines, 32), 120);
    }
    if (isHardDrop && ev.lockedCells && ev.lockedCells.length) {
      // BUGFIX 2026-10-26: v1.0.5 hardcoded impact x=150 (tengah papan).
      // Sekarang pakai tengah balok yang terkunci: rata-rata x selnya.
      var maxY = -1, sumX = 0, ci;
      for (ci = 0; ci < ev.lockedCells.length; ci++) {
        if (ev.lockedCells[ci][1] > maxY) maxY = ev.lockedCells[ci][1];
        sumX += ev.lockedCells[ci][0];
      }
      var impactX = (sumX / ev.lockedCells.length) * CELL + CELL / 2;
      var impactY = (maxY - M.HIDDEN_ROWS + 1) * CELL;
      spawnParticles(impactX, impactY, ['#ffffff', '#ffd166'], 12, 90);
    }
    if (ev.tspin) {
      tspinGlowUntil = now + 400;
      spawnParticles(150, 300, ['#b000f0', '#e0aaff'], 16, 100);
    }
    if (ev.perfectClear) {
      spawnParticles(150, 300, ['#ffd166', '#fff3b0', '#ffffff'], 40, 160);
      addFloatingText('PERFECT CLEAR!', '#ffd166', 24, 260);
    } else if (name) {
      var textColor = ev.tspin ? '#e0aaff' : (ev.clearKey === 'quad' ? '#ffd166' : '#ffffff');
      addFloatingText(name + (ev.gained ? ('  +' + ev.gained) : ''), textColor, ev.clearKey === 'quad' ? 24 : 20, 300);
    }
    if (ev.level && ev.level > prevLevel) {
      addFloatingText('LEVEL ' + ev.level, '#ffd166', 28, 240);
    }
    if (ev.level) prevLevel = ev.level;
    if (ev.gained) {
      scoreEl.style.transform = 'scale(1.25)';
      setTimeout(function () { scoreEl.style.transform = ''; }, 250);
    }
    if (engine.score > best) {
      best = engine.score;
      try { window.localStorage.setItem('ngeditblocks-best', String(best)); } catch (e) {}
    }
    if (ev.gameOver || engine.gameOver) {
      running = false;
      updateBgm();
      showOverlay('GAME OVER', 'Skor ' + engine.score + '  |  ' + engine.lines + ' baris  |  Tekan R atau Restart untuk main lagi.');
    }
  }

  // ---- Game control ----
  function startGame() {
    helpShowing = false;
    helpPausedGame = false;
    ensureAudio();
    particles = [];
    floatingTexts = [];
    flashRows = [];
    lockFlashCells = [];
    tspinGlowUntil = 0;
    prevLevel = 1;
    engine.reset();
    elapsedMs = 0;
    running = true;
    paused = false;
    messageEl.textContent = '';
    hideOverlay();
    updateStats();
    drawBoard();
    drawSide();
    lastFrame = performance.now();
    resetBgm();
    updateBgm();
  }

  function togglePause() {
    if (!running) return;
    helpShowing = false;
    helpPausedGame = false;
    paused = !paused;
    if (paused) showOverlay('PAUSED', 'Tekan P atau tombol Pause lagi untuk lanjut.');
    else hideOverlay();
    lastFrame = performance.now();
    updateBgm();
  }

  function updateSoundButton() {
    soundBtn.textContent = soundOn ? 'SFX: ON' : 'SFX: OFF';
  }

  function saveSettings() {
    try {
      window.localStorage.setItem('ngeditblocks-settings', JSON.stringify({ das: dasMs, arr: arrMs, sound: soundOn, bgm: bgmOn }));
    } catch (e) {}
  }

  startBtn.addEventListener('click', function () {
    if (!running) startGame();
    else if (paused) togglePause();
    boardCanvas.focus();
  });
  pauseBtn.addEventListener('click', function () { togglePause(); boardCanvas.focus(); });
  if (helpBtn) helpBtn.addEventListener('click', function () {
    if (helpShowing) hideHelp(); else showHelp();
    boardCanvas.focus();
  });
  restartBtn.addEventListener('click', function () { startGame(); boardCanvas.focus(); });
  soundBtn.addEventListener('click', function () {
    ensureAudio();
    soundOn = !soundOn;
    updateSoundButton();
    saveSettings();
    boardCanvas.focus();
  });
  if (bgmBtn) bgmBtn.addEventListener('click', function () {
    ensureAudio();
    bgmOn = !bgmOn;
    updateBgmButton();
    saveSettings();
    updateBgm();
    boardCanvas.focus();
  });
  dasInput.addEventListener('change', function () {
    dasMs = Math.max(0, Math.min(500, parseInt(dasInput.value, 10) || 133));
    dasInput.value = dasMs;
    saveSettings();
    boardCanvas.focus();
  });
  arrInput.addEventListener('change', function () {
    arrMs = Math.max(0, Math.min(200, parseInt(arrInput.value, 10) || 33));
    arrInput.value = arrMs;
    saveSettings();
    boardCanvas.focus();
  });

  // ---- Keyboard, with DAS / ARR ----
  var keysDown = {};
  var repeatDir = 0;
  var repeatDirKey = null;
  var dasElapsed = 0;
  var arrElapsed = 0;

  function setRepeat(dir, key) {
    repeatDir = dir;
    repeatDirKey = key;
    dasElapsed = 0;
    arrElapsed = 0;
  }

  function onDirectionDown(dir, key) {
    if (keysDown[key]) return;
    keysDown[key] = true;
    if (running && !paused && !engine.gameOver) {
      engine.move(dir);
      beep(200, 0.04, 'sine', 0.025, 0);
    }
    setRepeat(dir, key);
  }

  function onDirectionUp(key) {
    delete keysDown[key];
    if (repeatDirKey === key) {
      // Fall back to the other direction if it is still held.
      var otherKey = null;
      var otherDir = 0;
      if (keysDown['ArrowLeft'] || keysDown['KeyA']) { otherKey = keysDown['ArrowLeft'] ? 'ArrowLeft' : 'KeyA'; otherDir = -1; }
      if (keysDown['ArrowRight'] || keysDown['KeyD']) { otherKey = keysDown['ArrowRight'] ? 'ArrowRight' : 'KeyD'; otherDir = 1; }
      if (otherKey) {
        setRepeat(otherDir, otherKey);
        if (running && !paused && !engine.gameOver) engine.move(otherDir);
      } else {
        repeatDir = 0;
        repeatDirKey = null;
      }
    }
  }

  var GAME_KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowDown', 'ArrowUp', 'Space',
    'KeyA', 'KeyD', 'KeyS', 'KeyW', 'KeyX', 'KeyZ', 'KeyC', 'KeyP', 'KeyR',
    'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'Enter'];
  window.addEventListener('keydown', function (e) {
    var code = e.code;
    // Let DAS/ARR number inputs be edited normally.
    if (e.target && e.target.tagName === 'INPUT') return;
    if (GAME_KEYS.indexOf(code) !== -1) {
      e.preventDefault();
      e.stopPropagation();
      // Keep focus inside the panel so AE never gets the key.
      if (document.activeElement && document.activeElement.tagName === 'BUTTON') {
        boardCanvas.focus();
      }
    }
    if (e.repeat) {
      if (code === 'ArrowDown' || code === 'KeyS') keysDown['soft'] = true;
      return;
    }
    ensureAudio();
    switch (code) {
      case 'ArrowLeft':
      case 'KeyA':
        onDirectionDown(-1, code);
        break;
      case 'ArrowRight':
      case 'KeyD':
        onDirectionDown(1, code);
        break;
      case 'ArrowDown':
      case 'KeyS':
        keysDown['soft'] = true;
        break;
      case 'ArrowUp':
      case 'KeyX':
      case 'KeyW':
        if (running && !paused && engine.rotate(1)) sweepBeep(360, 440, 0.05, 'sine', 0.035);
        break;
      case 'KeyZ':
      case 'ControlLeft':
      case 'ControlRight':
        if (running && !paused && engine.rotate(-1)) sweepBeep(440, 360, 0.05, 'sine', 0.035);
        break;
      case 'Space':
        if (running && !paused) {
          var ev = engine.hardDrop();
          handleLockEvent(ev, true);
          updateStats();
        } else if (!running) {
          startGame();
        }
        break;
      case 'KeyC':
      case 'ShiftLeft':
      case 'ShiftRight':
        if (running && !paused && engine.hold()) beep(520, 0.08, 'sine', 0.04, 0);
        break;
      case 'KeyP':
        togglePause();
        break;
      case 'KeyR':
        startGame();
        break;
      case 'Enter':
        if (!running) startGame();
        else if (paused) togglePause();
        break;
      default:
        break;
    }
    drawBoard();
    drawSide();
  });

  window.addEventListener('keyup', function (e) {
    var code = e.code;
    if (code === 'ArrowLeft' || code === 'KeyA' || code === 'ArrowRight' || code === 'KeyD') {
      onDirectionUp(code);
    }
    if (code === 'ArrowDown' || code === 'KeyS') delete keysDown['soft'];
  });

  window.addEventListener('blur', function () {
    keysDown = {};
    repeatDir = 0;
    repeatDirKey = null;
  });

  // Clicking the board area also gives the panel keyboard focus in CEP.
  boardCanvas.addEventListener('mousedown', function () {
    boardCanvas.focus();
  });

  // ---- Main loop ----
  function frame(now) {
    var dt = Math.min(100, now - (lastFrame || now));
    lastFrame = now;
    if (running && !paused && !engine.gameOver) {
      elapsedMs += dt;
      // DAS / ARR repeat for held left/right.
      if (repeatDir !== 0) {
        dasElapsed += dt;
        if (dasElapsed >= dasMs) {
          arrElapsed += dt;
          while (arrElapsed >= Math.max(1, arrMs)) {
            arrElapsed -= Math.max(1, arrMs);
            engine.move(repeatDir);
          }
        }
      }
      var soft = !!keysDown['soft'];
      updateEffects(dt);
      var ev = engine.update(dt, soft);
      if (ev) handleLockEvent(ev);
      updateStats();
      drawBoard();
      drawSide();
    }
    requestAnimationFrame(frame);
  }

  // Initial paint, game starts on Start / Space / Enter.
  resizeBoard();
  engine.reset();
  running = false;
  updateStats();
  drawBoard();
  drawSide();
  showOverlay('Ngedit Blocks', INITIAL_TEXT);
  requestAnimationFrame(frame);
})();
