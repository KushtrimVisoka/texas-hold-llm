export const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'] as const;
export const SUITS = ['s', 'h', 'd', 'c'] as const;

export type Rank = (typeof RANKS)[number];
export type Suit = (typeof SUITS)[number];
export type Card = `${Rank}${Suit}`;

export const rankOf = (c: Card) => c[0] as Rank;
export const suitOf = (c: Card) => c[1] as Suit;

/** Deterministic PRNG. Same seed always produces the same deck. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function freshDeck(): Card[] {
  const deck: Card[] = [];
  for (const r of RANKS) for (const s of SUITS) deck.push(`${r}${s}` as Card);
  return deck;
}

/** Fisher-Yates driven by the seeded PRNG, so a hand replays exactly from its seed. */
export function shuffled(seed: number): Card[] {
  const deck = freshDeck();
  const rng = mulberry32(seed);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

const SUIT_GLYPH: Record<Suit, string> = { s: '♠', h: '♥', d: '♦', c: '♣' };
export const glyphOf = (c: Card) => SUIT_GLYPH[suitOf(c)];
export const isRed = (c: Card) => suitOf(c) === 'h' || suitOf(c) === 'd';
export const cardText = (c: Card) => `${rankOf(c)}${glyphOf(c)}`;
