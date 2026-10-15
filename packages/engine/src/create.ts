import { getBoard } from '@rollionaire/boards';
import { phaseSeconds } from './core';
import { ownsWholeGroup } from './helpers';
import { seedRng, shuffle } from './rng';
import type { Settings } from './settings';
import type { GameEvent, GameState, PlayerState, SeqEvent } from './types';

export interface NewPlayer {
  id: string;
  name: string;
  token: string;
  color: string;
  isBot: boolean;
}

export interface CreateOptions {
  players: NewPlayer[];
  settings: Settings;
  /** Secret match seed (hex from crypto.getRandomValues); its SHA-256 is published at the start. */
  seed: string;
  now: number;
  /** Random seat order (default true, PRD 6.1). */
  shuffleSeats?: boolean;
}

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 6;

export function createGame(opts: CreateOptions): { state: GameState; events: SeqEvent[] } {
  const { settings, now } = opts;
  if (opts.players.length < MIN_PLAYERS || opts.players.length > MAX_PLAYERS) {
    throw new Error(`A match needs ${MIN_PLAYERS}-${MAX_PLAYERS} players`);
  }
  if (new Set(opts.players.map((p) => p.id)).size !== opts.players.length) throw new Error('Duplicate player id');
  const board = getBoard(settings.boardId);
  const rng = seedRng(opts.seed);
  const order = [...opts.players];
  if (opts.shuffleSeats !== false) shuffle(rng, order);

  const players: PlayerState[] = order.map((p, seat) => ({
    ...p,
    seat,
    cash: settings.startingCash,
    position: board.startIndex,
    inJail: false,
    jailTurns: 0,
    bailPasses: [],
    status: 'active',
    away: false,
    timeouts: 0,
    bankruptOrder: null,
    stats: {
      rentPaid: 0,
      rentReceived: 0,
      jailVisits: 0,
      doubles: 0,
      tradesDone: 0,
      auctionsWon: 0,
      auctionSpend: 0,
      buildingsBuilt: 0,
      lowestNetWorth: settings.startingCash,
      timeouts: 0,
    },
  }));

  const deckOrder = (n: number) => shuffle(rng, Array.from({ length: n }, (_, i) => i));
  const first = players[0]!;
  const state: GameState = {
    v: 1,
    settings,
    rng,
    diceDeck: [],
    players,
    tiles: board.tiles.map(() => ({ owner: null, level: 0, mortgaged: false })),
    bank: { houses: settings.totalHouses, hotels: settings.totalHotels, jackpot: 0 },
    decks: { fortune: deckOrder(board.decks.fortune.length), community: deckOrder(board.decks.community.length) },
    turn: {
      playerId: first.id,
      phase: 'AWAIT_ROLL',
      phaseStartedAt: now,
      deadline: 0,
      doubles: 0,
      extraRoll: false,
      hasRolled: false,
      lastRoll: null,
      pendingBuy: null,
      pendingMove: null,
      endTurn: false,
    },
    debts: [],
    auction: null,
    auctionQueue: [],
    trades: [],
    nextTradeId: 1,
    round: 1,
    turnCount: 1,
    startedAt: now,
    endedAt: null,
    winnerIds: [],
    endReason: null,
    bankruptCount: 0,
    seq: 0,
    log: [],
  };
  state.turn.deadline = now + phaseSeconds(state, 'AWAIT_ROLL') * 1000;

  const out: GameEvent[] = [{ t: 'GameStarted', seats: players.map((p) => p.id) }];

  // Blitz: deal free random properties, never completing a colour group outright.
  if (settings.freeProperties > 0) {
    const pool = shuffle(
      rng,
      board.tiles.filter((t) => t.type === 'property').map((t) => t.index),
    );
    for (let r = 0; r < settings.freeProperties; r++) {
      for (const p of players) {
        const pick = pool.findIndex((i) => {
          const def = board.tiles[i]!;
          if (def.type !== 'property') return false;
          state.tiles[i]!.owner = p.id;
          const completes = ownsWholeGroup(state, board, p.id, def.group);
          state.tiles[i]!.owner = null;
          return !completes;
        });
        if (pick < 0) continue;
        const [tile] = pool.splice(pick, 1);
        state.tiles[tile!]!.owner = p.id;
        out.push({ t: 'FreePropertyDealt', playerId: p.id, tile: tile! });
      }
    }
  }
  out.push({ t: 'TurnStarted', playerId: first.id, round: 1 });

  const events = out.map((ev) => ({ ...ev, seq: ++state.seq }));
  state.log.push(...events);
  return { state, events };
}
