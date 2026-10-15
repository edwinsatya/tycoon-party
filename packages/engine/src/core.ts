import type { BoardDef } from '@rollionaire/boards';
import { activePlayers, getPlayer, netWorth, richest } from './helpers';
import type { EndReason, GameEvent, GameState, Phase, PlayerState } from './types';
import { moveBy, resolveLanding } from './movement';
import { startAuction } from './auction';

/** Mutable working context for one applyIntent call. */
export interface E {
  s: GameState;
  now: number;
  board: BoardDef;
  out: GameEvent[];
  /** The next phase change resets the deadline even if the phase name is unchanged (a new roll). */
  resetPhase: boolean;
}

export const emit = (e: E, ev: GameEvent): void => {
  e.out.push(ev);
};

export function phaseSeconds(s: GameState, phase: Phase): number {
  const t = s.settings.timers;
  switch (phase) {
    case 'AWAIT_ROLL':
      return t.roll;
    case 'JAIL_DECISION':
      return t.jail;
    case 'BUY_DECISION':
      return t.buy;
    case 'AUCTION':
      return t.auctionStart;
    case 'RAISE_FUNDS':
      return t.raiseFunds;
    case 'POST_ROLL':
      return t.endTurn;
    case 'GAME_OVER':
      return 0;
  }
}

export function setPhase(e: E, phase: Phase): void {
  const turn = e.s.turn;
  if (turn.phase === phase && !e.resetPhase) return;
  e.resetPhase = false;
  turn.phase = phase;
  turn.phaseStartedAt = e.now;
  turn.deadline = e.now + phaseSeconds(e.s, phase) * 1000;
}

/** Longest a player can keep POST_ROLL alive by acting (stops endless stalling). */
const POST_ROLL_CAP_MS = 90_000;

/** "Auto-end 15 s after the last action" (PRD 8.4), capped so nobody can stall forever. */
export function touchPostRoll(e: E): void {
  const turn = e.s.turn;
  if (turn.phase !== 'POST_ROLL') return;
  const wanted = e.now + e.s.settings.timers.endTurn * 1000;
  turn.deadline = Math.min(turn.phaseStartedAt + POST_ROLL_CAP_MS, Math.max(turn.deadline, wanted));
}

export function endGame(e: E, reason: EndReason, winnerIds: string[]): void {
  const s = e.s;
  s.turn.phase = 'GAME_OVER';
  s.turn.deadline = 0;
  s.endedAt = e.now;
  s.endReason = reason;
  s.winnerIds = winnerIds;
  s.auction = null;
  s.auctionQueue = [];
  s.debts = [];
  s.trades = [];
  emit(e, { t: 'GameOver', winnerIds, reason });
}

export function checkGameOver(e: E): boolean {
  const s = e.s;
  if (s.turn.phase === 'GAME_OVER') return true;
  const alive = activePlayers(s);
  if (alive.length <= 1) {
    endGame(
      e,
      'lastStanding',
      alive.map((p) => p.id),
    );
    return true;
  }
  if (s.settings.endAfterBankruptcies > 0 && s.bankruptCount >= s.settings.endAfterBankruptcies) {
    endGame(e, 'bankruptcyLimit', richest(s, alive));
    return true;
  }
  return false;
}

export function startNextTurn(e: E): void {
  const s = e.s;
  const cur = getPlayer(s, s.turn.playerId);
  if (cur.status === 'active') emit(e, { t: 'TurnEnded', playerId: cur.id });
  if (checkGameOver(e)) return;

  const alive = activePlayers(s);
  let next = alive.find((p) => p.seat > cur.seat);
  if (!next) {
    next = alive[0]!;
    s.round++;
  }
  s.turnCount++;

  if (s.settings.roundLimit > 0 && s.round > s.settings.roundLimit) {
    endGame(e, 'roundLimit', richest(s, alive));
    return;
  }
  if (s.settings.timeLimitMin > 0 && e.now - s.startedAt >= s.settings.timeLimitMin * 60_000) {
    endGame(e, 'timeLimit', richest(s, alive));
    return;
  }

  for (const p of alive) {
    const w = netWorth(s, p.id);
    if (w < p.stats.lowestNetWorth) p.stats.lowestNetWorth = w;
  }

  s.turn = {
    playerId: next.id,
    phase: next.inJail ? 'JAIL_DECISION' : 'AWAIT_ROLL',
    phaseStartedAt: e.now,
    deadline: 0,
    doubles: 0,
    extraRoll: false,
    hasRolled: false,
    lastRoll: null,
    pendingBuy: null,
    pendingMove: null,
    endTurn: false,
  };
  s.turn.deadline = e.now + phaseSeconds(s, s.turn.phase) * 1000;
  emit(e, { t: 'TurnStarted', playerId: next.id, round: s.round });
}

/**
 * Drives the game forward after any change until someone has to make a choice:
 * settle debts, run auctions, finish pending moves, then hand the turn on.
 */
export function advance(e: E): void {
  const s = e.s;
  for (let guard = 0; guard < 1000; guard++) {
    if (checkGameOver(e)) return;

    const debt = s.debts[0];
    if (debt) {
      const debtor = getPlayer(s, debt.debtorId);
      if (debtor.status === 'bankrupt') {
        s.debts.shift();
        continue;
      }
      if (debt.creditorId && getPlayer(s, debt.creditorId).status === 'bankrupt') debt.creditorId = null;
      if (debtor.cash >= debt.amount) {
        settleDebt(e, debtor);
        continue;
      }
      if (!debt.raising) {
        debt.raising = true;
        emit(e, {
          t: 'DebtStarted',
          debtorId: debt.debtorId,
          creditorId: debt.creditorId,
          amount: debt.amount,
          reason: debt.reason,
        });
        e.resetPhase = true;
      }
      setPhase(e, 'RAISE_FUNDS');
      return;
    }

    if (s.auction) {
      s.turn.phase = 'AUCTION';
      s.turn.deadline = s.auction.endsAt;
      return;
    }
    if (s.auctionQueue.length > 0) {
      const tile = s.auctionQueue.shift()!;
      if (s.tiles[tile]!.owner === null) startAuction(e, tile, 'bankruptcy');
      continue;
    }

    const cur = getPlayer(s, s.turn.playerId);
    if (cur.status === 'bankrupt') {
      startNextTurn(e);
      return;
    }
    if (s.turn.pendingBuy !== null) {
      setPhase(e, 'BUY_DECISION');
      return;
    }
    if (s.turn.pendingMove !== null) {
      const steps = s.turn.pendingMove;
      s.turn.pendingMove = null;
      moveBy(e, cur, steps);
      resolveLanding(e, cur, {});
      continue;
    }
    if (s.turn.endTurn) {
      startNextTurn(e);
      return;
    }
    if (s.turn.extraRoll || !s.turn.hasRolled) {
      setPhase(e, cur.inJail && !s.turn.hasRolled ? 'JAIL_DECISION' : 'AWAIT_ROLL');
      return;
    }
    setPhase(e, 'POST_ROLL');
    return;
  }
  throw new Error('advance(): loop guard tripped');
}

const JACKPOT_REASONS = new Set(['tax', 'card', 'repairs', 'jailFine']);

/** Pays the debt at the head of the queue; the debtor is known to have the cash. */
function settleDebt(e: E, debtor: PlayerState): void {
  const s = e.s;
  const d = s.debts.shift()!;
  debtor.cash -= d.amount;
  if (d.creditorId) {
    const creditor = getPlayer(s, d.creditorId);
    creditor.cash += d.amount;
    if (d.reason === 'rent') {
      debtor.stats.rentPaid += d.amount;
      creditor.stats.rentReceived += d.amount;
      emit(e, { t: 'RentPaid', from: debtor.id, to: creditor.id, amount: d.amount, tile: d.tile!, calc: d.calc! });
    } else {
      emit(e, { t: 'Paid', from: debtor.id, to: creditor.id, amount: d.amount, reason: d.reason, toJackpot: false });
    }
    return;
  }
  const toJackpot = s.settings.jackpot && JACKPOT_REASONS.has(d.reason);
  if (toJackpot) s.bank.jackpot += d.amount;
  emit(e, { t: 'Paid', from: debtor.id, to: null, amount: d.amount, reason: d.reason, toJackpot });
}

/** Pays the bank right away (the payer has already been checked for cash). */
export function payBank(e: E, p: PlayerState, amount: number, reason: 'jailFine' | 'mortgageFee'): void {
  p.cash -= amount;
  const toJackpot = e.s.settings.jackpot && reason === 'jailFine';
  if (toJackpot) e.s.bank.jackpot += amount;
  emit(e, { t: 'Paid', from: p.id, to: null, amount, reason, toJackpot });
}
