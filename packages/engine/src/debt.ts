import { emit, type E } from './core';
import { findPlayer, groupHasBuildings, groupOf, maxRaisable, mortgageFee, ownableDef, ownedTiles } from './helpers';
import { mortgage, sellAll, sellBuilding, checkSellBuilding, checkMortgage } from './assets';
import { bailCardIndex } from './movement';
import type { ErrorCode, PlayerId, PlayerState } from './types';
import type { GroupId } from '@rollionaire/boards';

/** BANKRUPT: only allowed when even selling everything cannot cover the debt (PRD 6.8). */
export function declareBankrupt(e: E, p: PlayerState): ErrorCode | null {
  const s = e.s;
  const debt = s.debts[0];
  if (s.turn.phase !== 'RAISE_FUNDS' || !debt) return 'wrong_phase';
  if (debt.debtorId !== p.id) return 'not_debtor';
  if (maxRaisable(s, p.id) >= debt.amount) return 'can_still_pay';
  goBankrupt(e, p, debt.creditorId);
  return null;
}

export function goBankrupt(e: E, p: PlayerState, creditorId: PlayerId | null): void {
  const s = e.s;
  const board = e.board;

  // 1. Buildings go back to the bank at half price.
  const groups = new Set<GroupId>();
  for (const i of ownedTiles(s, p.id)) {
    const g = groupOf(board, i);
    if (g && groupHasBuildings(s, board, g)) groups.add(g);
  }
  for (const g of groups) sellAll(e, p, g, false);

  const creditor = findPlayer(s, creditorId);
  const tiles = ownedTiles(s, p.id);
  if (creditor && creditor.status === 'active') {
    // 2a. Everything goes to the creditor; mortgaged tiles cost them the 10% fee (PRD 6.6).
    creditor.cash += p.cash;
    p.cash = 0;
    for (const i of tiles) {
      const ts = s.tiles[i]!;
      ts.owner = creditor.id;
      if (ts.mortgaged) {
        const fee = mortgageFee(ownableDef(board, i)!.mortgage);
        // A creditor who cannot cover the fee keeps the tile mortgaged and pays nothing now.
        if (creditor.cash >= fee) {
          creditor.cash -= fee;
          emit(e, { t: 'Paid', from: creditor.id, to: null, amount: fee, reason: 'mortgageFee', toJackpot: false });
        }
      }
    }
    creditor.bailPasses.push(...p.bailPasses);
  } else {
    // 2b. To the bank: tiles return unmortgaged and are auctioned one by one.
    p.cash = 0;
    for (const i of tiles) {
      const ts = s.tiles[i]!;
      ts.owner = null;
      ts.mortgaged = false;
      ts.level = 0;
      if (s.settings.auctions) s.auctionQueue.push(i);
    }
    for (const deck of p.bailPasses) s.decks[deck].push(bailCardIndex(e, deck));
  }
  p.bailPasses = [];
  p.status = 'bankrupt';
  p.inJail = false;
  s.bankruptCount++;
  p.bankruptOrder = s.bankruptCount;

  s.debts = s.debts.filter((d) => d.debtorId !== p.id);
  for (const d of s.debts) if (d.creditorId === p.id) d.creditorId = null;

  for (const t of s.trades.filter((t) => t.fromId === p.id || t.toId === p.id)) {
    emit(e, { t: 'TradeVoided', tradeId: t.id });
  }
  s.trades = s.trades.filter((t) => t.fromId !== p.id && t.toId !== p.id);

  emit(e, { t: 'Bankrupt', playerId: p.id, creditorId: creditor && creditor.status === 'active' ? creditor.id : null });
  e.resetPhase = true;
}

/**
 * Raise Funds timeout (Autopilot): raise cash with the least damage first. Mortgage
 * tiles outside built groups (cheapest first), then sell buildings evenly, then
 * mortgage the rest. Bankrupt if still short.
 */
export function autoLiquidate(e: E, p: PlayerState, target: number): void {
  const s = e.s;
  const board = e.board;
  for (let guard = 0; guard < 200 && p.cash < target; guard++) {
    const owned = ownedTiles(s, p.id);
    const mortgageable = owned
      .filter((i) => checkMortgage(e, p, i) === null)
      .sort((a, b) => ownableDef(board, a)!.mortgage - ownableDef(board, b)!.mortgage);
    if (mortgageable.length > 0) {
      mortgage(e, p, mortgageable[0]!);
      continue;
    }
    const sellable = owned
      .filter((i) => s.tiles[i]!.level > 0)
      .sort((a, b) => {
        const da = ownableDef(board, a)!;
        const db = ownableDef(board, b)!;
        return (da.type === 'property' ? da.houseCost : 0) - (db.type === 'property' ? db.houseCost : 0);
      });
    const one = sellable.find((i) => checkSellBuilding(e, p, i) === null);
    if (one !== undefined) {
      sellBuilding(e, p, one);
      continue;
    }
    const first = sellable[0];
    if (first !== undefined) {
      sellAll(e, p, groupOf(board, first)!, false);
      continue;
    }
    break;
  }
  if (p.cash < target) {
    const debt = s.debts[0];
    goBankrupt(e, p, debt?.debtorId === p.id ? debt.creditorId : null);
  }
}
