/** Player pieces. None of them match classic tabletop pieces (PRD 11.2). */
export const TOKENS = [
  'rocket',
  'scooter',
  'boba',
  'robot',
  'plane',
  'sneaker',
  'cactus',
  'balloon',
] as const;
export type TokenId = (typeof TOKENS)[number];

/** Seat colours: distinct hues that stay readable on the dark table. */
export const PLAYER_COLORS = ['#FF6B6B', '#4DABF7', '#FFD43B', '#69DB7C', '#DA77F2', '#FF922B'] as const;
