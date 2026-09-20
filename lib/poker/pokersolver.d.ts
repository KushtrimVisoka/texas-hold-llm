declare module 'pokersolver' {
  export class Hand {
    static solve(cards: string[]): Hand;
    static winners(hands: Hand[]): Hand[];
    name: string;
    descr: string;
    cards: { toString(): string }[];
    seat?: number;
  }
  const _default: { Hand: typeof Hand };
  export default _default;
}
