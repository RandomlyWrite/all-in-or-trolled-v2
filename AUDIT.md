# Original DeepSeek build: targeted engineering review

Inputs reviewed: `ALL IN OR TROLLED · Complete Deployable Build` and `Old Vegas Card Micro-Interactions Sandbox` (both provided as pasted text files). The shared DeepSeek link was inaccessible from this environment (HTTP 403); the attached source was reviewed directly.

| Priority | Observed issue in the original source | V2 change |
|---|---|---|
| P0 | `STARTING_STACK = 1000` and blind levels rather than requested 30,000/500-ante table. | 30,000 chips per seat, 500 ante, no blinds. |
| P0 | `Math.random()` controls the card deck and no commit/reveal scheme exists. | Node crypto randomness, pre-seed commitment, independent client seeds, HMAC shuffle, replayable JSON proof. |
| P0 | Hand evaluator uses decimal positional score packing that can make a one-pair hand exceed a two-pair score (e.g. high pair). | Base-15 lexicographic comparison with separate hand category. |
| P0 | Original side-pot remainder is paid to the best overall hand, not necessarily the winners entitled to odd chips in that pot. | Each contribution tier is resolved separately; odd chips allocated clockwise among that tier's eligible tied winners. |
| P1 | Client compares `currentTurnId` to `p.socketId`, but public player objects do not contain `socketId`. | Public stable `currentTurnPlayerId` and proper turn badge. |
| P1 | Client's `prevPhase` is set before the showdown event checks it, preventing transition SFX. | Track previously displayed showdown hand independently. |
| P1 | Opponents' positions are absolute; a joined player can appear at the side/top rather than at the mobile bottom seat. | Rotate table seating around current viewer. |
| P1 | Original `innerHTML` interpolates user-provided display names without escaping, allowing HTML injection. | Server strips unsafe markup characters and client HTML-escapes dynamic display names. |
| P1 | No verified Telegram user identity; disconnect instantly marks a player dead. | Optional Telegram initData hash verification with `TG_BOT_TOKEN` and resume tokens for reconnects. |
| P2 | Bots fill four empty seats maximum, leaving one vacant when a single person starts. | All six seats filled, with bots explicitly identified as bots in state. |
| P2 | Buttons depend on pointer-up handlers rather than native click, making keyboard activation and some touch paths brittle. | Native click handler, immediate double-action lockout. |
| P2 | README claims gyroscope/card features not actually integrated in the main game. | Preserve seven experimental interactions in a separate `extras/` sandbox, without claiming they are shipped gameplay. |

## Verification achieved

- JavaScript syntax checked with Node 22.
- Seven tests passed, including 250 randomized six-player side-pot conservation trials.
- Sample seed/deal/board proof generated and independently validated by the bundled verifier.
- Browser/TG live-session/Socket.IO integration and Railway deployment **not** verified. Dependency installation was unavailable in the working environment.

## Outstanding blockers before a real launch

Use a persistent database, immutable fairness transcript/event log, separate observer proof verifier, bot/collusion detection, rate limiting, abuse monitoring, Telegram-bound recovery credentials, disconnection/edge-case multiplayer integration testing, and an external security and compliance review. This build is **play-chip only**.
