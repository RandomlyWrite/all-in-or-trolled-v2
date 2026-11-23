'use strict';
/* ALL IN OR TROLLED v2 | play-chip Telegram Mini App | one-process prototype */
const express = require('express');
const http = require('node:http');
const path = require('node:path');
const crypto = require('node:crypto');
const { Server } = require('socket.io');
const { settlePots } = require('./lib/poker');
const { newSeed, sha256, makeCommit, shuffledDeck, proveDeck, verifyProof } = require('./lib/fairness');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 12_000 });
app.use(express.static(path.join(__dirname, 'public')));
app.get('/api/health', (_req, res) => res.json({ ok: true, mode: 'play-chips', version: 2 }));

const CONFIG = Object.freeze({ startingStack: 30_000, ante: 500, maxPlayers: 6,
  turnMs: 18_000, seedWindowMs: 4_000, nextHandDelayMs: 1_300 });
const BOT_NAMES = ['Rusty_Pint', 'Dr_Muck', 'LadyLuck99', 'ChipFiend', 'AllInAndy'];
const BOT_AVATARS = ['🍺', '💀', '🎰', '🎩', '👑'];
const ALLOWED_AVATARS = new Set(['🎲', '🤠', '🍺', '💀', '🎰', '🎩', '👑', '🃏', '🔥', '☠️', '🦂', '🗿']);
const FLAVOR = {
  welcome: ['Welcome to Table 7. Regret checks in first.', 'The felt remembers. The dealer denies it.'],
  fold: ['Folded. Your ante sends its regards.', 'Mucked. The house admires your survival instinct.'],
  allin: ['SHOVED. An accountant just felt a disturbance.', 'ALL IN. The felt accepts your resignation.'],
  win: ['Chips shipped. Try not to make it your personality.', 'Winner. The dealer marks it down as suspicious.'],
  showdown: ['Cards speak. Lawyers remain silent.', 'Showdown. The river delivers its verdict.']
};
const pick = k => FLAVOR[k][crypto.randomInt(FLAVOR[k].length)];
const rooms = new Map();
const sessions = new Map(); // socketId => { room, player }
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const uid = () => crypto.randomUUID();
const token = () => crypto.randomBytes(24).toString('hex');
const safeName = name => String(name || 'Degen').trim().replace(/[<>"'`&]/g, '').slice(0, 12) || 'Degen';
const safeAvatar = avatar => ALLOWED_AVATARS.has(avatar) ? avatar : '🎲';

function verifyTelegram(initData) {
  if (!process.env.TG_BOT_TOKEN) return { ok: true, telegramId: null, mode: 'guest' };
  if (typeof initData !== 'string' || initData.length > 4096) return { ok: false };
  try {
    const params = new URLSearchParams(initData);
    const supplied = params.get('hash');
    if (!supplied || !/^[0-9a-f]{64}$/i.test(supplied)) return { ok: false };
    params.delete('hash');
    const canonical = [...params.entries()].sort(([a],[b]) => a.localeCompare(b, 'en'))
      .map(([k,v]) => `${k}=${v}`).join('\n');
    const secret = crypto.createHmac('sha256', 'WebAppData').update(process.env.TG_BOT_TOKEN).digest();
    const expected = crypto.createHmac('sha256', secret).update(canonical).digest();
    if (!crypto.timingSafeEqual(expected, Buffer.from(supplied, 'hex'))) return { ok: false };
    const authDate = Number(params.get('auth_date'));
    const age = Date.now() / 1000 - authDate;
    if (!Number.isFinite(age) || age < -60 || age > 24 * 3600) return { ok: false };
    const user = JSON.parse(params.get('user') || '{}');
    if (!user.id) return { ok: false };
    return { ok: true, telegramId: String(user.id), mode: 'telegram' };
  } catch { return { ok: false }; }
}

function makePlayer(socket, name, avatar, { isBot = false, telegramId = null } = {}) {
  return { id: uid(), socketId: isBot ? null : socket.id, sessionToken: token(), telegramId,
    name: safeName(name), avatar: safeAvatar(avatar), stack: CONFIG.startingStack,
    alive: true, folded: false, allIn: false, connected: true, isBot,
    hole: [], contribution: 0 };
}
function newRoom(socket, name, avatar, telegramId) {
  let code;
  do { code = Array.from({ length: 5 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[crypto.randomInt(32)]).join(''); }
  while (rooms.has(code));
  const p = makePlayer(socket, name, avatar, { telegramId });
  const room = { code, players: [p], hostPlayerId: p.id, buttonIdx: 0,
    phase: 'lobby', pot: 0, board: [], handNumber: 0, currentTurnPlayerId: null,
    turnDeadline: 0, lastFlavor: pick('welcome'), showdown: null, pending: new Map(),
    seedResolve: null, fair: null, proofs: new Map(), running: false, lastUsed: Date.now() };
  rooms.set(code, room);
  return { room, player: p };
}
function bind(socket, room, player) {
  if (sessions.has(socket.id)) return false;
  const prior = player.socketId && io.sockets.sockets.get(player.socketId);
  if (prior && prior.id !== socket.id) prior.disconnect(true);
  player.socketId = socket.id;
  player.connected = true;
  sessions.set(socket.id, { room, player });
  socket.join(room.code);
  room.lastUsed = Date.now();
  room.noHumansSince = null;
  return true;
}
function state(room, viewer) {
  const reveals = room.showdown?.reveals || [];
  return {
    code: room.code, phase: room.phase, handNumber: room.handNumber,
    players: room.players.map((p, index) => ({
      id: p.id, name: p.name, avatar: p.avatar, stack: p.stack, isBot: p.isBot,
      alive: p.alive, folded: p.folded, allIn: p.allIn,
      contribution: p.contribution, connected: p.connected,
      isHost: p.id === room.hostPlayerId, isYou: p.id === viewer.id,
      hole: (p.id === viewer.id || reveals.includes(p.id)) ? p.hole : p.hole.map(() => null),
      seat: index
    })),
    board: room.board, pot: room.pot, buttonIdx: room.buttonIdx,
    ante: CONFIG.ante, startingStack: CONFIG.startingStack,
    currentTurnPlayerId: room.currentTurnPlayerId, turnDeadline: room.turnDeadline,
    showdown: room.showdown, lastFlavor: room.lastFlavor,
    fairCommit: room.fair?.commit || null, fairDealOrder: room.fair?.dealOrder || [],
    fairSeedsReceived: room.fair?.seeds.size || 0,
    aliveCount: room.players.filter(p => p.alive).length,
    isHost: viewer.id === room.hostPlayerId,
    you: viewer.id
  };
}
function broadcast(room) {
  room.lastUsed = Date.now();
  for (const p of room.players) if (!p.isBot && p.connected) {
    const sock = io.sockets.sockets.get(p.socketId);
    if (sock) sock.emit('room:state', state(room, p));
  }
}
function nextAliveIndex(room, fromIdx) {
  for (let k = 1; k <= room.players.length; k++) {
    const i = (fromIdx + k) % room.players.length;
    if (room.players[i].alive) return i;
  }
  return -1;
}
function actionPromise(room, p) {
  return new Promise(resolve => {
    let done = false;
    const finish = action => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      room.pending.delete(p.id);
      resolve(action);
    };
    const timer = setTimeout(() => finish('fold'), CONFIG.turnMs);
    room.pending.set(p.id, finish);
  });
}
function autopilot(p) {
  const a = p.hole[0], b = p.hole[1];
  const pair = a.value === b.value;
  const suited = a.suit === b.suit;
  const strength = pair ? 0.56 + a.value / 35
    : (Math.max(a.value,b.value) + Math.min(a.value,b.value)) / 38 + (suited ? 0.08 : 0);
  return strength > 0.53 || crypto.randomInt(100) < 9 ? 'allin' : 'fold';
}

async function runHand(room) {
  if (room.running || !rooms.has(room.code)) return;
  room.running = true;
  try {
    const alive = room.players.filter(p => p.alive);
    if (alive.length < 2) return endTournament(room);
    room.handNumber++;
    room.board = []; room.pot = 0; room.showdown = null;
    room.currentTurnPlayerId = null; room.turnDeadline = 0;
    for (const p of room.players) {
      p.hole = []; p.contribution = 0; p.allIn = false; p.folded = !p.alive;
    }
    // Freeze seat/deal order BEFORE accepting client entropy, and bind it to the seed commitment.
    const dealOrder = [];
    for (let i = 1; i <= room.players.length; i++) {
      const idx = (room.buttonIdx + i) % room.players.length;
      if (room.players[idx].alive) dealOrder.push(room.players[idx]);
    }
    const dealIds = dealOrder.map(p => p.id);
    const serverSeed = newSeed();
    room.fair = { serverSeed, commit: makeCommit(serverSeed, dealIds), dealOrder: dealIds,
      seeds: new Map(), handNumber: room.handNumber };
    for (const p of alive.filter(p => p.isBot)) room.fair.seeds.set(p.id, sha256(`bot:${room.code}:${room.handNumber}:${p.id}`));
    room.phase = 'seeding'; room.lastFlavor = 'SHA-256 seed + seat order sealed. Contribute your seed.';
    broadcast(room);
    await new Promise(resolve => {
      let settled = false;
      const finish = () => { if (settled) return; settled = true; clearTimeout(timer); room.seedResolve = null; resolve(); };
      const timer = setTimeout(finish, CONFIG.seedWindowMs);
      room.seedResolve = finish;
      if (room.players.filter(p => p.alive).every(p => room.fair.seeds.has(p.id))) finish();
    });
    for (const p of alive) if (!room.fair.seeds.has(p.id))
      room.fair.seeds.set(p.id, sha256(`fallback:${room.code}:${room.handNumber}:${p.id}`));
    const clientSeeds = [...room.fair.seeds].map(([playerId, seed]) => ({ playerId, seed }));
    const deck = shuffledDeck({ serverSeed, clientSeeds, roomCode: room.code, handNumber: room.handNumber });
    for (let r = 0; r < 2; r++) for (const p of dealOrder) p.hole.push(deck.pop());
    for (const p of alive) {
      const ante = Math.min(p.stack, CONFIG.ante);
      p.stack -= ante; p.contribution += ante; room.pot += ante;
      if (p.stack === 0) p.allIn = true;
    }
    room.phase = 'preflop'; room.lastFlavor = pick('welcome'); broadcast(room);
    await delay(300);
    for (const p of dealOrder) {
      if (room.players.filter(x => x.alive && !x.folded).length <= 1) break;
      if (p.folded || p.allIn) continue;
      let action;
      if (p.isBot) {
        room.currentTurnPlayerId = p.id; room.turnDeadline = Date.now() + 750; broadcast(room);
        await delay(450 + crypto.randomInt(250)); action = autopilot(p);
      } else if (!p.connected) action = 'fold';
      else {
        room.currentTurnPlayerId = p.id; room.turnDeadline = Date.now() + CONFIG.turnMs;
        const promise = actionPromise(room, p);
        broadcast(room);
        action = await promise;
      }
      room.currentTurnPlayerId = null; room.turnDeadline = 0;
      if (action === 'allin') {
        const stake = p.stack; p.stack = 0; p.contribution += stake; room.pot += stake;
        p.allIn = true; room.lastFlavor = pick('allin');
      } else { p.folded = true; room.lastFlavor = pick('fold'); }
      broadcast(room);
      await delay(160);
    }
    const contenders = alive.filter(p => !p.folded);
    const result = { winners: [], pots: [], winnerName: '', winnerHandName: '', potSize: room.pot,
      reveals: contenders.map(p => p.id) };
    if (contenders.length === 1) {
      const winner = contenders[0]; winner.stack += room.pot;
      result.winners = [winner.id]; result.winnerName = winner.name;
      result.winnerHandName = 'Uncontested pot';
      result.pots = [{ amount: room.pot, winners: [winner.id] }];
    } else if (contenders.length > 1) {
      deck.pop(); room.board.push(deck.pop(), deck.pop(), deck.pop()); // burn + flop
      deck.pop(); room.board.push(deck.pop()); // burn + turn
      deck.pop(); room.board.push(deck.pop()); // burn + river
      const payout = settlePots(room.players, room.buttonIdx, room.board);
      for (const [id, amount] of payout.winnings) room.players.find(p => p.id === id).stack += amount;
      result.winners = [...payout.winnings.keys()];
      result.pots = payout.pots;
      const best = contenders.reduce((a, b) => payout.scores.get(a.id).score >= payout.scores.get(b.id).score ? a : b);
      result.winnerName = result.winners.length > 1 ? 'Split / side pots' : room.players.find(p => p.id === result.winners[0]).name;
      result.winnerHandName = payout.scores.get(best.id).name;
    } else throw new Error('No contenders after action sequence');
    result.fairProof = proveDeck({ serverSeed, clientSeeds, roomCode: room.code,
      handNumber: room.handNumber, dealOrder: dealOrder.map(p => p.id),
      holes: dealOrder.map(p => [p.id, p.hole]), board: room.board });
    if (!verifyProof(result.fairProof).ok) throw new Error('Fair proof failed local verification');
    room.proofs.set(room.handNumber, result.fairProof);
    room.pot = 0; room.phase = 'showdown'; room.showdown = result;
    room.lastFlavor = pick('showdown'); broadcast(room);
    const totalChips = room.players.reduce((acc, p) => acc + p.stack, 0);
    if (totalChips !== room.players.length * CONFIG.startingStack) throw new Error(`CHIP CONSERVATION FAILURE: ${totalChips}`);
    await delay(2_500);
    for (const p of room.players) if (p.alive && p.stack === 0) p.alive = false;
    if (room.players.filter(p => p.alive).length <= 1) return endTournament(room);
    room.buttonIdx = nextAliveIndex(room, room.buttonIdx);
    room.running = false;
    setTimeout(() => runHand(room).catch(e => console.error('Hand error:', e)), CONFIG.nextHandDelayMs);
  } catch (error) {
    console.error('Game halted for fairness:', room.code, error);
    room.phase = 'halted'; room.lastFlavor = 'Hand halted for integrity review. No further betting.';
    broadcast(room);
  } finally { if (room.phase !== 'preflop' && room.phase !== 'seeding') room.running = false; }
}
function endTournament(room) {
  room.phase = 'ended'; room.running = false;
  const winner = room.players.find(p => p.alive && p.stack > 0);
  room.lastFlavor = winner ? `${winner.name} wins the tournament.` : 'Nobody survives the table.';
  broadcast(room);
}

app.get('/api/fairness/:code/:hand', (req, res) => {
  const room = rooms.get(String(req.params.code).toUpperCase());
  const hand = Number(req.params.hand);
  if (!room || !room.proofs.has(hand)) return res.status(404).json({ error: 'Proof not available' });
  res.json({ ...room.proofs.get(hand), verification: verifyProof(room.proofs.get(hand)) });
});

io.on('connection', socket => {
  const ack = (cb, value) => { if (typeof cb === 'function') cb(value); };
  socket.on('room:create', (input = {}, cb) => {
    if (sessions.has(socket.id)) return ack(cb, { ok: false, error: 'Already at a table' });
    if (rooms.size >= 100) return ack(cb, { ok: false, error: 'Table capacity reached' });
    const auth = verifyTelegram(input.initData);
    if (!auth.ok) return ack(cb, { ok: false, error: 'Telegram authentication failed' });
    const { room, player } = newRoom(socket, input.name, input.avatar, auth.telegramId);
    bind(socket, room, player);
    ack(cb, { ok: true, code: room.code, token: player.sessionToken });
    broadcast(room);
  });
  socket.on('room:join', (input = {}, cb) => {
    const code = String(input.code || '').toUpperCase().slice(0, 5);
    const room = rooms.get(code);
    if (!room || room.phase !== 'lobby') return ack(cb, { ok: false, error: 'Table unavailable' });
    if (room.players.length >= CONFIG.maxPlayers) return ack(cb, { ok: false, error: 'Table full' });
    if (sessions.has(socket.id)) return ack(cb, { ok: false, error: 'Already at a table' });
    const auth = verifyTelegram(input.initData);
    if (!auth.ok) return ack(cb, { ok: false, error: 'Telegram authentication failed' });
    if (auth.telegramId && room.players.some(p => p.telegramId === auth.telegramId))
      return ack(cb, { ok: false, error: 'That Telegram account is already seated' });
    const player = makePlayer(socket, input.name, input.avatar, { telegramId: auth.telegramId });
    room.players.push(player); bind(socket, room, player);
    ack(cb, { ok: true, code: room.code, token: player.sessionToken });
    broadcast(room);
  });
  socket.on('room:resume', (data = {}, cb) => {
    const room = rooms.get(String(data.code || '').toUpperCase());
    const player = room?.players.find(p => !p.isBot && p.sessionToken === data.token);
    if (!player || !bind(socket, room, player)) return ack(cb, { ok: false, error: 'Unable to restore seat' });
    ack(cb, { ok: true, code: room.code }); broadcast(room);
  });
  socket.on('game:start', () => {
    const session = sessions.get(socket.id);
    if (!session) return;
    const { room, player } = session;
    if (room.hostPlayerId !== player.id || room.phase !== 'lobby') return;
    const needed = CONFIG.maxPlayers - room.players.length;
    for (let i = 0; i < needed; i++) room.players.push(makePlayer(socket, BOT_NAMES[i], BOT_AVATARS[i], { isBot: true }));
    runHand(room).catch(e => console.error(e));
  });
  socket.on('fair:seed', (data = {}, cb) => {
    const session = sessions.get(socket.id);
    if (!session) return;
    const { room, player } = session;
    if (!room.fair || room.phase !== 'seeding' || !player.alive || player.isBot ||
        data.handNumber !== room.handNumber || !/^[0-9a-f]{64}$/.test(data.seed || '') ||
        room.fair.seeds.has(player.id)) return;
    room.fair.seeds.set(player.id, data.seed);
    ack(cb, { ok: true, handNumber: room.handNumber, seedHash: sha256(Buffer.from(data.seed, 'hex')) });
    if (room.players.filter(p => p.alive).every(p => room.fair.seeds.has(p.id))) room.seedResolve?.();
    broadcast(room);
  });
  socket.on('game:action', (data = {}) => {
    const session = sessions.get(socket.id);
    if (!session) return;
    const { room, player } = session;
    if (room.phase === 'preflop' && room.currentTurnPlayerId === player.id &&
        (data.action === 'fold' || data.action === 'allin')) room.pending.get(player.id)?.(data.action);
  });
  socket.on('disconnect', () => {
    const session = sessions.get(socket.id);
    if (!session) return;
    const { room, player } = session;
    room.pending.get(player.id)?.('fold');
    sessions.delete(socket.id);
    if (player.socketId === socket.id) player.connected = false;
    if (room.players.every(p => p.isBot || !p.connected)) room.noHumansSince = Date.now();
    if (room.phase === 'lobby' && player.id === room.hostPlayerId) {
      room.hostPlayerId = room.players.find(p => !p.isBot && p.connected)?.id || player.id;
    }
    broadcast(room);
  });
});
// In-memory demo: orphaned tables expire; one process/replica only.
setInterval(() => {
  for (const [code, room] of rooms) {
    if (room.noHumansSince && Date.now() - room.noHumansSince > 5 * 60_000)
      rooms.delete(code);
  }
}, 60_000).unref();
const PORT = Number(process.env.PORT) || 3000;
if (require.main === module) server.listen(PORT, '0.0.0.0', () => console.log(`AOT v2 on ${PORT} | play-chips only`));
module.exports = { app, server, io, CONFIG, verifyTelegram };
