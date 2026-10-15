import type { GroupId } from '@rollionaire/boards';
import { checkBuild, checkMortgage, checkSellAll, checkSellBuilding, checkUnmortgage } from './assets';
import { minBid } from './auction';
import { type BaseState, activePlayers, boardOf, findPlayer, maxRaisable, ownableDef, ownedTiles } from './helpers';
import type { PlayerId } from './types';

/** Everything a player may do right now. Drives button states in the UI and the bots. */
export interface LegalActions {
  roll: boolean;
  buy: { tile: number; price: number; affordable: boolean } | null;
  decline: boolean;
  bid: { min: number; max: number } | null;
  auctionPass: boolean;
  jail: { pay: boolean; card: boolean; roll: boolean } | null;
  endTurn: boolean;
  bankrupt: boolean;
  raise: { amount: number; creditorId: PlayerId | null; max: number } | null;
  build: number[];
  sell: number[];
  sellAll: GroupId[];
  mortgage: number[];
  unmortgage: number[];
  canProposeTrade: boolean;
  tradesToAnswer: string[];
}

export function legalActions(s: BaseState, pid: PlayerId): LegalActions {
  const none: LegalActions = {
    roll: false,
    buy: null,
    decline: false,
    bid: null,
    auctionPass: false,
    jail: null,
    endTurn: false,
    bankrupt: false,
    raise: null,
    build: [],
    sell: [],
    sellAll: [],
    mortgage: [],
    unmortgage: [],
    canProposeTrade: false,
    tradesToAnswer: [],
  };
  const p = findPlayer(s, pid);
  if (!p || p.status !== 'active' || s.turn.phase === 'GAME_OVER') return none;
  const board = boardOf(s);
  const v = { s };
  const mine = s.turn.playerId === pid;
  const phase = s.turn.phase;
  const owned = ownedTiles(s, pid);
  const groups = [...new Set(owned.map((i) => board.tiles[i]!).flatMap((t) => (t.type === 'property' ? [t.group] : [])))];

  const out: LegalActions = { ...none };
  out.roll = mine && phase === 'AWAIT_ROLL' && (!s.turn.hasRolled || s.turn.extraRoll);
  if (mine && phase === 'BUY_DECISION' && s.turn.pendingBuy !== null) {
    const price = ownableDef(board, s.turn.pendingBuy)!.price;
    out.buy = { tile: s.turn.pendingBuy, price, affordable: p.cash >= price };
    out.decline = true;
  }
  if (phase === 'AUCTION' && s.auction) {
    const a = s.auction;
    const open = !a.passed.includes(pid) && a.highBidderId !== pid;
    const min = minBid(a, s.settings.auctionMinBid);
    if (open && p.cash >= min) out.bid = { min, max: p.cash };
    out.auctionPass = open;
  }
  if (mine && phase === 'JAIL_DECISION') {
    out.jail = { pay: p.cash >= board.jailFine, card: p.bailPasses.length > 0, roll: true };
  }
  out.endTurn = mine && phase === 'POST_ROLL';
  const debt = s.debts[0];
  if (phase === 'RAISE_FUNDS' && debt?.debtorId === pid) {
    const max = maxRaisable(s, pid);
    out.raise = { amount: debt.amount, creditorId: debt.creditorId, max };
    out.bankrupt = max < debt.amount;
  }
  out.build = owned.filter((i) => checkBuild(v, p, i) === null);
  out.sell = owned.filter((i) => checkSellBuilding(v, p, i) === null);
  out.sellAll = groups.filter((g) => checkSellAll(v, p, g) === null);
  out.mortgage = owned.filter((i) => checkMortgage(v, p, i) === null);
  out.unmortgage = owned.filter((i) => checkUnmortgage(v, p, i) === null);
  out.canProposeTrade =
    phase !== 'AUCTION' &&
    activePlayers(s).length > 1 &&
    s.trades.filter((t) => t.fromId === pid).length < s.settings.maxPendingTrades;
  out.tradesToAnswer = phase === 'AUCTION' ? [] : s.trades.filter((t) => t.toId === pid).map((t) => t.id);
  return out;
}

/** Players the game is waiting on right now (trade recipients included). */
export function pendingActors(s: BaseState): PlayerId[] {
  if (s.turn.phase === 'GAME_OVER') return [];
  const ids = new Set<PlayerId>();
  if (s.turn.phase === 'AUCTION' && s.auction) {
    const a = s.auction;
    for (const p of activePlayers(s)) if (!a.passed.includes(p.id) && p.id !== a.highBidderId) ids.add(p.id);
  } else if (s.turn.phase === 'RAISE_FUNDS' && s.debts[0]) {
    ids.add(s.debts[0].debtorId);
  } else {
    ids.add(s.turn.playerId);
  }
  if (s.turn.phase !== 'AUCTION') for (const t of s.trades) ids.add(t.toId);
  return [...ids];
}
