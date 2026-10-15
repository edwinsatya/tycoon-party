import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { type Intent, applyIntent, checkInvariants, createGame, makeSettings, nextDeadline } from '../src';
import { candidates } from './fuzz-candidates';
import { T0 } from './harness';

const houseRules = fc.record({
  jackpot: fc.boolean(),
  auctions: fc.boolean(),
  rentInJail: fc.boolean(),
  evenBuild: fc.boolean(),
  mortgages: fc.boolean(),
  balancedDice: fc.boolean(),
  catchUp: fc.boolean(),
  doubleSalaryOnStart: fc.boolean(),
  startingCash: fc.constantFrom(1000, 1500, 3000),
  salary: fc.constantFrom(200, 300, 400),
  roundLimit: fc.constantFrom(0, 0, 20),
});

describe('fuzzing (PRD 13.5)', () => {
  it('keeps every invariant under random play, rejects junk without side effects, and replays exactly', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 12 }),
        fc.integer({ min: 2, max: 6 }),
        fc.constantFrom('classic' as const, 'blitz' as const),
        houseRules,
        fc.array(fc.nat(), { minLength: 50, maxLength: 500 }),
        (seed, n, mode, rules, choices) => {
          const players = Array.from({ length: n }, (_, i) => ({
            id: `p${i}`,
            name: `P${i}`,
            token: 'rocket',
            color: '#fff',
            isBot: false,
          }));
          const settings = makeSettings(mode, rules);
          let { state } = createGame({ players, settings, seed, now: T0 });
          let now = T0;
          const log: { intent: Intent; now: number }[] = [];

          for (const c of choices) {
            if (state.turn.phase === 'GAME_OVER') break;
            const options = candidates(state, c);
            const intent = options[c % options.length]!;
            if (intent.type === 'TICK') now = Math.max(now, nextDeadline(state) ?? now);
            else now += 300;
            const before = JSON.stringify(state);
            const r = applyIntent(state, intent, { now });
            expect(JSON.stringify(state)).toBe(before);
            if (!r.ok) continue;
            state = r.state;
            log.push({ intent, now });
            const errs = checkInvariants(state);
            if (errs.length) throw new Error(`${intent.type}: ${errs.join('; ')}`);
          }

          // Replay: same seed + same intents = same match (PRD 13.1, provably fair dice).
          let replay = createGame({ players, settings, seed, now: T0 }).state;
          for (const { intent, now: at } of log) {
            const r = applyIntent(replay, intent, { now: at });
            if (!r.ok) throw new Error(`replay diverged at ${intent.type}: ${r.error}`);
            replay = r.state;
          }
          expect(replay).toEqual(state);
        },
      ),
      { numRuns: 150 },
    );
  });
});
