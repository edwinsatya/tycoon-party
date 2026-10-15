import { getBoard } from '@rollionaire/boards';
import { advance, emit, payBank, startNextTurn, touchPostRoll, type E } from './core';
import { build, mortgage, sellAll, sellBuilding, unmortgage } from './assets';
import { closeAuction, passAuction, placeBid, startAuction } from './auction';
import { autoLiquidate, declareBankrupt } from './debt';
import { findPlayer, getPlayer } from './helpers';
import { bailCardIndex, jailRoll, leaveJail, rollAndMove } from './movement';
import { cancel, expireTrades, propose, respond } from './trade';
import type { ApplyResult, Ctx, ErrorCode, GameState, Intent, PlayerState, SeqEvent } from './types';

export const LOG_SIZE = 60;

/**
 * The engine contract (PRD 13.1): a pure function from (state, intent, clock) to the
 * next state plus the events that explain it. The input state is never mutated, so
 * a rejected intent changes nothing.
 */
export function applyIntent(state: GameState, intent: Intent, ctx: Ctx): ApplyResult {
  if (state.turn.phase === 'GAME_OVER') return { ok: false, error: 'game_over' };
  const s = structuredClone(state);
  const e: E = { s, now: ctx.now, board: getBoard(s.settings.boardId), out: [], resetPhase: false };

  const err = dispatch(e, intent);
  if (err) return { ok: false, error: err };

  if (intent.type !== 'TICK') {
    const p = getPlayer(s, intent.by);
    p.timeouts = 0;
    if (p.away) {
      p.away = false;
      emit(e, { t: 'PlayerBack', playerId: p.id });
    }
  }
  advance(e);

  const events: SeqEvent[] = e.out.map((ev) => ({ ...ev, seq: ++s.seq }));
  s.log.push(...events);
  if (s.log.length > LOG_SIZE) s.log.splice(0, s.log.length - LOG_SIZE);
  return { ok: true, state: s, events };
}

function dispatch(e: E, it: Intent): ErrorCode | null {
  if (it.type === 'TICK') return tick(e);

  const p = findPlayer(e.s, it.by);
  if (!p) return 'unknown_player';
  if (p.status !== 'active') return 'player_bankrupt';

  switch (it.type) {
    case 'ROLL': {
      const err = needTurn(e, p, 'AWAIT_ROLL');
      if (err) return err;
      if (e.s.turn.hasRolled && !e.s.turn.extraRoll) return 'already_rolled';
      rollAndMove(e, p);
      return null;
    }
    case 'BUY': {
      const err = needTurn(e, p, 'BUY_DECISION');
      if (err) return err;
      const tile = e.s.turn.pendingBuy!;
      const def = e.board.tiles[tile]!;
      const price = 'price' in def ? def.price : 0;
      if (p.cash < price) return 'not_enough_cash';
      p.cash -= price;
      e.s.tiles[tile]!.owner = p.id;
      e.s.turn.pendingBuy = null;
      emit(e, { t: 'PropertyBought', playerId: p.id, tile, price });
      return null;
    }
    case 'DECLINE': {
      const err = needTurn(e, p, 'BUY_DECISION');
      if (err) return err;
      decline(e, p);
      return null;
    }
    case 'BID':
      return placeBid(e, p, it.amount);
    case 'AUCTION_PASS':
      return passAuction(e, p);
    case 'BUILD':
      return afterManage(e, p, build(e, p, it.tile));
    case 'SELL_BUILDING':
      return afterManage(e, p, sellBuilding(e, p, it.tile));
    case 'SELL_ALL_BUILDINGS':
      return afterManage(e, p, sellAll(e, p, it.group));
    case 'MORTGAGE':
      return afterManage(e, p, mortgage(e, p, it.tile));
    case 'UNMORTGAGE':
      return afterManage(e, p, unmortgage(e, p, it.tile));
    case 'JAIL_PAY': {
      const err = needTurn(e, p, 'JAIL_DECISION');
      if (err) return err;
      if (p.cash < e.board.jailFine) return 'not_enough_cash';
      payBank(e, p, e.board.jailFine, 'jailFine');
      leaveJail(e, p, 'pay');
      return null;
    }
    case 'JAIL_CARD': {
      const err = needTurn(e, p, 'JAIL_DECISION');
      if (err) return err;
      if (p.bailPasses.length === 0) return 'no_bail_pass';
      useBailPass(e, p);
      return null;
    }
    case 'JAIL_ROLL': {
      const err = needTurn(e, p, 'JAIL_DECISION');
      if (err) return err;
      jailRoll(e, p);
      return null;
    }
    case 'TRADE_PROPOSE':
      return propose(e, p, it);
    case 'TRADE_RESPOND':
      return respond(e, p, it);
    case 'TRADE_CANCEL':
      return cancel(e, p, it.tradeId);
    case 'END_TURN': {
      const err = needTurn(e, p, 'POST_ROLL');
      if (err) return err;
      startNextTurn(e);
      return null;
    }
    case 'BANKRUPT':
      return declareBankrupt(e, p);
    default:
      return 'wrong_phase';
  }
}

function needTurn(e: E, p: PlayerState, phase: GameState['turn']['phase']): ErrorCode | null {
  if (e.s.turn.playerId !== p.id) return 'not_your_turn';
  if (e.s.turn.phase !== phase) return 'wrong_phase';
  return null;
}

function afterManage(e: E, p: PlayerState, err: ErrorCode | null): ErrorCode | null {
  if (!err && e.s.turn.playerId === p.id) touchPostRoll(e);
  return err;
}

function decline(e: E, p: PlayerState): void {
  const tile = e.s.turn.pendingBuy!;
  e.s.turn.pendingBuy = null;
  emit(e, { t: 'BuyDeclined', playerId: p.id, tile });
  if (e.s.settings.auctions) startAuction(e, tile, 'declined');
}

function useBailPass(e: E, p: PlayerState): void {
  const deck = p.bailPasses.shift()!;
  e.s.decks[deck].push(bailCardIndex(e, deck));
  leaveJail(e, p, 'card');
}

function markTimeout(e: E, p: PlayerState, strike: boolean): void {
  emit(e, { t: 'TimedOut', playerId: p.id, phase: e.s.turn.phase });
  if (!strike) return;
  p.timeouts++;
  p.stats.timeouts++;
  if (!p.away && p.timeouts >= e.s.settings.awayAfterTimeouts) {
    p.away = true;
    emit(e, { t: 'PlayerAway', playerId: p.id });
  }
}

/** TICK: apply every timeout that is due (PRD 8.4). Rejected when nothing is due, so claims are cheap to ignore. */
function tick(e: E): ErrorCode | null {
  const s = e.s;
  let did = expireTrades(e);
  if (s.turn.deadline > 0 && e.now >= s.turn.deadline) {
    did = true;
    const cur = getPlayer(s, s.turn.playerId);
    switch (s.turn.phase) {
      case 'AWAIT_ROLL':
        markTimeout(e, cur, true);
        rollAndMove(e, cur);
        break;
      case 'JAIL_DECISION':
        markTimeout(e, cur, true);
        if (cur.bailPasses.length > 0) useBailPass(e, cur);
        else jailRoll(e, cur);
        break;
      case 'BUY_DECISION':
        markTimeout(e, cur, true);
        decline(e, cur);
        break;
      case 'AUCTION':
        emit(e, { t: 'TimedOut', playerId: null, phase: 'AUCTION' });
        closeAuction(e);
        break;
      case 'RAISE_FUNDS': {
        const debt = s.debts[0]!;
        const debtor = getPlayer(s, debt.debtorId);
        markTimeout(e, debtor, true);
        autoLiquidate(e, debtor, debt.amount);
        break;
      }
      case 'POST_ROLL':
        // Forgetting to press End Turn is normal, so it does not count towards Away.
        markTimeout(e, cur, false);
        startNextTurn(e);
        break;
      case 'GAME_OVER':
        break;
    }
  }
  return did ? null : 'nothing_due';
}

/** When the server should next send TICK (earliest turn deadline or trade expiry); null when none. */
export function nextDeadline(s: Pick<GameState, 'turn' | 'trades'>): number | null {
  if (s.turn.phase === 'GAME_OVER') return null;
  const times = [s.turn.deadline, ...s.trades.map((t) => t.expiresAt)].filter((t) => t > 0);
  return times.length ? Math.min(...times) : null;
}
