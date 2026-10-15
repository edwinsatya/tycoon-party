export * from './types';
export * from './tokens';
export { metroCity } from './metro-city';
export * from './i18n';

import { metroCity } from './metro-city';
import type { BoardDef } from './types';

export const BOARDS: Record<string, BoardDef> = { [metroCity.id]: metroCity };

export function getBoard(id: string): BoardDef {
  const board = BOARDS[id];
  if (!board) throw new Error(`Unknown board: ${id}`);
  return board;
}
