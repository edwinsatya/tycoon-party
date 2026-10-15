import { emit, type E } from './core';
import { type BaseState, activePlayers, getPlayer } from './helpers';
import type { AuctionState, ErrorCode, PlayerState } from './types';

export function startAuction(e: E, tile: number, reason: AuctionState['reason']): void {
  const s = e.s;
  const endsAt = e.now + s.settings.timers.auctionStart * 1000;
  s.auction = { tile, highBid: 0, highBidderId: null, endsAt, passed: [], reason };
  s.turn.phase = 'AUCTION';
  s.turn.phaseStartedAt = e.now;
  s.turn.deadline = endsAt;
  emit(e, { t: 'AuctionStarted', tile, endsAt, reason });
}

export const minBid = (a: AuctionState, openingBid: number): number =>
  a.highBidderId ? a.highBid + 1 : openingBid;

/** Players who can still bid: active, not passed, not already the high bidder. */
export function openBidders(e: { s: BaseState }): PlayerState[] {
  const a = e.s.auction;
  if (!a) return [];
  return activePlayers(e.s).filter((p) => !a.passed.includes(p.id) && p.id !== a.highBidderId);
}

export function checkBid(e: { s: BaseState }, p: PlayerState, amount: number): ErrorCode | null {
  const a = e.s.auction;
  if (!a || e.s.turn.phase !== 'AUCTION') return 'wrong_phase';
  if (!Number.isSafeInteger(amount) || amount <= 0) return 'bad_amount';
  if (a.passed.includes(p.id)) return 'already_passed';
  if (a.highBidderId === p.id) return 'already_high_bidder';
  if (amount < minBid(a, e.s.settings.auctionMinBid)) return 'bid_too_low';
  if (amount > p.cash) return 'not_enough_cash';
  return null;
}

export function placeBid(e: E, p: PlayerState, amount: number): ErrorCode | null {
  const err = checkBid(e, p, amount);
  if (err) return err;
  const a = e.s.auction!;
  a.highBid = amount;
  a.highBidderId = p.id;
  // Extend, never shorten: the clock always shows at least `auctionBump` seconds after a bid.
  a.endsAt = Math.max(a.endsAt, e.now + e.s.settings.timers.auctionBump * 1000);
  e.s.turn.deadline = a.endsAt;
  emit(e, { t: 'BidPlaced', playerId: p.id, tile: a.tile, amount, endsAt: a.endsAt });
  if (openBidders(e).length === 0) closeAuction(e);
  return null;
}

export function passAuction(e: E, p: PlayerState): ErrorCode | null {
  const a = e.s.auction;
  if (!a || e.s.turn.phase !== 'AUCTION') return 'wrong_phase';
  if (a.passed.includes(p.id)) return 'already_passed';
  if (a.highBidderId === p.id) return 'already_high_bidder';
  a.passed.push(p.id);
  emit(e, { t: 'AuctionPassed', playerId: p.id, tile: a.tile });
  if (openBidders(e).length === 0) closeAuction(e);
  return null;
}

export function closeAuction(e: E): void {
  const s = e.s;
  const a = s.auction;
  if (!a) return;
  s.auction = null;
  if (a.highBidderId) {
    const winner = getPlayer(s, a.highBidderId);
    winner.cash -= a.highBid;
    winner.stats.auctionsWon++;
    winner.stats.auctionSpend += a.highBid;
    const ts = s.tiles[a.tile]!;
    ts.owner = winner.id;
    ts.mortgaged = false;
    emit(e, { t: 'AuctionWon', playerId: winner.id, tile: a.tile, amount: a.highBid });
  } else {
    emit(e, { t: 'AuctionUnsold', tile: a.tile });
  }
  // Leave the phase so advance() picks what comes next with a fresh deadline.
  e.resetPhase = true;
}
