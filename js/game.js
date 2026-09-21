'use strict';

/* ============================================================
   Dolly Crush Saga — match-3 engine with special candies
   Specials: 'H' striped row, 'V' striped column, 'W' wrapped
   3x3, 'CB' color bomb (type -1, matches nothing)
   ============================================================ */

const ROWS = 8, COLS = 8, TYPES = 6;
const CANDIES = ['🍒', '🍋', '🍇', '🍊', '🍏', '🫐'];
const POINTS_PER_CANDY = 60;

/* ===== game-screen DOM ===== */
const boardEl = document.getElementById('board');
const jellyEl = document.getElementById('jelly-layer');
const fxLayer = document.getElementById('fx-layer');
const hudScore = document.getElementById('hud-score');
const hudMoves = document.getElementById('hud-moves');
const levelLabel = document.getElementById('level-label');
const objFill = document.getElementById('obj-fill');
const objText = document.getElementById('obj-text');
const backBtn = document.getElementById('back-btn');
const overlayEl = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayText = document.getElementById('overlay-text');
const overlayStars = document.getElementById('overlay-stars');
const nextBtn = document.getElementById('next-btn');
const retryBtn = document.getElementById('retry-btn');
const mapBtn = document.getElementById('overlay-map-btn');
const boosterHammer = document.getElementById('booster-hammer');
const boosterMoves = document.getElementById('booster-moves');
const boosterShuffle = document.getElementById('booster-shuffle');

/* ===== state ===== */
let grid = [];            // grid[r][c] = { type, special, el } | null
let jelly = [];           // jelly[r][c] = layers left
let jellyEls = [];        // jellyEls[r][c] = overlay div | null
let jellyLeft = 0;
let level = null;         // Levels.config(n)
let score = 0;
let movesLeft = 0;
let busy = false;
let levelEnded = false;
let hammerMode = false;
let selected = null;
let pointer = null;
let lastSwapCells = null;
let audioCtx = null;

/* ===== helpers ===== */
const sleep = ms => new Promise(res => setTimeout(res, ms));
const rnd = n => Math.floor(Math.random() * n);
const key = (r, c) => r * COLS + c;
const unkey = k => [Math.floor(k / COLS), k % COLS];
const posOf = (r, c) => `translate(${c * 100}%, ${r * 100}%)`;
const fmt = n => n.toLocaleString();

/* ===== sound (WebAudio, zero files) ===== */
let soundOn = () => true;
let vibrationOn = () => true;

function ensureAudio() {
  if (!soundOn()) return null;
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    audioCtx = new AC();
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

function tone(freq, dur, type = 'sine', vol = 0.16, delay = 0, slideTo = 0) {
  const ctx = ensureAudio();
  if (!ctx) return;
  const t0 = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

const sfxSwap = () => tone(240, 0.07, 'triangle', 0.1, 0, 320);
const sfxInvalid = () => { tone(150, 0.11, 'sawtooth', 0.09); tone(110, 0.14, 'sawtooth', 0.09, 0.12); };
const sfxPop = combo => tone(320 * (1 + 0.14 * combo), 0.13, 'sine', 0.18, 0, 620 * (1 + 0.14 * combo));
const sfxStriped = () => tone(900, 0.2, 'sawtooth', 0.1, 0, 250);
const sfxBomb = (p = 1) => { tone(90, 0.28, 'square', 0.16 * p); tone(55, 0.34, 'sine', 0.18 * p, 0.02); };
const sfxWin = () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.18, 'sine', 0.16, i * 0.13));
const sfxFail = () => [392, 330, 262].forEach((f, i) => tone(f, 0.2, 'triangle', 0.14, i * 0.18));

function buzz(pattern) {
  if (vibrationOn() && navigator.vibrate) navigator.vibrate(pattern);
}

/* ===== FX ===== */
function floatScore(xPct, yPct, text) {
  const el = document.createElement('div');
  el.className = 'fscore';
  el.textContent = text;
  el.style.left = xPct + '%';
  el.style.top = yPct + '%';
  fxLayer.appendChild(el);
  setTimeout(() => el.remove(), 950);
}

function shout(text) {
  const el = document.createElement('div');
  el.className = 'combo';
  el.textContent = text;
  fxLayer.appendChild(el);
  setTimeout(() => el.remove(), 1000);
}

function popupClusters(set, totalPts) {
  const seen = new Set();
  for (const start of set) {
    if (seen.has(start)) continue;
    const stack = [start], grp = [];
    seen.add(start);
    while (stack.length) {
      const cur = stack.pop();
      grp.push(cur);
      const [r, c] = unkey(cur);
      for (const [dr, dc] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
        const nk = key(r + dr, c + dc);
        if (set.has(nk) && !seen.has(nk)) { seen.add(nk); stack.push(nk); }
      }
    }
    const pts = Math.round(totalPts * grp.length / set.size);
    const x = (grp.reduce((s, k) => s + (k % COLS), 0) / grp.length + 0.5) / COLS * 100;
    const y = (grp.reduce((s, k) => s + Math.floor(k / COLS), 0) / grp.length + 0.5) / ROWS * 100;
    floatScore(x, y, `+${fmt(pts)}`);
  }
}

/* ===== board & rendering ===== */
function makeCandy(type, r, c) {
  const el = document.createElement('div');
  el.className = 'candy';
  const inner = document.createElement('span');
  inner.className = 'drop';
  inner.textContent = type >= 0 ? CANDIES[type] : '';
  if (type < 0) inner.classList.add('cb');
  el.appendChild(inner);
  el.style.transform = posOf(r, c);
  boardEl.appendChild(el);
  return { type, special: null, el };
}

function activeTypes() { return level ? level.types : 6; }

function randType(r, c) {
  for (;;) {
    const t = rnd(activeTypes());
    const l1 = grid[r][c - 1], l2 = grid[r][c - 2];
    const u1 = grid[r - 1]?.[c], u2 = grid[r - 2]?.[c];
    if (c >= 2 && l1?.type === t && l2?.type === t) continue;
    if (r >= 2 && u1?.type === t && u2?.type === t) continue;
    return t;
  }
}

function newBoard() {
  boardEl.querySelectorAll('.candy, .icing').forEach(el => el.remove());
  grid = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
  // place ice blockers first — candies fill in around them
  if (level?.icing) {
    for (const [r, c, layers] of level.icing) {
      const el = document.createElement('div');
      el.className = 'icing';
      el.dataset.l = layers;
      el.style.transform = posOf(r, c);
      boardEl.appendChild(el);
      grid[r][c] = { type: -2, blocker: layers, special: null, el };
    }
  }
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      if (!grid[r][c]) grid[r][c] = makeCandy(randType(r, c), r, c);
  if (!hasAnyMove()) newBoard();
}

function renderPositions() {
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      if (grid[r][c]) grid[r][c].el.style.transform = posOf(r, c);
}

/* ===== special candy visuals ===== */
function applySpecial(r, c, special) {
  const cell = grid[r][c];
  if (!cell) return;
  cell.special = special;
  const span = cell.el.firstChild;
  span.className = 'drop';
  if (special === 'CB') {
    cell.type = -1;
    span.textContent = '';
    span.classList.add('cb');
  } else if (special === 'W') {
    span.classList.add('wrapped');
  } else {
    span.classList.add(special === 'H' ? 'striped-h' : 'striped-v');
  }
}

/* ===== match detection: concrete scanners ===== */

function scanRuns() {
  const hRuns = [], vRuns = [];
  for (let r = 0; r < ROWS; r++) {
    let c = 0;
    while (c < COLS) {
      const t = grid[r][c]?.type;
      if (t == null || t < 0) { c++; continue; }
      let c2 = c + 1;
      while (c2 < COLS && grid[r][c2]?.type === t) c2++;
      if (c2 - c >= 3) {
        const cells = [];
        for (let k = c; k < c2; k++) cells.push([r, k]);
        hRuns.push({ dir: 'H', type: t, cells });
      }
      c = c2;
    }
  }
  for (let c = 0; c < COLS; c++) {
    let r = 0;
    while (r < ROWS) {
      const t = grid[r][c]?.type;
      if (t == null || t < 0) { r++; continue; }
      let r2 = r + 1;
      while (r2 < ROWS && grid[r2][c]?.type === t) r2++;
      if (r2 - r >= 3) {
        const cells = [];
        for (let k = r; k < r2; k++) cells.push([k, c]);
        vRuns.push({ dir: 'V', type: t, cells });
      }
      r = r2;
    }
  }
  return { hRuns, vRuns };
}

function computeMatch() {
  const { hRuns, vRuns } = scanRuns();
  if (!hRuns.length && !vRuns.length) return null;

  const runs = [...hRuns, ...vRuns];
  const clears = new Set();
  for (const run of runs) for (const [r, c] of run.cells) clears.add(key(r, c));

  // intersections -> wrapped
  const vMap = new Map();
  for (const run of vRuns) for (const [r, c] of run.cells) vMap.set(key(r, c), run);
  const intersect = new Set();
  for (const run of hRuns)
    for (const [r, c] of run.cells)
      if (vMap.has(key(r, c))) intersect.add(key(r, c));

  const creates = [];
  const createAt = new Set();

  const pickPos = run => {
    if (lastSwapCells) {
      for (const s of lastSwapCells)
        if (run.cells.some(([r, c]) => r === s[0] && c === s[1])) return s;
    }
    return run.cells[Math.floor(run.cells.length / 2)];
  };

  // 5+ straight -> color bomb
  for (const run of runs) {
    if (run.cells.length >= 5) {
      const [r, c] = pickPos(run);
      const k = key(r, c);
      if (!createAt.has(k)) { creates.push({ r, c, special: 'CB' }); createAt.add(k); }
    }
  }

  // intersections -> wrapped
  for (const k of intersect) {
    if (!createAt.has(k)) {
      const [r, c] = unkey(k);
      creates.push({ r, c, special: 'W' });
      createAt.add(k);
    }
  }

  // 4 straight (without intersection) -> striped
  for (const run of runs) {
    if (run.cells.length === 4 && !run.cells.some(([r, c]) => intersect.has(key(r, c)))) {
      const [r, c] = pickPos(run);
      const k = key(r, c);
      if (!createAt.has(k)) { creates.push({ r, c, special: run.dir }); createAt.add(k); }
    }
  }

  return { clears, creates };
}

/* ===== special activation & chain expansion ===== */
function areaAround(r, c, rad) {
  const out = [];
  for (let rr = Math.max(0, r - rad); rr <= Math.min(ROWS - 1, r + rad); rr++)
    for (let cc = Math.max(0, c - rad); cc <= Math.min(COLS - 1, c + rad); cc++)
      out.push(key(rr, cc));
  return out;
}

function mostCommonType() {
  const cnt = Array(TYPES).fill(0);
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++) {
      const t = grid[r][c]?.type;
      if (t != null && t >= 0) cnt[t]++;
    }
  let best = -1, bestN = 0;
  for (let t = 0; t < activeTypes(); t++)
    if (cnt[t] > bestN) { bestN = cnt[t]; best = t; }
  return best;
}

function expandSpecials(seeds) {
  const final = new Set(seeds);
  const queue = [...seeds];
  const wrappedBlasts = [];
  let bonus = 0;
  while (queue.length) {
    const k = queue.pop();
    if (!final.has(k)) continue;
    const [r, c] = unkey(k);
    const cell = grid[r]?.[c];
    if (!cell || !cell.special) continue;
    bonus += 150;
    let cells = [];
    if (cell.special === 'H') {
      for (let i = 0; i < COLS; i++) cells.push(key(r, i));
      sfxStriped(); shout('STRIPE! ▬');
    } else if (cell.special === 'V') {
      for (let i = 0; i < ROWS; i++) cells.push(key(i, c));
      sfxStriped(); shout('STRIPE! ▮');
    } else if (cell.special === 'W') {
      cells = areaAround(r, c, 1);
      wrappedBlasts.push([r, c]);
      sfxBomb(0.8);
    } else if (cell.special === 'CB') {
      const t = mostCommonType();
      if (t >= 0)
        for (let rr = 0; rr < ROWS; rr++)
          for (let cc = 0; cc < COLS; cc++)
            if (grid[rr][cc]?.type === t) cells.push(key(rr, cc));
      sfxBomb(1);
    }
    for (const nk of cells)
      if (!final.has(nk)) { final.add(nk); queue.push(nk); }
  }
  return { final, wrappedBlasts, bonus };
}

/* ===== special+special swap combos ===== */
function specialCombo(a, b) {
  const A = grid[a[0]][a[1]], B = grid[b[0]][b[1]];
  if (!A || !B) return null;
  const ak = key(a[0], a[1]), bk = key(b[0], b[1]);
  const isCB = x => x.special === 'CB';
  const isSt = x => x.special === 'H' || x.special === 'V';
  const isWr = x => x.special === 'W';
  const allCells = () => {
    const s = new Set();
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) s.add(key(r, c));
    return s;
  };

  if (isCB(A) && isCB(B)) {
    sfxBomb(1);
    return { clears: allCells(), shout: 'DOUBLE BOMB! 🌈🌈' };
  }
  if (isCB(A) || isCB(B)) {
    const cbPos = isCB(A) ? a : b;
    const oCell = isCB(A) ? B : A;
    const cbk = key(cbPos[0], cbPos[1]);
    if (oCell.special) {
      // CB + striped/wrapped: transform every candy of that color, then detonate
      const t = oCell.type;
      const transforms = [];
      const clears = new Set([cbk]);
      for (let r = 0; r < ROWS; r++)
        for (let c = 0; c < COLS; c++) {
          const cell = grid[r][c];
          if (cell && cell.type === t) {
            transforms.push({ r, c, special: oCell.special === 'W' ? 'W' : (Math.random() < 0.5 ? 'H' : 'V') });
            clears.add(key(r, c));
          }
        }
      sfxBomb(1);
      return { clears, transforms, shout: 'RAINBOOM! 🌈' };
    }
    // CB + normal candy: clear that whole color
    const t = oCell.type;
    const clears = new Set([cbk]);
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++)
        if (grid[r][c]?.type === t) clears.add(key(r, c));
    sfxBomb(1);
    return { clears, shout: 'COLOR BOMB! 🌈' };
  }
  if (isSt(A) && isSt(B)) {
    const s = new Set([ak, bk]);
    for (let i = 0; i < COLS; i++) s.add(key(a[0], i));
    for (let i = 0; i < ROWS; i++) s.add(key(i, a[1]));
    return { clears: s, shout: 'CROSS BLAST! ✚' };
  }
  if ((isSt(A) && isWr(B)) || (isWr(A) && isSt(B))) {
    const s = new Set([ak, bk]);
    for (let d = -1; d <= 1; d++) {
      const r = a[0] + d;
      if (r >= 0 && r < ROWS) for (let c = 0; c < COLS; c++) s.add(key(r, c));
      const c = a[1] + d;
      if (c >= 0 && c < COLS) for (let rr = 0; rr < ROWS; rr++) s.add(key(rr, c));
    }
    return { clears: s, shout: 'GIANT STRIPES! ✹' };
  }
  if (isWr(A) && isWr(B)) {
    const s = new Set([ak, bk, ...areaAround(a[0], a[1], 2)]);
    return { clears: s, shout: 'MEGA BOOM! 💥' };
  }
  return null;
}

/* ===== jelly ===== */
function buildJelly() {
  jelly = Array.from({ length: ROWS }, () => Array(COLS).fill(0));
  jellyEls = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
  jellyLeft = 0;
  jellyEl.innerHTML = '';
  if (!level.isJelly) return;
  for (const [r, c, layers] of level.jelly) {
    jelly[r][c] = layers;
    jellyLeft += layers;
    const d = document.createElement('div');
    d.className = 'jelly';
    d.dataset.l = layers;
    d.style.transform = posOf(r, c);
    jellyEl.appendChild(d);
    jellyEls[r][c] = d;
  }
}

function jellyHit(r, c) {
  if (jelly[r][c] > 0) {
    jelly[r][c]--;
    jellyLeft--;
    const cell = jellyEls[r][c];
    if (cell) {
      if (jelly[r][c] === 0) { cell.remove(); jellyEls[r][c] = null; }
      else cell.dataset.l = jelly[r][c];
    }
  }
}

/* ===== HUD ===== */
function updateGameHud() {
  hudScore.textContent = fmt(score);
  hudMoves.textContent = movesLeft;
  objFill.style.width = Math.min(100, score / level.target * 100) + '%';
  objText.textContent = level.isJelly
    ? `🧊 jelly left: ${jellyLeft} · 🎯 ${fmt(level.target)}`
    : `🎯 ${fmt(score)} / ${fmt(level.target)}`;
}

/* ===== wave processing ===== */
async function processWave(clears, creates, combo) {
  const { final, wrappedBlasts, bonus } = expandSpecials(clears);
  for (const cr of creates) final.delete(key(cr.r, cr.c));

  // ===== ice blockers: direct hits + damage from adjacent clears =====
  let icingPts = 0;
  const poppedIcing = [];
  const damaged = new Set();
  const hitIcing = (r, c) => {
    const cell = grid[r][c];
    if (!cell || !cell.blocker) return;
    cell.blocker--;
    icingPts += 150;
    if (cell.blocker <= 0) {
      cell.el.classList.add('pop');
      poppedIcing.push(cell.el);
      grid[r][c] = null;
    } else {
      cell.el.dataset.l = cell.blocker;
      cell.el.classList.add('hit');
      setTimeout(() => cell.el && cell.el.classList.remove('hit'), 350);
    }
  };
  for (const k of [...final]) {
    const [r, c] = unkey(k);
    if (grid[r]?.[c]?.blocker) {
      final.delete(k);
      if (!damaged.has(k)) { damaged.add(k); hitIcing(r, c); }
    }
  }
  for (const k of final) {
    const [r, c] = unkey(k);
    for (const [dr, dc] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
      const rr = r + dr, cc = c + dc;
      if (rr < 0 || rr >= ROWS || cc < 0 || cc >= COLS) continue;
      const kk = key(rr, cc);
      if (grid[rr][cc]?.blocker && !damaged.has(kk)) { damaged.add(kk); hitIcing(rr, cc); }
    }
  }
  if (final.size === 0 && creates.length === 0 && poppedIcing.length === 0) return [];

  const pts = (final.size * POINTS_PER_CANDY + bonus + icingPts) * combo;
  score += pts;
  updateGameHud();
  sfxPop(combo);
  buzz(combo > 1 ? [30, 30, 45] : 25);
  if (final.size > 0) popupClusters(final, pts);
  if (combo >= 2 && final.size >= 4) shout(combo >= 6 ? 'SUGAR CRUSH!' : ['SWEET!', 'TASTY!', 'DELICIOUS!', 'DIVINE!'][Math.min(combo - 2, 3)]);

  const popped = [];
  for (const k of final) {
    const [r, c] = unkey(k);
    const cell = grid[r][c];
    if (!cell) continue;
    cell.el.firstChild.classList.add('pop');
    popped.push(cell.el);
    grid[r][c] = null;
    jellyHit(r, c);
  }
  await sleep(300);
  popped.forEach(el => el.remove());
  poppedIcing.forEach(el => el.remove());

  for (const cr of creates) applySpecial(cr.r, cr.c, cr.special);

  gravityRefill();
  return wrappedBlasts;
}

function gravityRefill() {
  for (let c = 0; c < COLS; c++) {
    // segments are separated by ice blockers: candies compact within a
    // segment, and only segments with no blocker above can refill from the top
    const blockerRows = [];
    for (let r = 0; r < ROWS; r++) if (grid[r][c]?.blocker) blockerRows.push(r);
    const bounds = [-1, ...blockerRows, ROWS];
    for (let i = bounds.length - 2; i >= 0; i--) {
      const start = bounds[i] + 1;
      const end = bounds[i + 1] - 1;
      if (end < start) continue;
      let write = end;
      for (let r = end; r >= start; r--) {
        const cell = grid[r][c];
        if (cell && !cell.blocker) {
          if (r !== write) {
            grid[write][c] = cell;
            grid[r][c] = null;
            cell.el.style.transform = posOf(write, c);
          }
          write--;
        }
      }
      const hasBlockerAbove = blockerRows.some(br => br < start);
      if (!hasBlockerAbove) {
        const holes = write - start + 1;
        for (let r = write; r >= start; r--)
          grid[r][c] = makeCandy(rnd(activeTypes()), r - holes, c);
      }
    }
  }
}

async function settleAnimations() {
  await new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)));
  renderPositions();
  await sleep(300);
}

async function resolveCascades(firstWave) {
  let combo = 1;
  let wave = firstWave;
  for (;;) {
    if (!wave) {
      const m = computeMatch();
      if (!m) break;
      wave = m;
    }
    const blasts = await processWave(wave.clears, wave.creates || [], combo);
    combo++;
    lastSwapCells = null;
    await settleAnimations();
    wave = blasts && blasts.length
      ? { clears: new Set(blasts.flatMap(([r, c]) => areaAround(r, c, 1))), creates: [] }
      : null;
  }
}

/* ===== swapping ===== */
function swapData(a, b) {
  const tmp = grid[a[0]][a[1]];
  grid[a[0]][a[1]] = grid[b[0]][b[1]];
  grid[b[0]][b[1]] = tmp;
}

async function trySwap(a, b) {
  if (busy) return;
  if (grid[a[0]]?.[a[1]]?.blocker || grid[b[0]]?.[b[1]]?.blocker) return; // ice can't be swapped
  busy = true;
  clearSelection();
  sfxSwap();
  lastSwapCells = [a, b];

  swapData(a, b);
  renderPositions();
  await sleep(260);

  const combo = specialCombo(a, b);
  if (combo) {
    if (combo.shout) shout(combo.shout);
    if (combo.transforms) for (const t of combo.transforms) applySpecial(t.r, t.c, t.special);
    movesLeft--;
    updateGameHud();
    await resolveCascades({ clears: combo.clears, creates: [] });
    await settleAnimations();
    busy = false;
    endTurn();
    return;
  }

  const m = computeMatch();
  if (!m) {
    swapData(a, b);
    renderPositions();
    sfxInvalid();
    buzz([60, 50, 60]);
    boardEl.classList.add('shake');
    await sleep(330);
    boardEl.classList.remove('shake');
    busy = false;
    return;
  }

  movesLeft--;
  updateGameHud();
  await resolveCascades(m);
  await settleAnimations();
  busy = false;
  endTurn();
}

/* ===== dead-board detection ===== */
function hasAnyMove() {
  // any special makes a move possible with any neighbor
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++) {
      const cell = grid[r][c];
      if (!cell) continue;
      if (cell.special === 'CB') {
        const nn = [[0, 1], [0, -1], [1, 0], [-1, 0]].some(([dr, dc]) => grid[r + dr]?.[c + dc]);
        if (nn) return true;
      }
      if (cell.special) {
        const sp = [[0, 1], [1, 0]];
        for (const [dr, dc] of sp) {
          const other = grid[r + dr]?.[c + dc];
          if (other?.special) return true;
        }
      }
    }
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      for (const [dr, dc] of [[0, 1], [1, 0]]) {
        const r2 = r + dr, c2 = c + dc;
        if (r2 >= ROWS || c2 >= COLS) continue;
        swapData([r, c], [r2, c2]);
        const ok = !!computeMatch();
        swapData([r, c], [r2, c2]);
        if (ok) return true;
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

/* ===== selection & input ===== */
function select(cell) {
  clearSelection();
  if (grid[cell[0]]?.[cell[1]]?.blocker) return;
  selected = cell;
  grid[cell[0]][cell[1]]?.el.classList.add('selected');
}
function clearSelection() {
  if (selected) grid[selected[0]][selected[1]]?.el.classList.remove('selected');
  selected = null;
}

function cellFromPoint(x, y) {
  const rect = boardEl.getBoundingClientRect();
  const c = Math.floor((x - rect.left) / (rect.width / COLS));
  const r = Math.floor((y - rect.top) / (rect.height / ROWS));
  if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return null;
  return [r, c];
}

boardEl.addEventListener('pointerdown', e => {
  ensureAudio();
  if (busy || pointer) return;
  const cell = cellFromPoint(e.clientX, e.clientY);
  if (!cell) return;
  if (hammerMode) { hammerSmash(cell); return; }
  pointer = { r: cell[0], c: cell[1], x: e.clientX, y: e.clientY, dragged: false };
  boardEl.setPointerCapture(e.pointerId);
});

boardEl.addEventListener('pointermove', e => {
  if (!pointer || busy) return;
  const dx = e.clientX - pointer.x;
  const dy = e.clientY - pointer.y;
  if (Math.hypot(dx, dy) < boardEl.clientWidth / COLS * 0.35) return;
  const dir = Math.abs(dx) > Math.abs(dy) ? [0, Math.sign(dx)] : [Math.sign(dy), 0];
  const from = [pointer.r, pointer.c];
  const to = [pointer.r + dir[0], pointer.c + dir[1]];
  pointer = null;
  if (to[0] >= 0 && to[0] < ROWS && to[1] >= 0 && to[1] < COLS) trySwap(from, to);
});

boardEl.addEventListener('pointerup', () => {
  if (!pointer) return;
  const cell = [pointer.r, pointer.c];
  pointer = null;
  if (busy) return;
  if (!selected) select(cell);
  else if (selected[0] === cell[0] && selected[1] === cell[1]) clearSelection();
  else if (Math.abs(selected[0] - cell[0]) + Math.abs(selected[1] - cell[1]) === 1) {
    const from = selected;
    clearSelection();
    trySwap(from, cell);
  } else select(cell);
});

boardEl.addEventListener('pointercancel', () => { pointer = null; });

/* ===== boosters ===== */
async function hammerSmash(pos) {
  if (busy || levelEnded) return;
  if (!Progress.spendBooster('hammer')) { UI.openShop(); return; }
  hammerMode = false;
  boosterHammer.classList.remove('active');
  refreshBoosterBar();
  busy = true;
  sfxBomb(0.5);
  buzz(40);
  shout('SMASH! 🍭');
  await resolveCascades({ clears: new Set([key(pos[0], pos[1])]), creates: [] });
  await settleAnimations();
  busy = false;
  endTurn();
}

function refreshBoosterBar() {
  document.getElementById('count-hammer').textContent = Progress.getBooster('hammer');
  document.getElementById('count-moves').textContent = Progress.getBooster('moves');
  document.getElementById('count-shuffle').textContent = Progress.getBooster('shuffle');
}

boosterHammer.addEventListener('click', () => {
  if (levelEnded) return;
  if (Progress.getBooster('hammer') <= 0) { UI.openShop(); return; }
  hammerMode = !hammerMode;
  clearSelection();
  boosterHammer.classList.toggle('active', hammerMode);
});

boosterMoves.addEventListener('click', () => {
  if (levelEnded || busy) return;
  if (!Progress.spendBooster('moves')) { UI.openShop(); return; }
  movesLeft += 5;
  refreshBoosterBar();
  updateGameHud();
  sfxSwap();
  buzz(30);
  shout('+5 MOVES! ➕');
});

boosterShuffle.addEventListener('click', async () => {
  if (levelEnded || busy) return;
  if (!Progress.spendBooster('shuffle')) { UI.openShop(); return; }
  refreshBoosterBar();
  busy = true;
  boardEl.classList.add('shake');
  await sleep(400);
  newBoard();
  boardEl.classList.remove('shake');
  busy = false;
});

/* ===== level lifecycle ===== */
function startLevel(n) {
  level = Levels.config(n);
  score = 0;
  movesLeft = level.moves;
  levelEnded = false;
  hammerMode = false;
  boosterHammer.classList.remove('active');
  lastSwapCells = null;
  clearSelection();
  overlayEl.classList.add('hidden');
  levelLabel.textContent = `Level ${n}`;
  buildJelly();
  newBoard();
  refreshBoosterBar();
  updateGameHud();
  UI.showScreen('game');
}

function objectiveMet() {
  return level.isJelly ? jellyLeft === 0 : score >= level.target;
}

function endTurn() {
  if (levelEnded) return;
  if (objectiveMet()) return levelWin();
  if (movesLeft <= 0) return levelFail();
  ensureMovesExist();
}

function levelWin() {
  levelEnded = true;
  const s = score >= level.target * Levels.STAR_MULT[2] ? 3
    : score >= level.target * Levels.STAR_MULT[1] ? 2 : 1;
  Progress.setStars(level.n, s);
  const coins = 30 + 25 * s + Math.floor(level.n / 10);
  Progress.addCoins(coins);

  overlayTitle.textContent = 'Dolly says: SWEET! 🍭';
  overlayText.textContent = `Level ${level.n} cleared · +${coins} 🪙`;
  overlayStars.innerHTML = '';
  for (let i = 1; i <= 3; i++) {
    const star = document.createElement('span');
    star.textContent = '⭐';
    star.className = 'ostar s' + i + (i <= s ? '' : ' off');
    overlayStars.appendChild(star);
  }
  nextBtn.classList.toggle('hidden', level.n >= Levels.TOTAL);
  overlayEl.classList.remove('hidden');
  sfxWin();
  buzz([40, 40, 40, 40, 80]);
}

function levelFail() {
  levelEnded = true;
  Progress.loseLife();
  overlayTitle.textContent = 'Out of moves! 💔';
  const left = level.isJelly ? `${jellyLeft} jelly left` : `${fmt(Math.max(0, level.target - score))} points to go`;
  overlayText.textContent = `Dolly believes in you — ${left}`;
  overlayStars.innerHTML = '';
  nextBtn.classList.add('hidden');
  overlayEl.classList.remove('hidden');
  sfxFail();
  buzz([80, 60, 80]);
}

nextBtn.addEventListener('click', () => startLevel(level.n + 1));
retryBtn.addEventListener('click', () => startLevel(level.n));
mapBtn.addEventListener('click', () => { overlayEl.classList.add('hidden'); UI.goHome(); });
backBtn.addEventListener('click', () => { overlayEl.classList.add('hidden'); UI.goHome(); });
