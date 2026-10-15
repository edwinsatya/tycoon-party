# Rollionaire

A free, browser-based property-trading board game for 2–6 friends, played in real time. See [PRD.md](PRD.md) for the full product spec.

## Status

**Phase 0 (engine prototype): done.** The rules engine, board data, bots and simulator are built and pass the 1,000-match gate. Phase 1 (multiplayer MVP: client, rooms, real-time server) is next.

## Layout

| Package                                  | What it is                                                                                  |
| ---------------------------------------- | ------------------------------------------------------------------------------------------- |
| [packages/boards](packages/boards)       | Metro City board, card decks, tokens, and English / Bahasa Indonesia strings                 |
| [packages/engine](packages/engine)       | Pure TypeScript rules engine: `applyIntent(state, intent, { now })` returns the next state and events |
| [packages/bots](packages/bots)           | Casual, Smart and Shark bots, plus the match simulator                                      |

## Commands

Requires Node 22+ and pnpm.

```bash
pnpm install
```

```bash
pnpm check
```

Runs the type checker and all tests (rules, fuzzing, i18n, bot matches).

```bash
pnpm sim
```

Simulates 1,000 bot matches and prints a summary: finished games, crashes, invariant violations, average length, first-seat win rate. Add `--mode blitz`, `--matches 200` or `--h2h` (Shark vs Casual).

```bash
pnpm sim --watch --seed demo
```

Narrates one bot match in the terminal. Add `--lang id` for Bahasa Indonesia or `--bots smart,shark,casual` to pick the table.

## Engine in one minute

```ts
import { createGame, applyIntent, makeSettings, toPublicState } from '@rollionaire/engine';

let { state } = createGame({ players, settings: makeSettings('classic'), seed, now: Date.now() });
const r = applyIntent(state, { type: 'ROLL', by: 'p0' }, { now: Date.now() });
if (r.ok) {
  state = r.state; // r.events drive animations and the game log
  send(toPublicState(state)); // never send the raw state: it holds the dice generator and card order
}
```

- The engine is deterministic: seed plus intents replays a match exactly (provably fair dice).
- Timeouts are a `TICK` intent; `nextDeadline(state)` says when to send it.
- `legalActions(state, playerId)` lists what a player can do right now, for buttons and bots.
- `narrate(event, state, t)` turns an event into a sentence for the log and screen readers.
