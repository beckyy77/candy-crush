'use strict';

/* ===== Config ===== */
const ROWS = 8, COLS = 8, TYPES = 6;
const CANDIES = ['🍒', '🍋', '🍇', '🍊', '🍏', '🫐'];
const MOVES_START = 30;
const POINTS_PER_CANDY = 60;
const COMBO_SHOUTS = { 2: 'Sweet!', 3: 'Tasty!', 4: 'Delicious!', 5: 'Divine!' };

/* ===== DOM ===== */
const boardEl = document.getElementById('board');
const fxLayer = document.getElementById('fx-layer');
const scoreEl = document.getElementById('score');
const bestEl = document.getElementById('best');
const movesEl = document.getElementById('moves');
const overlayEl = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayText = document.getElementById('overlay-text');
const restartBtn = document.getElementById('restart');
const bubblesEl = document.getElementById('bubbles');

const settingsModal = document.getElementById('settings');
const settingsBtn = document.getElementById('settings-btn');
const settingsCloseBtn = document.getElementById('settings-close');
const playerChip = document.getElementById('player-chip');
const playerNameLabel = document.getElementById('player-name-label');
const playerNameInput = document.getElementById('player-name');
const playerEmailInput = document.getElementById('player-email');
const emailHint = document.getElementById('email-hint');
const saveProfileBtn = document.getElementById('save-profile');
const tSound = document.getElementById('toggle-sound');
const tVibration = document.getElementById('toggle-vibration');
const tBubbles = document.getElementById('toggle-bubbles');
const installBtn = document.getElementById('install-btn');
const installHint = document.getElementById('install-hint');
const installSection = document.getElementById('install-section');

/* ===== State ===== */
let grid = []; // grid[r][c] = { type, el } | null
let score = 0;
let moves = MOVES_START;
let best = Number(localStorage.getItem('cc-best') || 0);
let roundStartBest = best;
let busy = false;
let selected = null; // [r, c]
let pointer = null;  // { r, c, x, y, dragged }

let profile = { name: '', email: '' };
let settings = { sound: true, vibration: true, bubbles: true };
let deferredPrompt = null;
let audioCtx = null;

/* ===== Helpers ===== */
const sleep = ms => new Promise(res => setTimeout(res, ms));
const rnd = n => Math.floor(Math.random() * n);
const key = (r, c) => r * COLS + c;
const posOf = (r, c) => `translate(${c * 100}%, ${r * 100}%)`;

function loadLocal() {
  try { profile = { ...profile, ...JSON.parse(localStorage.getItem('cc-profile') || '{}') }; } catch {}
  try { settings = { ...settings, ...JSON.parse(localStorage.getItem('cc-settings') || '{}') }; } catch {}
}
const saveProfileLocal = () => localStorage.setItem('cc-profile', JSON.stringify(profile));
const saveSettingsLocal = () => localStorage.setItem('cc-settings', JSON.stringify(settings));

function updateHud() {
  scoreEl.textContent = score;
  movesEl.textContent = moves;
  if (score > best) {
    best = score;
    localStorage.setItem('cc-best', best);
  }
  bestEl.textContent = best;
}

/* ===== Sound (WebAudio, no files needed) ===== */
function ensureAudio() {
  if (!settings.sound) return null;
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
const sfxGameOver = () => [392, 330, 262].forEach((f, i) => tone(f, 0.2, 'triangle', 0.14, i * 0.18));
const sfxBest = () => [262, 330, 392, 523].forEach((f, i) => tone(f, 0.16, 'sine', 0.16, i * 0.13));

function buzz(pattern) {
  if (settings.vibration && navigator.vibrate) navigator.vibrate(pattern);
}

/* ===== FX: floating scores + combo shouts ===== */
function floatScore(xPct, yPct, text) {
  const el = document.createElement('div');
  el.className = 'fscore';
  el.textContent = text;
  el.style.left = xPct + '%';
  el.style.top = yPct + '%';
  fxLayer.appendChild(el);
  setTimeout(() => el.remove(), 950);
}

function comboShout(combo) {
  const text = combo >= 6 ? 'Sugar Crush!' : COMBO_SHOUTS[combo];
  if (!text) return;
  const el = document.createElement('div');
  el.className = 'combo';
  el.textContent = text;
  fxLayer.appendChild(el);
  setTimeout(() => el.remove(), 1000);
}

/* ===== Board ===== */
function makeCandy(type, r, c) {
  const el = document.createElement('div');
  el.className = 'candy';
  const inner = document.createElement('span');
  inner.className = 'drop';
  inner.textContent = CANDIES[type];
  el.appendChild(inner);
  el.style.transform = posOf(r, c);
  boardEl.appendChild(el);
  return { type, el };
}

function randType(r, c) {
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

/* group matched cells into connected clusters -> floating score popups */
function clusterPopups(matches, combo) {
  const cells = new Set(matches.map(([r, c]) => key(r, c)));
  const seen = new Set();
  const popups = [];
  for (const start of cells) {
    if (seen.has(start)) continue;
    const stack = [start], grp = [];
    seen.add(start);
    while (stack.length) {
      const cur = stack.pop();
      grp.push(cur);
      const r = Math.floor(cur / COLS), c = cur % COLS;
      for (const [dr, dc] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
        const nk = key(r + dr, c + dc);
        if (cells.has(nk) && !seen.has(nk)) { seen.add(nk); stack.push(nk); }
      }
    }
    popups.push({
      pts: grp.length * POINTS_PER_CANDY * combo,
      x: (grp.reduce((s, k) => s + (k % COLS), 0) / grp.length + 0.5) / COLS * 100,
      y: (grp.reduce((s, k) => s + Math.floor(k / COLS), 0) / grp.length + 0.5) / ROWS * 100,
    });
  }
  return popups;
}

/* ===== Swaps & cascades ===== */
function swapData(a, b) {
  const tmp = grid[a[0]][a[1]];
  grid[a[0]][a[1]] = grid[b[0]][b[1]];
  grid[b[0]][b[1]] = tmp;
}

async function trySwap(a, b) {
  busy = true;
  clearSelection();
  sfxSwap();

  swapData(a, b);
  renderPositions();
  await sleep(260);

  if (findMatches().length === 0) {
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

    sfxPop(combo);
    buzz(combo > 1 ? [30, 30, 45] : 25);
    for (const p of clusterPopups(matches, combo)) floatScore(p.x, p.y, `+${p.pts}`);
    comboShout(combo);

    score += matches.length * POINTS_PER_CANDY * combo;
    combo++;
    updateHud();

    const popped = [];
    for (const [r, c] of matches) {
      const cell = grid[r][c];
      if (!cell) continue;
      cell.el.firstChild.classList.add('pop');
      popped.push(cell.el);
      grid[r][c] = null;
    }
    await sleep(300);
    popped.forEach(el => el.remove());

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
      const holes = write + 1;
      for (let r = write; r >= 0; r--) {
        grid[r][c] = makeCandy(rnd(TYPES), r - holes, c);
      }
    }

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
  ensureAudio(); // unlock audio on first gesture (iOS)
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
function firstName() {
  return (profile.name || '').trim().split(/\s+/)[0];
}

function gameOver() {
  const name = firstName();
  const newBest = score > roundStartBest && score > 0;
  overlayTitle.textContent = name ? `Out of moves, ${name}! 🍬` : 'Out of moves! 🍬';
  overlayText.textContent =
    `Final score: ${score} · Best: ${best}` + (newBest ? ' — 🏆 New best!' : '');
  overlayEl.classList.remove('hidden');
  if (newBest) { sfxBest(); buzz([40, 40, 40, 40, 80]); }
  else { sfxGameOver(); buzz([80, 60, 80]); }
}

restartBtn.addEventListener('click', () => {
  score = 0;
  moves = MOVES_START;
  roundStartBest = best;
  overlayEl.classList.add('hidden');
  newBoard();
  updateHud();
});

/* ===== Profile UI ===== */
function applyProfile() {
  const name = firstName();
  playerNameLabel.textContent = name || 'Sign in';
  playerNameInput.value = profile.name || '';
  playerEmailInput.value = profile.email || '';
}

saveProfileBtn.addEventListener('click', () => {
  const name = playerNameInput.value.trim();
  const email = playerEmailInput.value.trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    emailHint.textContent = 'That email doesn’t look right — check it?';
    emailHint.className = 'hint err';
    return;
  }
  profile = { name, email };
  saveProfileLocal();
  applyProfile();
  emailHint.textContent = email ? 'Saved! 🎉' : 'Saved (no email given).';
  emailHint.className = 'hint ok';
  buzz(30);
});

/* ===== Settings UI ===== */
function openSettings() { settingsModal.classList.remove('hidden'); }
function closeSettings() { settingsModal.classList.add('hidden'); }

settingsBtn.addEventListener('click', openSettings);
playerChip.addEventListener('click', () => { openSettings(); playerNameInput.focus(); });
settingsCloseBtn.addEventListener('click', closeSettings);
settingsModal.addEventListener('click', e => { if (e.target === settingsModal) closeSettings(); });
window.addEventListener('keydown', e => { if (e.key === 'Escape') closeSettings(); });

function applySettings() {
  tSound.checked = settings.sound;
  tVibration.checked = settings.vibration;
  tBubbles.checked = settings.bubbles;
  buildBubbles();
}

tSound.addEventListener('change', () => {
  settings.sound = tSound.checked;
  saveSettingsLocal();
  if (settings.sound) sfxSwap();
});
tVibration.addEventListener('change', () => {
  settings.vibration = tVibration.checked;
  saveSettingsLocal();
  if (settings.vibration) buzz(40);
});
tBubbles.addEventListener('change', () => {
  settings.bubbles = tBubbles.checked;
  saveSettingsLocal();
  buildBubbles();
});

/* ===== Floating background bubbles ===== */
function buildBubbles() {
  bubblesEl.innerHTML = '';
  if (!settings.bubbles) return;
  for (let i = 0; i < 14; i++) {
    const b = document.createElement('div');
    b.className = 'bubble';
    const size = 14 + Math.random() * 58;
    b.style.width = b.style.height = size + 'px';
    b.style.left = Math.random() * 100 + '%';
    b.style.animationDuration = 9 + Math.random() * 14 + 's';
    b.style.animationDelay = -Math.random() * 20 + 's';
    b.style.opacity = 0.25 + Math.random() * 0.5;
    bubblesEl.appendChild(b);
  }
}

/* ===== Install (PWA) ===== */
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = matchMedia('(display-mode: standalone)').matches
  || window.navigator.standalone === true;

function refreshInstallUI() {
  if (isStandalone) {
    installBtn.classList.add('hidden');
    installHint.textContent = '✅ You’re playing the installed app!';
    installHint.className = 'hint ok';
  } else if (isIOS) {
    installBtn.classList.add('hidden');
    installHint.textContent = 'On iPhone/iPad: tap the Share button (square with arrow), then “Add to Home Screen”. 📲';
  } else {
    installBtn.classList.toggle('hidden', !deferredPrompt);
    installHint.textContent = deferredPrompt
      ? 'Tap the button to install Candy Crush as an app.'
      : 'Tip: browser menu (⋮) → “Add to Home screen” / “Install app”.';
  }
}

window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  deferredPrompt = e;
  refreshInstallUI();
});

window.addEventListener('appinstalled', () => {
  deferredPrompt = null;
  refreshInstallUI();
});

installBtn.addEventListener('click', async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  refreshInstallUI();
});

/* ===== Boot ===== */
loadLocal();
applyProfile();
applySettings();
refreshInstallUI();
roundStartBest = best;
updateHud();
newBoard();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
