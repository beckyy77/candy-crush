'use strict';

/* ===== deterministic RNG (same levels on every device) ===== */
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ===== level generator: 300 levels, easy -> hard ===== */
const Levels = (() => {
  const TOTAL = 300;
  const STAR_MULT = [1, 1.6, 2.4]; // 1★..3★ score thresholds

  function config(n) {
    const rng = mulberry32(n * 7919 + 13);
    const moves = Math.max(15, 32 - Math.floor(n / 14));
    const target = Math.round((900 + n * 260 + Math.pow(n, 1.75) * 6) / 50) * 50;
    const types = n < 8 ? 5 : 6;
    const isJelly = n >= 6 && (n % 3 !== 0);

    const jelly = [];
    if (isJelly) {
      const count = Math.min(4 + Math.floor(n / 6), 34);
      const baseLayer = n >= 60 ? 2 : 1;
      const seen = new Set();
      let guard = 0;
      while (jelly.length < count && guard++ < 600) {
        const r = 1 + Math.floor(rng() * 6);
        const c = 1 + Math.floor(rng() * 6);
        const k = r * 8 + c;
        if (!seen.has(k)) {
          seen.add(k);
          jelly.push([r, c, rng() < 0.3 ? baseLayer + 1 : baseLayer]);
        }
      }
    }
    return { n, moves, target, types, isJelly, jelly };
  }

  return { TOTAL, config, STAR_MULT };
})();

/* ===== persistent progress: stars, coins, lives, boosters ===== */
const Progress = (() => {
  const KEY = 'dolly-progress';
  const LIFE_MS = 10 * 60 * 1000;
  const MAX_LIVES = 5;

  let data = {
    unlocked: 1,
    stars: {},
    coins: 200,
    lives: MAX_LIVES,
    livesTs: 0,
    boosters: { hammer: 1, moves: 1, shuffle: 1 },
  };

  function load() {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
      data = { ...data, ...saved, boosters: { ...data.boosters, ...(saved.boosters || {}) } };
    } catch {}
  }
  const save = () => localStorage.setItem(KEY, JSON.stringify(data));

  function livesData() {
    if (data.lives >= MAX_LIVES) return { lives: MAX_LIVES, nextIn: 0 };
    const base = data.livesTs || Date.now();
    const gained = Math.floor((Date.now() - base) / LIFE_MS);
    if (gained > 0) {
      data.lives = Math.min(MAX_LIVES, data.lives + gained);
      data.livesTs = data.lives >= MAX_LIVES ? 0 : base + gained * LIFE_MS;
      save();
    }
    const nextIn = data.lives >= MAX_LIVES ? 0 : Math.max(0, LIFE_MS - (Date.now() - (data.livesTs || Date.now())));
    return { lives: data.lives, nextIn };
  }

  function loseLife() {
    const { lives } = livesData();
    if (lives > 0) {
      data.lives = lives - 1;
      if (!data.livesTs) data.livesTs = Date.now();
      save();
    }
  }

  const refillLives = () => { data.lives = MAX_LIVES; data.livesTs = 0; save(); };
  const stars = n => data.stars[n] || 0;
  const totalStars = () => Object.values(data.stars).reduce((a, b) => a + b, 0);

  function setStars(n, s) {
    if (s > (data.stars[n] || 0)) data.stars[n] = s;
    if (n + 1 > data.unlocked) data.unlocked = Math.min(Levels.TOTAL, n + 1);
    save();
  }

  const addCoins = n => { data.coins += n; save(); };
  function spendCoins(n) {
    if (data.coins < n) return false;
    data.coins -= n; save(); return true;
  }

  const getBooster = id => data.boosters[id] || 0;
  function spendBooster(id) {
    if ((data.boosters[id] || 0) <= 0) return false;
    data.boosters[id]--; save(); return true;
  }
  const addBooster = (id, n = 1) => { data.boosters[id] = (data.boosters[id] || 0) + n; save(); };

  return { load, save, livesData, loseLife, refillLives, stars, totalStars, setStars, addCoins, spendCoins, getBooster, spendBooster, addBooster, get coins() { return data.coins; }, get unlocked() { return data.unlocked; } };
})();

/* ===== demo friends pinned on the map ===== */
const FRIENDS = [
  { name: 'Lily', avatar: '👧🏻', level: 5, stars: 12 },
  { name: 'Mia', avatar: '👩🏻‍🦰', level: 18, stars: 84 },
  { name: 'Abeba', avatar: '🧑🏽', level: 37, stars: 61 },
  { name: 'Sam', avatar: '👨🏿‍🦱', level: 64, stars: 47 },
];

const DOLLY_TIPS = [
  'Match 4 in a row for a striped candy! 🍬',
  'Match 5 for a color bomb — then swap it with anything! 🌈',
  'L or T shapes make wrapped candies. Boom! 💥',
  'Combine two specials for something magical… ✨',
  'Stuck? A shuffle from the shop can save the day! 🔄',
  'Dolly believes in you! 🍭',
];
