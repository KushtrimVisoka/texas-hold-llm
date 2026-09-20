/**
 * Where each seat pod sits, as a percentage of the table box.
 *
 * Slot 0 is always the point-of-view player at the bottom; the rest run clockwise.
 * Shared by the React table and the satori renderer so the agent's picture and the
 * human's screen always agree on who sits where.
 *
 * Hole cards are drawn directly above each pod and chips out on the felt in front of
 * it, so the vertical bands have to stay clear of each other: top seats sit at 18%,
 * the pot sits around 30%, the board at the middle, and bet chips at 62%.
 */
export interface SeatSlot {
  x: number;
  y: number;
  /** Where this seat's chips land once committed. */
  chips: { x: number; y: number };
}

const BOTTOM: SeatSlot = { x: 50, y: 88, chips: { x: 50, y: 62 } };

const LAYOUTS: Record<number, SeatSlot[]> = {
  2: [BOTTOM, { x: 50, y: 18, chips: { x: 64, y: 33 } }],
  3: [
    BOTTOM,
    { x: 25, y: 20, chips: { x: 37, y: 34 } },
    { x: 75, y: 20, chips: { x: 63, y: 34 } },
  ],
  4: [
    BOTTOM,
    { x: 15, y: 50, chips: { x: 30, y: 56 } },
    { x: 50, y: 18, chips: { x: 64, y: 33 } },
    { x: 85, y: 50, chips: { x: 70, y: 56 } },
  ],
  5: [
    BOTTOM,
    { x: 15, y: 50, chips: { x: 30, y: 56 } },
    { x: 29, y: 18, chips: { x: 38, y: 33 } },
    { x: 71, y: 18, chips: { x: 62, y: 33 } },
    { x: 85, y: 50, chips: { x: 70, y: 56 } },
  ],
  6: [
    BOTTOM,
    { x: 14, y: 62, chips: { x: 30, y: 62 } },
    { x: 15, y: 26, chips: { x: 31, y: 38 } },
    { x: 50, y: 18, chips: { x: 64, y: 33 } },
    { x: 85, y: 26, chips: { x: 69, y: 38 } },
    { x: 86, y: 62, chips: { x: 70, y: 62 } },
  ],
};

export function seatLayout(count: number): SeatSlot[] {
  return LAYOUTS[count] ?? LAYOUTS[6].slice(0, Math.max(2, count));
}

/** Rotates the table so `pov` is in slot 0 (the bottom seat). */
export function slotFor(seat: number, pov: number, count: number): number {
  return (seat - pov + count) % count;
}
