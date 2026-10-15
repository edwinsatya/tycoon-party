import type { CardEffect, DeckId } from '@rollionaire/boards';
import { emit, type E } from './core';
import {
  activePlayers,
  buildingsOwnedBy,
  countOwnedOfType,
  getPlayer,
  hotelLevel,
  netWorth,
  ownsWholeGroup,
} from './helpers';
import { randInt, shuffle } from './rng';
import type { Debt, PlayerState, RentCalc } from './types';

export function rollDice(e: E): [number, number] {
  const s = e.s;
  if (s.settings.balancedDice) {
    if (s.diceDeck.length === 0) s.diceDeck = shuffle(s.rng, Array.from({ length: 36 }, (_, i) => i));
    const code = s.diceDeck.shift()!;
    return [Math.floor(code / 6) + 1, (code % 6) + 1];
  }
  return [randInt(s.rng, 6) + 1, randInt(s.rng, 6) + 1];
}

/** ROLL from AWAIT_ROLL. */
export function rollAndMove(e: E, p: PlayerState): void {
  const s = e.s;
  const dice = rollDice(e);
  emit(e, { t: 'DiceRolled', playerId: p.id, dice, purpose: 'move' });
  s.turn.lastRoll = dice;
  s.turn.hasRolled = true;
  e.resetPhase = true;
  const doubles = dice[0] === dice[1];
  if (doubles) {
    s.turn.doubles++;
    p.stats.doubles++;
    if (s.turn.doubles >= 3) {
      sendToJail(e, p, 'doubles');
      return;
    }
  }
  s.turn.extraRoll = doubles;
  moveBy(e, p, dice[0] + dice[1]);
  resolveLanding(e, p, {});
}

/** JAIL_ROLL: doubles frees the player with no extra roll; the third miss pays the fine and moves. */
export function jailRoll(e: E, p: PlayerState): void {
  const s = e.s;
  const dice = rollDice(e);
  emit(e, { t: 'DiceRolled', playerId: p.id, dice, purpose: 'jail' });
  s.turn.lastRoll = dice;
  s.turn.hasRolled = true;
  s.turn.extraRoll = false;
  e.resetPhase = true;
  const total = dice[0] + dice[1];
  if (dice[0] === dice[1]) {
    leaveJail(e, p, 'doubles');
    moveBy(e, p, total);
    resolveLanding(e, p, {});
    return;
  }
  p.jailTurns++;
  emit(e, { t: 'JailRollFailed', playerId: p.id, attempt: p.jailTurns });
  if (p.jailTurns >= 3) {
    leaveJail(e, p, 'forced');
    s.debts.push({ debtorId: p.id, creditorId: null, amount: e.board.jailFine, reason: 'jailFine' });
    s.turn.pendingMove = total;
    return;
  }
  s.turn.endTurn = true;
}

export function leaveJail(e: E, p: PlayerState, how: 'pay' | 'card' | 'doubles' | 'forced'): void {
  p.inJail = false;
  p.jailTurns = 0;
  emit(e, { t: 'LeftJail', playerId: p.id, how });
}

export function sendToJail(e: E, p: PlayerState, reason: 'tile' | 'card' | 'doubles'): void {
  const s = e.s;
  p.position = e.board.jailIndex;
  p.inJail = true;
  p.jailTurns = 0;
  p.stats.jailVisits++;
  emit(e, { t: 'WentToJail', playerId: p.id, reason });
  if (s.turn.playerId === p.id) {
    s.turn.extraRoll = false;
    s.turn.pendingMove = null;
    s.turn.endTurn = true;
  }
}

function paySalary(e: E, p: PlayerState, exact: boolean): void {
  const s = e.s;
  let amount = s.settings.salary;
  if (exact && s.settings.doubleSalaryOnStart) amount *= 2;
  if (s.settings.catchUp) {
    const others = activePlayers(s).filter((o) => o.id !== p.id);
    const leader = Math.max(0, ...others.map((o) => netWorth(s, o.id)));
    if (netWorth(s, p.id) < leader / 4) amount = Math.round(amount * 1.5);
  }
  p.cash += amount;
  emit(e, { t: 'PassedStart', playerId: p.id, amount, exact });
}

/** Walk `steps` tiles (negative = backwards, never pays salary). */
export function moveBy(e: E, p: PlayerState, steps: number): void {
  const size = e.board.size;
  const from = p.position;
  const to = (((from + steps) % size) + size) % size;
  p.position = to;
  emit(e, { t: 'TokenMoved', playerId: p.id, from, to, steps, direct: false });
  if (steps > 0 && from + steps >= size) paySalary(e, p, to === e.board.startIndex);
}

/** Card movement: go forward to `target`, paying salary when passing START. */
export function moveTo(e: E, p: PlayerState, target: number): void {
  const size = e.board.size;
  const from = p.position;
  const steps = (target - from + size) % size;
  p.position = target;
  emit(e, { t: 'TokenMoved', playerId: p.id, from, to: target, steps, direct: true });
  if (steps > 0 && from + steps >= size) paySalary(e, p, target === e.board.startIndex);
}

interface LandingOpts {
  /** "Catch the Next Ride": pay double the normal hub rent. */
  transitDouble?: boolean;
  /** "Service Call": roll fresh dice and pay 10 x, whatever the owner holds. */
  utilityRoll?: boolean;
}

export function resolveLanding(e: E, p: PlayerState, opts: LandingOpts): void {
  const s = e.s;
  const idx = p.position;
  const def = e.board.tiles[idx]!;
  switch (def.type) {
    case 'start':
    case 'jail':
      return;
    case 'rest':
      if (s.settings.jackpot && s.bank.jackpot > 0) {
        const amount = s.bank.jackpot;
        s.bank.jackpot = 0;
        p.cash += amount;
        emit(e, { t: 'JackpotWon', playerId: p.id, amount });
      }
      return;
    case 'goToJail':
      sendToJail(e, p, 'tile');
      return;
    case 'tax':
      s.debts.push({ debtorId: p.id, creditorId: null, amount: def.amount, reason: 'tax', tile: idx });
      return;
    case 'card':
      drawCard(e, p, def.deck);
      return;
    default: {
      const ts = s.tiles[idx]!;
      if (ts.owner === null) {
        s.turn.pendingBuy = idx;
        return;
      }
      if (ts.owner === p.id) return;
      const rent = computeRent(e, idx, opts);
      if (rent && rent.amount > 0) {
        s.debts.push({
          debtorId: p.id,
          creditorId: ts.owner,
          amount: rent.amount,
          reason: 'rent',
          tile: idx,
          calc: rent.calc,
        });
      }
    }
  }
}

function computeRent(e: E, idx: number, opts: LandingOpts): { amount: number; calc: RentCalc } | null {
  const s = e.s;
  const ts = s.tiles[idx]!;
  if (!ts.owner || ts.mortgaged) return null;
  const owner = getPlayer(s, ts.owner);
  if (owner.inJail && !s.settings.rentInJail) return null;
  const def = e.board.tiles[idx]!;
  if (def.type === 'property') {
    if (ts.level === 0) {
      const full = ownsWholeGroup(s, e.board, owner.id, def.group);
      return { amount: def.rent[0] * (full ? 2 : 1), calc: { kind: full ? 'set' : 'base' } };
    }
    if (ts.level === hotelLevel(s)) return { amount: def.rent[5], calc: { kind: 'hotel' } };
    return { amount: def.rent[ts.level]!, calc: { kind: 'houses', houses: ts.level } };
  }
  if (def.type === 'transit') {
    const owned = countOwnedOfType(s, e.board, owner.id, 'transit');
    const base = e.board.transitRent[owned - 1]!;
    const cardDouble = !!opts.transitDouble;
    return { amount: base * (cardDouble ? 2 : 1), calc: { kind: 'transit', owned, cardDouble } };
  }
  if (def.type === 'utility') {
    const owned = countOwnedOfType(s, e.board, owner.id, 'utility');
    let dice: number;
    let multiplier: number;
    if (opts.utilityRoll) {
      const roll = rollDice(e);
      emit(e, { t: 'DiceRolled', playerId: s.turn.playerId, dice: roll, purpose: 'utility' });
      dice = roll[0] + roll[1];
      multiplier = e.board.utilityMultiplier[e.board.utilityMultiplier.length - 1]!;
    } else {
      const last = s.turn.lastRoll ?? [0, 0];
      dice = last[0] + last[1];
      multiplier = e.board.utilityMultiplier[owned - 1]!;
    }
    return { amount: dice * multiplier, calc: { kind: 'utility', owned, dice, multiplier } };
  }
  return null;
}

export function bailCardIndex(e: E, deck: DeckId): number {
  return e.board.decks[deck].findIndex((c) => c.effect.kind === 'bailPass');
}

function drawCard(e: E, p: PlayerState, deck: DeckId): void {
  const s = e.s;
  const order = s.decks[deck];
  const cardIdx = order.shift();
  if (cardIdx === undefined) return;
  const card = e.board.decks[deck][cardIdx]!;
  emit(e, { t: 'CardDrawn', playerId: p.id, deck, card: cardIdx, key: card.key });
  if (card.effect.kind !== 'bailPass') order.push(cardIdx);
  applyCard(e, p, deck, card.effect);
}

function nextTileOfType(e: E, from: number, type: 'transit' | 'utility'): number {
  const size = e.board.size;
  for (let i = 1; i <= size; i++) {
    const idx = (from + i) % size;
    if (e.board.tiles[idx]!.type === type) return idx;
  }
  return from;
}

function applyCard(e: E, p: PlayerState, deck: DeckId, effect: CardEffect): void {
  const s = e.s;
  const others = () => {
    // Seat order, starting after the drawing player (PRD 6.9).
    const alive = activePlayers(s).filter((o) => o.id !== p.id);
    return [...alive.filter((o) => o.seat > p.seat), ...alive.filter((o) => o.seat < p.seat)];
  };
  const debt = (d: Omit<Debt, 'reason'> & { reason?: Debt['reason'] }) =>
    s.debts.push({ reason: 'card', ...d });

  switch (effect.kind) {
    case 'advance':
      moveTo(e, p, effect.to);
      resolveLanding(e, p, {});
      return;
    case 'advanceNearest': {
      moveTo(e, p, nextTileOfType(e, p.position, effect.target));
      resolveLanding(e, p, effect.target === 'transit' ? { transitDouble: true } : { utilityRoll: true });
      return;
    }
    case 'move':
      moveBy(e, p, effect.steps);
      resolveLanding(e, p, {});
      return;
    case 'collect':
      p.cash += effect.amount;
      emit(e, { t: 'Collected', playerId: p.id, amount: effect.amount, reason: 'card' });
      return;
    case 'pay':
      debt({ debtorId: p.id, creditorId: null, amount: effect.amount });
      return;
    case 'bailPass':
      p.bailPasses.push(deck);
      emit(e, { t: 'BailPassGained', playerId: p.id, deck });
      return;
    case 'goToJail':
      sendToJail(e, p, 'card');
      return;
    case 'repairs': {
      const b = buildingsOwnedBy(s, p.id);
      const amount = b.houses * effect.perHouse + b.hotels * effect.perHotel;
      if (amount > 0) debt({ debtorId: p.id, creditorId: null, amount, reason: 'repairs' });
      return;
    }
    case 'payEach':
      for (const o of others()) debt({ debtorId: p.id, creditorId: o.id, amount: effect.amount, reason: 'payEach' });
      return;
    case 'collectEach':
      for (const o of others()) debt({ debtorId: o.id, creditorId: p.id, amount: effect.amount, reason: 'collectEach' });
      return;
  }
}
