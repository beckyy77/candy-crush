'use strict';

/* ===== Config ===== */
const ROWS = 8, COLS = 8, TYPES = 6;
const CANDIES = ['🍒', '🍋', '🍇', '🍊', '🍏', '🫐']; // distinct colors = readable board
const MOVES_START = 30;
const POINTS_PER_CANDY = 60;

/* ===== DOM ===== */
const boardEl = document.getElementById('board');
const scoreEl = document.getElementById('score');
const bestEl = document.getElementById('best');
const movesEl = document.getElementById('moves');
const overlayEl = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayText = document.getElementById('overlay-text');
const restartBtn = document.getElementById('restart');

/* ===== State ===== */
let grid = []; // grid[r][c] = { type, el } | null
let score = 0;
let moves = MOVES_START;
let best = Number(localStorage.getItem('cc-best') || 0);
let busy = false;
let selected = null; // [r, c]
let pointer = null;  // { r, c, x, y, dragged }

/* ===== Helpers ===== */
const sleep = ms => new Promise(res => setTimeout(res, ms));
const rnd = n => Math.floor(Math.random() * n);
const key = (r, c) => r * COLS + c;
const posOf = (r, c) => `translate(${c * 100}%, ${r * 100}%)`;

function updateHud() {
  scoreEl.textContent = score;
  movesEl.textContent = moves;
  if (score > best) {
    best = score;
    localStorage.setItem('cc-best', best);
  }
  bestEl.textContent = best;
}

/* ===== Board ===== */
function makeCandy(type, r, c) {
  const el = document.createElement('div');
  el.className = 'candy';
  const inner = document.createElement('span');
  inner.textContent = CANDIES[type];
  el.appendChild(inner);
  el.style.transform = posOf(r, c);
  boardEl.appendChild(el);
  return { type, el };
}

function randType(r, c) {
  // avoid creating an instant match while filling
  for (;;) {
    const t = rnd(TYPES);
    const l1 = grid[r][c - 1], l2 = grid[r][c - 2];
    const u1 = grid[r - 1]?.[c], u2 = grid[r - 2]?.[c];
    if (c >= 2 && l1?.type === t && l2?.type === t) continue;
    if (r >= 2 && u1?.type === t && u2?.type === t) continue;
    return t;
  }
}

function newBoard() {
  boardEl.querySelectorAll('.candy').forEach(el => el.remove());
  grid = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      grid[r][c] = makeCandy(randType(r, c), r, c);
  if (!hasAnyMove()) newBoard(); // rare, just redeal
}

function renderPositions() {
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      if (grid[r][c]) grid[r][c].el.style.transform = posOf(r, c);
}

/* ===== Match detection ===== */
function findMatches() {
  const matched = new Set();

  // horizontal runs
  for (let r = 0; r < ROWS; r++) {
    let run = 1;
    for (let c = 1; c <= COLS; c++) {
      const cur = c < COLS ? grid[r][c]?.type : null;
      const prev = grid[r][c - 1]?.type;
      if (cur !== null && cur === prev) {
        run++;
      } else {
        if (run >= 3 && prev !== null)
          for (let k = c - run; k < c; k++) matched.add(key(r, k));
        run = 1;
      }
    }
  }

  // vertical runs
  for (let c = 0; c < COLS; c++) {
    let run = 1;
    for (let r = 1; r <= ROWS; r++) {
      const cur = r < ROWS ? grid[r][c]?.type : null;
      const prev = grid[r - 1][c]?.type;
      if (cur !== null && cur === prev) {
        run++;
      } else {
        if (run >= 3 && prev !== null)
          for (let k = r - run; k < r; k++) matched.add(key(k, c));
        run = 1;
      }
    }
  }

  return [...matched].map(i => [Math.floor(i / COLS), i % COLS]);
}

/* ===== Moves / swaps ===== */
function swapData(a, b) {
  const tmp = grid[a[0]][a[1]];
  grid[a[0]][a[1]] = grid[b[0]][b[1]];
  grid[b[0]][b[1]] = tmp;
}

async function trySwap(a, b) {
  busy = true;
  clearSelection();

  swapData(a, b);
  renderPositions();
  await sleep(230);

  if (findMatches().length === 0) {
    // invalid move: swap back + shake
    swapData(a, b);
    renderPositions();
    boardEl.classList.add('shake');
    await sleep(320);
    boardEl.classList.remove('shake');
    busy = false;
    return;
  }

  moves--;
  updateHud();
  await resolveCascades();

  busy = false;
  if (moves <= 0) gameOver();
  else ensureMovesExist();
}

async function resolveCascades() {
  let combo = 1;
  for (;;) {
    const matches = findMatches();
    if (matches.length === 0) break;

    score += matches.length * POINTS_PER_CANDY * combo;
    combo++;
    updateHud();

    // pop animation
    const popped = [];
    for (const [r, c] of matches) {
      const cell = grid[r][c];
      if (!cell) continue;
      cell.el.firstChild.classList.add('pop');
      popped.push(cell.el);
      grid[r][c] = null;
    }
    await sleep(290);
    popped.forEach(el => el.remove());

    // gravity: compact each column downward
    for (let c = 0; c < COLS; c++) {
      let write = ROWS - 1;
      for (let r = ROWS - 1; r >= 0; r--) {
        const cell = grid[r][c];
        if (cell) {
          if (r !== write) {
            grid[write][c] = cell;
            grid[r][c] = null;
            cell.el.style.transform = posOf(write, c);
          }
          write--;
        }
      }
      // refill holes from the top (spawn above the board, then drop in)
      const holes = write + 1;
      for (let r = write; r >= 0; r--) {
        grid[r][c] = makeCandy(rnd(TYPES), r - holes, c);
      }
    }

    // let the browser commit spawn positions, then animate to final spots
    await new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)));
    renderPositions();
    await sleep(300);
  }
}

function hasAnyMove() {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      for (const [dr, dc] of [[0, 1], [1, 0]]) {
        const r2 = r + dr, c2 = c + dc;
        if (r2 >= ROWS || c2 >= COLS) continue;
        swapData([r, c], [r2, c2]);
        const ok = findMatches().length > 0;
        swapData([r, c], [r2, c2]);
        if (ok) return true;
      }
    }
  }
  return false;
}

async function ensureMovesExist() {
  if (hasAnyMove()) return;
  busy = true;
  boardEl.classList.add('shake');
  await sleep(400);
  newBoard();
  boardEl.classList.remove('shake');
  busy = false;
}

/* ===== Selection ===== */
function select(cell) {
  clearSelection();
  selected = cell;
  grid[cell[0]][cell[1]]?.el.classList.add('selected');
}

function clearSelection() {
  if (selected) grid[selected[0]][selected[1]]?.el.classList.remove('selected');
  selected = null;
}

/* ===== Input: tap + swipe ===== */
function cellFromPoint(x, y) {
  const rect = boardEl.getBoundingClientRect();
  const c = Math.floor((x - rect.left) / (rect.width / COLS));
  const r = Math.floor((y - rect.top) / (rect.height / ROWS));
  if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return null;
  return [r, c];
}

boardEl.addEventListener('pointerdown', e => {
  if (busy || pointer) return;
  const cell = cellFromPoint(e.clientX, e.clientY);
  if (!cell) return;
  pointer = { r: cell[0], c: cell[1], x: e.clientX, y: e.clientY, dragged: false };
  boardEl.setPointerCapture(e.pointerId);
});

boardEl.addEventListener('pointermove', e => {
  if (!pointer || busy) return;
  const dx = e.clientX - pointer.x;
  const dy = e.clientY - pointer.y;
  const threshold = boardEl.clientWidth / COLS * 0.35;
  if (Math.hypot(dx, dy) < threshold) return;

  const dir = Math.abs(dx) > Math.abs(dy) ? [0, Math.sign(dx)] : [Math.sign(dy), 0];
  const from = [pointer.r, pointer.c];
  const to = [pointer.r + dir[0], pointer.c + dir[1]];
  pointer = null;

  if (to[0] >= 0 && to[0] < ROWS && to[1] >= 0 && to[1] < COLS) trySwap(from, to);
});

boardEl.addEventListener('pointerup', () => {
  if (!pointer) return;
  const cell = [pointer.r, pointer.c];
  const wasDragged = pointer.dragged;
  pointer = null;
  if (wasDragged || busy) return;

  if (!selected) {
    select(cell);
  } else if (selected[0] === cell[0] && selected[1] === cell[1]) {
    clearSelection();
  } else if (Math.abs(selected[0] - cell[0]) + Math.abs(selected[1] - cell[1]) === 1) {
    const from = selected;
    clearSelection();
    trySwap(from, cell);
  } else {
    select(cell);
  }
});

boardEl.addEventListener('pointercancel', () => { pointer = null; });

/* ===== Game over / restart ===== */
function gameOver() {
  overlayTitle.textContent = 'Out of moves! 🍬';
  overlayText.textContent = `Final score: ${score} · Best: ${best}`;
  overlayEl.classList.remove('hidden');
}

restartBtn.addEventListener('click', () => {
  score = 0;
  moves = MOVES_START;
  overlayEl.classList.add('hidden');
  newBoard();
  updateHud();
});

/* ===== Boot ===== */
updateHud();
newBoard();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
