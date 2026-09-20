import { describe, expect, it } from 'vitest';
import { nextButton, reduce, startHand, type StartHandInput } from '../lib/poker/dealer';
import { legalActions } from '../lib/poker/legal';
import { playerAt, type Action, type HandState } from '../lib/poker/state';
import { shuffled } from '../lib/poker/cards';

const BLINDS = { sb: 100, bb: 200 };

function hand(overrides: Partial<StartHandInput> = {}, stacks = [20_000, 20_000]): HandState {
  return startHand({
    handId: 'h1',
    matchId: 'm1',
    handNo: 1,
    seed: 42,
    button: 0,
    blinds: BLINDS,
    seats: stacks.map((stack, i) => ({
      seat: i,
      name: i === 0 ? 'You' : `Bot${i}`,
      kind: i === 0 ? ('human' as const) : ('agent' as const),
      avatar: 'human',
      stack,
    })),
    ...overrides,
  });
}

const play = (s: HandState, ...actions: Action[]) => actions.reduce(reduce, s);

describe('deck', () => {
  it('is deterministic per seed and has 52 unique cards', () => {
    const a = shuffled(7);
    const b = shuffled(7);
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(52);
    expect(shuffled(8)).not.toEqual(a);
  });
});

describe('heads-up setup', () => {
  it('button posts the small blind and acts first preflop', () => {
    const s = hand();
    expect(playerAt(s, 0).committed).toBe(100); // button = SB
    expect(playerAt(s, 1).committed).toBe(200); // other = BB
    expect(s.toAct).toBe(0);
    expect(s.pot).toBe(300);
  });

  it('deals two distinct hole cards to each seat', () => {
    const s = hand();
    const all = s.players.flatMap((p) => p.hole!);
    expect(all).toHaveLength(4);
    expect(new Set(all).size).toBe(4);
  });

  it('button acts last postflop', () => {
    let s = hand();
    s = play(s, { type: 'call', seat: 0 }, { type: 'check', seat: 1 });
    expect(s.stage).toBe('flop');
    expect(s.toAct).toBe(1); // non-button acts first postflop
  });
});

describe('big blind option', () => {
  it('lets the big blind check or raise after a limp', () => {
    const s = play(hand(), { type: 'call', seat: 0 });
    expect(s.stage).toBe('preflop');
    expect(s.toAct).toBe(1);
    const la = legalActions(s);
    expect(la.check).toBe(true);
    expect(la.fold).toBe(false); // nothing to call, so folding is hidden
    expect(la.raise).toEqual({ min: 400, max: 20_000 });
  });
});

describe('min-raise', () => {
  it('requires at least the previous increment', () => {
    const s = hand();
    expect(legalActions(s).raise).toEqual({ min: 400, max: 20_000 });
    const raised = play(s, { type: 'raise', seat: 0, to: 600 });
    // increment was 400, so the next raise must reach 1000
    expect(legalActions(raised).raise).toEqual({ min: 1_000, max: 20_000 });
  });

  it('rejects a raise below the minimum', () => {
    const s = hand();
    expect(() => reduce(s, { type: 'raise', seat: 0, to: 300 })).toThrow(/outside/);
  });

  it('rejects action out of turn', () => {
    const s = hand();
    expect(() => reduce(s, { type: 'check', seat: 1 })).toThrow(/out of turn/);
  });
});

describe('all-in for less', () => {
  it('does not reopen betting for a player who already acted', () => {
    // Seat 2 is short and can only make a partial raise over seat 0's bet.
    let s = hand({ button: 0 }, [20_000, 20_000, 1_500]);
    // 3-handed: SB=1, BB=2, action starts at 0
    expect(s.toAct).toBe(0);
    s = play(s, { type: 'raise', seat: 0, to: 1_000 }); // full raise, increment 800
    s = play(s, { type: 'call', seat: 1 });
    // Seat 2 has 1500 total, already posted 200 -> max raise-to is 1500, increment 500 < 800
    const la = legalActions(s);
    expect(la.raise).toEqual({ min: 1_500, max: 1_500 }); // short all-in only
    s = play(s, { type: 'raise', seat: 2, to: 1_500 });

    expect(playerAt(s, 2).allIn).toBe(true);
    // The short all-in must not raise the minimum increment for everyone else.
    expect(s.lastRaiseSize).toBe(800);
    // Seat 0 owes 500 more and may act, but may not re-raise.
    expect(s.toAct).toBe(0);
    expect(legalActions(s).call).toEqual({ amount: 500 });
  });
});

describe('street progression', () => {
  it('walks preflop -> flop -> turn -> river with the right board sizes', () => {
    let s = hand();
    s = play(s, { type: 'call', seat: 0 }, { type: 'check', seat: 1 });
    expect([s.stage, s.board.length]).toEqual(['flop', 3]);
    s = play(s, { type: 'check', seat: 1 }, { type: 'check', seat: 0 });
    expect([s.stage, s.board.length]).toEqual(['turn', 4]);
    s = play(s, { type: 'check', seat: 1 }, { type: 'check', seat: 0 });
    expect([s.stage, s.board.length]).toEqual(['river', 5]);
    s = play(s, { type: 'check', seat: 1 }, { type: 'check', seat: 0 });
    expect(s.stage).toBe('complete');
    expect(s.revealed).toHaveLength(2);
  });

  it('runs the board out with no betting once players are all-in', () => {
    let s = hand({}, [20_000, 20_000]);
    s = play(s, { type: 'raise', seat: 0, to: 20_000 }, { type: 'call', seat: 1 });
    expect(s.stage).toBe('complete');
    expect(s.board).toHaveLength(5);
  });
});

describe('pot resolution', () => {
  it('awards the whole pot when everyone folds', () => {
    const s = play(hand(), { type: 'fold', seat: 0 });
    expect(s.stage).toBe('complete');
    expect(s.awards).toEqual([{ seat: 1, name: 'Bot1', amount: 300 }]);
    expect(playerAt(s, 1).stack).toBe(20_100);
    expect(s.revealed).toHaveLength(0); // no showdown, cards stay hidden
  });

  it('conserves chips across a full hand', () => {
    const start = hand();
    const total = start.players.reduce((n, p) => n + p.stack, 0) + start.pot;
    const end = play(start, { type: 'raise', seat: 0, to: 20_000 }, { type: 'call', seat: 1 });
    const after = end.players.reduce((n, p) => n + p.stack, 0);
    expect(after).toBe(total);
  });

  it('builds side pots so a short stack cannot win chips it never covered', () => {
    // Seat 2 is all-in for 1500; seats 0 and 1 keep betting into a side pot.
    let s = hand({ button: 0 }, [20_000, 20_000, 1_500]);
    s = play(s, { type: 'raise', seat: 0, to: 5_000 });
    s = play(s, { type: 'call', seat: 1 });
    s = play(s, { type: 'call', seat: 2 }); // all-in for its last 1300
    expect(playerAt(s, 2).allIn).toBe(true);
    expect(playerAt(s, 2).totalCommitted).toBe(1_500);

    const total = s.players.reduce((n, p) => n + p.stack, 0) + s.pot;
    while (s.stage !== 'complete') {
      s = reduce(s, { type: 'check', seat: s.toAct });
    }
    expect(s.players.reduce((n, p) => n + p.stack, 0)).toBe(total);

    // Seat 2 can win at most 3 * 1500 = 4500; the rest belongs to the side pot.
    const seat2 = s.awards.find((a) => a.seat === 2);
    if (seat2) expect(seat2.amount).toBeLessThanOrEqual(4_500);
  });
});

describe('button rotation', () => {
  it('skips busted seats', () => {
    const s = hand({}, [20_000, 20_000, 0]);
    expect(nextButton({ ...s, button: 1 })).toBe(0);
  });
});
