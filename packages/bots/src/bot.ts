import type { GroupId } from '@rollionaire/boards';
import {
  type Bundle,
  type Intent,
  type PlayerId,
  type PublicGameState,
  type RngState,
  activePlayers,
  boardOf,
  findPlayer,
  groupHasBuildings,
  mortgageFee,
  legalActions,
  ownableDef,
  ownsWholeGroup,
  randFloat,
  seedRng,
  unmortgageCost,
} from '@rollionaire/engine';
import { maxThreat, tileValue, tradeDelta, unownedCount } from './eval';

export type BotLevel = 'casual' | 'smart' | 'shark';

interface Persona {
  /** Cash kept back: max(min, threat * factor), capped. */
  reserveMin: number;
  reserveFactor: number;
  reserveCap: number;
  auctionValue: number;
  setBonus: number;
  blockBonus: number;
  /** Buy even below the reserve when the tile is worth this many times its price. */
  stretchBuy: number;
  mortgageToBuy: boolean;
  proposeTrades: boolean;
  tradePremium: number;
  /** Accept when my gain is at least this share of what the partner gains. */
  dangerWeight: number;
  /** Stay in jail late in the game, when the board is dangerous. */
  jailStayLate: boolean;
  buildTo: number;
  /** Share of the cash reserve kept back when building (houses beat cash in hand). */
  buildReserve: number;
}

export const PERSONAS: Record<BotLevel, Persona> = {
  casual: {
    reserveMin: 50,
    reserveFactor: 0,
    reserveCap: 50,
    auctionValue: 0.8,
    setBonus: 1.3,
    blockBonus: 1,
    stretchBuy: 99,
    mortgageToBuy: false,
    proposeTrades: false,
    tradePremium: 1.2,
    dangerWeight: 0.15,
    jailStayLate: false,
    buildTo: 5,
    buildReserve: 1,
  },
  smart: {
    reserveMin: 120,
    reserveFactor: 0.6,
    reserveCap: 600,
    auctionValue: 1.05,
    setBonus: 1.9,
    blockBonus: 1.4,
    stretchBuy: 1.5,
    mortgageToBuy: false,
    proposeTrades: true,
    tradePremium: 1.6,
    dangerWeight: 0.9,
    jailStayLate: true,
    buildTo: 5,
    buildReserve: 0.75,
  },
  shark: {
    reserveMin: 80,
    reserveFactor: 0.45,
    reserveCap: 450,
    auctionValue: 1.25,
    setBonus: 2.4,
    blockBonus: 1.7,
    stretchBuy: 1.3,
    mortgageToBuy: true,
    proposeTrades: true,
    tradePremium: 1.4,
    dangerWeight: 1.1,
    jailStayLate: true,
    buildTo: 5,
    buildReserve: 0.5,
  },
};

export interface DecideCtx {
  now: number;
}

/**
 * Rule-based bot. It uses the same intents as humans and only reads the public
 * state (PRD 8.6). `decide` returns null when it has nothing to do right now.
 */
export class Bot {
  readonly persona: Persona;
  private rng: RngState;
  private proposedOnTurn = -1;
  /** Per trade target: the turn of the last offer and how many offers were made. */
  private proposals = new Map<string, { turn: number; tries: number }>();

  constructor(
    readonly id: PlayerId,
    readonly level: BotLevel,
    seed = id,
  ) {
    this.persona = PERSONAS[level];
    this.rng = seedRng(`bot:${seed}`);
  }

  decide(s: PublicGameState, _ctx: DecideCtx): Intent | null {
    const me = findPlayer(s, this.id);
    if (!me || me.status !== 'active' || s.turn.phase === 'GAME_OVER') return null;
    const la = legalActions(s, this.id);
    const by = this.id;

    for (const tradeId of la.tradesToAnswer) return this.answerTrade(s, tradeId);

    if (la.raise) return this.raiseFunds(s, la);
    if (s.turn.phase === 'AUCTION') return this.auction(s, la);
    if (s.turn.playerId !== this.id) return null;

    if (la.buy) return this.buyDecision(s, la);

    const manage = this.manage(s, la);
    if (manage) return manage;

    if (la.jail) {
      const late = this.persona.jailStayLate && unownedCount(s) < 6 && maxThreat(s, this.id) > 300;
      if (late) return { type: 'JAIL_ROLL', by };
      if (la.jail.card) return { type: 'JAIL_CARD', by };
      if (la.jail.pay && me.cash - 50 >= this.reserve(s)) return { type: 'JAIL_PAY', by };
      return { type: 'JAIL_ROLL', by };
    }
    if (la.roll) return { type: 'ROLL', by };
    if (la.endTurn) return { type: 'END_TURN', by };
    return null;
  }

  reserve(s: PublicGameState): number {
    const p = this.persona;
    return Math.min(p.reserveCap, Math.max(p.reserveMin, Math.round(maxThreat(s, this.id) * p.reserveFactor)));
  }

  private buyDecision(s: PublicGameState, la: ReturnType<typeof legalActions>): Intent {
    const by = this.id;
    const me = findPlayer(s, by)!;
    const { tile, price } = la.buy!;
    const value = tileValue(s, by, tile, this.persona.setBonus, this.persona.blockBonus);
    if (me.cash - price >= this.reserve(s)) return { type: 'BUY', by };
    if (me.cash >= price && value >= price * this.persona.stretchBuy) return { type: 'BUY', by };
    if (this.persona.mortgageToBuy && value >= price * this.persona.stretchBuy) {
      const spare = this.spareMortgage(s, la.mortgage);
      if (spare !== null) return { type: 'MORTGAGE', by, tile: spare };
    }
    return { type: 'DECLINE', by };
  }

  /** A mortgageable tile that is not part of a set I own or could soon complete. */
  private spareMortgage(s: PublicGameState, candidates: number[]): number | null {
    const board = boardOf(s);
    const loose = candidates.filter((i) => {
      const def = board.tiles[i]!;
      if (def.type !== 'property') return true;
      return !board.groups[def.group].tiles.every((j) => s.tiles[j]!.owner === this.id);
    });
    loose.sort((a, b) => ownableDef(board, a)!.mortgage - ownableDef(board, b)!.mortgage);
    return loose[0] ?? null;
  }

  private auction(s: PublicGameState, la: ReturnType<typeof legalActions>): Intent | null {
    const by = this.id;
    if (!la.auctionPass) return null;
    const me = findPlayer(s, by)!;
    const a = s.auction!;
    const value = tileValue(s, by, a.tile, this.persona.setBonus, this.persona.blockBonus) * this.persona.auctionValue;
    const cap = Math.min(Math.floor(value), me.cash - Math.floor(this.reserve(s) / 2));
    if (la.bid && la.bid.min <= cap) {
      const step = this.level === 'casual' ? Math.floor(randFloat(this.rng) * 10) : this.level === 'smart' ? 5 : 1;
      return { type: 'BID', by, amount: Math.min(cap, la.bid.min + step) };
    }
    return { type: 'AUCTION_PASS', by };
  }

  private raiseFunds(s: PublicGameState, la: ReturnType<typeof legalActions>): Intent {
    const by = this.id;
    const board = boardOf(s);
    if (la.bankrupt) return { type: 'BANKRUPT', by };
    const inOwnSet = (i: number) => {
      const def = board.tiles[i]!;
      return def.type === 'property' && ownsWholeGroup(s, board, by, def.group);
    };
    const byMortgage = (a: number, b: number) => ownableDef(board, a)!.mortgage - ownableDef(board, b)!.mortgage;
    const loose = la.mortgage.filter((i) => !inOwnSet(i)).sort(byMortgage);
    if (loose[0] !== undefined) return { type: 'MORTGAGE', by, tile: loose[0] };
    const setTiles = [...la.mortgage].sort(byMortgage);
    if (la.sell.length > 0) {
      // Sell from the cheapest group first: it hurts income the least.
      const sell = [...la.sell].sort((a, b) => houseCost(a) - houseCost(b));
      return { type: 'SELL_BUILDING', by, tile: sell[0]! };
    }
    if (la.sellAll[0]) return { type: 'SELL_ALL_BUILDINGS', by, group: la.sellAll[0] };
    if (setTiles[0] !== undefined) return { type: 'MORTGAGE', by, tile: setTiles[0] };
    return { type: 'BANKRUPT', by };

    function houseCost(i: number) {
      const def = board.tiles[i]!;
      return def.type === 'property' ? def.houseCost : 0;
    }
  }

  /** Lift mortgages, build, and look for a trade before rolling or ending the turn. */
  private manage(s: PublicGameState, la: ReturnType<typeof legalActions>): Intent | null {
    const by = this.id;
    const board = boardOf(s);
    const me = findPlayer(s, by)!;
    const reserve = this.reserve(s);

    // Lift mortgages inside complete sets first, so they can be built on.
    const lift = [...la.unmortgage].sort((a, b) => Number(inSet(b)) - Number(inSet(a)));
    for (const i of lift) {
      const cost = unmortgageCost(ownableDef(board, i)!.mortgage);
      if (me.cash - cost >= reserve + (inSet(i) ? 0 : 200)) return { type: 'UNMORTGAGE', by, tile: i };
    }

    if (la.build.length > 0) {
      const ranked = [...la.build].sort((a, b) => buildScore(b) - buildScore(a));
      for (const i of ranked) {
        const def = board.tiles[i]!;
        if (def.type !== 'property') continue;
        if (s.tiles[i]!.level >= this.persona.buildTo) continue;
        if (me.cash - def.houseCost >= reserve * this.persona.buildReserve) return { type: 'BUILD', by, tile: i };
      }
    }

    if (this.persona.proposeTrades && this.proposedOnTurn !== s.turnCount && la.canProposeTrade) {
      this.proposedOnTurn = s.turnCount;
      const offer = this.findTrade(s);
      if (offer) return offer;
    }
    return null;

    function inSet(i: number): boolean {
      const def = board.tiles[i]!;
      return def.type === 'property' && board.groups[def.group].tiles.every((j) => s.tiles[j]!.owner === by);
    }
    function buildScore(i: number): number {
      const def = board.tiles[i]!;
      if (def.type !== 'property') return 0;
      const lvl = s.tiles[i]!.level;
      const next = def.rent[Math.min(lvl + 1, 5)]!;
      // Prefer the jump to 3 houses (best return) and cheap houses.
      return (next - def.rent[lvl]!) / def.houseCost;
    }
  }

  /**
   * Work towards a colour group. Targets the tiles one opponent holds in a group
   * where I'm missing at most two; swaps when both sides complete a set, otherwise
   * offers the smallest cash amount a careful player would accept.
   */
  private findTrade(s: PublicGameState): Intent | null {
    const by = this.id;
    const board = boardOf(s);
    const me = findPlayer(s, by)!;
    const budget = me.cash - Math.floor(this.reserve(s) / 2);
    if (s.trades.some((t) => t.fromId === by)) return null;
    const cooldown = 3 * activePlayers(s).length;

    const targets: { holder: PlayerId; tiles: number[]; completes: boolean; worth: number }[] = [];
    for (const group of Object.keys(board.groups) as GroupId[]) {
      const tiles = board.groups[group].tiles;
      if (groupHasBuildings(s, board, group)) continue;
      const mine = tiles.filter((i) => s.tiles[i]!.owner === by);
      const missing = tiles.filter((i) => s.tiles[i]!.owner !== by);
      if (mine.length === 0 || missing.length === 0 || missing.length > 2) continue;
      if (missing.some((i) => !s.tiles[i]!.owner)) continue;
      const holders = new Set(missing.map((i) => s.tiles[i]!.owner!));
      for (const holder of holders) {
        const want = missing.filter((i) => s.tiles[i]!.owner === holder);
        const key = `${holder}:${want.join(',')}`;
        const last = this.proposals.get(key);
        if (last !== undefined && s.turnCount - last.turn < cooldown) continue;
        const worth = want.reduce((a, i) => a + ownableDef(board, i)!.price, 0);
        targets.push({ holder, tiles: want, completes: holders.size === 1, worth });
      }
    }
    targets.sort((a, b) => Number(b.completes) - Number(a.completes) || b.worth - a.worth);
    // Heads-up, every coin I hand over is my only rival's: only buy a finished set,
    // and only with cash left to build on it.
    const headsUp = activePlayers(s).length === 2 && this.level !== 'casual';

    for (const target of targets) {
      if (headsUp && !target.completes) continue;
      const key = `${target.holder}:${target.tiles.join(',')}`;
      const tries = this.proposals.get(key)?.tries ?? 0;
      this.proposals.set(key, { turn: s.turnCount, tries: tries + 1 });
      const get: Bundle = { cash: 0, tiles: target.tiles, passes: 0 };

      // 1. Swap: a tile of mine that completes a set for them, plus cash if they gain less.
      for (const give of this.tilesPartnerNeeds(s, target.holder)) {
        const offer = this.cheapestAcceptable(s, target.holder, [give], get, budget, tries);
        if (offer) return offer;
      }
      // 2. Cash only.
      const offer = this.cheapestAcceptable(s, target.holder, [], get, budget, tries);
      if (offer) return offer;
    }
    return null;
  }

  /**
   * Cash top-up for an offer. Opens at what an easy-going partner would take and
   * climbs towards what a careful one needs over repeated tries, so it never
   * overpays someone who would have said yes for less. Null if no price works for me.
   */
  private cheapestAcceptable(
    s: PublicGameState,
    partner: PlayerId,
    giveTiles: number[],
    get: Bundle,
    budget: number,
    tries: number,
  ): Intent | null {
    const by = this.id;
    const offer = (cash: number): Bundle => ({ cash, tiles: giveTiles, passes: 0 });
    const max = Math.max(0, budget);
    const minCash = (danger: number): number | null => {
      const accepts = (cash: number) => {
        const d = tradeDelta(s, partner, by, get, offer(cash));
        return d.me > 0 && d.me >= danger * d.them;
      };
      if (!accepts(max)) return null;
      let lo = 0;
      let hi = max;
      while (lo < hi) {
        const mid = Math.floor((lo + hi) / 2);
        if (accepts(mid)) hi = mid;
        else lo = mid + 1;
      }
      return lo;
    };
    const late = lateGameFactor(s);
    const careful = minCash(PERSONAS.smart.dangerWeight * late);
    const easy = minCash(PERSONAS.casual.dangerWeight * late);
    if (easy === null) return null;
    const step = Math.min(1, tries / 3);
    const target = careful === null ? max : easy + (careful - easy) * step;
    // Round up to a friendly number.
    const cash = Math.min(max, Math.ceil((target * 1.05) / 10) * 10);
    if (activePlayers(s).length === 2 && this.level !== 'casual') {
      const board = boardOf(s);
      const def = board.tiles[get.tiles[0]!]!;
      if (def.type === 'property') {
        const buildCost = 2 * def.houseCost * board.groups[def.group].tiles.length;
        if (findPlayer(s, by)!.cash - cash < buildCost) return null;
      }
    }
    const d = tradeDelta(s, by, partner, offer(cash), get);
    if (!(d.me > 0 && d.me >= this.relativeBar(s) * d.them)) return null;
    return { type: 'TRADE_PROPOSE', by, to: partner, give: offer(cash), get };
  }

  /**
   * How much better than my partner a deal must leave me. Heads-up, anything that
   * helps the only opponent more than me is a loss, whatever the absolute gain.
   */
  private relativeBar(s: PublicGameState): number {
    if (this.level === 'casual') return 0;
    if (activePlayers(s).length === 2) return Math.max(0.85, this.persona.dangerWeight * lateGameFactor(s));
    return 0.5 * this.persona.dangerWeight;
  }

  /** My tiles that would complete a colour group for `partner`. */
  private tilesPartnerNeeds(s: PublicGameState, partner: PlayerId): number[] {
    const board = boardOf(s);
    const out: number[] = [];
    for (const group of Object.keys(board.groups) as GroupId[]) {
      const tiles = board.groups[group].tiles;
      if (groupHasBuildings(s, board, group)) continue;
      const missing = tiles.filter((i) => s.tiles[i]!.owner !== partner);
      if (missing.length === 1 && s.tiles[missing[0]!]!.owner === this.id && missing.length < tiles.length)
        out.push(missing[0]!);
    }
    return out;
  }

  private answerTrade(s: PublicGameState, tradeId: string): Intent {
    const by = this.id;
    const trade = s.trades.find((t) => t.id === tradeId)!;
    const me = findPlayer(s, by)!;
    // From my side I give `trade.get` and receive `trade.give`.
    const d = tradeDelta(s, by, trade.fromId, trade.get, trade.give);
    const danger =
      this.level !== 'casual' && activePlayers(s).length === 2
        ? this.relativeBar(s)
        : this.persona.dangerWeight * lateGameFactor(s);
    const board = boardOf(s);
    const fees = trade.give.tiles
      .filter((i) => s.tiles[i]!.mortgaged)
      .reduce((a, i) => a + mortgageFee(ownableDef(board, i)!.mortgage), 0);
    const cashAfter = me.cash - trade.get.cash + trade.give.cash - fees;
    const accept = d.me > 0 && d.me >= danger * d.them && cashAfter >= 0;
    return { type: 'TRADE_RESPOND', by, tradeId, accept };
  }
}

/** Bots grow more willing to deal as a match drags on, so stalemates break up. */
const lateGameFactor = (s: PublicGameState) => Math.max(0.3, 1 - s.round / 80);
