'use strict';
const crypto = require('node:crypto');
const { makeDeck, cardCode } = require('./poker');
const sha256 = data => crypto.createHash('sha256').update(data).digest('hex');
const newSeed = () => crypto.randomBytes(32).toString('hex');
// Bind the dealing order at commit time as well as the unknown server seed.
const makeCommit = (serverSeed, dealOrder) => sha256(Buffer.concat([
  Buffer.from(serverSeed, 'hex'), Buffer.from('|'+JSON.stringify(dealOrder))
]));
const canonicalSeeds = seeds => [...seeds].map(x => ({ playerId: String(x.playerId), seed: String(x.seed).toLowerCase() }))
  .sort((a, b) => a.playerId.localeCompare(b.playerId, 'en'));

// serverSeed is committed as SHA-256 BEFORE clients contribute their seeds.
// Rejection sampling avoids modulo bias; every random draw comes from HMAC-SHA256.
function shuffledDeck({ serverSeed, clientSeeds, roomCode, handNumber }) {
  const seedPayload = JSON.stringify({ roomCode, handNumber, clientSeeds: canonicalSeeds(clientSeeds) });
  const key = crypto.createHmac('sha256', Buffer.from(serverSeed, 'hex')).update('all-in-or-trolled-v2|').update(seedPayload).digest();
  let counter = 0, queue = [];
  function nextU32() {
    if (!queue.length) {
      const bytes = crypto.createHmac('sha256', key).update(String(counter++)).digest();
      queue = Array.from({length: 8}, (_, i) => bytes.readUInt32BE(i * 4));
    }
    return queue.shift();
  }
  function randomIndex(size) {
    const limit = Math.floor(0x100000000 / size) * size;
    let n;
    do { n = nextU32(); } while (n >= limit);
    return n % size;
  }
  const deck = makeDeck();
  for (let i = deck.length - 1; i > 0; i--) {
    const j = randomIndex(i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function proveDeck({ serverSeed, clientSeeds, roomCode, handNumber, dealOrder, holes, board }) {
  const deck = shuffledDeck({ serverSeed, clientSeeds, roomCode, handNumber });
  return {
    version: 'AOT-v2-HMAC-SHA256-FY', roomCode, handNumber,
    commit: makeCommit(serverSeed, dealOrder),
    serverSeed, clientSeeds: canonicalSeeds(clientSeeds), dealOrder,
    deckHash: sha256(deck.map(cardCode).join(',')),
    holes: Object.fromEntries(holes.map(([id, cards]) => [id, cards.map(cardCode)])),
    board: board.map(cardCode)
  };
}
function verifyProof(proof) {
  if (!proof || !/^[0-9a-f]{64}$/.test(proof.serverSeed || '')) return { ok: false, reason: 'Invalid seed' };
  if (makeCommit(proof.serverSeed, proof.dealOrder) !== proof.commit) return { ok: false, reason: 'Commit does not match seed' };
  const deck = shuffledDeck(proof);
  if (sha256(deck.map(cardCode).join(',')) !== proof.deckHash) return { ok: false, reason: 'Deck hash mismatch' };
  const predicted = Object.fromEntries(proof.dealOrder.map(id => [id, []]));
  for (let round = 0; round < 2; round++) for (const id of proof.dealOrder) predicted[id].push(cardCode(deck.pop()));
  if (JSON.stringify(predicted) !== JSON.stringify(proof.holes)) return { ok: false, reason: 'Dealt cards mismatch' };
  if (proof.board?.length) {
    deck.pop(); // burn before flop
    const board = [cardCode(deck.pop()), cardCode(deck.pop()), cardCode(deck.pop())];
    deck.pop(); board.push(cardCode(deck.pop())); // turn
    deck.pop(); board.push(cardCode(deck.pop())); // river
    if (JSON.stringify(board) !== JSON.stringify(proof.board)) return { ok: false, reason: 'Board mismatch' };
  }
  return { ok: true, reason: 'Commit, shuffle, hole cards, and board verified' };
}
module.exports = { newSeed, sha256, makeCommit, canonicalSeeds, shuffledDeck, proveDeck, verifyProof };
