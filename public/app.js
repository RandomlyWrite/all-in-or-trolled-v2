/* ═══════════════════════════════════════════════════════════════
   ALL IN OR TROLLED · client
   ═══════════════════════════════════════════════════════════════ */

/* ─── TELEGRAM SHIM ──────────────────────────────────────── */
(function() {
  if (!window.Telegram) window.Telegram = {};
  if (!window.Telegram.WebApp) window.Telegram.WebApp = {
    __shim: true, ready() {}, expand() {}, close() {},
    HapticFeedback: { impactOccurred() {}, notificationOccurred() {}, selectionChanged() {} }
  };
  try { Telegram.WebApp.ready(); Telegram.WebApp.expand(); } catch(e) {}
})();

const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const escapeHTML = s => String(s).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const tgInitData = () => window.Telegram?.WebApp?.initData || '';
const saveSeat = (code, token) => { try { localStorage.setItem('aot_seat', JSON.stringify({code, token})); } catch (_) {} };
const readSeat = () => { try { return JSON.parse(localStorage.getItem('aot_seat') || 'null'); } catch (_) { return null; } };
const clearSeat = () => { try { localStorage.removeItem('aot_seat'); } catch (_) {} };
function sendSeed(state) {
  if (state.phase !== 'seeding' || !state.fairCommit || State.lastSeedHand === state.handNumber) return;
  if (!window.crypto?.getRandomValues) return toast('Secure RNG unavailable; deck will use published fallback seed.', 'err');
  State.lastSeedHand = state.handNumber;
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const seed = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  try {
    localStorage.setItem(`aot_fair_${state.code}_${state.handNumber}`,
      JSON.stringify({ playerId: state.you, seed, commit: state.fairCommit, dealOrder: state.fairDealOrder }));
  } catch (_) {}
  socket.emit('fair:seed', { handNumber: state.handNumber, seed }, receipt => {
    if (!receipt?.ok) toast('Seed receipt missing. Review this hand proof.', 'err');
  });
}


/* ─── STATE ──────────────────────────────────────────────── */
const State = {
  myId: null,
  myName: '',
  myAvatar: '🎲',
  roomState: null,
  prevHandNumber: 0,
  prevPhase: null, lastSeedHand: 0, lastShownShowdown: 0
};

/* ─── AVATARS ────────────────────────────────────────────── */
const AVATARS = ['🎲', '🤠', '🍺', '💀', '🎰', '🎩', '👑', '🃏', '🔥', '☠️', '🦂', '🗿'];

/* ─── AUDIO ENGINE ───────────────────────────────────────── */
const Sound = {
  ctx: null, master: null, ready: false, muted: false,
  init() {
    if (this.ctx) { this.ctx.resume && this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.0001;
    this.master.connect(this.ctx.destination);
    this._ambient();
    this.ready = true;
    this.master.gain.linearRampToValueAtTime(0.45, this.ctx.currentTime + 1.2);
  },
  _ambient() {
    const c = this.ctx, t = c.currentTime;
    const bus = c.createGain(); bus.gain.value = 0.4; bus.connect(this.master);
    [55, 82.5].forEach((f, i) => {
      const o = c.createOscillator();
      o.type = i === 0 ? 'sawtooth' : 'triangle';
      o.frequency.value = f;
      o.detune.value = i === 0 ? -6 : 6;
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 200; lp.Q.value = 2;
      const g = c.createGain(); g.gain.value = 0.025;
      o.connect(lp).connect(g).connect(bus);
      o.start(t);
    });
  },
  toggle() {
    if (!this.ready) return this.muted;
    this.muted = !this.muted;
    this.master.gain.setTargetAtTime(this.muted ? 0.0001 : 0.45, this.ctx.currentTime, 0.1);
    return this.muted;
  },
  deal() {
    if (!this.ready || this.muted) return;
    const c = this.ctx, t = c.currentTime;
    const osc = c.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(2000, t);
    osc.frequency.exponentialRampToValueAtTime(400, t + 0.06);
    const g = c.createGain();
    g.gain.setValueAtTime(0.08, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    osc.connect(g).connect(this.master);
    osc.start(t); osc.stop(t + 0.1);
  },
  allin() {
    if (!this.ready || this.muted) return;
    const c = this.ctx, t = c.currentTime;
    const osc = c.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(180, t);
    osc.frequency.exponentialRampToValueAtTime(60, t + 0.4);
    const g = c.createGain();
    g.gain.setValueAtTime(0.28, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
    osc.connect(g).connect(this.master);
    osc.start(t); osc.stop(t + 0.5);
    // high ping
    const p = c.createOscillator();
    p.type = 'sine'; p.frequency.value = 2400;
    const pg = c.createGain();
    pg.gain.setValueAtTime(0.12, t + 0.1);
    pg.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
    p.connect(pg).connect(this.master);
    p.start(t + 0.1); p.stop(t + 0.45);
  },
  fold() {
    if (!this.ready || this.muted) return;
    const c = this.ctx, t = c.currentTime;
    const osc = c.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(400, t);
    osc.frequency.exponentialRampToValueAtTime(120, t + 0.25);
    const g = c.createGain();
    g.gain.setValueAtTime(0.15, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
    osc.connect(g).connect(this.master);
    osc.start(t); osc.stop(t + 0.3);
  },
  win() {
    if (!this.ready || this.muted) return;
    const c = this.ctx, t = c.currentTime;
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
      const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = f;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t + i * 0.06);
      g.gain.exponentialRampToValueAtTime(0.15, t + i * 0.06 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.06 + 0.6);
      o.connect(g).connect(this.master);
      o.start(t + i * 0.06); o.stop(t + i * 0.06 + 0.7);
    });
  },
  badbeat() {
    if (!this.ready || this.muted) return;
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(220, t);
    o.frequency.exponentialRampToValueAtTime(28, t + 0.4);
    const g = c.createGain();
    g.gain.setValueAtTime(0.3, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + 0.5);
  }
};

/* ─── HAPTICS ────────────────────────────────────────────── */
const Haptics = {
  fire(kind = 'medium') {
    try {
      const hf = window.Telegram?.WebApp?.HapticFeedback;
      if (hf) {
        if (['light', 'medium', 'heavy'].includes(kind)) hf.impactOccurred(kind);
        else if (['success', 'error', 'warning'].includes(kind)) hf.notificationOccurred(kind);
        else hf.selectionChanged();
      }
    } catch(e) {}
    if (navigator.vibrate) {
      const patterns = { light: [10], medium: [22], heavy: [38], success: [10, 34, 10], error: [44, 60, 44], warning: [26, 44, 26], selection: [8] };
      try { navigator.vibrate(patterns[kind] || [15]); } catch(e) {}
    }
  }
};

/* ─── ASCII BACKDROP (canvas) ────────────────────────────── */
const Backdrop = (() => {
  function setup(canvasId) {
    const cv = document.getElementById(canvasId);
    if (!cv) return null;
    const ctx = cv.getContext('2d');
    let W, H, particles = [], flicker = 0;
    function resize() {
      W = cv.width = cv.clientWidth * (window.devicePixelRatio || 1);
      H = cv.height = cv.clientHeight * (window.devicePixelRatio || 1);
      ctx.setTransform(window.devicePixelRatio || 1, 0, 0, window.devicePixelRatio || 1, 0, 0);
    }
    function initParticles() {
      particles = [];
      for (let i = 0; i < 20; i++) {
        particles.push({ x: Math.random() * cv.clientWidth, y: cv.clientHeight + Math.random() * 100, vy: -0.2 - Math.random() * 0.4, a: 0.1 + Math.random() * 0.2, ch: ['~', '°', 'o', '.', '`'][Math.floor(Math.random() * 5)] });
      }
    }
    resize(); initParticles();
    window.addEventListener('resize', () => { resize(); initParticles(); });
    let last = 0;
    function loop(t) {
      if (t - last < 60) { requestAnimationFrame(loop); return; }
      last = t;
      ctx.clearRect(0, 0, cv.clientWidth, cv.clientHeight);
      flicker += 0.02;
      for (const p of particles) {
        p.y += p.vy;
        p.x += Math.sin(t * 0.001 + p.a * 10) * 0.3;
        if (p.y < -10) { p.y = cv.clientHeight + 10; p.x = Math.random() * cv.clientWidth; }
        ctx.globalAlpha = p.a * (0.6 + 0.4 * Math.sin(t * 0.003 + p.a * 5));
        ctx.fillStyle = '#E5DFC5';
        ctx.font = '10px ui-monospace, monospace';
        ctx.fillText(p.ch, p.x, p.y);
      }
      // flicker band
      ctx.globalAlpha = 0.03 + 0.02 * Math.sin(flicker);
      ctx.fillStyle = '#FF5D1B';
      ctx.fillRect(0, 0, cv.clientWidth, cv.clientHeight * 0.3);
      ctx.globalAlpha = 1;
      requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
  }
  return { setup };
})();

/* ─── SOCKET ─────────────────────────────────────────────── */
const socket = io();

socket.on('connect', () => {
  State.myId = socket.id;
  const saved = readSeat();
  if (saved?.code && saved?.token) {
    socket.emit('room:resume', saved, response => {
      if (!response.ok) { clearSeat(); showScreen('lobby'); }
    });
  }
});

socket.on('room:state', state => {
  State.roomState = state;
  sendSeed(state);
  render();
});

/* ─── LOBBY UI ───────────────────────────────────────────── */
function buildLobby() {
  Backdrop.setup('bg-canvas');
  const avatars = $('#avatar-picker');
  avatars.innerHTML = '';
  AVATARS.forEach((a, i) => {
    const b = document.createElement('button');
    b.className = 'av-btn' + (i === 0 ? ' sel' : '');
    b.textContent = a;
    b.onclick = () => {
      $$('.av-btn').forEach(x => x.classList.remove('sel'));
      b.classList.add('sel');
      State.myAvatar = a;
      Sound.init();
    };
    avatars.appendChild(b);
  });
  State.myAvatar = AVATARS[0];

  $('#btn-create').onclick = () => {
    const name = ($('#name-input').value || 'Degen').trim().slice(0, 12);
    if (!name) { $('#lobby-err').textContent = 'Name required.'; return; }
    State.myName = name;
    Sound.init(); Haptics.fire('heavy');
    socket.emit('room:create', { name, avatar: State.myAvatar, initData: tgInitData() }, res => {
      if (res.ok) {
        State.myId = socket.id;
        saveSeat(res.code, res.token);
        showScreen('waiting');
      } else {
        $('#lobby-err').textContent = res.error || 'Cannot create room.';
      }
    });
  };

  $('#btn-join').onclick = () => {
    const name = ($('#name-input').value || 'Degen').trim().slice(0, 12);
    const code = ($('#code-input').value || '').toUpperCase().trim();
    if (!code) { $('#lobby-err').textContent = 'Room code required.'; return; }
    State.myName = name;
    Sound.init(); Haptics.fire('medium');
    socket.emit('room:join', { code, name, avatar: State.myAvatar, initData: tgInitData() }, res => {
      if (res.ok) {
        State.myId = socket.id;
        saveSeat(res.code, res.token);
        showScreen('waiting');
      } else {
        $('#lobby-err').textContent = res.error || 'Cannot join.';
      }
    });
  };

  $('#code-input').addEventListener('input', e => {
    e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  });
}

function showScreen(name) {
  $$('.screen').forEach(s => s.classList.remove('active'));
  const el = $('#screen-' + name);
  if (el) el.classList.add('active');
}

/* ─── WAITING UI ─────────────────────────────────────────── */
function renderWaiting() {
  const s = State.roomState;
  if (!s) return;
  $('#wait-code').textContent = s.code;
  const list = $('#wait-players');
  list.innerHTML = '';
  s.players.forEach(p => {
    const el = document.createElement('div');
    el.className = 'wp' + (p.isYou ? ' you' : '');
    el.innerHTML = `<span class="av">${escapeHTML(p.avatar)}</span><span class="nm">${escapeHTML(p.name)}</span>${p.isHost ? '<span class="tag">HOST</span>' : ''}`;
    list.appendChild(el);
  });
  // fill empty seats
  for (let i = s.players.length; i < 6; i++) {
    const el = document.createElement('div');
    el.className = 'wp';
    el.style.opacity = '0.4';
    el.innerHTML = `<span class="av">—</span><span class="nm">empty seat</span>`;
    list.appendChild(el);
  }
  const startBtn = $('#btn-start');
  startBtn.disabled = s.phase !== 'lobby' || !s.isHost;
  startBtn.textContent = s.phase === 'seeding' ? 'SEALING DECK…' : (s.isHost ? 'Start Tournament' : 'Waiting for host…');
}

/* ─── TABLE RENDER ───────────────────────────────────────── */
const SEAT_POSITIONS = [
  { left: '50%', top: '88%' },  // 0 hero
  { left: '9%', top: '68%' },   // 1
  { left: '12%', top: '22%' },  // 2
  { left: '50%', top: '10%' },  // 3
  { left: '88%', top: '22%' },  // 4
  { left: '91%', top: '68%' }   // 5
];

function renderPlaying() {
  const s = State.roomState;
  if (!s) return;

  // HUD
  $('#hud-level').textContent = `TABLE 7 · HAND ${s.handNumber}`;
  $('#hud-blinds').textContent = `ANTE ${s.ante.toLocaleString()}`;
  $('#hud-alive').textContent = s.aliveCount;

  // Board
  const board = $('#board');
  board.innerHTML = '';
  for (let i = 0; i < 5; i++) {
    const c = s.board[i];
    const el = document.createElement('div');
    if (c) {
      el.className = 'bcard ' + (c.red ? 'red' : 'black');
      el.innerHTML = `<span class="r">${c.rank}</span><span class="s">${c.suit}</span>`;
      el.classList.add('reveal');
      el.style.animationDelay = (i * 180) + 'ms';
    } else {
      el.className = 'bcard slot';
    }
    board.appendChild(el);
  }

  // Pot
  $('#pot').textContent = `POT · ${s.pot}`;

  // Dealer button position
  const myIdx = Math.max(0, s.players.findIndex(p => p.isYou));
  const dealerVisibleIdx = (s.buttonIdx - myIdx + s.players.length) % s.players.length;
  const btnPos = SEAT_POSITIONS[dealerVisibleIdx];
  const db = $('#dealer-btn');
  db.style.left = btnPos.left;
  db.style.top = (parseFloat(btnPos.top) - 8) + '%';

  // Seats
  const seats = $('#seats');
  seats.innerHTML = '';

  s.players.forEach((p, i) => {
    const idx = (i - myIdx + s.players.length) % s.players.length;
    const pos = SEAT_POSITIONS[idx];
    const seat = document.createElement('div');
    const isHero = i === myIdx;
    seat.className = 'seat' + (isHero ? ' hero' : '') + (p.folded ? ' folded' : '') + (!p.alive ? ' eliminated' : '') + (s.currentTurnPlayerId === p.id ? ' acting' : '');
    seat.style.left = pos.left;
    seat.style.top = pos.top;
    let badge = '';
    if (p.allIn) badge = '<div class="act-badge show allin">ALL IN</div>';
    else if (p.folded && p.alive) badge = '<div class="act-badge show fold">FOLD</div>';
    else if (s.showdown && s.showdown.winners && s.showdown.winners.includes(p.id)) badge = '<div class="act-badge show win">WINNER</div>';
    seat.innerHTML = `${badge}
      <div class="avatar">${escapeHTML(p.avatar)}</div>
      <div class="seat-info">
        <div class="seat-name">${escapeHTML(p.name)}${p.isYou ? ' (you)' : ''}</div>
        <div class="seat-stack ${p.stack <= s.ante * 5 ? 'short' : ''}">${p.stack}</div>
      </div>`;
    seats.appendChild(seat);

    // Mini hand for non-hero
    if (!isHero && p.hole && p.hole.length > 0 && !p.folded) {
      const mh = document.createElement('div');
      mh.className = 'mini-hand';
      mh.style.left = pos.left;
      mh.style.top = `calc(${pos.top} - 46px)`;
      mh.style.transform = 'translate(-50%, -50%)';
      p.hole.forEach(card => {
        if (card) {
          const ch = document.createElement('div');
          ch.className = 'hcard revealed ' + (card.red ? 'red' : 'black');
          ch.innerHTML = `<span>${card.rank}</span><span style="font-size:7px">${card.suit}</span>`;
          mh.appendChild(ch);
        } else {
          const ch = document.createElement('div');
          ch.className = 'hcard';
          mh.appendChild(ch);
        }
      });
      seats.appendChild(mh);
    }
  });

  // Hero cards
  const hc = $('#hero-cards');
  const hero = s.players[myIdx];
  if (hero && hero.hole && hero.hole.length > 0 && !hero.folded && hero.alive) {
    const html = hero.hole.map(c => c ? `<div class="hcard ${c.red ? 'red' : 'black'}"><span class="r">${c.rank}</span><span class="s">${c.suit}</span></div>` : '<div class="hcard"></div>').join('');
    if (hc.innerHTML !== html) {
      hc.innerHTML = html;
      requestAnimationFrame(() => {
        hc.querySelectorAll('.hcard').forEach((el, i) => {
          setTimeout(() => el.classList.add('dealt'), i * 80);
        });
      });
    }
  } else {
    hc.innerHTML = '';
  }

  // Edge charge on my turn
  const isMyTurn = s.currentTurnPlayerId === s.you && s.phase === 'preflop';
  const table = $('#table');
  table.classList.toggle('charged', isMyTurn);

  // Action buttons
  const btnAllin = $('#btn-allin');
  const btnFold = $('#btn-fold');
  if (isMyTurn) {
    btnAllin.disabled = false;
    btnFold.disabled = false;
    $('#allin-amt').textContent = `SHOVE ${hero.stack}`;
  } else {
    btnAllin.disabled = true;
    btnFold.disabled = true;
    if (s.phase === 'showdown') {
      $('#allin-amt').textContent = 'SHOWDOWN';
    } else if (s.phase === 'ended') {
      $('#allin-amt').textContent = 'ENDED';
    } else if (s.currentTurnPlayerId) {
      const turner = s.players.find(p => p.id === s.currentTurnPlayerId);
      $('#allin-amt').textContent = turner ? `WAITING · ${turner.name}` : 'WAITING';
    } else {
      $('#allin-amt').textContent = 'WAITING';
    }
  }

  // Flavor bar
  const fb = $('#flavor-bar');
  if (fb.textContent !== s.lastFlavor) {
    fb.classList.remove('show');
    setTimeout(() => {
      fb.textContent = s.lastFlavor;
      fb.classList.add('show');
    }, 150);
  }

  // Showdown overlay
  const overlay = $('#showdown-overlay');
  if (s.phase === 'showdown' && s.showdown) {
    overlay.classList.add('active');
    $('#sd-who').textContent = s.showdown.winnerName;
    $('#sd-hand').textContent = s.showdown.winnerHandName;
    $('#sd-pot').textContent = `POT · ${s.showdown.potSize}`;
    // audio
    if (State.lastShownShowdown !== s.handNumber) {
      State.lastShownShowdown = s.handNumber;
      if (s.showdown.winners.includes(hero?.id)) { Sound.win(); Haptics.fire('success'); }
      else { Sound.badbeat(); Haptics.fire('warning'); }
      // hero card shatter if lost
      if (hero && !s.showdown.winners.includes(hero.id) && hero.hole && hero.hole.length > 0 && !hero.folded) {
        hc.querySelectorAll('.hcard').forEach(el => el.classList.add('shatter'));
      }
    }
  } else {
    overlay.classList.remove('active');
  }
}

/* ─── ENDED ──────────────────────────────────────────────── */
function renderEnded() {
  const s = State.roomState;
  if (!s) return;
  const hero = s.players.find(p => p.isYou);
  const winner = s.players.find(p => p.alive);
  const screen = $('#screen-ended');
  if (hero && hero.alive) {
    screen.classList.add('win');
    $('#end-title').textContent = 'TOURNAMENT WON';
    $('#end-text').textContent = `${hero.name} takes the felt. The croupier files no report.`;
  } else {
    screen.classList.remove('win');
    $('#end-title').textContent = 'ELIMINATED';
    $('#end-text').textContent = winner ? `${winner.name} takes it all. You are out. The house is unmoved.` : 'The table is empty.';
  }
}

/* ─── RENDER ROUTER ──────────────────────────────────────── */
function render() {
  const s = State.roomState;
  if (!s) return;
  if (!State.myId) State.myId = socket.id;

  if (State.prevPhase !== s.phase && s.phase === 'preflop') Sound.init();
  if (s.handNumber > State.prevHandNumber) {
    Sound.deal(); Haptics.fire('light');
    State.prevHandNumber = s.handNumber;
  }

  if (s.phase === 'lobby' || s.phase === 'seeding') {
    showScreen('waiting');
    renderWaiting();
  } else if (s.phase === 'preflop' || s.phase === 'showdown') {
    showScreen('playing');
    renderPlaying();
  } else if (s.phase === 'ended') {
    showScreen('ended');
    renderEnded();
  } else if (s.phase === 'halted') {
    showScreen('ended');
    $('#end-title').textContent = 'INTEGRITY HALT';
    $('#end-text').textContent = s.lastFlavor;
    $('#screen-ended').classList.remove('win');
  }
  State.prevPhase = s.phase;
}

/* ─── ACTION HANDLERS ────────────────────────────────────── */
function setupActions() {
  $('#btn-start').onclick = () => {
    socket.emit('game:start');
    Haptics.fire('heavy');
  };
  $('#btn-leave').onclick = () => {
    clearSeat();
    socket.disconnect();
    location.reload();
  };
  $('#btn-again').onclick = () => {
    clearSeat();
    location.reload();
  };
  $('#btn-sound').onclick = e => {
    Sound.init();
    const muted = Sound.toggle();
    e.currentTarget.textContent = muted ? '🔇' : '🔊';
    Haptics.fire('selection');
  };

  const btnAllin = $('#btn-allin');
  const btnFold = $('#btn-fold');

  // Native click handles touch, mouse, keyboard, and accessibility consistently.
  const commitAction = (action) => {
    if (btnAllin.disabled || btnFold.disabled) return;
    btnAllin.disabled = btnFold.disabled = true;
    if (action === 'allin') { Sound.allin(); Haptics.fire('heavy'); }
    else { Sound.fold(); Haptics.fire('medium'); }
    socket.emit('game:action', { action });
  };
  btnAllin.addEventListener('click', () => commitAction('allin'));
  btnFold.addEventListener('click', () => commitAction('fold'));
  $('#btn-proof').addEventListener('click', () => {
    const game = State.roomState;
    if (!game || !State.lastShownShowdown) return toast('Shuffle proof appears after showdown.');
    const url = `${location.origin}/api/fairness/${encodeURIComponent(game.code)}/${State.lastShownShowdown}`;
    if (window.Telegram?.WebApp?.openLink && !window.Telegram.WebApp.__shim) Telegram.WebApp.openLink(url);
    else window.open(url, '_blank', 'noopener,noreferrer');
  });

  // Foil shimmer follow pointer across action buttons
  document.addEventListener('pointermove', e => {
    const r = btnAllin.getBoundingClientRect();
    if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
      const fx = ((e.clientX - r.left) / r.width) * 100;
      const fy = ((e.clientY - r.top) / r.height) * 100;
      btnAllin.style.setProperty('--fx', fx + '%');
      btnAllin.style.setProperty('--fy', fy + '%');
    }
    const rf = btnFold.getBoundingClientRect();
    if (e.clientX >= rf.left && e.clientX <= rf.right && e.clientY >= rf.top && e.clientY <= rf.bottom) {
      const fx = ((e.clientX - rf.left) / rf.width) * 100;
      const fy = ((e.clientY - rf.top) / rf.height) * 100;
      btnFold.style.setProperty('--fx', fx + '%');
      btnFold.style.setProperty('--fy', fy + '%');
    }
  });
}

/* ─── GAME CANVAS BACKDROP ───────────────────────────────── */
function setupGameBackdrop() {
  Backdrop.setup('game-canvas');
}

/* ─── INIT ───────────────────────────────────────────────── */
(function init() {
  buildLobby();
  setupActions();
  // Defer game canvas setup until screen is created
  const observer = new MutationObserver(() => {
    if ($('#screen-playing').classList.contains('active') && !$('#game-canvas')._setupDone) {
      $('#game-canvas')._setupDone = true;
      setupGameBackdrop();
    }
  });
  observer.observe($('#screen-playing'), { attributes: true, attributeFilter: ['class'] });

  // Reload on disconnect
  socket.on('disconnect', () => {
    toast('Disconnected. The felt does not wait.', 'err');
  });

  setInterval(() => {
    const s = State.roomState, el = $('#hud-timer');
    if (!el) return;
    if (s?.turnDeadline && s.phase === 'preflop') {
      el.textContent = `${Math.max(0, Math.ceil((s.turnDeadline - Date.now()) / 1000))}s`;
    } else el.textContent = '';
  }, 200);
})();

/* ─── TOAST ──────────────────────────────────────────────── */
function toast(msg, type = '') {
  const stack = $('#toasts');
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  t.textContent = msg;
  stack.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 2200);
}
