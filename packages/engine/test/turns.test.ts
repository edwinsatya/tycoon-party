import { describe, expect, it } from 'vitest';
import { createGame, makeSettings, toPublicState } from '../src';
import { G, T0, TILE } from './harness';

describe('setup', () => {
  it('starts every player with the starting cash at START', () => {
    const g = new G(4);
    expect(g.s.players.map((p) => p.cash)).toEqual([1500, 1500, 1500, 1500]);
    expect(g.s.players.every((p) => p.position === 0)).toBe(true);
    expect(g.s.bank).toEqual({ houses: 32, hotels: 12, jackpot: 0 });
    expect(g.s.decks.fortune).toHaveLength(16);
    expect(g.s.decks.community).toHaveLength(16);
    expect(g.phase).toBe('AWAIT_ROLL');
    expect(g.current).toBe('p0');
  });

  it('is deterministic for a seed and shuffles seats', () => {
    const make = (seed: string) =>
      createGame({
        players: ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => ({ id, name: id, token: 'rocket', color: '#fff', isBot: false })),
        settings: makeSettings('classic'),
        seed,
        now: T0,
      }).state;
    expect(make('x')).toEqual(make('x'));
    const orders = new Set(['s1', 's2', 's3', 's4', 's5'].map((seed) => make(seed).players.map((p) => p.id).join()));
    expect(orders.size).toBeGreaterThan(1);
  });

  it('rejects too few or too many players', () => {
    const players = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: 'x', token: 'rocket', color: '#fff', isBot: false }));
    const settings = makeSettings('classic');
    expect(() => createGame({ players: players(1), settings, seed: 's', now: T0 })).toThrow();
    expect(() => createGame({ players: players(7), settings, seed: 's', now: T0 })).toThrow();
  });

  it('deals two free properties per player in Blitz without completing a group', () => {
    const g = new G(6, {}, 'blitz');
    for (const p of g.s.players) {
      const owned = g.s.tiles.flatMap((t, i) => (t.owner === p.id ? [i] : []));
      expect(owned).toHaveLength(2);
    }
    expect(g.s.settings.housesForHotel).toBe(3);
  });

  it('hides the RNG, dice order and card order from the public view', () => {
    const g = new G(2);
    const view = toPublicState(g.s) as unknown as Record<string, unknown>;
    expect(view.rng).toBeUndefined();
    expect(view.diceDeck).toBeUndefined();
    expect(view.decks).toBeUndefined();
    expect(view.deckSizes).toEqual({ fortune: 16, community: 16 });
  });
});

describe('rolling and moving', () => {
  it('moves by the dice total and offers an unowned property', () => {
    const g = new G().roll(1, 2);
    expect(g.p('p0').position).toBe(TILE.DOCKSIDE);
    expect(g.phase).toBe('BUY_DECISION');
    expect(g.s.turn.pendingBuy).toBe(TILE.DOCKSIDE);
  });

  it('rejects rolling out of turn and rolling twice', () => {
    const g = new G();
    expect(g.err('p1', { type: 'ROLL' })).toBe('not_your_turn');
    g.own('p0', TILE.DOCKSIDE).roll(1, 2);
    expect(g.phase).toBe('POST_ROLL');
    expect(g.err('p0', { type: 'ROLL' })).toBe('wrong_phase');
  });

  it('pays the salary when passing START', () => {
    const g = new G().at('p0', 35).roll(2, 4);
    expect(g.p('p0').position).toBe(TILE.RUSTY);
    expect(g.p('p0').cash).toBe(1700);
    expect(g.event('PassedStart').amount).toBe(200);
  });

  it('pays double for landing exactly on START when the house rule is on', () => {
    const g = new G(2, { doubleSalaryOnStart: true }).at('p0', 34).roll(2, 4);
    expect(g.p('p0').position).toBe(0);
    expect(g.p('p0').cash).toBe(1900);
  });

  it('gives an extra roll on doubles and jails on the third double', () => {
    const g = new G().own('p0', TILE.POWER, TILE.MARKET).at('p0', 10);
    g.roll(1, 1);
    expect(g.phase).toBe('AWAIT_ROLL');
    expect(g.current).toBe('p0');
    g.roll(2, 2);
    expect(g.p('p0').position).toBe(TILE.MARKET);
    g.roll(3, 3);
    expect(g.p('p0').position).toBe(TILE.JAIL);
    expect(g.p('p0').inJail).toBe(true);
    expect(g.event('WentToJail').reason).toBe('doubles');
    expect(g.current).toBe('p1');
  });

  it('passes the turn in seat order and counts rounds', () => {
    const g = new G(3).own('p0', TILE.DOCKSIDE).own('p1', TILE.DOCKSIDE);
    g.roll(1, 2).act('p0', { type: 'END_TURN' });
    expect(g.current).toBe('p1');
    g.s.tiles[TILE.DOCKSIDE]!.owner = 'p1';
    g.roll(1, 2).act('p1', { type: 'END_TURN' });
    expect(g.current).toBe('p2');
    g.s.tiles[TILE.DOCKSIDE]!.owner = 'p2';
    g.roll(1, 2).act('p2', { type: 'END_TURN' });
    expect(g.current).toBe('p0');
    expect(g.s.round).toBe(2);
  });
});

describe('rent', () => {
  const land = (g: G, tile: number) => g.at('p0', tile - 3).roll(1, 2);

  it('charges base rent, doubled for a full colour group', () => {
    const g = new G().own('p1', TILE.DOCKSIDE);
    land(g, TILE.DOCKSIDE);
    expect(g.event('RentPaid').amount).toBe(4);
    const h = new G().own('p1', TILE.RUSTY, TILE.DOCKSIDE);
    land(h, TILE.DOCKSIDE);
    expect(h.event('RentPaid')).toMatchObject({ amount: 8, calc: { kind: 'set' } });
  });

  it('keeps the set bonus when another tile in the group is mortgaged', () => {
    const g = new G().own('p1', TILE.RUSTY, TILE.DOCKSIDE);
    g.s.tiles[TILE.RUSTY]!.mortgaged = true;
    land(g, TILE.DOCKSIDE);
    expect(g.event('RentPaid').amount).toBe(8);
  });

  it('charges house and hotel rent', () => {
    const g = new G().own('p1', TILE.RUSTY, TILE.DOCKSIDE).houses(2, TILE.RUSTY, TILE.DOCKSIDE);
    land(g, TILE.DOCKSIDE);
    expect(g.event('RentPaid').amount).toBe(60);
    const h = new G().own('p1', TILE.RUSTY, TILE.DOCKSIDE).houses(5, TILE.RUSTY, TILE.DOCKSIDE);
    land(h, TILE.DOCKSIDE);
    expect(h.event('RentPaid')).toMatchObject({ amount: 450, calc: { kind: 'hotel' } });
  });

  it('charges transit rent by hubs owned', () => {
    for (const [hubs, rent] of [[[5], 25], [[5, 15], 50], [[5, 15, 25], 100], [[5, 15, 25, 35], 200]] as const) {
      const g = new G().own('p1', ...hubs);
      land(g, TILE.CENTRAL);
      expect(g.event('RentPaid').amount).toBe(rent);
    }
  });

  it('charges utilities 4x or 10x the dice', () => {
    const g = new G().own('p1', TILE.POWER);
    land(g, TILE.POWER);
    expect(g.event('RentPaid').amount).toBe(12);
    const h = new G().own('p1', TILE.POWER, TILE.WATER);
    land(h, TILE.POWER);
    expect(h.event('RentPaid').amount).toBe(30);
  });

  it('charges nothing on a mortgaged tile', () => {
    const g = new G().own('p1', TILE.DOCKSIDE);
    g.s.tiles[TILE.DOCKSIDE]!.mortgaged = true;
    land(g, TILE.DOCKSIDE);
    expect(g.has('RentPaid')).toBe(false);
    expect(g.p('p0').cash).toBe(1500);
  });

  it('lets jailed owners collect unless the house rule turns it off', () => {
    const on = new G().own('p1', TILE.DOCKSIDE);
    on.p('p1').inJail = true;
    land(on, TILE.DOCKSIDE);
    expect(on.has('RentPaid')).toBe(true);
    const off = new G(2, { rentInJail: false }).own('p1', TILE.DOCKSIDE);
    off.p('p1').inJail = true;
    land(off, TILE.DOCKSIDE);
    expect(off.has('RentPaid')).toBe(false);
  });

  it('charges no rent on your own tile', () => {
    const g = new G().own('p0', TILE.DOCKSIDE);
    land(g, TILE.DOCKSIDE);
    expect(g.p('p0').cash).toBe(1500);
    expect(g.phase).toBe('POST_ROLL');
  });
});

describe('taxes and the Rest Stop jackpot', () => {
  it('pays taxes to the bank', () => {
    const g = new G().at('p0', 1).roll(1, 2);
    expect(g.p('p0').cash).toBe(1300);
  });

  it('collects taxes into the jackpot and pays it out at the Rest Stop', () => {
    const g = new G(2, { jackpot: true }).at('p0', 1).roll(1, 2);
    expect(g.s.bank.jackpot).toBe(200);
    g.act('p0', { type: 'END_TURN' }).at('p1', 17).roll(1, 2);
    expect(g.p('p1').cash).toBe(1700);
    expect(g.s.bank.jackpot).toBe(0);
  });
});
