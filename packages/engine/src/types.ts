import type { DeckId, GroupId } from '@rollionaire/boards';
import type { RngState } from './rng';
import type { Settings } from './settings';

export type PlayerId = string;

export type Phase =
  | 'AWAIT_ROLL'
  | 'JAIL_DECISION'
  | 'BUY_DECISION'
  | 'AUCTION'
  | 'RAISE_FUNDS'
  | 'POST_ROLL'
  | 'GAME_OVER';

export interface PlayerStats {
  rentPaid: number;
  rentReceived: number;
  jailVisits: number;
  doubles: number;
  tradesDone: number;
  auctionsWon: number;
  auctionSpend: number;
  buildingsBuilt: number;
  /** Lowest net worth seen, for the Comeback Kid award. */
  lowestNetWorth: number;
  timeouts: number;
}

export interface PlayerState {
  id: PlayerId;
  name: string;
  token: string;
  color: string;
  isBot: boolean;
  seat: number;
  cash: number;
  position: number;
  inJail: boolean;
  /** Failed doubles attempts during the current stay. */
  jailTurns: number;
  /** Deck each held Bail Pass came from, so it returns to the right deck. */
  bailPasses: DeckId[];
  status: 'active' | 'bankrupt';
  /** Set after consecutive timeouts; cleared by any action of the player. */
  away: boolean;
  timeouts: number;
  /** 1 for the first player to go bankrupt, 2 for the second... */
  bankruptOrder: number | null;
  stats: PlayerStats;
}

export interface TileState {
  owner: PlayerId | null;
  /** 0 = bare, 1..housesForHotel = houses, housesForHotel + 1 = hotel. */
  level: number;
  mortgaged: boolean;
}

export type RentCalc =
  | { kind: 'base' }
  | { kind: 'set' }
  | { kind: 'houses'; houses: number }
  | { kind: 'hotel' }
  | { kind: 'transit'; owned: number; cardDouble: boolean }
  | { kind: 'utility'; owned: number; dice: number; multiplier: number };

export type DebtReason =
  | 'rent'
  | 'tax'
  | 'card'
  | 'repairs'
  | 'jailFine'
  | 'payEach'
  | 'collectEach'
  | 'mortgageFee';

export interface Debt {
  debtorId: PlayerId;
  /** null = the bank (or the Rest Stop jackpot when that rule is on). */
  creditorId: PlayerId | null;
  amount: number;
  reason: DebtReason;
  tile?: number;
  calc?: RentCalc;
  /** True once the debtor has been put into Raise Funds for this debt. */
  raising?: boolean;
}

export interface AuctionState {
  tile: number;
  highBid: number;
  highBidderId: PlayerId | null;
  endsAt: number;
  passed: PlayerId[];
  reason: 'declined' | 'bankruptcy';
}

export interface Bundle {
  cash: number;
  tiles: number[];
  /** Number of Bail Passes. */
  passes: number;
}

export interface Trade {
  id: string;
  fromId: PlayerId;
  toId: PlayerId;
  /** What the proposer gives. */
  give: Bundle;
  /** What the proposer gets. */
  get: Bundle;
  /** Mortgaged tiles in `get` the proposer lifts at once instead of paying the 10% fee. */
  liftByProposer: number[];
  createdAt: number;
  expiresAt: number;
  counterOf: string | null;
}

export interface TurnState {
  playerId: PlayerId;
  phase: Phase;
  phaseStartedAt: number;
  deadline: number;
  doubles: number;
  extraRoll: boolean;
  hasRolled: boolean;
  lastRoll: [number, number] | null;
  /** Unowned tile the player may buy (BUY_DECISION). */
  pendingBuy: number | null;
  /** Move to perform once debts are settled (third failed jail roll). */
  pendingMove: number | null;
  /** The turn ends as soon as everything pending resolves (sent to jail). */
  endTurn: boolean;
}

export type EndReason = 'lastStanding' | 'timeLimit' | 'roundLimit' | 'bankruptcyLimit';

export interface GameState {
  v: 1;
  settings: Settings;
  rng: RngState;
  /** Remaining outcomes for balanced dice, encoded (d1 - 1) * 6 + (d2 - 1). */
  diceDeck: number[];
  players: PlayerState[];
  tiles: TileState[];
  bank: { houses: number; hotels: number; jackpot: number };
  /** Card order (indices into the board's deck definitions); front = next card. */
  decks: Record<DeckId, number[]>;
  turn: TurnState;
  debts: Debt[];
  auction: AuctionState | null;
  auctionQueue: number[];
  trades: Trade[];
  nextTradeId: number;
  round: number;
  turnCount: number;
  startedAt: number;
  endedAt: number | null;
  winnerIds: PlayerId[];
  endReason: EndReason | null;
  bankruptCount: number;
  seq: number;
  /** Recent events for the game log and reconnect resync. */
  log: SeqEvent[];
}

// ---------------------------------------------------------------------------
// Intents: the only way to change a game. `by` is set by the server from the
// authenticated connection, never trusted from the client payload.

export type Intent =
  | { type: 'ROLL'; by: PlayerId }
  | { type: 'BUY'; by: PlayerId }
  | { type: 'DECLINE'; by: PlayerId }
  | { type: 'BID'; by: PlayerId; amount: number }
  | { type: 'AUCTION_PASS'; by: PlayerId }
  | { type: 'BUILD'; by: PlayerId; tile: number }
  | { type: 'SELL_BUILDING'; by: PlayerId; tile: number }
  | { type: 'SELL_ALL_BUILDINGS'; by: PlayerId; group: GroupId }
  | { type: 'MORTGAGE'; by: PlayerId; tile: number }
  | { type: 'UNMORTGAGE'; by: PlayerId; tile: number }
  | { type: 'JAIL_PAY'; by: PlayerId }
  | { type: 'JAIL_CARD'; by: PlayerId }
  | { type: 'JAIL_ROLL'; by: PlayerId }
  | {
      type: 'TRADE_PROPOSE';
      by: PlayerId;
      to: PlayerId;
      give: Bundle;
      get: Bundle;
      lift?: number[];
      counterOf?: string;
    }
  | { type: 'TRADE_RESPOND'; by: PlayerId; tradeId: string; accept: boolean; lift?: number[] }
  | { type: 'TRADE_CANCEL'; by: PlayerId; tradeId: string }
  | { type: 'END_TURN'; by: PlayerId }
  | { type: 'BANKRUPT'; by: PlayerId }
  /** System intent: apply every timeout whose deadline has passed. */
  | { type: 'TICK' };

export type IntentType = Intent['type'];

export interface Ctx {
  /** Server clock, epoch ms. */
  now: number;
}

// ---------------------------------------------------------------------------
// Events: drive animations, the log and the screen-reader narration.

export type GameEvent =
  | { t: 'GameStarted'; seats: PlayerId[] }
  | { t: 'FreePropertyDealt'; playerId: PlayerId; tile: number }
  | { t: 'TurnStarted'; playerId: PlayerId; round: number }
  | { t: 'DiceRolled'; playerId: PlayerId; dice: [number, number]; purpose: 'move' | 'jail' | 'utility' }
  | { t: 'TokenMoved'; playerId: PlayerId; from: number; to: number; steps: number; direct: boolean }
  | { t: 'PassedStart'; playerId: PlayerId; amount: number; exact: boolean }
  | { t: 'PropertyBought'; playerId: PlayerId; tile: number; price: number }
  | { t: 'BuyDeclined'; playerId: PlayerId; tile: number }
  | { t: 'AuctionStarted'; tile: number; endsAt: number; reason: AuctionState['reason'] }
  | { t: 'BidPlaced'; playerId: PlayerId; tile: number; amount: number; endsAt: number }
  | { t: 'AuctionPassed'; playerId: PlayerId; tile: number }
  | { t: 'AuctionWon'; playerId: PlayerId; tile: number; amount: number }
  | { t: 'AuctionUnsold'; tile: number }
  | { t: 'CardDrawn'; playerId: PlayerId; deck: DeckId; card: number; key: string }
  | { t: 'RentPaid'; from: PlayerId; to: PlayerId; amount: number; tile: number; calc: RentCalc }
  | { t: 'Paid'; from: PlayerId; to: PlayerId | null; amount: number; reason: DebtReason; toJackpot: boolean }
  | { t: 'Collected'; playerId: PlayerId; amount: number; reason: 'card' }
  | { t: 'JackpotWon'; playerId: PlayerId; amount: number }
  | { t: 'BuildingBuilt'; playerId: PlayerId; tile: number; level: number; cost: number }
  | { t: 'BuildingSold'; playerId: PlayerId; tile: number; level: number; refund: number }
  | { t: 'Mortgaged'; playerId: PlayerId; tile: number; amount: number }
  | { t: 'Unmortgaged'; playerId: PlayerId; tile: number; cost: number }
  | { t: 'WentToJail'; playerId: PlayerId; reason: 'tile' | 'card' | 'doubles' }
  | { t: 'LeftJail'; playerId: PlayerId; how: 'pay' | 'card' | 'doubles' | 'forced' }
  | { t: 'JailRollFailed'; playerId: PlayerId; attempt: number }
  | { t: 'BailPassGained'; playerId: PlayerId; deck: DeckId }
  | { t: 'DebtStarted'; debtorId: PlayerId; creditorId: PlayerId | null; amount: number; reason: DebtReason }
  | { t: 'TradeProposed'; trade: Trade }
  | { t: 'TradeCountered'; tradeId: string; by: PlayerId }
  | { t: 'TradeCompleted'; trade: Trade; fees: { playerId: PlayerId; tile: number; amount: number; lifted: boolean }[] }
  | { t: 'TradeDeclined'; tradeId: string; by: PlayerId }
  | { t: 'TradeCancelled'; tradeId: string; by: PlayerId }
  | { t: 'TradeExpired'; tradeId: string }
  | { t: 'TradeVoided'; tradeId: string }
  | { t: 'Bankrupt'; playerId: PlayerId; creditorId: PlayerId | null }
  | { t: 'PlayerAway'; playerId: PlayerId }
  | { t: 'PlayerBack'; playerId: PlayerId }
  | { t: 'TimedOut'; playerId: PlayerId | null; phase: Phase }
  | { t: 'TurnEnded'; playerId: PlayerId }
  | { t: 'GameOver'; winnerIds: PlayerId[]; reason: EndReason };

export type SeqEvent = GameEvent & { seq: number };

/** Every rejection reason; the client shows `error.<code>` from the locale files. */
export const ERROR_CODES = [
  'game_over',
  'unknown_player',
  'player_bankrupt',
  'not_your_turn',
  'wrong_phase',
  'not_enough_cash',
  'invalid_tile',
  'not_owner',
  'not_ownable',
  'already_rolled',
  'not_in_jail',
  'no_bail_pass',
  'bid_too_low',
  'already_high_bidder',
  'already_passed',
  'not_bidder',
  'incomplete_group',
  'group_mortgaged',
  'uneven_build',
  'max_level',
  'no_houses_left',
  'no_hotels_left',
  'no_building',
  'cannot_break_hotel',
  'has_buildings',
  'already_mortgaged',
  'not_mortgaged',
  'mortgages_disabled',
  'not_debtor',
  'can_still_pay',
  'trade_self',
  'trade_empty',
  'trade_invalid',
  'trade_not_found',
  'trade_limit',
  'trade_during_auction',
  'trade_fees_unaffordable',
  'nothing_due',
  'bad_amount',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export type ApplyResult =
  | { ok: true; state: GameState; events: SeqEvent[] }
  | { ok: false; error: ErrorCode };
