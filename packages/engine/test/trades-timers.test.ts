import { describe, expect, it } from 'vitest';
import type { Bundle } from '../src';
import { G, TILE } from './harness';

const b = (cash = 0, tiles: number[] = [], passes = 0): Bundle => ({ cash, tiles, passes });

describe('trading', () => {
  const setup = () => new G(3).own('p0', TILE.RUSTY).own('p1', TILE.DOCKSIDE, TILE.MARINA);

  it('swaps tiles and cash on accept', () => {
    const g = setup().act('p0', { type: 'TRADE_PROPOSE', to: 'p1', give: b(50, [TILE.RUSTY]), get: b(0, [TILE.DOCKSIDE]) });
    const id = g.event('TradeProposed').trade.id;
    g.act('p1', { type: 'TRADE_RESPOND', tradeId: id, accept: true });
    expect(g.s.tiles[TILE.RUSTY]!.owner).toBe('p1');
    expect(g.s.tiles[TILE.DOCKSIDE]!.owner).toBe('p0');
    expect(g.p('p0').cash).toBe(1450);
    expect(g.p('p1').cash).toBe(1550);
    expect(g.s.trades).toEqual([]);
  });

  it('works outside your turn and while someone else decides', () => {
    const g = setup().roll(2, 3);
    expect(g.phase).toBe('BUY_DECISION');
    g.act('p2', { type: 'TRADE_PROPOSE', to: 'p1', give: b(300), get: b(0, [TILE.MARINA]) });
    g.act('p1', { type: 'TRADE_RESPOND', tradeId: g.event('TradeProposed').trade.id, accept: true });
    expect(g.s.tiles[TILE.MARINA]!.owner).toBe('p2');
    expect(g.phase).toBe('BUY_DECISION');
  });

  it('declines, cancels and counters', () => {
    const g = setup().act('p0', { type: 'TRADE_PROPOSE', to: 'p1', give: b(10), get: b(0, [TILE.DOCKSIDE]) });
    const first = g.event('TradeProposed').trade.id;
    expect(g.err('p0', { type: 'TRADE_RESPOND', tradeId: first, accept: true })).toBe('trade_not_found');
    g.act('p1', {
      type: 'TRADE_PROPOSE',
      to: 'p0',
      give: b(0, [TILE.DOCKSIDE]),
      get: b(120),
      counterOf: first,
    });
    expect(g.has('TradeCountered')).toBe(true);
    expect(g.s.trades.map((t) => t.fromId)).toEqual(['p1']);
    const counter = g.s.trades[0]!.id;
    g.act('p0', { type: 'TRADE_RESPOND', tradeId: counter, accept: false });
    expect(g.s.trades).toEqual([]);
    g.act('p0', { type: 'TRADE_PROPOSE', to: 'p1', give: b(10), get: b(0, [TILE.DOCKSIDE]) });
    g.act('p0', { type: 'TRADE_CANCEL', tradeId: g.event('TradeProposed').trade.id });
    expect(g.s.trades).toEqual([]);
  });

  it('validates what can be traded', () => {
    const g = setup().own('p0', TILE.DOCKSIDE).houses(1, TILE.RUSTY, TILE.DOCKSIDE);
    expect(g.err('p0', { type: 'TRADE_PROPOSE', to: 'p1', give: b(0, [TILE.RUSTY]), get: b(1) })).toBe('has_buildings');
    expect(g.err('p0', { type: 'TRADE_PROPOSE', to: 'p1', give: b(0, [TILE.MARINA]), get: b() })).toBe('not_owner');
    expect(g.err('p0', { type: 'TRADE_PROPOSE', to: 'p1', give: b(9999), get: b() })).toBe('not_enough_cash');
    expect(g.err('p0', { type: 'TRADE_PROPOSE', to: 'p0', give: b(1), get: b() })).toBe('trade_self');
    expect(g.err('p0', { type: 'TRADE_PROPOSE', to: 'p1', give: b(), get: b() })).toBe('trade_empty');
    expect(g.err('p0', { type: 'TRADE_PROPOSE', to: 'p1', give: b(-5), get: b() })).toBe('trade_invalid');
    expect(g.err('p0', { type: 'TRADE_PROPOSE', to: 'p1', give: b(0, [], 1), get: b() })).toBe('no_bail_pass');
  });

  it('allows one open offer per partner', () => {
    const g = setup().act('p0', { type: 'TRADE_PROPOSE', to: 'p1', give: b(10), get: b(0, [TILE.MARINA]) });
    expect(g.err('p0', { type: 'TRADE_PROPOSE', to: 'p1', give: b(20), get: b(0, [TILE.MARINA]) })).toBe('trade_limit');
    g.act('p0', { type: 'TRADE_PROPOSE', to: 'p2', give: b(10), get: b(5) });
  });

  it('voids the offer if the proposer no longer has what they offered', () => {
    const g = setup().act('p0', { type: 'TRADE_PROPOSE', to: 'p1', give: b(1450), get: b(0, [TILE.MARINA]) });
    const id = g.event('TradeProposed').trade.id;
    g.roll(2, 3).act('p0', { type: 'BUY' });
    g.act('p1', { type: 'TRADE_RESPOND', tradeId: id, accept: true });
    expect(g.has('TradeVoided')).toBe(true);
    expect(g.s.tiles[TILE.MARINA]!.owner).toBe('p1');
  });

  it('charges the 10% fee on a mortgaged tile, or 110% to lift it at once', () => {
    const g = setup();
    g.s.tiles[TILE.MARINA]!.mortgaged = true;
    g.act('p0', { type: 'TRADE_PROPOSE', to: 'p1', give: b(100), get: b(0, [TILE.MARINA]) });
    g.act('p1', { type: 'TRADE_RESPOND', tradeId: g.event('TradeProposed').trade.id, accept: true });
    expect(g.p('p0').cash).toBe(1500 - 100 - 18);
    expect(g.s.tiles[TILE.MARINA]!.mortgaged).toBe(true);

    const h = setup();
    h.s.tiles[TILE.MARINA]!.mortgaged = true;
    h.act('p0', { type: 'TRADE_PROPOSE', to: 'p1', give: b(100), get: b(0, [TILE.MARINA]), lift: [TILE.MARINA] });
    h.act('p1', { type: 'TRADE_RESPOND', tradeId: h.event('TradeProposed').trade.id, accept: true });
    expect(h.p('p0').cash).toBe(1500 - 100 - 193);
    expect(h.s.tiles[TILE.MARINA]!.mortgaged).toBe(false);
  });

  it('pauses trading during an auction', () => {
    const g = setup().roll(2, 3).act('p0', { type: 'DECLINE' });
    expect(g.err('p0', { type: 'TRADE_PROPOSE', to: 'p1', give: b(10), get: b(0, [TILE.MARINA]) })).toBe(
      'trade_during_auction',
    );
  });

  it('expires unanswered offers', () => {
    const g = setup().act('p0', { type: 'TRADE_PROPOSE', to: 'p1', give: b(10), get: b(0, [TILE.MARINA]) });
    g.wait(31).tick();
    expect(g.has('TradeExpired')).toBe(true);
    expect(g.s.trades).toEqual([]);
  });
});

describe('timers and Away', () => {
  it('rejects a TICK when nothing is due', () => {
    const g = new G();
    expect(g.err(null, { type: 'TICK' })).toBe('nothing_due');
  });

  it('auto-rolls, then marks a player Away after two timeouts in a row', () => {
    const g = new G().own('p0', TILE.DOCKSIDE).dice([1, 2], [3, 4]);
    g.timeout();
    expect(g.p('p0').position).toBe(TILE.DOCKSIDE);
    expect(g.event('TimedOut').phase).toBe('AWAIT_ROLL');
    expect(g.phase).toBe('POST_ROLL');
    g.timeout();
    expect(g.current).toBe('p1');
    expect(g.p('p0').timeouts).toBe(1);
    g.own('p1', TILE.LANTERN).dice([4, 5]).act('p1', { type: 'ROLL' }).act('p1', { type: 'END_TURN' });
    g.dice([3, 4]).timeout();
    expect(g.p('p0').away).toBe(true);
    expect(g.has('PlayerAway')).toBe(true);
    g.act('p0', { type: 'END_TURN' });
    expect(g.p('p0').away).toBe(false);
    expect(g.has('PlayerBack')).toBe(true);
  });

  it('declines into an auction when the buy timer runs out', () => {
    const g = new G().roll(1, 2).timeout();
    expect(g.phase).toBe('AUCTION');
  });

  it('uses a held Bail Pass when the jail timer runs out', () => {
    const g = new G();
    g.p('p0').inJail = true;
    g.p('p0').position = TILE.JAIL;
    g.s.turn.phase = 'JAIL_DECISION';
    g.s.decks.community = g.s.decks.community.filter((c) => c !== 4);
    g.p('p0').bailPasses = ['community'];
    g.timeout();
    expect(g.p('p0').inJail).toBe(false);
    expect(g.phase).toBe('AWAIT_ROLL');
  });

  it('keeps the end-turn timer alive after actions, up to a cap', () => {
    const g = new G().own('p0', TILE.DOCKSIDE, TILE.RUSTY).roll(1, 2);
    const first = g.s.turn.deadline;
    g.wait(10).act('p0', { type: 'BUILD', tile: TILE.RUSTY });
    expect(g.s.turn.deadline).toBe(g.now + 15_000);
    expect(g.s.turn.deadline).toBeGreaterThan(first);
    g.wait(80).act('p0', { type: 'BUILD', tile: TILE.DOCKSIDE });
    expect(g.s.turn.deadline).toBe(g.s.turn.phaseStartedAt + 90_000);
  });
});

describe('match limits', () => {
  it('ends at the round limit and the richest player wins', () => {
    const g = new G(2, { roundLimit: 1 }).own('p0', TILE.DOCKSIDE);
    g.roll(1, 2).act('p0', { type: 'END_TURN' });
    g.own('p1', TILE.LANTERN).at('p1', 6).roll(1, 2).act('p1', { type: 'END_TURN' });
    expect(g.phase).toBe('GAME_OVER');
    expect(g.s.endReason).toBe('roundLimit');
    expect(g.s.winnerIds).toEqual(['p1']);
  });

  it('ends at the time limit', () => {
    const g = new G(2, { timeLimitMin: 30 }).own('p0', TILE.DOCKSIDE).roll(1, 2);
    g.wait(30 * 60).act('p0', { type: 'END_TURN' });
    expect(g.s.endReason).toBe('timeLimit');
  });

  it('Blitz ends at the second bankruptcy', () => {
    const g = new G(4, {}, 'blitz');
    for (const t of g.s.tiles) t.owner = null;
    g.cash('p0', 0).at('p0', 1).roll(1, 2).act('p0', { type: 'BANKRUPT' });
    expect(g.phase).not.toBe('GAME_OVER');
    g.cash('p1', 0).at('p1', 1).roll(1, 2).act('p1', { type: 'BANKRUPT' });
    expect(g.phase).toBe('GAME_OVER');
    expect(g.s.endReason).toBe('bankruptcyLimit');
    expect(g.s.winnerIds.length).toBeGreaterThan(0);
  });
});
