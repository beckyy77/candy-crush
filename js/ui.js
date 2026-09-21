'use strict';

/* ============================================================
   Dolly Crush Saga — UI: home map, shop, leaderboard, settings
   ============================================================ */

const UI = (() => {
  /* ===== DOM ===== */
  const $ = id => document.getElementById(id);
  const screenHome = $('screen-home');
  const screenGame = $('screen-game');
  const mapScroll = $('map-scroll');
  const mapCanvas = $('map-canvas');
  const greeting = $('greeting');
  const tipEl = $('dolly-tip');
  const coinsCount = $('coins-count');
  const livesCount = $('lives-count');

  /* ===== screens ===== */
  function showScreen(name) {
    screenHome.classList.toggle('hidden', name !== 'home');
    screenGame.classList.toggle('hidden', name !== 'game');
    if (name === 'home') { renderHome(); window.scrollTo(0, 0); }
  }

  function goHome() { showScreen('home'); }

  /* ===== home ===== */
  function renderHome() {
    updateTopbars();
    renderGreeting();
    renderMap();
  }

  function renderGreeting() {
    let name = '';
    try { name = (JSON.parse(localStorage.getItem('cc-profile') || '{}').name || '').trim().split(/\s+/)[0]; } catch {}
    greeting.textContent = name ? `Hi ${name}! Ready to crush?` : 'Ready to crush some candy?';
    tipEl.textContent = '🍭 ' + DOLLY_TIPS[(Progress.unlocked - 1) % DOLLY_TIPS.length];
  }

  function updateTopbars() {
    coinsCount.textContent = Progress.coins.toLocaleString();
    const { lives } = Progress.livesData();
    livesCount.textContent = lives;
    $('home-stars').textContent = Progress.totalStars();
  }

  /* ===== the saga map ===== */
  const NODE_GAP = 84;

  function nodePos(i, width, height) {
    const y = height - 100 - i * NODE_GAP; // level 1 at the bottom, climb up!
    const x = width / 2 + Math.sin(i * 0.55) * width * 0.30;
    return { x, y };
  }

  function renderMap() {
    const width = mapScroll.clientWidth || 360;
    const total = Levels.TOTAL;
    const height = 70 + total * NODE_GAP + 120;
    mapCanvas.style.height = height + 'px';

    let html = `<svg class="map-path" width="${width}" height="${height}">
      <polyline points="${Array.from({ length: total }, (_, i) => {
        const { x, y } = nodePos(i, width, height);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      }).join(' ')}" fill="none" stroke="rgba(255,154,213,.55)" stroke-width="10" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="1 18"/>
    </svg>`;

    // friend pins
    for (const f of FRIENDS) {
      const { x, y } = nodePos(f.level - 1, width, height);
      html += `<div class="pin" style="left:${x + 46}px;top:${y - 10}px"><span class="pin-avatar">${f.avatar}</span><span class="pin-name">${f.name}</span></div>`;
    }

    for (let n = 1; n <= total; n++) {
      const { x, y } = nodePos(n - 1, width, height);
      const stars = Progress.stars(n);
      const unlockedN = Progress.unlocked;
      const state = n < unlockedN ? 'done' : n === unlockedN ? 'current' : 'locked';
      const starsHtml = state === 'done'
        ? `<div class="node-stars">${[1, 2, 3].map(i => `<span class="${i <= stars ? '' : 'off'}">⭐</span>`).join('')}</div>`
        : '';
      const tag = state === 'current' ? '<div class="play-tag">▶ PLAY</div>' : '';
      const label = state === 'locked' ? '🔒' : n;
      html += `<button class="map-node ${state}" data-n="${n}" style="left:${x}px;top:${y}px">${tag}${label}${starsHtml}</button>`;
    }

    mapCanvas.innerHTML = html;

    const current = mapCanvas.querySelector('.map-node.current');
    if (current) {
      setTimeout(() => {
        // center the current level in view (level 1 lives near the bottom)
        const target = Math.max(0, current.offsetTop + 29 - mapScroll.clientHeight / 2);
        mapScroll.scrollTo({ top: target, behavior: 'smooth' });
      }, 60);
    }
  }

  mapCanvas.addEventListener('click', e => {
    const node = e.target.closest('.map-node');
    if (!node) return;
    const n = Number(node.dataset.n);
    if (n > Progress.unlocked) {
      node.classList.add('wiggle');
      setTimeout(() => node.classList.remove('wiggle'), 450);
      return;
    }
    const { lives } = Progress.livesData();
    if (lives <= 0) { openLives(); return; }
    startLevel(n);
  });

  /* ===== shop ===== */
  const SHOP_ITEMS = [
    { id: 'hammer', icon: '🍭', name: 'Lollipop Hammer', desc: 'Smash any single candy', price: 90 },
    { id: 'moves', icon: '➕', name: '+5 Moves', desc: 'Five extra moves, mid-level', price: 120 },
    { id: 'shuffle', icon: '🔄', name: 'Shuffle', desc: 'Mix up the whole board', price: 60 },
  ];

  function renderShop() {
    $('shop-coins').textContent = Progress.coins.toLocaleString();
    $('shop-list').innerHTML = SHOP_ITEMS.map(it => `
      <div class="shop-item">
        <div class="shop-icon">${it.icon}</div>
        <div class="shop-info">
          <b>${it.name}</b>
          <small>${it.desc}</small>
          <small class="owned">owned: ${Progress.getBooster(it.id)}</small>
        </div>
        <button class="small" data-buy="${it.id}">${it.price} 🪙</button>
      </div>`).join('');
  }

  document.addEventListener('click', e => {
    const buyBtn = e.target.closest('[data-buy]');
    if (!buyBtn) return;
    const item = SHOP_ITEMS.find(i => i.id === buyBtn.dataset.buy);
    if (!item) return;
    askConfirm({
      title: 'Buy this?',
      icon: item.icon,
      name: item.name,
      desc: item.desc,
      priceNum: item.price,
      priceLabel: `${item.price} 🪙`,
    }, () => {
      if (!Progress.spendCoins(item.price)) return;
      Progress.addBooster(item.id);
      renderShop();
      updateTopbars();
      if (typeof refreshBoosterBar === 'function') refreshBoosterBar();
      buzz(30);
      showToast(`${item.icon} ${item.name} purchased!`);
    });
  });

  /* ===== confirm popup + toast ===== */
  const confirmModal = $('confirm');
  const confirmOk = $('confirm-ok');
  let confirmAction = null;

  function askConfirm({ title, icon, name, desc, priceNum = 0, priceLabel = '', gift = null }, action) {
    $('confirm-title').textContent = title;
    $('confirm-body').innerHTML = `
      <div class="shop-icon">${icon}</div>
      <div class="shop-info"><b>${name}</b><small>${desc}</small></div>
      <div class="confirm-price">${priceLabel}</div>`;
    const hint = $('confirm-hint');
    hint.className = 'hint';
    if (priceNum > Progress.coins) {
      if (gift) {
        hint.textContent = gift;
        hint.classList.add('ok');
        confirmOk.textContent = 'Accept gift 💖';
        confirmOk.disabled = false;
      } else {
        hint.textContent = `Not enough coins — you have ${Progress.coins.toLocaleString()} 🪙. Earn more stars! ⭐`;
        hint.classList.add('err');
        confirmOk.textContent = 'Yes, buy! 🛒';
        confirmOk.disabled = true;
      }
    } else {
      hint.textContent = `Your balance after: ${(Progress.coins - priceNum).toLocaleString()} 🪙`;
      confirmOk.textContent = 'Yes, buy! 🛒';
      confirmOk.disabled = false;
    }
    confirmAction = action;
    confirmModal.classList.remove('hidden');
  }

  confirmOk.addEventListener('click', () => {
    confirmModal.classList.add('hidden');
    const action = confirmAction;
    confirmAction = null;
    if (action) action();
  });
  $('confirm-cancel').addEventListener('click', () => { confirmModal.classList.add('hidden'); confirmAction = null; });
  confirmModal.addEventListener('click', e => {
    if (e.target === confirmModal) { confirmModal.classList.add('hidden'); confirmAction = null; }
  });

  let toastT;
  function showToast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(() => t.classList.remove('show'), 2200);
  }

  const shopModal = $('shop');
  function openShop() { renderShop(); shopModal.classList.remove('hidden'); }
  $('shop-btn').addEventListener('click', openShop);
  $('shop-close').addEventListener('click', () => shopModal.classList.add('hidden'));
  shopModal.addEventListener('click', e => { if (e.target === shopModal) shopModal.classList.add('hidden'); });

  /* ===== leaderboard ===== */
  const lbModal = $('leaderboard');
  function renderLb() {
    let name = 'You';
    try { name = (JSON.parse(localStorage.getItem('cc-profile') || '{}').name || 'You').trim() || 'You'; } catch {}
    const rows = [
      { name: 'Dolly 🍭', stars: 902, you: false },
      ...FRIENDS.map(f => ({ name: `${f.avatar} ${f.name}`, stars: f.stars, you: false })),
      { name: `${name}`, stars: Progress.totalStars(), you: true },
    ].sort((a, b) => b.stars - a.stars);
    $('lb-list').innerHTML = rows.map((r, i) => `
      <div class="lb-row ${r.you ? 'you' : ''}">
        <span class="lb-rank">${i + 1}</span>
        <span class="lb-name">${r.name}</span>
        <span class="lb-stars">⭐ ${r.stars}</span>
      </div>`).join('');
  }
  $('leaderboard-btn').addEventListener('click', () => { renderLb(); lbModal.classList.remove('hidden'); });
  $('lb-close').addEventListener('click', () => lbModal.classList.add('hidden'));
  lbModal.addEventListener('click', e => { if (e.target === lbModal) lbModal.classList.add('hidden'); });

  /* ===== lives ===== */
  const livesModal = $('lives-modal');
  function openLives() {
    const { nextIn } = Progress.livesData();
    const mins = Math.ceil(nextIn / 60000);
    $('lives-text').textContent = nextIn > 0
      ? `Next life in ~${mins} min — or let Dolly cheer you up!`
      : 'Out of lives!';
    livesModal.classList.remove('hidden');
  }
  $('lives-close').addEventListener('click', () => livesModal.classList.add('hidden'));
  livesModal.addEventListener('click', e => { if (e.target === livesModal) livesModal.classList.add('hidden'); });
  $('lives-refill').addEventListener('click', () => {
    askConfirm({
      title: 'Refill lives?',
      icon: '❤️',
      name: 'Full Lives',
      desc: 'Back to 5 hearts instantly',
      priceNum: 150,
      priceLabel: '150 🪙',
      gift: 'Not enough coins — Dolly gifts you a free refill 💖 (demo)',
    }, () => {
      if (!Progress.spendCoins(150)) Progress.refillLives(); // Dolly's gift
      Progress.refillLives();
      updateTopbars();
      showToast('❤️ Lives refilled — go crush!');
      setTimeout(() => livesModal.classList.add('hidden'), 400);
    });
  });

  /* ===== share + QR ===== */
  const GAME_URL = 'https://beckyy77.github.io/candy-crush/';
  const qrModal = $('qr');

  function openQr() {
    const box = $('qr-code');
    box.innerHTML = '';
    if (typeof qrcode === 'function') {
      const qr = qrcode(0, 'M');
      qr.addData(GAME_URL);
      qr.make();
      box.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
    } else {
      box.textContent = GAME_URL;
    }
    qrModal.classList.remove('hidden');
  }

  $('share-btn').addEventListener('click', async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Dolly Crush Saga 🍭', text: 'Play Dolly Crush Saga with me!', url: GAME_URL });
        return;
      } catch (e) { /* user cancelled — fall through to QR */ }
    }
    openQr();
  });
  $('qr-close').addEventListener('click', () => qrModal.classList.add('hidden'));
  qrModal.addEventListener('click', e => { if (e.target === qrModal) qrModal.classList.add('hidden'); });
  $('copy-link').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(GAME_URL);
      showToast('🔗 Link copied — send it to a friend!');
    } catch (e) {
      showToast(GAME_URL);
    }
    qrModal.classList.add('hidden');
  });

  /* ===== settings + profile (carried over) ===== */
  const settingsModal = $('settings');
  const playerNameInput = $('player-name');
  const playerEmailInput = $('player-email');
  const emailHint = $('email-hint');
  let profile = { name: '', email: '' };
  let settings = { sound: true, vibration: true, bubbles: true };
  let deferredPrompt = null;

  function loadLocal() {
    try { profile = { ...profile, ...JSON.parse(localStorage.getItem('cc-profile') || '{}') }; } catch {}
    try { settings = { ...settings, ...JSON.parse(localStorage.getItem('cc-settings') || '{}') }; } catch {}
  }

  function applyProfile() {
    const first = (profile.name || '').trim().split(/\s+/)[0];
    $('player-name-label').textContent = first || 'Sign in';
    playerNameInput.value = profile.name || '';
    playerEmailInput.value = profile.email || '';
    renderGreeting();
  }

  $('save-profile').addEventListener('click', () => {
    const name = playerNameInput.value.trim();
    const email = playerEmailInput.value.trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      emailHint.textContent = 'That email doesn’t look right — check it?';
      emailHint.className = 'hint err';
      return;
    }
    profile = { name, email };
    localStorage.setItem('cc-profile', JSON.stringify(profile));
    applyProfile();
    emailHint.textContent = 'Saved! 🎉';
    emailHint.className = 'hint ok';
    buzz(30);
  });

  function applySettings() {
    $('toggle-sound').checked = settings.sound;
    $('toggle-vibration').checked = settings.vibration;
    $('toggle-bubbles').checked = settings.bubbles;
    buildBubbles();
  }

  $('toggle-sound').addEventListener('change', e => {
    settings.sound = e.target.checked;
    localStorage.setItem('cc-settings', JSON.stringify(settings));
    if (settings.sound) sfxSwap();
  });
  $('toggle-vibration').addEventListener('change', e => {
    settings.vibration = e.target.checked;
    localStorage.setItem('cc-settings', JSON.stringify(settings));
    if (settings.vibration) buzz(40);
  });
  $('toggle-bubbles').addEventListener('change', e => {
    settings.bubbles = e.target.checked;
    localStorage.setItem('cc-settings', JSON.stringify(settings));
    buildBubbles();
  });

  // engine hooks
  soundOn = () => settings.sound;
  vibrationOn = () => settings.vibration;

  const openSettings = () => settingsModal.classList.remove('hidden');
  const closeSettings = () => settingsModal.classList.add('hidden');
  $('settings-btn').addEventListener('click', openSettings);
  $('player-chip').addEventListener('click', () => { openSettings(); playerNameInput.focus(); });
  $('settings-close').addEventListener('click', closeSettings);
  settingsModal.addEventListener('click', e => { if (e.target === settingsModal) closeSettings(); });
  window.addEventListener('keydown', e => { if (e.key === 'Escape') { closeSettings(); } });

  /* ===== floating bubbles ===== */
  function buildBubbles() {
    const el = $('bubbles');
    el.innerHTML = '';
    if (!settings.bubbles) return;
    for (let i = 0; i < 18; i++) {
      const b = document.createElement('div');
      b.className = 'bubble p' + (1 + (i % 4));
      const size = 14 + Math.random() * 58;
      b.style.width = b.style.height = size + 'px';
      b.style.left = Math.random() * 100 + '%';
      b.style.animationDuration = 9 + Math.random() * 14 + 's';
      b.style.animationDelay = -Math.random() * 20 + 's';
      b.style.opacity = 0.3 + Math.random() * 0.5;
      el.appendChild(b);
    }
  }

  /* ===== install (PWA) ===== */
  const installBtn = $('install-btn');
  const installHint = $('install-hint');
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
        ? 'Tap the button to install Dolly Crush Saga as an app.'
        : 'Tip: browser menu (⋮) → “Add to Home screen” / “Install app”.';
    }
  }

  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredPrompt = e;
    refreshInstallUI();
  });
  window.addEventListener('appinstalled', () => { deferredPrompt = null; refreshInstallUI(); });
  installBtn.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    refreshInstallUI();
  });

  /* ===== boot ===== */
  function boot() {
    Progress.load();
    loadLocal();
    applyProfile();
    applySettings();
    refreshInstallUI();
    renderHome();
    setInterval(updateTopbars, 30000);
    let resizeT;
    window.addEventListener('resize', () => {
      clearTimeout(resizeT);
      resizeT = setTimeout(renderMap, 200);
    });
    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
      // auto-reload once when a new version takes over, so updates apply fast
      let reloaded = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!reloaded) { reloaded = true; location.reload(); }
      });
    }
  }

  return { showScreen, goHome, renderHome, updateTopbars, openShop, boot };
})();

UI.boot();
