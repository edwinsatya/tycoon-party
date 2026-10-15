import type { GroupId } from '@rollionaire/boards';
import { emit, type E } from './core';
import {
  type BaseState,
  boardOf,
  groupHasBuildings,
  groupLevels,
  hotelLevel,
  ownableDef,
  ownsWholeGroup,
  unmortgageCost,
} from './helpers';
import type { ErrorCode, Phase, PlayerState } from './types';

type View = { s: BaseState };

const BUILD_PHASES: Phase[] = ['AWAIT_ROLL', 'JAIL_DECISION', 'POST_ROLL'];
const LIQUIDATE_PHASES: Phase[] = [...BUILD_PHASES, 'BUY_DECISION'];

/** Building and lifting mortgages happen only during your own turn (PRD 6.5). */
export function mayBuild(s: BaseState, pid: string): boolean {
  return s.turn.playerId === pid && BUILD_PHASES.includes(s.turn.phase);
}

/** Selling and mortgaging: on your own turn, or whenever you are the one raising funds. */
export function mayLiquidate(s: BaseState, pid: string): boolean {
  if (s.turn.phase === 'RAISE_FUNDS') return s.debts[0]?.debtorId === pid;
  return s.turn.playerId === pid && LIQUIDATE_PHASES.includes(s.turn.phase);
}

export function checkBuild(v: View, p: PlayerState, tile: number): ErrorCode | null {
  const s = v.s;
  const board = boardOf(s);
  if (!mayBuild(s, p.id)) return s.turn.playerId === p.id ? 'wrong_phase' : 'not_your_turn';
  const def = board.tiles[tile];
  if (!def) return 'invalid_tile';
  if (def.type !== 'property') return 'not_ownable';
  const ts = s.tiles[tile]!;
  if (ts.owner !== p.id) return 'not_owner';
  if (!ownsWholeGroup(s, board, p.id, def.group)) return 'incomplete_group';
  if (board.groups[def.group].tiles.some((i) => s.tiles[i]!.mortgaged)) return 'group_mortgaged';
  const h = hotelLevel(s);
  if (ts.level >= h) return 'max_level';
  if (s.settings.evenBuild && ts.level > Math.min(...groupLevels(s, board, def.group))) return 'uneven_build';
  if (ts.level + 1 === h) {
    if (s.bank.hotels < 1) return 'no_hotels_left';
  } else if (s.bank.houses < 1) return 'no_houses_left';
  if (p.cash < def.houseCost) return 'not_enough_cash';
  return null;
}

export function build(e: E, p: PlayerState, tile: number): ErrorCode | null {
  const err = checkBuild(e, p, tile);
  if (err) return err;
  const s = e.s;
  const def = ownableDef(e.board, tile)!;
  if (def.type !== 'property') return 'not_ownable';
  const ts = s.tiles[tile]!;
  if (ts.level + 1 === hotelLevel(s)) {
    s.bank.hotels--;
    s.bank.houses += s.settings.housesForHotel;
  } else {
    s.bank.houses--;
  }
  ts.level++;
  p.cash -= def.houseCost;
  p.stats.buildingsBuilt++;
  emit(e, { t: 'BuildingBuilt', playerId: p.id, tile, level: ts.level, cost: def.houseCost });
  return null;
}

export function checkSellBuilding(v: View, p: PlayerState, tile: number): ErrorCode | null {
  const s = v.s;
  const board = boardOf(s);
  if (!mayLiquidate(s, p.id)) return 'wrong_phase';
  const def = board.tiles[tile];
  if (!def) return 'invalid_tile';
  if (def.type !== 'property') return 'not_ownable';
  const ts = s.tiles[tile]!;
  if (ts.owner !== p.id) return 'not_owner';
  if (ts.level === 0) return 'no_building';
  if (s.settings.evenBuild && ts.level < Math.max(...groupLevels(s, board, def.group))) return 'uneven_build';
  if (ts.level === hotelLevel(s) && s.bank.houses < s.settings.housesForHotel) return 'cannot_break_hotel';
  return null;
}

export function sellBuilding(e: E, p: PlayerState, tile: number): ErrorCode | null {
  const err = checkSellBuilding(e, p, tile);
  if (err) return err;
  const s = e.s;
  const def = ownableDef(e.board, tile)!;
  if (def.type !== 'property') return 'not_ownable';
  const ts = s.tiles[tile]!;
  if (ts.level === hotelLevel(s)) {
    s.bank.hotels++;
    s.bank.houses -= s.settings.housesForHotel;
  } else {
    s.bank.houses++;
  }
  ts.level--;
  const refund = Math.floor(def.houseCost / 2);
  p.cash += refund;
  emit(e, { t: 'BuildingSold', playerId: p.id, tile, level: ts.level, refund });
  return null;
}

export function checkSellAll(v: View, p: PlayerState, group: GroupId): ErrorCode | null {
  const s = v.s;
  const board = boardOf(s);
  if (!mayLiquidate(s, p.id)) return 'wrong_phase';
  const g = board.groups[group];
  if (!g) return 'invalid_tile';
  if (!g.tiles.every((i) => s.tiles[i]!.owner === p.id)) return 'not_owner';
  if (!groupHasBuildings(s, board, group)) return 'no_building';
  return null;
}

/** Sells every building in a group at once. Always possible, even when the bank has no houses to break a hotel. */
export function sellAll(e: E, p: PlayerState, group: GroupId, checked = true): ErrorCode | null {
  if (checked) {
    const err = checkSellAll(e, p, group);
    if (err) return err;
  }
  const s = e.s;
  const h = hotelLevel(s);
  for (const i of e.board.groups[group].tiles) {
    const ts = s.tiles[i]!;
    if (ts.level === 0) continue;
    const def = ownableDef(e.board, i)!;
    if (def.type !== 'property') continue;
    if (ts.level === h) s.bank.hotels++;
    else s.bank.houses += ts.level;
    const refund = ts.level * Math.floor(def.houseCost / 2);
    ts.level = 0;
    p.cash += refund;
    emit(e, { t: 'BuildingSold', playerId: p.id, tile: i, level: 0, refund });
  }
  return null;
}

export function checkMortgage(v: View, p: PlayerState, tile: number): ErrorCode | null {
  const s = v.s;
  const board = boardOf(s);
  if (!s.settings.mortgages) return 'mortgages_disabled';
  if (!mayLiquidate(s, p.id)) return 'wrong_phase';
  const def = ownableDef(board, tile);
  if (!def) return 'not_ownable';
  const ts = s.tiles[tile]!;
  if (ts.owner !== p.id) return 'not_owner';
  if (ts.mortgaged) return 'already_mortgaged';
  if (def.type === 'property' && groupHasBuildings(s, board, def.group)) return 'has_buildings';
  return null;
}

export function mortgage(e: E, p: PlayerState, tile: number): ErrorCode | null {
  const err = checkMortgage(e, p, tile);
  if (err) return err;
  const def = ownableDef(e.board, tile)!;
  e.s.tiles[tile]!.mortgaged = true;
  p.cash += def.mortgage;
  emit(e, { t: 'Mortgaged', playerId: p.id, tile, amount: def.mortgage });
  return null;
}

export function checkUnmortgage(v: View, p: PlayerState, tile: number): ErrorCode | null {
  const s = v.s;
  const board = boardOf(s);
  if (!mayBuild(s, p.id)) return s.turn.playerId === p.id ? 'wrong_phase' : 'not_your_turn';
  const def = ownableDef(board, tile);
  if (!def) return 'not_ownable';
  const ts = s.tiles[tile]!;
  if (ts.owner !== p.id) return 'not_owner';
  if (!ts.mortgaged) return 'not_mortgaged';
  if (p.cash < unmortgageCost(def.mortgage)) return 'not_enough_cash';
  return null;
}

export function unmortgage(e: E, p: PlayerState, tile: number): ErrorCode | null {
  const err = checkUnmortgage(e, p, tile);
  if (err) return err;
  const def = ownableDef(e.board, tile)!;
  const cost = unmortgageCost(def.mortgage);
  e.s.tiles[tile]!.mortgaged = false;
  p.cash -= cost;
  emit(e, { t: 'Unmortgaged', playerId: p.id, tile, cost });
  return null;
}
