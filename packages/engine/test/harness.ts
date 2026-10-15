import { expect } from 'vitest';
import { metroCity, type DeckId } from '@rollionaire/boards';
import {
  type ErrorCode,
  type GameState,
  type Intent,
  type ModeId,
  type SeqEvent,
  type Settings,
  applyIntent,
  checkInvariants,
  createGame,
  makeSettings,
} from '../src';

export const T0 = Date.UTC(2026, 9, 14, 12, 0, 0);

type NoBy<T> = T extends { by: string } ? Omit<T, 'by'> : T;
type PlayerIntent = NoBy<Exclude<Intent, { type: 'TICK' }>>;

/** Test driver: fixed seats (p0 first), forced dice, invariants checked after every intent. */
export class G {
  s: GameState;
  now = T0;
  events: SeqEvent[] = [];

  constructor(players = 2, overrides: Partial<Settings> = {}, mode: ModeId = 'classic') {
    const ids = Array.from({ length: players }, (_, i) => `p${i}`);
    const { state } = createGame({
      players: ids.map((id) => ({ id, name: id.toUpperCase(), token: 'rocket', color: '#fff', isBot: false })),
      settings: makeSettings(mode, overrides),
      seed: 'test-seed',
      now: this.now,
      shuffleSeats: false,
    });
    this.s = state;
  }

  p(id: string) {
    return this.s.players.find((p) => p.id === id)!;
  }

  get phase() {
    return this.s.turn.phase;
  }

  get current() {
    return this.s.turn.playerId;
  }

  /** Queue exact dice for the next rolls (uses the balanced-dice deck under the hood). */
  dice(...rolls: [number, number][]): this {
    this.s.settings = { ...this.s.settings, balancedDice: true };
    this.s.diceDeck = rolls.map(([a, b]) => (a - 1) * 6 + (b - 1));
    return this;
  }

  /** Put a card on top of a deck by its key. */
  card(deck: DeckId, key: string): this {
    const idx = metroCity.decks[deck].findIndex((c) => c.key === key);
    if (idx < 0) throw new Error(`no card ${key}`);
    this.s.decks[deck] = [idx, ...this.s.decks[deck].filter((c) => c !== idx)];
    return this;
  }

  own(pid: string, ...tiles: number[]): this {
    for (const t of tiles) this.s.tiles[t]!.owner = pid;
    return this;
  }

  at(pid: string, position: number): this {
    this.p(pid).position = position;
    return this;
  }

  cash(pid: string, amount: number): this {
    this.p(pid).cash = amount;
    return this;
  }

  /** Put houses on tiles directly (keeps the bank count consistent). */
  houses(level: number, ...tiles: number[]): this {
    const hotel = this.s.settings.housesForHotel + 1;
    for (const t of tiles) {
      const ts = this.s.tiles[t]!;
      const was = ts.level;
      if (was === hotel) this.s.bank.hotels++;
      else this.s.bank.houses += was;
      if (level === hotel) this.s.bank.hotels--;
      else this.s.bank.houses -= level;
      ts.level = level;
    }
    return this;
  }

  act(by: string, intent: PlayerIntent): this {
    return this.apply({ ...intent, by } as Intent);
  }

  tick(): this {
    return this.apply({ type: 'TICK' });
  }

  apply(intent: Intent): this {
    const r = applyIntent(this.s, intent, { now: this.now });
    if (!r.ok) throw new Error(`${intent.type} rejected: ${r.error}`);
    this.s = r.state;
    this.events = r.events;
    expect(checkInvariants(this.s)).toEqual([]);
    return this;
  }

  /** Expects a rejection and checks that nothing changed. */
  err(by: string | null, intent: PlayerIntent | { type: 'TICK' }): ErrorCode {
    const before = JSON.stringify(this.s);
    const full = (by ? { ...intent, by } : intent) as Intent;
    const r = applyIntent(this.s, full, { now: this.now });
    expect(r.ok).toBe(false);
    expect(JSON.stringify(this.s)).toBe(before);
    return (r as { error: ErrorCode }).error;
  }

  roll(a: number, b: number): this {
    return this.dice([a, b]).act(this.current, { type: 'ROLL' });
  }

  wait(seconds: number): this {
    this.now += seconds * 1000;
    return this;
  }

  /** Jump to the current deadline and fire the timeout. */
  timeout(): this {
    this.now = Math.max(this.now, this.s.turn.deadline);
    return this.tick();
  }

  has(t: SeqEvent['t']): boolean {
    return this.events.some((e) => e.t === t);
  }

  event<T extends SeqEvent['t']>(t: T): Extract<SeqEvent, { t: T }> {
    const ev = this.events.find((e) => e.t === t);
    if (!ev) throw new Error(`no ${t} event in ${this.events.map((e) => e.t).join(', ')}`);
    return ev as Extract<SeqEvent, { t: T }>;
  }
}

// Tile indices on Metro City used across tests.
export const TILE = {
  START: 0,
  RUSTY: 1,
  CF1: 2,
  DOCKSIDE: 3,
  INCOME_TAX: 4,
  CENTRAL: 5,
  MAPLE: 6,
  FORTUNE1: 7,
  BAMBOO: 8,
  LANTERN: 9,
  JAIL: 10,
  GARDEN: 11,
  POWER: 12,
  ORCHID: 13,
  SUNSET: 14,
  FERRY: 15,
  MARKET: 16,
  REST: 20,
  NEON: 21,
  FORTUNE2: 22,
  AIRPORT: 25,
  WATER: 28,
  BUSTED: 30,
  CF3: 33,
  BUS: 35,
  FORTUNE3: 36,
  MARINA: 37,
  LUXURY_TAX: 38,
  DIAMOND: 39,
} as const;
