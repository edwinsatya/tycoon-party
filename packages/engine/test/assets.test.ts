import { describe, expect, it } from 'vitest';
import { G, TILE } from './harness';

const toBuy = () => new G(3).roll(1, 2); // p0 on Dockside Row (60), unowned

describe('buying and auctions', () => {
  it('buys at list price', () => {
    const g = toBuy().act('p0', { type: 'BUY' });
    expect(g.s.tiles[TILE.DOCKSIDE]!.owner).toBe('p0');
    expect(g.p('p0').cash).toBe(1440);
    expect(g.phase).toBe('POST_ROLL');
  });

  it('cannot buy without the cash, but may decline into an auction', () => {
    const g = toBuy().cash('p0', 50);
    expect(g.err('p0', { type: 'BUY' })).toBe('not_enough_cash');
    g.act('p0', { type: 'DECLINE' });
    expect(g.phase).toBe('AUCTION');
    expect(g.event('AuctionStarted').reason).toBe('declined');
  });

  it('runs an auction: opening bid, raises, passes, winner pays', () => {
    const g = toBuy().act('p0', { type: 'DECLINE' });
    expect(g.err('p1', { type: 'BID', amount: 9 })).toBe('bid_too_low');
    g.act('p1', { type: 'BID', amount: 10 });
    expect(g.err('p1', { type: 'BID', amount: 20 })).toBe('already_high_bidder');
    expect(g.err('p0', { type: 'BID', amount: 10 })).toBe('bid_too_low');
    g.act('p0', { type: 'BID', amount: 11 });
    g.act('p1', { type: 'AUCTION_PASS' });
    expect(g.phase).toBe('AUCTION');
    g.act('p2', { type: 'AUCTION_PASS' });
    expect(g.event('AuctionWon')).toMatchObject({ playerId: 'p0', amount: 11 });
    expect(g.s.tiles[TILE.DOCKSIDE]!.owner).toBe('p0');
    expect(g.p('p0').cash).toBe(1489);
    expect(g.phase).toBe('POST_ROLL');
  });

  it('rejects bids above your cash', () => {
    const g = toBuy().act('p0', { type: 'DECLINE' }).cash('p1', 30);
    expect(g.err('p1', { type: 'BID', amount: 31 })).toBe('not_enough_cash');
  });

  it('extends the clock after a late bid and closes on timeout', () => {
    const g = toBuy().act('p0', { type: 'DECLINE' });
    g.wait(7).act('p2', { type: 'BID', amount: 40 });
    expect(g.s.auction!.endsAt).toBe(g.now + 5000);
    g.wait(4);
    expect(g.err(null, { type: 'TICK' })).toBe('nothing_due');
    g.wait(1).tick();
    expect(g.event('AuctionWon')).toMatchObject({ playerId: 'p2', amount: 40 });
  });

  it('leaves the tile with the bank when nobody bids', () => {
    const g = toBuy().act('p0', { type: 'DECLINE' });
    g.act('p0', { type: 'AUCTION_PASS' }).act('p1', { type: 'AUCTION_PASS' }).act('p2', { type: 'AUCTION_PASS' });
    expect(g.has('AuctionUnsold')).toBe(true);
    expect(g.s.tiles[TILE.DOCKSIDE]!.owner).toBeNull();
  });

  it('skips the auction when auctions are off', () => {
    const g = new G(2, { auctions: false }).roll(1, 2).act('p0', { type: 'DECLINE' });
    expect(g.phase).toBe('POST_ROLL');
    expect(g.s.tiles[TILE.DOCKSIDE]!.owner).toBeNull();
  });

  it('lets the buyer mortgage to afford the purchase', () => {
    const g = toBuy().own('p0', TILE.MARINA).cash('p0', 10);
    g.act('p0', { type: 'MORTGAGE', tile: TILE.MARINA }).act('p0', { type: 'BUY' });
    expect(g.p('p0').cash).toBe(10 + 175 - 60);
  });
});

describe('building', () => {
  const sand = () => new G().own('p0', TILE.RUSTY, TILE.DOCKSIDE);

  it('needs the whole group and builds evenly', () => {
    const g = new G().own('p0', TILE.RUSTY);
    expect(g.err('p0', { type: 'BUILD', tile: TILE.RUSTY })).toBe('incomplete_group');
    const h = sand().act('p0', { type: 'BUILD', tile: TILE.RUSTY });
    expect(h.s.tiles[TILE.RUSTY]!.level).toBe(1);
    expect(h.p('p0').cash).toBe(1450);
    expect(h.s.bank.houses).toBe(31);
    expect(h.err('p0', { type: 'BUILD', tile: TILE.RUSTY })).toBe('uneven_build');
    h.act('p0', { type: 'BUILD', tile: TILE.DOCKSIDE }).act('p0', { type: 'BUILD', tile: TILE.RUSTY });
    expect(h.s.tiles[TILE.RUSTY]!.level).toBe(2);
  });

  it('allows uneven building when the house rule is off', () => {
    const g = new G(2, { evenBuild: false }).own('p0', TILE.RUSTY, TILE.DOCKSIDE);
    g.act('p0', { type: 'BUILD', tile: TILE.RUSTY }).act('p0', { type: 'BUILD', tile: TILE.RUSTY });
    expect(g.s.tiles[TILE.RUSTY]!.level).toBe(2);
  });

  it('turns four houses into a hotel and returns them to the bank', () => {
    const g = sand().houses(4, TILE.RUSTY, TILE.DOCKSIDE);
    expect(g.s.bank.houses).toBe(24);
    g.act('p0', { type: 'BUILD', tile: TILE.RUSTY });
    expect(g.s.tiles[TILE.RUSTY]!.level).toBe(5);
    expect(g.s.bank).toMatchObject({ houses: 28, hotels: 11 });
    expect(g.err('p0', { type: 'BUILD', tile: TILE.RUSTY })).toBe('max_level');
  });

  it('stops building when the bank runs out of houses', () => {
    const g = sand();
    g.s.settings = { ...g.s.settings, totalHouses: 1 };
    g.s.bank.houses = 1;
    g.act('p0', { type: 'BUILD', tile: TILE.RUSTY });
    expect(g.err('p0', { type: 'BUILD', tile: TILE.DOCKSIDE })).toBe('no_houses_left');
  });

  it('only builds on your own turn and never on a mortgaged group', () => {
    const g = sand();
    expect(g.err('p1', { type: 'BUILD', tile: TILE.RUSTY })).toBe('not_your_turn');
    g.s.tiles[TILE.DOCKSIDE]!.mortgaged = true;
    expect(g.err('p0', { type: 'BUILD', tile: TILE.RUSTY })).toBe('group_mortgaged');
  });

  it('sells evenly at half price', () => {
    const g = sand().houses(2, TILE.RUSTY).houses(1, TILE.DOCKSIDE);
    expect(g.err('p0', { type: 'SELL_BUILDING', tile: TILE.DOCKSIDE })).toBe('uneven_build');
    g.act('p0', { type: 'SELL_BUILDING', tile: TILE.RUSTY });
    expect(g.p('p0').cash).toBe(1525);
    expect(g.s.tiles[TILE.RUSTY]!.level).toBe(1);
  });

  it('needs four bank houses to break a hotel; selling the whole group always works', () => {
    const g = sand().houses(5, TILE.RUSTY, TILE.DOCKSIDE);
    g.s.settings = { ...g.s.settings, totalHouses: 3 };
    g.s.bank.houses = 3;
    expect(g.err('p0', { type: 'SELL_BUILDING', tile: TILE.RUSTY })).toBe('cannot_break_hotel');
    g.act('p0', { type: 'SELL_ALL_BUILDINGS', group: 'sand' });
    expect(g.s.tiles[TILE.RUSTY]!.level).toBe(0);
    expect(g.s.tiles[TILE.DOCKSIDE]!.level).toBe(0);
    expect(g.p('p0').cash).toBe(1500 + 2 * 5 * 25);
    expect(g.s.bank).toMatchObject({ houses: 3, hotels: 12 });
  });
});

describe('mortgages', () => {
  it('pays half the price and costs 110% (rounded up) to lift', () => {
    const g = new G().own('p0', TILE.POWER);
    g.act('p0', { type: 'MORTGAGE', tile: TILE.POWER });
    expect(g.p('p0').cash).toBe(1575);
    expect(g.err('p0', { type: 'MORTGAGE', tile: TILE.POWER })).toBe('already_mortgaged');
    g.act('p0', { type: 'UNMORTGAGE', tile: TILE.POWER });
    expect(g.p('p0').cash).toBe(1575 - 83);
  });

  it('requires selling the group buildings first', () => {
    const g = new G().own('p0', TILE.RUSTY, TILE.DOCKSIDE).houses(1, TILE.RUSTY);
    expect(g.err('p0', { type: 'MORTGAGE', tile: TILE.DOCKSIDE })).toBe('has_buildings');
  });

  it('can be switched off', () => {
    const g = new G(2, { mortgages: false }).own('p0', TILE.POWER);
    expect(g.err('p0', { type: 'MORTGAGE', tile: TILE.POWER })).toBe('mortgages_disabled');
  });

  it('only on your own turn unless you are raising funds', () => {
    const g = new G().own('p1', TILE.POWER);
    expect(g.err('p1', { type: 'MORTGAGE', tile: TILE.POWER })).toBe('wrong_phase');
  });
});

describe('jail', () => {
  const jailed = () => {
    const g = new G().at('p0', 27).roll(1, 2);
    expect(g.p('p0').inJail).toBe(true);
    expect(g.p('p0').position).toBe(TILE.JAIL);
    expect(g.current).toBe('p1');
    g.own('p1', TILE.RUSTY).at('p1', 39).roll(1, 1).roll(1, 2).act('p1', { type: 'END_TURN' });
    expect(g.current).toBe('p0');
    expect(g.phase).toBe('JAIL_DECISION');
    return g;
  };

  it('pays the fine and then rolls normally', () => {
    const g = jailed().act('p0', { type: 'JAIL_PAY' });
    expect(g.p('p0').cash).toBe(1450);
    expect(g.phase).toBe('AWAIT_ROLL');
    g.own('p0', TILE.SUNSET).roll(1, 3);
    expect(g.p('p0').position).toBe(TILE.SUNSET);
  });

  it('uses a Bail Pass, which goes back under its deck', () => {
    const g = jailed();
    const bail = g.s.decks.fortune.findIndex((c) => c === 8);
    g.s.decks.fortune.splice(bail, 1);
    g.p('p0').bailPasses = ['fortune'];
    g.act('p0', { type: 'JAIL_CARD' });
    expect(g.p('p0').bailPasses).toEqual([]);
    expect(g.s.decks.fortune.at(-1)).toBe(8);
    expect(g.phase).toBe('AWAIT_ROLL');
  });

  it('leaves on doubles without an extra roll', () => {
    const g = jailed().own('p0', TILE.SUNSET).dice([2, 2]).act('p0', { type: 'JAIL_ROLL' });
    expect(g.p('p0').inJail).toBe(false);
    expect(g.p('p0').position).toBe(TILE.SUNSET);
    expect(g.phase).toBe('POST_ROLL');
  });

  it('ends the turn on a miss, and pays and moves on the third miss', () => {
    const g = jailed().dice([1, 2]).act('p0', { type: 'JAIL_ROLL' });
    expect(g.current).toBe('p1');
    g.p('p0').jailTurns = 2;
    g.s.turn.playerId = 'p0';
    g.s.turn.phase = 'JAIL_DECISION';
    g.dice([1, 2]).act('p0', { type: 'JAIL_ROLL' });
    expect(g.p('p0').inJail).toBe(false);
    expect(g.p('p0').cash).toBe(1450);
    expect(g.p('p0').position).toBe(TILE.ORCHID);
    expect(g.phase).toBe('BUY_DECISION');
  });

  it('still collects rent while in jail', () => {
    const h = new G().own('p1', TILE.DOCKSIDE);
    h.p('p1').inJail = true;
    h.roll(1, 2);
    expect(h.p('p1').cash).toBe(1504);
  });

  it('sends you to jail from Busted! even on doubles', () => {
    const g = new G().at('p0', 26).roll(2, 2);
    expect(g.p('p0').inJail).toBe(true);
    expect(g.current).toBe('p1');
  });
});
