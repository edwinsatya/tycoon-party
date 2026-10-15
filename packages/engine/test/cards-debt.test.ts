import { describe, expect, it } from 'vitest';
import { G, TILE } from './harness';

/** Land p0 on a card tile with a chosen card on top. */
const draw = (g: G, tile: number, deck: 'fortune' | 'community', key: string, extraDice: [number, number][] = []) =>
  g.at('p0', tile - 3).card(deck, key).dice([1, 2], ...extraDice).act('p0', { type: 'ROLL' });

describe('cards', () => {
  it('Back to Base: advance to START and collect', () => {
    const g = draw(new G(), TILE.FORTUNE1, 'fortune', 'card.f.back_to_base');
    expect(g.p('p0').position).toBe(0);
    expect(g.p('p0').cash).toBe(1700);
    expect(g.phase).toBe('POST_ROLL');
  });

  it('collects the salary when an advance card passes START', () => {
    const g = draw(new G(), TILE.FORTUNE3, 'fortune', 'card.f.dinner_reservation');
    expect(g.p('p0').position).toBe(24);
    expect(g.p('p0').cash).toBe(1700);
    expect(g.phase).toBe('BUY_DECISION');
  });

  it('Catch the Next Ride: double rent at the nearest hub', () => {
    const g = draw(new G().own('p1', TILE.FERRY), TILE.FORTUNE1, 'fortune', 'card.f.next_ride');
    expect(g.p('p0').position).toBe(TILE.FERRY);
    expect(g.event('RentPaid')).toMatchObject({ amount: 50, calc: { kind: 'transit', cardDouble: true } });
  });

  it('Catch the Next Ride wraps past START to Central Station', () => {
    const g = draw(new G(), TILE.FORTUNE3, 'fortune', 'card.f.next_ride');
    expect(g.p('p0').position).toBe(TILE.CENTRAL);
    expect(g.p('p0').cash).toBe(1700);
    expect(g.phase).toBe('BUY_DECISION');
  });

  it('Service Call: roll and pay 10x at the nearest utility, whatever the owner holds', () => {
    const g = draw(new G().own('p1', TILE.WATER), TILE.FORTUNE2, 'fortune', 'card.f.service_call', [[3, 4]]);
    expect(g.p('p0').position).toBe(TILE.WATER);
    expect(g.event('RentPaid')).toMatchObject({ amount: 70, calc: { kind: 'utility', multiplier: 10, dice: 7 } });
  });

  it('Wrong Turn: back 3 tiles, resolving the new tile', () => {
    const g = draw(new G(), TILE.FORTUNE1, 'fortune', 'card.f.wrong_turn');
    expect(g.p('p0').position).toBe(TILE.INCOME_TAX);
    expect(g.p('p0').cash).toBe(1300);
    const h = new G().card('community', 'card.c.tax_refund');
    draw(h, TILE.FORTUNE3, 'fortune', 'card.f.wrong_turn');
    expect(h.p('p0').position).toBe(TILE.CF3);
    expect(h.p('p0').cash).toBe(1520);
  });

  it('repairs charge per house and per hotel', () => {
    const g = new G().own('p0', TILE.RUSTY, TILE.DOCKSIDE).houses(5, TILE.RUSTY).houses(4, TILE.DOCKSIDE);
    draw(g, TILE.FORTUNE1, 'fortune', 'card.f.renovation_season');
    expect(g.p('p0').cash).toBe(1500 - (4 * 25 + 100));
  });

  it('pay every player: in seat order, raising funds when short', () => {
    const g = new G(3).cash('p0', 60);
    draw(g, TILE.FORTUNE1, 'fortune', 'card.f.club_president');
    expect(g.p('p1').cash).toBe(1550);
    expect(g.phase).toBe('RAISE_FUNDS');
    expect(g.s.debts[0]).toMatchObject({ debtorId: 'p0', creditorId: 'p2', amount: 50 });
    g.act('p0', { type: 'BANKRUPT' });
    expect(g.p('p0').status).toBe('bankrupt');
    expect(g.p('p2').cash).toBe(1510);
    expect(g.current).toBe('p1');
  });

  it("It's Your Birthday: other players pay, raising funds out of turn", () => {
    const g = new G(3).cash('p2', 5).own('p2', TILE.MARINA);
    draw(g, 17, 'community', 'card.c.birthday');
    expect(g.phase).toBe('RAISE_FUNDS');
    expect(g.s.debts[0]!.debtorId).toBe('p2');
    expect(g.err('p0', { type: 'END_TURN' })).toBe('wrong_phase');
    g.act('p2', { type: 'MORTGAGE', tile: TILE.MARINA });
    expect(g.p('p0').cash).toBe(1520);
    expect(g.p('p2').cash).toBe(5 + 175 - 10);
    expect(g.phase).toBe('POST_ROLL');
  });

  it('keeps a Bail Pass out of the deck until it is used', () => {
    const g = draw(new G(), TILE.CF1, 'community', 'card.bail_pass');
    expect(g.p('p0').bailPasses).toEqual(['community']);
    expect(g.s.decks.community).toHaveLength(15);
  });

  it('sends you to jail without the salary', () => {
    const g = draw(new G(), TILE.FORTUNE1, 'fortune', 'card.f.caught_red_handed');
    expect(g.p('p0').inJail).toBe(true);
    expect(g.p('p0').cash).toBe(1500);
    expect(g.current).toBe('p1');
  });
});

describe('debt and bankruptcy', () => {
  const hotelOnDockside = (g: G) => g.own('p1', TILE.RUSTY, TILE.DOCKSIDE).houses(5, TILE.RUSTY, TILE.DOCKSIDE);

  it('enters Raise Funds when short and settles as soon as the cash is there', () => {
    const g = hotelOnDockside(new G()).cash('p0', 100).own('p0', TILE.MARINA, TILE.DIAMOND).roll(1, 2);
    expect(g.phase).toBe('RAISE_FUNDS');
    expect(g.event('DebtStarted').amount).toBe(450);
    expect(g.err('p0', { type: 'BANKRUPT' })).toBe('can_still_pay');
    g.act('p0', { type: 'MORTGAGE', tile: TILE.DIAMOND });
    expect(g.phase).toBe('RAISE_FUNDS');
    g.act('p0', { type: 'MORTGAGE', tile: TILE.MARINA });
    expect(g.phase).toBe('POST_ROLL');
    expect(g.p('p0').cash).toBe(100 + 200 + 175 - 450);
    expect(g.p('p1').cash).toBe(1950);
  });

  it('bankrupt to a player: creditor takes cash, tiles (paying the 10% fee) and passes', () => {
    const g = hotelOnDockside(new G(3)).cash('p0', 10).own('p0', TILE.MARINA);
    g.s.tiles[TILE.MARINA]!.mortgaged = true;
    g.s.decks.fortune = g.s.decks.fortune.filter((c) => c !== 8);
    g.p('p0').bailPasses = ['fortune'];
    g.roll(1, 2).act('p0', { type: 'BANKRUPT' });
    expect(g.p('p0')).toMatchObject({ status: 'bankrupt', cash: 0, bailPasses: [], bankruptOrder: 1 });
    expect(g.s.tiles[TILE.MARINA]).toMatchObject({ owner: 'p1', mortgaged: true });
    expect(g.p('p1').cash).toBe(1500 + 10 - 18);
    expect(g.p('p1').bailPasses).toEqual(['fortune']);
    expect(g.current).toBe('p1');
  });

  it('bankrupt to the bank: tiles return unmortgaged and are auctioned', () => {
    const g = new G(3).cash('p0', 10).own('p0', TILE.MARINA, TILE.DIAMOND);
    g.s.tiles[TILE.DIAMOND]!.mortgaged = true;
    g.at('p0', 1).roll(1, 2);
    expect(g.phase).toBe('RAISE_FUNDS');
    g.act('p0', { type: 'BANKRUPT' });
    expect(g.phase).toBe('AUCTION');
    expect(g.s.auction).toMatchObject({ tile: TILE.MARINA, reason: 'bankruptcy' });
    expect(g.s.auctionQueue).toEqual([TILE.DIAMOND]);
    g.act('p1', { type: 'BID', amount: 100 }).act('p2', { type: 'AUCTION_PASS' });
    expect(g.s.auction).toMatchObject({ tile: TILE.DIAMOND });
    g.act('p1', { type: 'AUCTION_PASS' }).act('p2', { type: 'AUCTION_PASS' });
    expect(g.s.tiles[TILE.DIAMOND]).toMatchObject({ owner: null, mortgaged: false });
    expect(g.current).toBe('p1');
    expect(g.phase).toBe('AWAIT_ROLL');
  });

  it('ends the match when one player is left', () => {
    const g = hotelOnDockside(new G()).cash('p0', 10).roll(1, 2).act('p0', { type: 'BANKRUPT' });
    expect(g.phase).toBe('GAME_OVER');
    expect(g.s.winnerIds).toEqual(['p1']);
    expect(g.event('GameOver').reason).toBe('lastStanding');
    expect(g.err('p1', { type: 'ROLL' })).toBe('game_over');
  });

  it('Raise Funds timeout mortgages the least useful tiles first and keeps buildings', () => {
    const g = new G().cash('p0', 0).own('p0', TILE.RUSTY, TILE.DOCKSIDE, TILE.MARINA).houses(1, TILE.RUSTY, TILE.DOCKSIDE);
    g.at('p0', 35).roll(1, 2);
    expect(g.phase).toBe('RAISE_FUNDS');
    g.timeout();
    expect(g.s.tiles[TILE.MARINA]!.mortgaged).toBe(true);
    expect(g.s.tiles[TILE.RUSTY]!.level).toBe(1);
    expect(g.p('p0').cash).toBe(75);
    expect(g.p('p0').timeouts).toBe(1);
  });

  it('Raise Funds timeout goes bankrupt when assets fall short', () => {
    const g = new G(3).cash('p0', 0).at('p0', 35).roll(1, 2);
    g.timeout();
    expect(g.p('p0').status).toBe('bankrupt');
    expect(g.current).toBe('p1');
  });
});
