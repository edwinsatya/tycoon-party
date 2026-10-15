export type ModeId = 'classic' | 'blitz';

export interface Timers {
  /** Seconds to roll (the room "turn timer"). */
  roll: number;
  buy: number;
  auctionStart: number;
  /** After every bid the clock is extended to at least this many seconds. */
  auctionBump: number;
  jail: number;
  raiseFunds: number;
  trade: number;
  /** Auto-end the turn this long after the last action. */
  endTurn: number;
}

export interface Settings {
  mode: ModeId;
  boardId: 'metro-city';
  startingCash: number;
  salary: number;
  doubleSalaryOnStart: boolean;
  jackpot: boolean;
  auctions: boolean;
  rentInJail: boolean;
  evenBuild: boolean;
  mortgages: boolean;
  /** Minutes; 0 = off. Checked at turn boundaries. */
  timeLimitMin: number;
  /** Rounds; 0 = off. */
  roundLimit: number;
  balancedDice: boolean;
  catchUp: boolean;
  /** Houses needed before a hotel (Classic 4, Blitz 3). */
  housesForHotel: number;
  totalHouses: number;
  totalHotels: number;
  /** Free random properties dealt to each player at the start (Blitz 2). */
  freeProperties: number;
  /** End the match once this many players have gone bankrupt; 0 = off (Blitz 2). */
  endAfterBankruptcies: number;
  auctionMinBid: number;
  maxPendingTrades: number;
  /** Consecutive timeouts before a player is marked Away. */
  awayAfterTimeouts: number;
  timers: Timers;
}

export const DEFAULT_TIMERS: Timers = {
  roll: 30,
  buy: 20,
  auctionStart: 8,
  auctionBump: 5,
  jail: 20,
  raiseFunds: 90,
  trade: 30,
  endTurn: 15,
};

export const CLASSIC: Settings = {
  mode: 'classic',
  boardId: 'metro-city',
  startingCash: 1500,
  salary: 200,
  doubleSalaryOnStart: false,
  jackpot: false,
  auctions: true,
  rentInJail: true,
  evenBuild: true,
  mortgages: true,
  timeLimitMin: 0,
  roundLimit: 0,
  balancedDice: false,
  catchUp: false,
  housesForHotel: 4,
  totalHouses: 32,
  totalHotels: 12,
  freeProperties: 0,
  endAfterBankruptcies: 0,
  auctionMinBid: 10,
  maxPendingTrades: 3,
  awayAfterTimeouts: 2,
  timers: DEFAULT_TIMERS,
};

export const BLITZ: Settings = {
  ...CLASSIC,
  mode: 'blitz',
  housesForHotel: 3,
  freeProperties: 2,
  endAfterBankruptcies: 2,
  timeLimitMin: 25,
  timers: { ...DEFAULT_TIMERS, roll: 20 },
};

export const PRESETS: Record<ModeId, Settings> = { classic: CLASSIC, blitz: BLITZ };

/** Relaxed timers for family tables: every timer x3, capped at 90 s (PRD 7.5, 11.4). */
export function relaxTimers(t: Timers): Timers {
  const r = (n: number) => Math.min(90, n * 3);
  return {
    roll: r(t.roll),
    buy: r(t.buy),
    auctionStart: t.auctionStart + 4,
    auctionBump: t.auctionBump + 3,
    jail: r(t.jail),
    raiseFunds: Math.max(90, t.raiseFunds),
    trade: r(t.trade),
    endTurn: r(t.endTurn),
  };
}

export function makeSettings(mode: ModeId = 'classic', overrides: Partial<Settings> = {}): Settings {
  const base = PRESETS[mode];
  return { ...base, ...overrides, timers: { ...base.timers, ...overrides.timers } };
}
