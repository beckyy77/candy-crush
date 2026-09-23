'use strict';

/* ============================================================
   Dolly Crush Saga — Versus Mode ⚔️
   Real-time duels with a friend over the internet:
   - create a room, share the code / QR / link
   - both play the SAME seeded board (race, 20 moves)
   - live opponent score bar, quick-chat bubbles (8-ball style)
   - text chat in the waiting room, rematch, forfeit detection
   Built on Firebase Realtime Database (loaded lazily from CDN).
   ============================================================ */

const MP = (() => {
  const SDK = 'https://www.gstatic.com/firebasejs/10.12.2/';
  const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const DUEL_MOVES = 20;
  const QUICK_CHAT = [
    'Good luck! 🍀', 'Nice! 👏', 'Wow! 😮', 'Boom! 💥',
    'So close! 😅', 'Too slow! 😜', 'Uh oh… 😬', 'Good game! 🤝',
  ];

  const $ = id => document.getElementById(id);
  const modal = $('versus');

  let db = null;
  let roomRef = null, meRef = null;
  let roomCode = null, role = null;          // role: 'host' | 'guest'
  let phase = 'idle';                        // idle | waiting | playing | result
  let lastChatAt = 0;
  let forfeitTimer = null;
  let listeners = [];
  let pendingState = null, stateTimer = null, lastSent = null;

  /* ===== config & lazy SDK load ===== */
  const enabled = () => !!(window.FIREBASE_ENABLED && window.FIREBASE_ENABLED());

  function loadScript(src) {
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src; s.async = true;
      s.onload = res;
      s.onerror = () => rej(new Error('could not load ' + src));
      document.head.appendChild(s);
    });
  }

  async function initSdk() {
    if (db) return true;
    if (!enabled()) return false;
    await loadScript(SDK + 'firebase-app-compat.js');
    await loadScript(SDK + 'firebase-auth-compat.js');
    await loadScript(SDK + 'firebase-database-compat.js');
    const app = firebase.apps.length ? firebase.app() : firebase.initializeApp(window.FIREBASE_CONFIG);
    await firebase.auth(app).signInAnonymously().catch(() => {}); // best effort
    db = firebase.database(app);
    return true;
  }

  /* ===== helpers ===== */
  const genCode = () => Array.from({ length: 5 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
  const inviteUrl = () => roomCode
    ? (location.protocol.startsWith('http') ? location.origin + location.pathname : 'https://beckyy77.github.io/candy-crush/') + '?room=' + roomCode
    : '';
  function myName() {
    try { return ((JSON.parse(localStorage.getItem('cc-profile') || '{}').name || '').trim().split(/\s+/)[0] || 'Player').slice(0, 18); }
    catch { return 'Player'; }
  }
  function myAvatar() {
    const a = ['😀', '😎', '🥳', '🐱', '🦊', '🐼', '🐯', '🦄', '🐸', '👑'];
    let h = 0; for (const ch of myName()) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return a[h % a.length];
  }
  const mkPlayer = () => ({ name: myName(), avatar: myAvatar(), connected: false, score: 0, movesLeft: DUEL_MOVES, finished: false, rematch: false });

  function on(ref, ev, cb) { ref.on(ev, cb); listeners.push([ref, ev, cb]); }
  function detachAll() { for (const [r, e, c] of listeners) r.off(e, c); listeners = []; }

  function status(msg) { $('vs-status').textContent = msg || ''; }

  /* ===== lobby views ===== */
  function showLobbyView() {
    $('vs-room').classList.add('hidden');
    $('vs-lobby').classList.remove('hidden');
    const ok = enabled();
    $('vs-setup-help').classList.toggle('hidden', ok);
    $('vs-create').classList.toggle('hidden', !ok);
    $('vs-join').classList.toggle('hidden', !ok);
    status('');
  }

  function showRoomView() {
    $('vs-lobby').classList.add('hidden');
    $('vs-room').classList.remove('hidden');
    $('vs-room-code').textContent = roomCode || '—';
    renderInvite();
  }

  function openLobby() {
    modal.classList.remove('hidden');
    hideQuick();
    if (phase === 'waiting') return showRoomView(); // rejoin our open room
    if (!enabled()) return showLobbyView();
    if (!navigator.onLine) status('You look offline — battles need internet 📡');
    initSdk().catch(() => status('Could not load multiplayer — check your internet 📡'));
    showLobbyView();
  }

  /* ===== rooms ===== */
  async function createRoom() {
    if (!navigator.onLine) return status('You look offline — battles need internet 📡');
    status('Creating room…');
    try {
      if (!(await initSdk())) return showLobbyView();
      for (let attempt = 0; attempt < 5; attempt++) {
        const code = genCode();
        const ref = db.ref('rooms/' + code);
        const room = {
          v: 1,
          state: 'waiting',
          createdAt: firebase.database.ServerValue.TIMESTAMP,
          seed: 0,
          moves: DUEL_MOVES,
          host: mkPlayer(),
          guest: null,
          chat: {},
        };
        const res = await ref.transaction(cur => (cur === null ? room : undefined));
        if (res.committed) return enterRoom(code, 'host');
      }
      status('Rooms were full of candy — try again! ⚠️');
    } catch (e) {
      status('Could not create a room. Check FIREBASE-SETUP.md 🛠️');
    }
  }

  async function joinRoom(codeRaw) {
    const code = String(codeRaw || '').trim().toUpperCase();
    if (code.length < 4) return status('Enter the code your friend gave you 🔑');
    if (!navigator.onLine) return status('You look offline — battles need internet 📡');
    status('Joining…');
    try {
      if (!(await initSdk())) return showLobbyView();
      const ref = db.ref('rooms/' + code);
      const snap = await ref.get();
      if (!snap.exists()) return status('No room with that code — check it? 🤔');
      const room = snap.val();
      if (room.state !== 'waiting') return status('That match already started! 💨');
      if (room.guest && room.guest.connected) return status('That room is already full 👥');
      const res = await ref.transaction(cur => {
        if (!cur || cur.state !== 'waiting') return undefined;
        if (cur.guest && cur.guest.connected) return undefined;
        return { ...cur, guest: mkPlayer() };
      });
      if (!res.committed) return status('Room filled up just now — try another! ⚡');
      enterRoom(code, 'guest');
    } catch (e) {
      status('Could not join. Check your internet 📡');
    }
  }

  function enterRoom(code, myRole) {
    roomCode = code; role = myRole; phase = 'waiting';
    lastSent = null; pendingState = null;
    roomRef = db.ref('rooms/' + code);
    meRef = roomRef.child(role);
    status('');
    showRoomView();

    // presence: flip connected=false if we drop
    on(db.ref('.info/connected'), 'value', s => {
      if (!s.val() || !meRef) return;
      meRef.onDisconnect().update({ connected: false });
      meRef.update({ connected: true });
    });

    // chat (last 30 messages, live)
    on(roomRef.child('chat').limitToLast(30), 'child_added', snap => {
      const m = snap.val() || {};
      addChatMessage(m, m.from === role);
      if (m.from !== role) {
        if (typeof sfxChat === 'function') sfxChat();
        if (typeof buzz === 'function') buzz(15);
      }
    });

    // the whole room, live
    on(roomRef, 'value', snap => onRoom(snap.val()));
  }

  function leaveRoom() {
    if (forfeitTimer) { clearTimeout(forfeitTimer); forfeitTimer = null; }
    if (stateTimer) { clearTimeout(stateTimer); stateTimer = null; }
    pendingState = null; lastSent = null;
    detachAll();
    if (meRef) { try { meRef.onDisconnect().cancel(); meRef.update({ connected: false }); } catch {} }
    const ref = roomRef, wasHost = role === 'host', wasPlaying = phase === 'playing', wasResult = phase === 'result';
    if (ref && (wasHost || wasResult)) {
      // waiting rooms die instantly; finished rooms linger briefly for the result screen
      setTimeout(() => { try { ref.remove(); } catch {} }, wasResult ? 15000 : wasPlaying ? 20000 : 0);
    }
    roomRef = meRef = null; roomCode = null; role = null; phase = 'idle';
    $('vs-chat-log').innerHTML = '';
  }

  function roomGone() {
    const wasPlaying = phase === 'playing';
    detachAll();
    roomRef = meRef = null; roomCode = null; role = null; phase = 'idle';
    hideQuick();
    if (typeof UI !== 'undefined') UI.showToast('Room closed 🚪');
    if (wasPlaying && typeof duelResultShow === 'function') {
      duelResultShow({ winner: 'you', reason: 'left' }); // host vanished -> you take it
    } else if (!modal.classList.contains('hidden')) {
      showLobbyView();
    }
  }

  /* ===== live room updates ===== */
  function onRoom(room) {
    if (!room) return roomGone();
    const oppKey = role === 'host' ? 'guest' : 'host';
    const opp = room[oppKey];

    if (phase === 'waiting') {
      renderPlayers(room);
      const ready = !!(opp && opp.connected);
      $('vs-start').classList.toggle('hidden', !(role === 'host' && ready));
      $('vs-room-status').textContent = ready
        ? (role === 'host' ? 'Friend is in — start the battle! ⚔️' : 'Ready! Waiting for the host to start… 🕐')
        : 'Waiting for a friend to join… ⏳';
    }

    if (room.state === 'playing' && phase !== 'playing') beginDuel(room);

    if (phase === 'playing') {
      if (opp) duelOpponentUpdate(opp);
      if (opp && opp.connected === false) scheduleForfeitCheck();
      else cancelForfeitCheck();

      const meFin = room[role] && room[role].finished;
      const oppFin = opp && opp.finished;
      if (!room.result && meFin && oppFin && role === 'host') {
        const hostScore = room.host.finalScore || 0;
        const guestScore = room.guest.finalScore || 0;
        const winner = hostScore > guestScore ? 'host' : guestScore > hostScore ? 'guest' : 'draw';
        roomRef.child('result').set({ winner, reason: 'score' });
      }
    }

    if (room.result && phase === 'playing') {
      phase = 'result';
      duelResultShow(room.result);
    }

    // rematch handshake: both clicked rematch -> host restarts the room
    if (room.result && phase === 'result'
      && room.host && room.guest && room.host.rematch && room.guest.rematch
      && role === 'host') {
      const seed = ((Math.random() * 0x7fffffff) | 0) || 424243;
      roomRef.update({
        state: 'playing', seed, result: null, moves: DUEL_MOVES,
        'host/score': 0, 'host/movesLeft': DUEL_MOVES, 'host/finished': false, 'host/rematch': false,
        'guest/score': 0, 'guest/movesLeft': DUEL_MOVES, 'guest/finished': false, 'guest/rematch': false,
      });
    }
  }

  function beginDuel(room) {
    phase = 'playing';
    modal.classList.add('hidden');
    hideQuick();
    const oppKey = role === 'host' ? 'guest' : 'host';
    const opp = room[oppKey] || {};
    duelBegin({
      seed: (room.seed >>> 0) || 12345,
      moves: room.moves || DUEL_MOVES,
      opponent: { name: String(opp.name || 'Rival').slice(0, 18), avatar: opp.avatar || '🙂' },
      myRole: role,
    });
  }

  /* ===== score sync (throttled) ===== */
  function reportState(score, movesLeft) {
    if (!meRef || phase !== 'playing') return;
    pendingState = { score, movesLeft };
    if (!stateTimer) stateTimer = setTimeout(flushState, 200);
  }

  function flushState() {
    stateTimer = null;
    if (!pendingState || !meRef) { pendingState = null; return; }
    const p = pendingState; pendingState = null;
    if (lastSent && lastSent.score === p.score && lastSent.movesLeft === p.movesLeft) return;
    lastSent = p;
    meRef.update(p).catch(() => { lastSent = null; });
  }

  function reportFinished(finalScore) {
    if (!meRef) return;
    if (stateTimer) { clearTimeout(stateTimer); stateTimer = null; }
    pendingState = null; lastSent = null;
    meRef.update({ score: finalScore, movesLeft: 0, finished: true, finalScore });
  }

  /* ===== forfeit detection ===== */
  function scheduleForfeitCheck() {
    if (forfeitTimer) return;
    forfeitTimer = setTimeout(() => {
      forfeitTimer = null;
      if (!roomRef || phase !== 'playing') return;
      roomRef.get().then(s => {
        const room = s.val();
        const oppKey = role === 'host' ? 'guest' : 'host';
        if (phase === 'playing' && room && !room.result && room[oppKey] && room[oppKey].connected === false) {
          roomRef.child('result').transaction(cur => cur || { winner: role, reason: 'forfeit' });
        }
      }).catch(() => {});
    }, 6000);
  }
  function cancelForfeitCheck() { if (forfeitTimer) { clearTimeout(forfeitTimer); forfeitTimer = null; } }

  function forfeit() {
    if (roomRef && phase === 'playing') {
      const winner = role === 'host' ? 'guest' : 'host';
      roomRef.child('result').transaction(cur => cur || { winner, reason: 'forfeit' }).catch(() => {});
    }
    leaveRoom();
  }

  function requestRematch() {
    if (!meRef) return;
    meRef.update({ rematch: true });
    if (typeof UI !== 'undefined') UI.showToast('Rematch requested — waiting for your friend… ⏳');
  }

  function onResultShown() { phase = 'result'; }

  /* ===== chat ===== */
  function sendChat(text) {
    text = String(text || '').trim().slice(0, 120);
    if (!text || !roomRef) return;
    const now = Date.now();
    if (now - lastChatAt < 1200) return; // no spamming 😄
    lastChatAt = now;
    roomRef.child('chat').push({
      from: role,
      name: myName(),
      text,
      ts: firebase.database.ServerValue.TIMESTAMP,
    });
  }

  function addChatMessage(m, mine) {
    // waiting-room log
    const log = $('vs-chat-log');
    if (log) {
      const row = document.createElement('div');
      row.className = 'vmsg' + (mine ? ' mine' : '');
      const b = document.createElement('b');
      b.textContent = (mine ? 'You' : (m.name || 'Rival')) + ': ';
      const t = document.createElement('span');
      t.textContent = m.text || '';
      row.append(b, t);
      log.appendChild(row);
      while (log.children.length > 40) log.firstChild.remove();
      log.scrollTop = log.scrollHeight;
    }

    // in-game bubble (8-ball style, floats over the board)
    if (typeof isDuelActive === 'function' && isDuelActive()) {
      const box = $('chat-bubbles');
      const bub = document.createElement('div');
      bub.className = 'chat-bubble ' + (mine ? 'mine' : 'opp');
      bub.textContent = m.text || '';
      box.appendChild(bub);
      while (box.children.length > 3) box.firstChild.remove();
      setTimeout(() => { if (bub.parentNode) bub.remove(); }, 3500);
    }
  }

  function buildQuickChat() {
    const qc = $('quickchat');
    qc.innerHTML = '';
    for (const phrase of QUICK_CHAT) {
      const b = document.createElement('button');
      b.className = 'qc-btn';
      b.textContent = phrase;
      b.addEventListener('click', () => { sendChat(phrase); hideQuick(); });
      qc.appendChild(b);
    }
  }

  function toggleQuick() {
    const qc = $('quickchat');
    if (qc.classList.contains('hidden')) qc.classList.remove('hidden');
    else qc.classList.add('hidden');
  }
  function hideQuick() { $('quickchat').classList.add('hidden'); }

  /* ===== lobby DOM wiring ===== */
  $('versus-btn').addEventListener('click', openLobby);
  $('versus-close').addEventListener('click', () => modal.classList.add('hidden'));
  modal.addEventListener('click', e => { if (e.target === modal) modal.classList.add('hidden'); });
  $('vs-create').addEventListener('click', createRoom);
  $('vs-join').addEventListener('click', () => joinRoom($('vs-code').value));
  $('vs-code').addEventListener('keydown', e => { if (e.key === 'Enter') joinRoom($('vs-code').value); });
  $('vs-code').addEventListener('input', e => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5); });
  $('vs-leave').addEventListener('click', () => { leaveRoom(); showLobbyView(); });
  $('vs-start').addEventListener('click', async () => {
    if (!roomRef || role !== 'host') return;
    const seed = ((Math.random() * 0x7fffffff) | 0) || 424243;
    await roomRef.update({ state: 'playing', seed, moves: DUEL_MOVES, result: null });
  });
  $('vs-copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(inviteUrl());
      if (typeof UI !== 'undefined') UI.showToast('🔗 Invite copied — send it to a friend!');
    } catch { if (typeof UI !== 'undefined') UI.showToast(inviteUrl()); }
  });
  $('vs-share').addEventListener('click', async () => {
    const url = inviteUrl();
    try {
      if (navigator.share) { await navigator.share({ title: 'Dolly Crush duel ⚔️', text: `Beat me in Dolly Crush! Room ${roomCode}`, url }); return; }
    } catch (e) { if (e && e.name === 'AbortError') return; /* cancelled — not an error */ }
    if (typeof UI !== 'undefined') UI.showToast('Share needs HTTPS — copy the invite instead 🔗');
  });
  $('vs-chat-send').addEventListener('click', () => { sendChat($('vs-chat-input').value); $('vs-chat-input').value = ''; });
  $('vs-chat-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') { sendChat($('vs-chat-input').value); $('vs-chat-input').value = ''; }
  });
  $('chat-fab').addEventListener('click', toggleQuick);
  buildQuickChat();

  /* ===== invite QR ===== */
  function renderInvite() {
    const box = $('vs-qr');
    box.innerHTML = '';
    const url = inviteUrl();
    try {
      if (typeof qrcode === 'function' && url) {
        const qr = qrcode(0, 'M');
        qr.addData(url);
        qr.make();
        box.innerHTML = qr.createSvgTag({ cellSize: 3, margin: 2, scalable: true });
      }
    } catch { box.textContent = ''; }
  }

  function renderPlayers(room) {
    const me = room[role] || {};
    const opp = room[role === 'host' ? 'guest' : 'host'];
    const esc = s => String(s || '').replace(/[<>&"]/g, '');
    $('vs-players').innerHTML = `
      <div class="vs-player"><span class="vs-avatar">${esc(me.avatar)}</span><b>${esc(me.name)}</b><small>you</small></div>
      <div class="vs-vs">⚔️</div>
      <div class="vs-player ${opp && opp.connected ? '' : 'wait'}">
        <span class="vs-avatar">${opp ? esc(opp.avatar) : '⏳'}</span>
        <b>${opp ? esc(opp.name) : 'Waiting…'}</b>
        <small>${opp && opp.connected ? 'ready!' : 'share the code'}</small>
      </div>`;
  }

  /* ===== invite deep link (?room=CODE) ===== */
  function handleRoomLink(code) {
    if (!enabled() || !navigator.onLine) return;
    openLobby();
    joinRoom(code);
  }

  window.addEventListener('pagehide', () => { if (phase === 'waiting') leaveRoom(); });
  window.addEventListener('beforeunload', () => { if (phase === 'waiting') leaveRoom(); });

  return {
    enabled, openLobby, handleRoomLink,
    createRoom, joinRoom, leaveRoom, forfeit, requestRematch, onResultShown,
    reportState, reportFinished, sendChat, hideQuick,
    get roomCode() { return roomCode; },
    get phase() { return phase; },
  };
})();
