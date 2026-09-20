import type { Card } from './cards';
import { type HandState, type PotAward, playerAt } from './state';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import pokersolver from 'pokersolver';

const { Hand } = pokersolver as unknown as {
  Hand: {
    solve(cards: string[]): SolvedHand;
    winners(hands: SolvedHand[]): SolvedHand[];
  };
};

interface SolvedHand {
  name: string;
  descr: string;
  cards: { toString(): string }[];
  /** We tag each solved hand so winners() results map back to a seat. */
  seat?: number;
}

export interface Evaluated {
  seat: number;
  name: string;
  descr: string;
  cards: Card[];
}

export function evaluate(hole: [Card, Card], board: Card[]): Omit<Evaluated, 'seat'> {
  const h = Hand.solve([...hole, ...board]);
  return {
    name: h.name,
    descr: h.descr,
    cards: h.cards.map((c) => normalize(c.toString())),
  };
}

/** pokersolver prints 10s as "T" already, but strips nothing else; keep the cast honest. */
function normalize(s: string): Card {
  return s.replace('10', 'T').trim() as Card;
}

/**
 * Side pots from contribution tiers.
 *
 * Every distinct `totalCommitted` opens a tier. Each tier's chips are contested only by
 * players who paid into it and are still live, so a short stack can never win chips it
 * never covered.
 */
export function distribute(s: HandState): PotAward[] {
  const contributors = s.players.filter((p) => p.totalCommitted > 0);
  const live = s.players.filter((p) => !p.folded && p.totalCommitted > 0);

  // Everyone folded to one player — no showdown, they take the pot uncontested.
  if (live.length === 1) {
    return [{ seat: live[0].seat, name: live[0].name, amount: s.pot }];
  }

  const solved = new Map<number, Omit<Evaluated, 'seat'>>();
  for (const p of live) {
    if (p.hole) solved.set(p.seat, evaluate(p.hole, s.board));
  }

  const tiers = [...new Set(contributors.map((p) => p.totalCommitted))].sort((a, b) => a - b);
  const awards = new Map<number, PotAward>();
  let prev = 0;

  for (const tier of tiers) {
    const paidIn = contributors.filter((p) => p.totalCommitted >= tier);
    const amount = (tier - prev) * paidIn.length;
    prev = tier;
    if (amount === 0) continue;

    const eligible = paidIn.filter((p) => !p.folded && solved.has(p.seat));
    if (eligible.length === 0) continue;

    const hands = eligible.map((p) => {
      const h = Hand.solve([...(p.hole as [Card, Card]), ...s.board]) as SolvedHand;
      h.seat = p.seat;
      return h;
    });
    const winners = Hand.winners(hands);

    // Odd chips go to the first winner left of the button, as at a real table.
    const share = Math.floor(amount / winners.length);
    let remainder = amount - share * winners.length;
    const ordered = [...winners].sort(
      (a, b) => seatOrder(s, a.seat as number) - seatOrder(s, b.seat as number),
    );

    for (const w of ordered) {
      const seat = w.seat as number;
      const p = playerAt(s, seat);
      const ev = solved.get(seat)!;
      const extra = remainder > 0 ? 1 : 0;
      remainder -= extra;
      const existing = awards.get(seat);
      if (existing) {
        existing.amount += share + extra;
      } else {
        awards.set(seat, {
          seat,
          name: p.name,
          amount: share + extra,
          handName: ev.descr,
          cards: ev.cards,
        });
      }
    }
  }

  return [...awards.values()];
}

/** Distance clockwise from the button — used for odd-chip order. */
function seatOrder(s: HandState, seat: number): number {
  const n = s.players.length;
  return (seat - s.button + n) % n;
}
