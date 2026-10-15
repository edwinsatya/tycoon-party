import {
  type GameState,
  type Intent,
  activePlayers,
  legalActions,
  ownedTiles,
} from '../src';

/** Every intent worth trying right now: all legal moves for everyone, plus junk that must be rejected. */
export function candidates(s: GameState, r: number): Intent[] {
  const out: Intent[] = [{ type: 'TICK' }];
  const alive = activePlayers(s);
  for (const p of s.players) {
    const by = p.id;
    const la = legalActions(s, by);
    if (la.roll) out.push({ type: 'ROLL', by });
    if (la.buy) out.push({ type: 'BUY', by });
    if (la.decline) out.push({ type: 'DECLINE', by });
    if (la.bid) out.push({ type: 'BID', by, amount: la.bid.min }, { type: 'BID', by, amount: la.bid.max });
    if (la.auctionPass) out.push({ type: 'AUCTION_PASS', by });
    if (la.jail) out.push({ type: 'JAIL_PAY', by }, { type: 'JAIL_CARD', by }, { type: 'JAIL_ROLL', by });
    if (la.endTurn) out.push({ type: 'END_TURN', by });
    if (la.bankrupt) out.push({ type: 'BANKRUPT', by });
    for (const tile of la.build) out.push({ type: 'BUILD', by, tile });
    for (const tile of la.sell) out.push({ type: 'SELL_BUILDING', by, tile });
    for (const group of la.sellAll) out.push({ type: 'SELL_ALL_BUILDINGS', by, group });
    for (const tile of la.mortgage) out.push({ type: 'MORTGAGE', by, tile });
    for (const tile of la.unmortgage) out.push({ type: 'UNMORTGAGE', by, tile });
    for (const tradeId of la.tradesToAnswer) {
      out.push({ type: 'TRADE_RESPOND', by, tradeId, accept: true }, { type: 'TRADE_RESPOND', by, tradeId, accept: false });
    }
    for (const t of s.trades.filter((t) => t.fromId === by)) out.push({ type: 'TRADE_CANCEL', by, tradeId: t.id });
    if (la.canProposeTrade) {
      const partner = alive[r % alive.length];
      if (partner && partner.id !== by) {
        const mine = ownedTiles(s, by);
        const theirs = ownedTiles(s, partner.id);
        const give = mine.length ? [mine[r % mine.length]!] : [];
        const get = theirs.length ? [theirs[(r >> 3) % theirs.length]!] : [];
        out.push({
          type: 'TRADE_PROPOSE',
          by,
          to: partner.id,
          give: { cash: r % 3 === 0 ? Math.min(p.cash, 50) : 0, tiles: give, passes: Math.min(p.bailPasses.length, r % 2) },
          get: { cash: 0, tiles: get, passes: 0 },
          lift: get.filter((i) => s.tiles[i]!.mortgaged && r % 2 === 0),
        });
      }
    }
    // Junk the engine must reject without side effects.
    out.push(
      { type: 'ROLL', by },
      { type: 'BID', by, amount: -5 },
      { type: 'BID', by, amount: 1.5 },
      { type: 'BUILD', by, tile: 99 },
      { type: 'MORTGAGE', by, tile: 0 },
      { type: 'TRADE_RESPOND', by, tradeId: 'nope', accept: true },
    );
  }
  out.push({ type: 'ROLL', by: 'ghost' });
  return out;
}
