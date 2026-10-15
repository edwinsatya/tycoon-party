import { emit, type E } from './core';
import { type BaseState, boardOf, findPlayer, groupHasBuildings, mortgageFee, ownableDef, unmortgageCost } from './helpers';
import type { Bundle, ErrorCode, Intent, PlayerState, Trade } from './types';

type ProposeIntent = Extract<Intent, { type: 'TRADE_PROPOSE' }>;
type RespondIntent = Extract<Intent, { type: 'TRADE_RESPOND' }>;

const isCount = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;

/** Tradable: cash, Bail Passes, and tiles with no buildings anywhere in their colour group (PRD 9.1). */
export function checkBundle(s: BaseState, owner: PlayerState, b: Bundle): ErrorCode | null {
  const board = boardOf(s);
  if (!b || !isCount(b.cash) || !isCount(b.passes) || !Array.isArray(b.tiles)) return 'trade_invalid';
  if (b.cash > owner.cash) return 'not_enough_cash';
  if (b.passes > owner.bailPasses.length) return 'no_bail_pass';
  if (new Set(b.tiles).size !== b.tiles.length) return 'trade_invalid';
  for (const i of b.tiles) {
    if (!Number.isSafeInteger(i)) return 'trade_invalid';
    const def = ownableDef(board, i);
    if (!def) return 'not_ownable';
    if (s.tiles[i]!.owner !== owner.id) return 'not_owner';
    if (def.type === 'property' && groupHasBuildings(s, board, def.group)) return 'has_buildings';
  }
  return null;
}

const isEmpty = (b: Bundle) => b.cash === 0 && b.passes === 0 && b.tiles.length === 0;

/** Lift choices must name mortgaged tiles the chooser is about to receive. */
function checkLift(s: BaseState, receiving: number[], lift: number[] | undefined): ErrorCode | null {
  if (lift === undefined) return null;
  if (!Array.isArray(lift)) return 'trade_invalid';
  for (const i of lift) if (!receiving.includes(i) || !s.tiles[i]?.mortgaged) return 'trade_invalid';
  return null;
}

export function checkPropose(s: BaseState, p: PlayerState, it: Omit<ProposeIntent, 'type' | 'by'>): ErrorCode | null {
  if (s.turn.phase === 'AUCTION') return 'trade_during_auction';
  const to = findPlayer(s, it.to);
  if (!to || to.status !== 'active') return 'unknown_player';
  if (to.id === p.id) return 'trade_self';
  const err = checkBundle(s, p, it.give) ?? checkBundle(s, to, it.get) ?? checkLift(s, it.get.tiles, it.lift);
  if (err) return err;
  if (isEmpty(it.give) && isEmpty(it.get)) return 'trade_empty';
  const counterOf = it.counterOf ? s.trades.find((t) => t.id === it.counterOf) : undefined;
  if (it.counterOf && (!counterOf || counterOf.toId !== p.id || counterOf.fromId !== to.id)) return 'trade_not_found';
  const mine = s.trades.filter((t) => t.fromId === p.id);
  if (mine.length >= s.settings.maxPendingTrades) return 'trade_limit';
  if (mine.some((t) => t.toId === to.id)) return 'trade_limit';
  return null;
}

export function propose(e: E, p: PlayerState, it: ProposeIntent): ErrorCode | null {
  const err = checkPropose(e.s, p, it);
  if (err) return err;
  const s = e.s;
  if (it.counterOf) {
    s.trades = s.trades.filter((t) => t.id !== it.counterOf);
    emit(e, { t: 'TradeCountered', tradeId: it.counterOf, by: p.id });
  }
  const trade: Trade = {
    id: `T${s.nextTradeId++}`,
    fromId: p.id,
    toId: it.to,
    give: { cash: it.give.cash, tiles: [...it.give.tiles], passes: it.give.passes },
    get: { cash: it.get.cash, tiles: [...it.get.tiles], passes: it.get.passes },
    liftByProposer: [...(it.lift ?? [])],
    createdAt: e.now,
    expiresAt: e.now + s.settings.timers.trade * 1000,
    counterOf: it.counterOf ?? null,
  };
  s.trades.push(trade);
  emit(e, { t: 'TradeProposed', trade });
  return null;
}

function feesFor(s: BaseState, receiving: number[], lift: number[], playerId: string) {
  const board = boardOf(s);
  return receiving
    .filter((i) => s.tiles[i]!.mortgaged)
    .map((tile) => {
      const m = ownableDef(board, tile)!.mortgage;
      const lifted = lift.includes(tile);
      return { playerId, tile, amount: lifted ? unmortgageCost(m) : mortgageFee(m), lifted };
    });
}

export function respond(e: E, p: PlayerState, it: RespondIntent): ErrorCode | null {
  const s = e.s;
  const trade = s.trades.find((t) => t.id === it.tradeId);
  if (!trade || trade.toId !== p.id) return 'trade_not_found';
  if (s.turn.phase === 'AUCTION') return 'trade_during_auction';
  if (!it.accept) {
    s.trades = s.trades.filter((t) => t.id !== trade.id);
    emit(e, { t: 'TradeDeclined', tradeId: trade.id, by: p.id });
    return null;
  }
  const liftErr = checkLift(s, trade.give.tiles, it.lift);
  if (liftErr) return liftErr;
  const from = findPlayer(s, trade.fromId);
  // Re-check at acceptance: both sides must still own everything (PRD 9.1).
  if (!from || from.status !== 'active' || checkBundle(s, from, trade.give) || checkBundle(s, p, trade.get)) {
    s.trades = s.trades.filter((t) => t.id !== trade.id);
    emit(e, { t: 'TradeVoided', tradeId: trade.id });
    return null;
  }
  const fromFees = feesFor(s, trade.get.tiles, trade.liftByProposer, from.id);
  const toFees = feesFor(s, trade.give.tiles, it.lift ?? [], p.id);
  const sum = (xs: { amount: number }[]) => xs.reduce((a, x) => a + x.amount, 0);
  const fromAfter = from.cash - trade.give.cash + trade.get.cash - sum(fromFees);
  const toAfter = p.cash - trade.get.cash + trade.give.cash - sum(toFees);
  // The proposer can no longer cover their side: the offer cannot complete.
  if (fromAfter < 0) {
    s.trades = s.trades.filter((t) => t.id !== trade.id);
    emit(e, { t: 'TradeVoided', tradeId: trade.id });
    return null;
  }
  // The acceptor is short: keep the offer open so they can raise cash or choose not to lift.
  if (toAfter < 0) return 'trade_fees_unaffordable';

  from.cash = fromAfter;
  p.cash = toAfter;
  for (const i of trade.give.tiles) s.tiles[i]!.owner = p.id;
  for (const i of trade.get.tiles) s.tiles[i]!.owner = from.id;
  for (const f of [...fromFees, ...toFees]) if (f.lifted) s.tiles[f.tile]!.mortgaged = false;
  const passesGiven = from.bailPasses.splice(from.bailPasses.length - trade.give.passes, trade.give.passes);
  const passesGot = p.bailPasses.splice(p.bailPasses.length - trade.get.passes, trade.get.passes);
  p.bailPasses.push(...passesGiven);
  from.bailPasses.push(...passesGot);
  from.stats.tradesDone++;
  p.stats.tradesDone++;
  s.trades = s.trades.filter((t) => t.id !== trade.id);
  emit(e, { t: 'TradeCompleted', trade, fees: [...fromFees, ...toFees] });
  return null;
}

export function cancel(e: E, p: PlayerState, tradeId: string): ErrorCode | null {
  const s = e.s;
  const trade = s.trades.find((t) => t.id === tradeId);
  if (!trade || trade.fromId !== p.id) return 'trade_not_found';
  s.trades = s.trades.filter((t) => t.id !== tradeId);
  emit(e, { t: 'TradeCancelled', tradeId, by: p.id });
  return null;
}

export function expireTrades(e: E): boolean {
  const s = e.s;
  const expired = s.trades.filter((t) => t.expiresAt <= e.now);
  if (expired.length === 0) return false;
  s.trades = s.trades.filter((t) => t.expiresAt > e.now);
  for (const t of expired) emit(e, { t: 'TradeExpired', tradeId: t.id });
  return true;
}
