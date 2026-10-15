/**
 * Small seeded PRNG (sfc32) with a cyrb128 seed hash. The generator state is
 * stored inside the game state, so seed + intents replays a match exactly and
 * a room restored from storage continues the same sequence.
 */
export type RngState = [number, number, number, number];

export function seedRng(seed: string): RngState {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < seed.length; i++) {
    const k = seed.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  const state: RngState = [(h1 ^ h2 ^ h3 ^ h4) >>> 0, (h2 ^ h1) >>> 0, (h3 ^ h1) >>> 0, (h4 ^ h1) >>> 0];
  for (let i = 0; i < 15; i++) nextUint32(state);
  return state;
}

/** Advances the state in place and returns a uint32. */
export function nextUint32(s: RngState): number {
  let [a, b, c, d] = s;
  a >>>= 0;
  b >>>= 0;
  c >>>= 0;
  d >>>= 0;
  let t = (a + b) | 0;
  a = b ^ (b >>> 9);
  b = (c + (c << 3)) | 0;
  c = (c << 21) | (c >>> 11);
  d = (d + 1) | 0;
  t = (t + d) | 0;
  c = (c + t) | 0;
  s[0] = a >>> 0;
  s[1] = b >>> 0;
  s[2] = c >>> 0;
  s[3] = d >>> 0;
  return t >>> 0;
}

/** Unbiased integer in [0, n). */
export function randInt(s: RngState, n: number): number {
  if (n <= 1) return 0;
  const limit = 0x100000000 - (0x100000000 % n);
  let x = nextUint32(s);
  while (x >= limit) x = nextUint32(s);
  return x % n;
}

/** Fisher–Yates shuffle, in place. */
export function shuffle<T>(s: RngState, arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randInt(s, i + 1);
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }
  return arr;
}

/** A float in [0, 1) for non-game randomness such as bot jitter. */
export function randFloat(s: RngState): number {
  return nextUint32(s) / 0x100000000;
}
