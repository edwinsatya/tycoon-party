/**
 * Bot match simulator (PRD 13.5, Phase 0 gate).
 *
 *   pnpm sim                        1,000 mixed matches, Classic
 *   pnpm sim --matches 200 --mode blitz
 *   pnpm sim --watch --seed demo    narrate one match in the terminal
 *   pnpm sim --watch --lang id      ...in Bahasa Indonesia
 */
import { makeTranslator, type Locale } from '@rollionaire/boards';
import { type ModeId, makeSettings, narrate, randInt, seedRng } from '@rollionaire/engine';
import type { BotLevel } from './bot';
import { runMatch, summarize, type MatchResult } from './sim';

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const opt = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1]! : fallback;
};

const mode = opt('mode', 'classic') as ModeId;
const settings = makeSettings(mode);
const LEVELS: BotLevel[] = ['casual', 'smart', 'shark'];

if (flag('watch')) {
  const t = makeTranslator(opt('lang', 'en') as Locale);
  const levels = opt('bots', 'smart,shark,casual,smart').split(',') as BotLevel[];
  const r = runMatch({
    seed: opt('seed', 'demo'),
    levels,
    settings,
    onEvents: (events, state) => {
      for (const ev of events) {
        const line = narrate(ev, state, t);
        if (line) console.log(`${String(ev.seq).padStart(5)}  ${line}`);
      }
    },
  });
  console.log(`\n${r.endReason} after ${r.rounds} rounds, ${r.turns} turns, ~${r.minutes} min simulated`);
  process.exit(0);
}

const matches = Number(opt('matches', '1000'));
const seedBase = opt('seed', 'gate');
const pick = seedRng(`levels:${seedBase}`);
const results: MatchResult[] = [];
const started = performance.now();
for (let i = 0; i < matches; i++) {
  const count = 2 + randInt(pick, 5);
  const levels = Array.from({ length: count }, () => LEVELS[randInt(pick, LEVELS.length)]!);
  results.push(runMatch({ seed: `${seedBase}-${i}`, levels, settings }));
  if ((i + 1) % 100 === 0) process.stderr.write(`  ${i + 1}/${matches}\n`);
}
const secs = ((performance.now() - started) / 1000).toFixed(1);
const s = summarize(results);
console.log(JSON.stringify({ mode, seconds: Number(secs), ...s }, null, 2));

// Head-to-head check from the Phase 2 checklist: Shark vs Casual.
if (flag('h2h')) {
  const h2h: MatchResult[] = [];
  for (let i = 0; i < 300; i++) {
    const levels: BotLevel[] = i % 2 ? ['shark', 'casual'] : ['casual', 'shark'];
    h2h.push(runMatch({ seed: `h2h-${i}`, levels, settings }));
  }
  const decided = h2h.filter((r) => r.winnerLevels.length === 1);
  const sharkWins = decided.filter((r) => r.winnerLevels[0] === 'shark').length;
  console.log(`Shark vs Casual: Shark won ${sharkWins}/${decided.length} decided matches`);
}

const clean = s.crashes === 0 && s.stuck === 0 && s.invariantViolations === 0;
process.exit(clean ? 0 : 1);
