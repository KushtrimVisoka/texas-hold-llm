import { describe, expect, it } from 'vitest';
import { startHand } from '../lib/poker/dealer';
import { renderTable } from '../lib/agent/render';
import { reduce } from '../lib/poker/dealer';
import { legalActions } from '../lib/poker/legal';
import type { HandState } from '../lib/poker/state';

function table(n: number): HandState {
  return startHand({
    handId: 'r1',
    matchId: 'm1',
    handNo: 1,
    seed: 99,
    button: 0,
    blinds: { sb: 100, bb: 200 },
    seats: Array.from({ length: n }, (_, i) => ({
      seat: i,
      name: i === 0 ? 'You' : ['Claude', 'GPT', 'Gemini', 'Llama'][i - 1],
      kind: i === 0 ? ('human' as const) : ('agent' as const),
      avatar: i === 0 ? 'human' : ['claude', 'gpt', 'gemini', 'llama'][i - 1],
      stack: 30_000,
    })),
  });
}

describe('table render', () => {
  it('produces a PNG for a heads-up table', async () => {
    const png = await renderTable(table(2), 1);
    expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    expect(png.length).toBeGreaterThan(5_000);
  });

  it('never draws another seat’s hole cards', async () => {
    // Rendering from seat 1's POV must not differ when seat 0's cards change,
    // because seat 0 is drawn face-down.
    const s = table(2);
    const a = await renderTable(s, 1);
    const swapped: HandState = structuredClone(s);
    swapped.players[0].hole = ['As', 'Ad'];
    const b = await renderTable(swapped, 1);
    expect(a.equals(b)).toBe(true);
  });

  it('renders a five-handed table with a board', async () => {
    let s = table(5);
    // Limp the whole table in so the flop comes out.
    while (s.stage === 'preflop') {
      const la = legalActions(s);
      s = reduce(s, la.check ? { type: 'check', seat: s.toAct } : { type: 'call', seat: s.toAct });
    }
    expect(s.board).toHaveLength(3);
    const png = await renderTable(s, 1);
    expect(png.length).toBeGreaterThan(5_000);
  });
});
