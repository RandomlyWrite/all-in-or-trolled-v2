'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeDeck, cardCode, five, evaluate7, settlePots } = require('../lib/poker');
const { newSeed, sha256, makeCommit, shuffledDeck, proveDeck, verifyProof } = require('../lib/fairness');
const deck = makeDeck();
const card = code => { const c = deck.find(x => cardCode(x) === code); assert.ok(c, code); return c; };
const hand = (...codes) => codes.map(card);

test('deck is 52 distinct standard cards', () => {
  assert.equal(deck.length, 52);
  assert.equal(new Set(deck.map(cardCode)).size, 52);
});
test('category hierarchy, kicker order, ace-low wheel', () => {
  const hands = [
    hand('A♠','K♦','10♣','8♥','3♠'),
    hand('A♠','A♥','10♣','8♥','3♠'),
    hand('A♠','A♥','10♣','10♥','3♠'),
    hand('A♠','A♥','A♦','8♥','3♠'),
    hand('A♠','2♥','3♦','4♥','5♠'),
    hand('A♠','J♠','10♠','8♠','3♠'),
    hand('A♠','A♥','A♦','8♥','8♠'),
    hand('A♠','A♥','A♦','A♣','8♠'),
    hand('A♠','K♠','Q♠','J♠','10♠')
  ];
  for (let i = 1; i < hands.length; i++) {
    assert.ok(five(hands[i]).score > five(hands[i-1]).score, `rank ${i}`);
  }
  assert.equal(five(hand('A♠','2♥','3♦','4♥','5♠')).kickers[0], 5);
  assert.equal(five(hand('A♠','2♠','3♠','4♠','5♠')).category, 8);
  assert.ok(five(hand('A♠','A♦','K♣','Q♥','9♠')).score > five(hand('A♥','A♣','K♦','J♣','9♥')).score);
});
test('7-card best of 21 combos finds wheel and quads', () => {
  assert.equal(evaluate7(hand('A♠','A♥','A♦','A♣','2♠','3♠','4♣')).category, 7);
  assert.equal(evaluate7(hand('A♠','2♥','3♦','4♥','5♠','J♠','Q♣')).name, 'Straight');
});
test('side pots include folded ante and award only eligible winner', () => {
  const players = [
    { id: 'A', hole: hand('A♠','A♥'), folded: false, contribution: 100 },
    { id: 'B', hole: hand('K♦','K♥'), folded: false, contribution: 300 },
    { id: 'C', hole: hand('Q♣','Q♦'), folded: false, contribution: 300 },
    { id: 'D', hole: hand('J♣','J♦'), folded: true, contribution: 100 }
  ];
  const r = settlePots(players, 0, hand('2♣','3♦','4♠','8♥','9♣'));
  assert.equal(r.totalPot, 800);
  assert.deepEqual(Object.fromEntries(r.winnings), { A: 400, B: 400 });
  assert.deepEqual(r.pots.map(p => p.amount), [400, 400]);
});
test('split pot odd chip goes clockwise from dealer', () => {
  const players = [
    { id: 'A', hole: hand('A♠','K♦'), folded: false, contribution: 101 },
    { id: 'B', hole: hand('A♥','K♠'), folded: false, contribution: 101 },
    { id: 'C', hole: hand('Q♣','Q♦'), folded: true, contribution: 101 }
  ];
  const r = settlePots(players, 0, hand('2♣','3♦','4♠','5♥','9♣'));
  assert.equal(r.winnings.get('B'), 152);
  assert.equal(r.winnings.get('A'), 151);
});
test('shuffle proof reconstructs deck, holes, burn cards and board; detects changes', () => {
  for (let i = 0; i < 24; i++) {
    const serverSeed = newSeed();
    const clientSeeds = [{playerId:'A',seed:newSeed()}, {playerId:'B',seed:newSeed()}];
    const roomCode = 'TABLE', handNumber = i + 1;
    const cards = shuffledDeck({ serverSeed, clientSeeds, roomCode, handNumber });
    const holes = [['A', []], ['B', []]];
    for (let k = 0; k < 2; k++) for (const [, arr] of holes) arr.push(cards.pop());
    cards.pop(); const board = [cards.pop(), cards.pop(), cards.pop()];
    cards.pop(); board.push(cards.pop());
    cards.pop(); board.push(cards.pop());
    const proof = proveDeck({ serverSeed, clientSeeds, roomCode, handNumber, dealOrder: ['A','B'], holes, board });
    assert.equal(verifyProof(proof).ok, true);
    assert.equal(makeCommit(serverSeed, ['A','B']), proof.commit);
    assert.equal(verifyProof({ ...proof, board: [proof.board[0] === 'J♠' ? 'Q♠' : 'J♠', ...proof.board.slice(1)] }).ok, false);
    assert.equal(verifyProof({ ...proof, commit: '0'.repeat(64) }).ok, false);
    assert.equal(verifyProof({ ...proof, dealOrder: ['B','A'] }).ok, false);
  }
});

test('randomized side-pot settlements always conserve chips', () => {
  const crypto = require('node:crypto');
  for (let trial = 0; trial < 250; trial++) {
    const shuffled = makeDeck();
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = crypto.randomInt(i + 1);
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    const players = Array.from({length: 6}, (_, i) => ({
      id: String(i), hole: [shuffled.pop(), shuffled.pop()],
      folded: i > 1 && crypto.randomInt(2) === 0,
      contribution: 500
    }));
    for (const p of players) if (!p.folded) p.contribution += crypto.randomInt(0, 29501);
    const board = Array.from({length: 5}, () => shuffled.pop());
    const result = settlePots(players, crypto.randomInt(6), board);
    const total = players.reduce((sum, p) => sum + p.contribution, 0);
    assert.equal(result.totalPot, total);
    assert.equal([...result.winnings.values()].reduce((a,b) => a + b, 0), total);
    for (const p of players.filter(p => p.folded)) assert.equal(result.winnings.has(p.id), false);
  }
});
