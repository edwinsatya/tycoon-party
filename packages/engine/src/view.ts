import type { DeckId } from '@rollionaire/boards';
import type { BaseState } from './helpers';
import type { GameState } from './types';

/**
 * What clients (and bots) may see. The RNG state, balanced-dice order and card
 * order are secret: a modified client holding them could predict every roll and card.
 */
export type PublicGameState = BaseState & { deckSizes: Record<DeckId, number> };

export function toPublicState(s: GameState): PublicGameState {
  const { rng: _rng, diceDeck: _dice, decks, ...rest } = s;
  return {
    ...structuredClone(rest),
    deckSizes: { fortune: decks.fortune.length, community: decks.community.length },
  };
}
