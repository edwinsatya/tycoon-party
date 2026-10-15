import type { BoardDef, GroupId } from '@rollionaire/boards';
import {
  type BaseState,
  type Bundle,
  type PlayerId,
  boardOf,
  countOwnedOfType,
  findPlayer,
  hotelLevel,
  ownableDef,
  ownsWholeGroup,
} from '@rollionaire/engine';

/** Rent a visitor would pay on a tile right now (utilities use an average roll of 7). */
export function currentRent(s: BaseState, tile: number): number {
  const board = boardOf(s);
  const ts = s.tiles[tile]!;
  if (!ts.owner || ts.mortgaged) return 0;
  const def = board.tiles[tile]!;
  if (def.type === 'property') {
    if (ts.level === 0) return def.rent[0] * (ownsWholeGroup(s, board, ts.owner, def.group) ? 2 : 1);
    return ts.level === hotelLevel(s) ? def.rent[5] : def.rent[ts.level]!;
  }
  if (def.type === 'transit') return board.transitRent[countOwnedOfType(s, board, ts.owner, 'transit') - 1]!;
  if (def.type === 'utility') return 7 * board.utilityMultiplier[countOwnedOfType(s, board, ts.owner, 'utility') - 1]!;
  return 0;
}

/** The worst rent `me` could face from opponents' tiles: a proxy for how much cash to keep. */
export function maxThreat(s: BaseState, me: PlayerId): number {
  let worst = 0;
  s.tiles.forEach((t, i) => {
    if (t.owner && t.owner !== me) worst = Math.max(worst, currentRent(s, i));
  });
  return worst;
}

type Owners = (PlayerId | null)[];

function groupOwnerCounts(board: BoardDef, owners: Owners, group: GroupId, pid: PlayerId) {
  const tiles = board.groups[group].tiles;
  const mine = tiles.filter((i) => owners[i] === pid).length;
  const others = tiles.filter((i) => owners[i] && owners[i] !== pid).length;
  return { mine, others, total: tiles.length };
}

/**
 * A rough "how good is this position" score: cash plus tiles weighted by how close
 * each colour group is to a monopoly. Used to judge trades from both sides.
 */
export function positionScore(s: BaseState, pid: PlayerId, owners: Owners, cash: number, passes: number): number {
  const board = boardOf(s);
  let score = cash + passes * 40;
  const transit = owners.filter((o, i) => o === pid && board.tiles[i]!.type === 'transit').length;
  const utility = owners.filter((o, i) => o === pid && board.tiles[i]!.type === 'utility').length;
  owners.forEach((o, i) => {
    if (o !== pid) return;
    const def = ownableDef(board, i)!;
    const ts = s.tiles[i]!;
    let v = def.price;
    if (def.type === 'property') {
      const g = groupOwnerCounts(board, owners, def.group, pid);
      if (g.mine === g.total) {
        // A monopoly is worth what it earns once built (near its 3-house rent), and
        // only if there is cash to build: a set you cannot develop is worth less.
        const toThreeHouses = 3 * def.houseCost * g.total;
        const canBuild = 0.4 + 0.6 * Math.min(1, Math.max(0, cash) / toThreeHouses);
        v = def.price * 1.6 + def.rent[3] * 0.8 * canBuild;
      } else {
        // Each extra tile in a group is a step towards the set; a group someone else
        // also holds is worth a little less because it needs a deal to finish.
        v *= (1 + 0.25 * (g.mine - 1)) * (g.others > 0 ? 0.9 : 1);
      }
      v += ts.level * def.houseCost;
    } else if (def.type === 'transit') v *= [1, 1.15, 1.35, 1.6][transit - 1]!;
    else v *= utility === 2 ? 1.1 : 0.8;
    if (ts.mortgaged) v -= def.mortgage * 1.1;
    score += v;
  });
  return score;
}

export interface TradeDelta {
  me: number;
  them: number;
}

/** Score change for both sides if `me` gives `give` to `them` and gets `get` back. */
export function tradeDelta(s: BaseState, me: PlayerId, them: PlayerId, give: Bundle, get: Bundle): TradeDelta {
  const pm = findPlayer(s, me)!;
  const pt = findPlayer(s, them)!;
  const before: Owners = s.tiles.map((t) => t.owner);
  const after: Owners = [...before];
  for (const i of give.tiles) after[i] = them;
  for (const i of get.tiles) after[i] = me;
  const meBefore = positionScore(s, me, before, pm.cash, pm.bailPasses.length);
  const themBefore = positionScore(s, them, before, pt.cash, pt.bailPasses.length);
  const meAfter = positionScore(
    s,
    me,
    after,
    pm.cash - give.cash + get.cash,
    pm.bailPasses.length - give.passes + get.passes,
  );
  const themAfter = positionScore(
    s,
    them,
    after,
    pt.cash + give.cash - get.cash,
    pt.bailPasses.length + give.passes - get.passes,
  );
  return { me: meAfter - meBefore, them: themAfter - themBefore };
}

/** How much a single unowned tile is worth to `pid` (completing or blocking a set raises it). */
export function tileValue(s: BaseState, pid: PlayerId, tile: number, setBonus: number, blockBonus: number): number {
  const board = boardOf(s);
  const def = ownableDef(board, tile);
  if (!def) return 0;
  if (def.type === 'property') {
    const tiles = board.groups[def.group].tiles.filter((i) => i !== tile);
    const mine = tiles.filter((i) => s.tiles[i]!.owner === pid).length;
    const owners = new Set(tiles.map((i) => s.tiles[i]!.owner).filter((o) => o && o !== pid));
    if (mine === tiles.length) return def.price * setBonus;
    if (owners.size === 1 && tiles.every((i) => s.tiles[i]!.owner && s.tiles[i]!.owner !== pid))
      return def.price * blockBonus;
    return def.price * (1 + 0.1 * mine);
  }
  if (def.type === 'transit') return def.price * (1 + 0.15 * countOwnedOfType(s, board, pid, 'transit'));
  return def.price * (countOwnedOfType(s, board, pid, 'utility') ? 1.1 : 0.75);
}

export function unownedCount(s: BaseState): number {
  const board = boardOf(s);
  return s.tiles.filter((t, i) => !t.owner && ownableDef(board, i)).length;
}
