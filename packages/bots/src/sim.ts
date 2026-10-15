import { PLAYER_COLORS, TOKENS } from '@rollionaire/boards';
import {
  type EndReason,
  type GameState,
  type Intent,
  type PublicGameState,
  type SeqEvent,
  type Settings,
  applyIntent,
  checkInvariants,
  createGame,
  makeSettings,
  nextDeadline,
  pendingActors,
  randInt,
  seedRng,
} from '@rollionaire/engine';
import { Bot, type BotLevel } from './bot';

export interface MatchConfig {
  seed: string;
  levels: BotLevel[];
  settings?: Settings;
  /** Safety valve: a match still running after this many rounds counts as a stalemate. */
  maxRounds?: number;
  maxIntents?: number;
  checkInvariants?: boolean;
  onEvents?: (events: SeqEvent[], state: GameState) => void;
}

export interface MatchResult {
  seed: string;
  levels: BotLevel[];
  ended: boolean;
  endReason: EndReason | 'stalemate' | 'stuck';
  winnerSeats: number[];
  winnerLevels: BotLevel[];
  rounds: number;
  turns: number;
  intents: number;
  ticks: number;
  /** Simulated match length in minutes (bots act every ~0.8-2 s, timers as configured). */
  minutes: number;
  botErrors: { code: string; intent: Intent['type'] }[];
  invariantErrors: string[];
  trades: number;
  auctions: number;
  crash?: string;
}

/** Bots act 0.8–2 s after the state changes (PRD 8.6). */
const BOT_DELAY_MIN = 800;
const BOT_DELAY_SPREAD = 1200;
const START = Date.UTC(2026, 9, 14, 12, 0, 0);

const shallowPublic = (s: GameState): PublicGameState => {
  const { rng: _r, diceDeck: _d, decks, ...rest } = s;
  return { ...rest, deckSizes: { fortune: decks.fortune.length, community: decks.community.length } };
};

export function runMatch(cfg: MatchConfig): MatchResult {
  const settings = cfg.settings ?? makeSettings('classic');
  const maxRounds = cfg.maxRounds ?? 300;
  const maxIntents = cfg.maxIntents ?? 60_000;
  const players = cfg.levels.map((level, i) => ({
    id: `p${i}`,
    name: `${level[0]!.toUpperCase()}${level.slice(1)} ${i + 1}`,
    token: TOKENS[i]!,
    color: PLAYER_COLORS[i]!,
    isBot: true,
  }));
  const bots = new Map(players.map((p, i) => [p.id, new Bot(p.id, cfg.levels[i]!, `${cfg.seed}:${i}`)]));
  const jitter = seedRng(`sim:${cfg.seed}`);

  let now = START;
  let { state, events } = createGame({ players, settings, seed: cfg.seed, now });
  cfg.onEvents?.(events, state);

  const result: MatchResult = {
    seed: cfg.seed,
    levels: cfg.levels,
    ended: false,
    endReason: 'stalemate',
    winnerSeats: [],
    winnerLevels: [],
    rounds: 0,
    turns: 0,
    intents: 0,
    ticks: 0,
    minutes: 0,
    botErrors: [],
    invariantErrors: [],
    trades: 0,
    auctions: 0,
  };

  const apply = (intent: Intent): boolean => {
    const r = applyIntent(state, intent, { now });
    if (!r.ok) return false;
    state = r.state;
    result.intents++;
    for (const ev of r.events) {
      if (ev.t === 'TradeCompleted') result.trades++;
      if (ev.t === 'AuctionStarted') result.auctions++;
    }
    cfg.onEvents?.(r.events, state);
    if (cfg.checkInvariants !== false) {
      const errs = checkInvariants(state);
      if (errs.length) result.invariantErrors.push(...errs.map((x) => `#${result.intents} ${intent.type}: ${x}`));
    }
    return true;
  };

  try {
    while (state.turn.phase !== 'GAME_OVER') {
      if (state.round > maxRounds) break;
      if (result.intents > maxIntents) {
        result.endReason = 'stuck';
        break;
      }
      const view = shallowPublic(state);
      let acted = false;
      for (const pid of pendingActors(view)) {
        const intent = bots.get(pid)?.decide(view, { now });
        if (!intent) continue;
        now += BOT_DELAY_MIN + randInt(jitter, BOT_DELAY_SPREAD);
        if (apply(intent)) {
          acted = true;
          break;
        }
        const r = applyIntent(state, intent, { now });
        if (!r.ok) result.botErrors.push({ code: r.error, intent: intent.type });
      }
      if (acted) continue;
      // Nobody acted: jump the clock to the next deadline and let the timers fire.
      const due = nextDeadline(state);
      if (due === null) {
        result.endReason = 'stuck';
        break;
      }
      now = Math.max(now, due);
      result.ticks++;
      if (!apply({ type: 'TICK' })) {
        result.endReason = 'stuck';
        break;
      }
    }
  } catch (err) {
    result.crash = err instanceof Error ? `${err.message}\n${err.stack}` : String(err);
    result.endReason = 'stuck';
  }

  result.ended = state.turn.phase === 'GAME_OVER';
  if (result.ended) result.endReason = state.endReason!;
  result.rounds = state.round;
  result.turns = state.turnCount;
  result.minutes = Math.round((now - START) / 60_000);
  result.winnerSeats = state.winnerIds.map((id) => state.players.find((p) => p.id === id)!.seat);
  result.winnerLevels = state.winnerIds.map((id) => bots.get(id)!.level);
  return result;
}

export interface SimSummary {
  matches: number;
  finished: number;
  byReason: Record<string, number>;
  crashes: number;
  stuck: number;
  invariantViolations: number;
  botErrors: number;
  avgRounds: number;
  avgMinutes: number;
  p90Minutes: number;
  avgTrades: number;
  firstSeatWinRate: number;
  expectedFirstSeatRate: number;
  winsByLevel: Record<string, { wins: number; seats: number }>;
  samples: { crash?: string; invariant?: string; botError?: string };
}

export function summarize(results: MatchResult[]): SimSummary {
  const n = results.length;
  const byReason: Record<string, number> = {};
  for (const r of results) byReason[r.endReason] = (byReason[r.endReason] ?? 0) + 1;
  const decisive = results.filter((r) => r.ended && r.winnerSeats.length === 1);
  const minutes = results.map((r) => r.minutes).sort((a, b) => a - b);
  const winsByLevel: SimSummary['winsByLevel'] = {};
  for (const r of results) {
    for (const lvl of r.levels) (winsByLevel[lvl] ??= { wins: 0, seats: 0 }).seats++;
    if (r.winnerLevels.length === 1) winsByLevel[r.winnerLevels[0]!]!.wins++;
  }
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  return {
    matches: n,
    finished: results.filter((r) => r.ended).length,
    byReason,
    crashes: results.filter((r) => r.crash).length,
    stuck: results.filter((r) => r.endReason === 'stuck').length,
    invariantViolations: results.reduce((a, r) => a + r.invariantErrors.length, 0),
    botErrors: results.reduce((a, r) => a + r.botErrors.length, 0),
    avgRounds: Math.round(avg(results.map((r) => r.rounds))),
    avgMinutes: Math.round(avg(minutes)),
    p90Minutes: minutes[Math.floor(minutes.length * 0.9)] ?? 0,
    avgTrades: Math.round(avg(results.map((r) => r.trades)) * 10) / 10,
    firstSeatWinRate: decisive.length ? decisive.filter((r) => r.winnerSeats[0] === 0).length / decisive.length : 0,
    expectedFirstSeatRate: decisive.length ? avg(decisive.map((r) => 1 / r.levels.length)) : 0,
    winsByLevel,
    samples: {
      crash: results.find((r) => r.crash)?.crash,
      invariant: results.find((r) => r.invariantErrors.length)?.invariantErrors[0],
      botError: (() => {
        const r = results.find((x) => x.botErrors.length);
        return r ? `${r.seed}: ${JSON.stringify(r.botErrors.slice(0, 3))}` : undefined;
      })(),
    },
  };
}
