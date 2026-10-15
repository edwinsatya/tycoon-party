import { getBoard, type BoardDef, type GroupId, type OwnableTile, isOwnable } from '@rollionaire/boards';
import type { GameState, PlayerId, PlayerState } from './types';

/** Fields every view of the game has, public or not. Helpers take this so bots can use them. */
export type BaseState = Omit<GameState, 'rng' | 'diceDeck' | 'decks'>;

export const boardOf = (s: BaseState): BoardDef => getBoard(s.settings.boardId);

export const hotelLevel = (s: BaseState): number => s.settings.housesForHotel + 1;

export function findPlayer(s: BaseState, id: PlayerId | null | undefined): PlayerState | undefined {
  if (!id) return undefined;
  return s.players.find((p) => p.id === id);
}

export function getPlayer(s: BaseState, id: PlayerId): PlayerState {
  const p = findPlayer(s, id);
  if (!p) throw new Error(`Unknown player ${id}`);
  return p;
}

export const activePlayers = (s: BaseState): PlayerState[] =>
  s.players.filter((p) => p.status === 'active').sort((a, b) => a.seat - b.seat);

export function ownableDef(board: BoardDef, tile: number): OwnableTile | null {
  const def = board.tiles[tile];
  return def && isOwnable(def) ? def : null;
}

export function groupOf(board: BoardDef, tile: number): GroupId | null {
  const def = board.tiles[tile];
  return def && def.type === 'property' ? def.group : null;
}

export const ownedTiles = (s: BaseState, pid: PlayerId): number[] =>
  s.tiles.flatMap((t, i) => (t.owner === pid ? [i] : []));

export function ownsWholeGroup(s: BaseState, board: BoardDef, pid: PlayerId, group: GroupId): boolean {
  return board.groups[group].tiles.every((i) => s.tiles[i]!.owner === pid);
}

export function groupHasBuildings(s: BaseState, board: BoardDef, group: GroupId): boolean {
  return board.groups[group].tiles.some((i) => s.tiles[i]!.level > 0);
}

export function groupLevels(s: BaseState, board: BoardDef, group: GroupId): number[] {
  return board.groups[group].tiles.map((i) => s.tiles[i]!.level);
}

export function countOwnedOfType(s: BaseState, board: BoardDef, pid: PlayerId, type: 'transit' | 'utility'): number {
  return board.tiles.filter((t) => t.type === type && s.tiles[t.index]!.owner === pid).length;
}

/** Build cost sunk into a tile at a given level (a hotel counts every level it took). */
export function buildingValue(level: number, houseCost: number): number {
  return level * houseCost;
}

/** Net worth (PRD 6.8): cash, list price of unmortgaged tiles, mortgage value of mortgaged ones, build cost. */
export function netWorth(s: BaseState, pid: PlayerId): number {
  const board = boardOf(s);
  const p = getPlayer(s, pid);
  let total = p.cash;
  s.tiles.forEach((t, i) => {
    if (t.owner !== pid) return;
    const def = ownableDef(board, i)!;
    total += t.mortgaged ? def.mortgage : def.price;
    if (def.type === 'property') total += buildingValue(t.level, def.houseCost);
  });
  return total;
}

/** The most cash a player could raise right now by selling every building and mortgaging every tile. */
export function maxRaisable(s: BaseState, pid: PlayerId): number {
  const board = boardOf(s);
  const p = getPlayer(s, pid);
  let total = p.cash;
  s.tiles.forEach((t, i) => {
    if (t.owner !== pid) return;
    const def = ownableDef(board, i)!;
    if (def.type === 'property') total += t.level * Math.floor(def.houseCost / 2);
    if (!t.mortgaged && s.settings.mortgages) total += def.mortgage;
  });
  return total;
}

export const unmortgageCost = (mortgage: number): number => Math.ceil((mortgage * 11) / 10);
export const mortgageFee = (mortgage: number): number => Math.ceil(mortgage / 10);

/** Houses and hotels currently standing on the board. */
export function buildingsOnBoard(s: BaseState): { houses: number; hotels: number } {
  const h = hotelLevel(s);
  let houses = 0;
  let hotels = 0;
  for (const t of s.tiles) {
    if (t.level === h) hotels++;
    else houses += t.level;
  }
  return { houses, hotels };
}

export function buildingsOwnedBy(s: BaseState, pid: PlayerId): { houses: number; hotels: number } {
  const h = hotelLevel(s);
  let houses = 0;
  let hotels = 0;
  for (const t of s.tiles) {
    if (t.owner !== pid) continue;
    if (t.level === h) hotels++;
    else houses += t.level;
  }
  return { houses, hotels };
}

export function richest(s: BaseState, players: PlayerState[]): PlayerId[] {
  if (players.length === 0) return [];
  const worth = players.map((p) => ({ id: p.id, w: netWorth(s, p.id) }));
  const best = Math.max(...worth.map((x) => x.w));
  return worth.filter((x) => x.w === best).map((x) => x.id);
}
