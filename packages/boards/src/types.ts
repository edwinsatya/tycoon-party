export type DeckId = 'fortune' | 'community';

export type GroupId = 'sand' | 'mint' | 'sky' | 'lilac' | 'amber' | 'coral' | 'teal' | 'indigo';

interface TileBase {
  index: number;
  /** Translation key for the tile name, e.g. `tile.rusty_lane`. */
  key: string;
}

export interface StartTile extends TileBase { type: 'start' }
export interface JailTile extends TileBase { type: 'jail' }
export interface RestTile extends TileBase { type: 'rest' }
export interface GoToJailTile extends TileBase { type: 'goToJail' }
export interface TaxTile extends TileBase { type: 'tax'; amount: number }
export interface CardTile extends TileBase { type: 'card'; deck: DeckId }

export interface PropertyTile extends TileBase {
  type: 'property';
  group: GroupId;
  price: number;
  /** base · 1 house · 2 · 3 · 4 houses · hotel */
  rent: [number, number, number, number, number, number];
  houseCost: number;
  mortgage: number;
}

export interface TransitTile extends TileBase { type: 'transit'; price: number; mortgage: number }
export interface UtilityTile extends TileBase { type: 'utility'; price: number; mortgage: number }

export type OwnableTile = PropertyTile | TransitTile | UtilityTile;

export type TileDef =
  | StartTile
  | JailTile
  | RestTile
  | GoToJailTile
  | TaxTile
  | CardTile
  | PropertyTile
  | TransitTile
  | UtilityTile;

export type CardEffect =
  | { kind: 'advance'; to: number }
  | { kind: 'advanceNearest'; target: 'transit' | 'utility' }
  | { kind: 'move'; steps: number }
  | { kind: 'collect'; amount: number }
  | { kind: 'pay'; amount: number }
  | { kind: 'bailPass' }
  | { kind: 'goToJail' }
  | { kind: 'repairs'; perHouse: number; perHotel: number }
  | { kind: 'payEach'; amount: number }
  | { kind: 'collectEach'; amount: number };

export interface CardDef {
  /** Translation key; `${key}.title` and `${key}.text` hold the copy. */
  key: string;
  effect: CardEffect;
}

export interface GroupDef {
  id: GroupId;
  /** Main fill colour for the group band. */
  color: string;
  /** Second signal so colour is never the only cue (colour-blind support). */
  pattern: 'dots' | 'stripes' | 'grid' | 'waves' | 'zigzag' | 'cross' | 'diamonds' | 'solid';
  icon: string;
  tiles: number[];
}

export interface BoardDef {
  id: string;
  key: string;
  size: number;
  tiles: TileDef[];
  groups: Record<GroupId, GroupDef>;
  startIndex: number;
  jailIndex: number;
  /** Rent for owning 1, 2, 3 or 4 transit hubs. */
  transitRent: number[];
  /** Dice multiplier for owning 1 or 2 utilities. */
  utilityMultiplier: number[];
  jailFine: number;
  decks: Record<DeckId, CardDef[]>;
}

export const isOwnable = (t: TileDef): t is OwnableTile =>
  t.type === 'property' || t.type === 'transit' || t.type === 'utility';
