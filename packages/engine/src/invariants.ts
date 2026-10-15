import { boardOf, buildingsOnBoard, findPlayer, groupLevels, hotelLevel, ownableDef } from './helpers';
import type { GameState } from './types';

/**
 * Rules that must hold after every intent (PRD 13.1). Returns a list of
 * violations; empty means healthy. Run by tests, fuzzing and the bot simulator.
 */
export function checkInvariants(s: GameState): string[] {
  const errs: string[] = [];
  const board = boardOf(s);
  const h = hotelLevel(s);

  const onBoard = buildingsOnBoard(s);
  if (onBoard.houses + s.bank.houses !== s.settings.totalHouses)
    errs.push(`houses: ${onBoard.houses} on board + ${s.bank.houses} in bank != ${s.settings.totalHouses}`);
  if (onBoard.hotels + s.bank.hotels !== s.settings.totalHotels)
    errs.push(`hotels: ${onBoard.hotels} on board + ${s.bank.hotels} in bank != ${s.settings.totalHotels}`);
  if (s.bank.houses < 0 || s.bank.hotels < 0) errs.push('bank stock negative');

  for (const p of s.players) {
    if (!Number.isSafeInteger(p.cash) || p.cash < 0) errs.push(`${p.id} cash ${p.cash}`);
    if (p.position < 0 || p.position >= board.size) errs.push(`${p.id} position ${p.position}`);
    if (p.status === 'bankrupt' && (p.cash !== 0 || p.bailPasses.length > 0)) errs.push(`${p.id} bankrupt but holds assets`);
  }

  s.tiles.forEach((t, i) => {
    const def = ownableDef(board, i);
    if (!def) {
      if (t.owner || t.level || t.mortgaged) errs.push(`tile ${i} is not ownable but has state`);
      return;
    }
    if (t.owner) {
      const owner = findPlayer(s, t.owner);
      if (!owner || owner.status !== 'active') errs.push(`tile ${i} owned by inactive ${t.owner}`);
    } else if (t.level || t.mortgaged) errs.push(`bank tile ${i} has buildings or mortgage`);
    if (t.level < 0 || t.level > h) errs.push(`tile ${i} level ${t.level}`);
    if (def.type !== 'property' && t.level > 0) errs.push(`tile ${i} non-property with buildings`);
    if (t.mortgaged && t.level > 0) errs.push(`tile ${i} mortgaged with buildings`);
  });

  for (const g of Object.values(board.groups)) {
    const levels = groupLevels(s, board, g.id);
    const built = levels.some((l) => l > 0);
    if (!built) continue;
    const owners = new Set(g.tiles.map((i) => s.tiles[i]!.owner));
    if (owners.size !== 1 || owners.has(null)) errs.push(`group ${g.id} built without single owner`);
    if (g.tiles.some((i) => s.tiles[i]!.mortgaged)) errs.push(`group ${g.id} built with a mortgage`);
    if (s.settings.evenBuild && Math.max(...levels) - Math.min(...levels) > 1)
      errs.push(`group ${g.id} uneven: ${levels.join(',')}`);
  }

  // One Bail Pass per deck, either in the deck or in a hand.
  for (const deck of ['fortune', 'community'] as const) {
    const bail = board.decks[deck].findIndex((c) => c.effect.kind === 'bailPass');
    const inDeck = s.decks[deck].filter((c) => c === bail).length;
    const inHands = s.players.reduce((n, p) => n + p.bailPasses.filter((d) => d === deck).length, 0);
    if (inDeck + inHands !== 1) errs.push(`${deck} bail pass count ${inDeck}+${inHands}`);
    const others = s.decks[deck].filter((c) => c !== bail);
    if (others.length !== board.decks[deck].length - 1 || new Set(others).size !== others.length)
      errs.push(`${deck} deck corrupted`);
  }

  const phase = s.turn.phase;
  if (phase === 'RAISE_FUNDS' && s.debts.length === 0) errs.push('RAISE_FUNDS without debt');
  if (phase === 'AUCTION' && !s.auction) errs.push('AUCTION without auction');
  if (phase !== 'AUCTION' && s.auction) errs.push(`auction open in ${phase}`);
  if (phase === 'BUY_DECISION' && s.turn.pendingBuy === null) errs.push('BUY_DECISION without tile');
  if (phase !== 'GAME_OVER') {
    const cur = findPlayer(s, s.turn.playerId);
    if (!cur) errs.push('current player missing');
    else if (cur.status !== 'active' && phase !== 'AUCTION' && phase !== 'RAISE_FUNDS')
      errs.push(`current player ${cur.id} bankrupt in ${phase}`);
    if (phase !== 'RAISE_FUNDS' && s.debts.length > 0) errs.push(`debts pending in ${phase}`);
  }
  for (const t of s.trades) {
    const a = findPlayer(s, t.fromId);
    const b = findPlayer(s, t.toId);
    if (!a || !b || a.status !== 'active' || b.status !== 'active') errs.push(`trade ${t.id} with inactive player`);
  }
  return errs;
}
