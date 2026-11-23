'use strict';

const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const makeDeck = () => SUITS.flatMap(suit => RANKS.map((rank, index) => ({
  rank, suit, value: index + 2, red: suit === '♥' || suit === '♦'
})));
const cardCode = c => c.rank + c.suit;

function five(cards) {
  if (cards.length !== 5) throw new Error('Exactly five cards required');
  const ranks = cards.map(c => c.value).sort((a, b) => b - a);
  const groups = [...new Set(ranks)].map(v => [v, ranks.filter(x => x === v).length])
    .sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const uniq = [...new Set(ranks)];
  const wheel = uniq.length === 5 && uniq.join(',') === '14,5,4,3,2';
  const straight = uniq.length === 5 ? (wheel ? 5 : (uniq[0] - uniq[4] === 4 ? uniq[0] : 0)) : 0;
  const flush = cards.every(c => c.suit === cards[0].suit);
  let category, kickers, name;
  if (flush && straight) { category = 8; kickers = [straight]; name = 'Straight Flush'; }
  else if (groups[0][1] === 4) { category = 7; kickers = [groups[0][0], groups[1][0]]; name = 'Four of a Kind'; }
  else if (groups[0][1] === 3 && groups[1][1] === 2) { category = 6; kickers = [groups[0][0], groups[1][0]]; name = 'Full House'; }
  else if (flush) { category = 5; kickers = ranks; name = 'Flush'; }
  else if (straight) { category = 4; kickers = [straight]; name = 'Straight'; }
  else if (groups[0][1] === 3) { category = 3; kickers = [groups[0][0], ...groups.slice(1).map(x => x[0]).sort((a,b) => b-a)]; name = 'Three of a Kind'; }
  else if (groups[0][1] === 2 && groups[1][1] === 2) { category = 2; kickers = [Math.max(groups[0][0], groups[1][0]), Math.min(groups[0][0], groups[1][0]), groups[2][0]]; name = 'Two Pair'; }
  else if (groups[0][1] === 2) { category = 1; kickers = [groups[0][0], ...groups.slice(1).map(x => x[0]).sort((a,b) => b-a)]; name = 'One Pair'; }
  else { category = 0; kickers = ranks; name = 'High Card'; }
  const padded = [...kickers, ...Array(5 - kickers.length).fill(0)];
  const score = category * 15 ** 5 + padded.reduce((sum, v, i) => sum + v * 15 ** (4 - i), 0);
  return { score, category, kickers, name };
}

function evaluate7(cards) {
  if (cards.length !== 7 || new Set(cards.map(cardCode)).size !== 7) throw new Error('Expected seven distinct cards');
  let best = null;
  for (let a = 0; a < 3; a++) for (let b = a + 1; b < 4; b++)
    for (let c = b + 1; c < 5; c++) for (let d = c + 1; d < 6; d++)
      for (let e = d + 1; e < 7; e++) {
        const h = five([cards[a], cards[b], cards[c], cards[d], cards[e]]);
        if (!best || h.score > best.score) best = h;
      }
  return best;
}

// Pot tiers include folded antes, but only live hands can win. Odd chips go clockwise from dealer.
function settlePots(players, dealerIdx, board) {
  const contenders = players.filter(p => !p.folded && p.contribution > 0);
  if (!contenders.length) throw new Error('No eligible players');
  const totalPot = players.reduce((sum, p) => sum + p.contribution, 0);
  const scores = new Map(contenders.map(p => [p.id, evaluate7([...p.hole, ...board])]));
  const tiers = [...new Set(players.map(p => p.contribution).filter(x => x > 0))].sort((a, b) => a - b);
  const winnings = new Map(), pots = [];
  let previous = 0;
  const oddChipOrder = contenders.map(p => p.id).sort((a, b) =>
    (((players.findIndex(p => p.id === a) - dealerIdx - 1 + players.length) % players.length) -
     ((players.findIndex(p => p.id === b) - dealerIdx - 1 + players.length) % players.length)));
  for (const tier of tiers) {
    const atLevel = players.filter(p => p.contribution >= tier);
    const amount = (tier - previous) * atLevel.length;
    const eligible = contenders.filter(p => p.contribution >= tier);
    if (!eligible.length) throw new Error('Invalid pot with no eligible contenders');
    const best = Math.max(...eligible.map(p => scores.get(p.id).score));
    const winners = eligible.filter(p => scores.get(p.id).score === best);
    const share = Math.floor(amount / winners.length);
    let remainder = amount % winners.length;
    for (const w of winners) winnings.set(w.id, (winnings.get(w.id) || 0) + share);
    for (const id of oddChipOrder) {
      if (remainder === 0) break;
      if (winners.some(p => p.id === id)) {
        winnings.set(id, winnings.get(id) + 1);
        remainder--;
      }
    }
    pots.push({ amount, eligible: eligible.map(p => p.id), winners: winners.map(p => p.id) });
    previous = tier;
  }
  if ([...winnings.values()].reduce((a,b) => a + b, 0) !== totalPot) throw new Error('Chip conservation failure');
  return { totalPot, winnings, pots, scores };
}

module.exports = { makeDeck, cardCode, five, evaluate7, settlePots };
