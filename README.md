# 🎰 ALL IN OR TROLLED · Degen Vegas · v2

A responsive, 6-seat, **play-chip** all-in-or-fold Hold'em tournament designed for a Telegram Mini App. The original casino-noir visual theme and procedural sounds remain. Version 2 replaces the original game engine with correct hand ranking, side pots, stable seat IDs, Telegram init-data verification (when configured), and reproducible shuffle proofs.

## Exact default rules

- **30,000 play chips** per seat. **500-chip mandatory ante per hand**. **No small/big blinds**.
- 6 seats. The host can start alone; clearly labeled bots fill empty seats.
- Two hole cards and a five-card Hold'em board when at least two players contest the pot.
- On your turn, **ALL IN** commits your remaining chips, or **FOLD** forfeits your ante. No calls or smaller raises.
- 18-second decisions; human timeouts/disconnections fold if action is due. Ante-short players are automatically all-in.
- Side pots and split-pot odd chips are accounted for. Tournament ends with one player retaining chips.
- No wallets, deposits, withdrawals, or real-currency payouts.

## Start locally

Install Node.js 20+:

```sh
npm install
npm test
npm start
```

Open `http://localhost:3000` on your computer. To test on phones, use HTTPS hosting (Telegram requires HTTPS for its Mini App integration), or local-network development if browser permissions permit. Create a room, share its 5-character code, and start the table.

## Fairness: server commit + independent client entropy

1. Before each hand, the server generates 256 random bits using Node `crypto.randomBytes` and publishes `SHA-256(serverSeedBytes || "|" || JSON.stringify(dealOrder))` while withholding the seed. This commits to the exact order of seats, too.
2. Each connected browser independently generates its own 256-bit seed using `crypto.getRandomValues`, sending it **after** the commit. Bot seeds and deterministic fallback seeds are included in the published list.
3. The server derives a shuffle key from its committed seed and the canonical sorted client-seed list. Cards are shuffled with an **HMAC-SHA256 pseudorandom stream, rejection-sampled Fisher–Yates**, and dealt round-robin with Hold'em burn cards.
4. At showdown, the server reveals the seed and the complete proof, including deal order, hole cards, board, and deck hash.
5. Anyone can independently reconstruct the deck and verify the revealed outcome with the bundled `scripts/verify-proof.js`. The proof is not a mere server-provided “verified” badge.

After hand N, visit:

```text
https://YOUR_DOMAIN/api/fairness/ROOMCODE/N
```

Save the JSON body as `hand-proof.json`. Run:

```sh
npm run verify -- hand-proof.json
```

The `SHA` HUD button opens the latest completed hand's JSON proof. The browser separately stores each contributed seed and the pre-deal commitment locally under `aot_fair_ROOMCODE_HAND` so the player can compare their own submitted entropy against the revealed proof. **Limitations:** this proves the deck matches the previously published commitment and submitted seeds; it does not by itself prove the operator never aborted a committed hand, withheld a seed, or operated honestly. No independent third-party audit or production certification has been performed. Proofs are held in memory and are lost on restart. Client browsers should record commitments independently for an adversarial dispute mechanism.

## Deploy on Railway

1. Upload this folder to a GitHub repository.
2. In Railway, create a service from the GitHub repository.
3. Install dependencies and launch using the `start` npm script. `server.js` uses `process.env.PORT` and binds to `0.0.0.0`.
4. Under **Settings → Networking**, generate a public HTTPS domain.
5. Add `TG_BOT_TOKEN` to the Railway service variables **before exposing the Telegram app**. This enables Telegram Mini App `initData` verification and blocks unauthenticated guest room creation/join. Without it, browser access uses guest mode **for testing only**. Never put the token in frontend code.
6. In `@BotFather`, configure the Mini App or bot menu button with your HTTPS URL. Open from Telegram.
7. Keep this prototype to **one Railway replica**. In-memory rooms and socket IDs are not synchronized between replicas.

Useful endpoints: `GET /api/health`, `GET /api/fairness/:roomCode/:handNumber`.

## Package map

```text
server.js                     Socket.IO game rooms, Telegram auth, hand orchestration
lib/poker.js                  Hold'em evaluator and side-pot chip distribution
lib/fairness.js               HMAC shuffle, commits, reveal proofs, independent verification
public/index.html             Mobile lobby and table
public/styles.css             Degen Vegas casino-noir styling
public/app.js                 Two-button Telegram/browser client
scripts/verify-proof.js       Offline shuffle-proof verifier
extras/old-vegas-card-lab.html Original standalone 7-interaction design sandbox
test/poker.test.js            Unit tests for hand hierarchy, side pots, shuffle tampering
```

## Scope and production gaps

**Testable starter, not a real-money or production gaming platform.** The code has not been audited, regulatory-approved, load-tested, or end-to-end tested inside Telegram. It lacks a persistent database, dispute-resolution ledger, multi-replica coordination, durable tournament history, robust anti-collusion, monitoring/alerts, and comprehensive rate limits. Seat restoration uses a browser-local session secret; a database-backed, Telegram-bound account scheme would be appropriate in production. A private host with untrusted clients can still deny service, manipulate timing, or abandon hands.

The original **Card Lab** is copied under `extras/` as a separate, optional interactions gallery. It is not gameplay code, and its dramatic 99.8% bad-beat label is a mockup, not an odds calculator.
