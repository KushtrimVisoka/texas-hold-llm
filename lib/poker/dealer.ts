import { shuffled, type Card } from './cards';
import { describeIllegal, isLegal } from './legal';
import {
  actableSeats,
  liveSeats,
  playerAt,
  type Action,
  type HandState,
  type LogEntry,
  type Player,
  type Stage,
} from './state';
import { distribute } from './showdown';

export interface SeatConfig {
  seat: number;
  name: string;
  kind: Player['kind'];
  avatar: string;
  stack: number;
}

export interface StartHandInput {
  handId: string;
  matchId: string;
  handNo: number;
  seed: number;
  seats: SeatConfig[];
  button: number;
  blinds: { sb: number; bb: number };
}

/* ------------------------------------------------------------------ seating */

const occupied = (p: Player) => !p.busted;

/** Next seat clockwise from `from` (exclusive) matching `pred`. */
function nextSeat(s: HandState, from: number, pred: (p: Player) => boolean): number {
  const n = s.players.length;
  for (let i = 1; i <= n; i++) {
    const p = s.players[(from + i) % n];
    if (pred(p)) return p.seat;
  }
  return from;
}

const nextOccupied = (s: HandState, from: number) => nextSeat(s, from, occupied);
const nextActable = (s: HandState, from: number) =>
  nextSeat(s, from, (p) => occupied(p) && !p.folded && !p.allIn);

/* --------------------------------------------------------------- start hand */

export function startHand(input: StartHandInput): HandState {
  const deck = shuffled(input.seed);

  const players: Player[] = input.seats.map((c) => ({
    seat: c.seat,
    name: c.name,
    kind: c.kind,
    avatar: c.avatar,
    stack: c.stack,
    committed: 0,
    totalCommitted: 0,
    hole: null,
    folded: c.stack <= 0,
    allIn: false,
    hasActed: false,
    mayReraise: true,
    busted: c.stack <= 0,
  }));

  const s: HandState = {
    handId: input.handId,
    matchId: input.matchId,
    handNo: input.handNo,
    seed: input.seed,
    deck,
    board: [],
    stage: 'preflop',
    players,
    button: input.button,
    toAct: input.button,
    currentBet: 0,
    lastRaiseSize: input.blinds.bb,
    pot: 0,
    finalPot: 0,
    blinds: input.blinds,
    log: [],
    awards: [],
    revealed: [],
  };

  const seated = players.filter(occupied);
  if (seated.length < 2) throw new Error('need at least two funded seats to start a hand');

  // Heads-up inverts the blinds: the button posts the small blind and acts first preflop,
  // then acts LAST on every later street. Three-handed and up uses the normal order.
  const headsUp = seated.length === 2;
  const sbSeat = headsUp ? s.button : nextOccupied(s, s.button);
  const bbSeat = nextOccupied(s, sbSeat);

  post(s, sbSeat, s.blinds.sb);
  post(s, bbSeat, s.blinds.bb);

  s.currentBet = s.blinds.bb;
  s.lastRaiseSize = s.blinds.bb;

  // Deal one card at a time around the table, starting left of the button.
  const dealt = new Map<number, Card[]>(seated.map((p) => [p.seat, []]));
  for (let round = 0; round < 2; round++) {
    let seat = nextOccupied(s, s.button);
    for (let i = 0; i < seated.length; i++) {
      dealt.get(seat)!.push(s.deck.pop() as Card);
      seat = nextOccupied(s, seat);
    }
  }
  for (const p of seated) {
    const [a, b] = dealt.get(p.seat)!;
    p.hole = [a, b];
  }

  // Preflop action starts left of the big blind (which IS the button, heads-up).
  s.toAct = headsUp ? s.button : nextActable(s, bbSeat);

  return s;
}

function post(s: HandState, seat: number, amount: number) {
  const p = playerAt(s, seat);
  const paid = Math.min(amount, p.stack);
  commit(p, paid);
  s.pot += paid;
  s.log.push({
    seq: s.log.length,
    seat,
    name: p.name,
    stage: 'preflop',
    action: 'call',
    amount: paid,
    potAfter: s.pot,
    text: `${p.name} ${verb(p.name, 'posts', 'post')} the ${
      amount === s.blinds.sb ? 'small' : 'big'
    } blind (${fmt(paid)}).`,
  });
}

function commit(p: Player, amount: number) {
  p.stack -= amount;
  p.committed += amount;
  p.totalCommitted += amount;
  if (p.stack === 0) p.allIn = true;
}

/* ------------------------------------------------------------------- reduce */

/**
 * The only function permitted to mutate a hand. Pure: no I/O, no ambient randomness
 * (the deck comes from `seed`), so any hand replays exactly from its action log.
 */
export function reduce(state: HandState, a: Action): HandState {
  if (state.stage === 'complete' || state.stage === 'showdown') {
    throw new Error('hand is already over');
  }
  if (!isLegal(state, a)) throw new Error(describeIllegal(state, a));

  const s: HandState = structuredClone(state);
  const p = playerAt(s, a.seat);
  let moved = 0;
  let text = '';

  switch (a.type) {
    case 'fold':
      p.folded = true;
      text = `${p.name} ${verb(p.name, 'folds', 'fold')}.`;
      break;

    case 'check':
      text = `${p.name} ${verb(p.name, 'checks', 'check')}.`;
      break;

    case 'call': {
      moved = Math.min(s.currentBet - p.committed, p.stack);
      commit(p, moved);
      s.pot += moved;
      const calls = verb(p.name, 'calls', 'call');
      text = p.allIn
        ? `${p.name} ${calls} all-in (${fmt(moved)}).`
        : `${p.name} ${calls} ${fmt(moved)}.`;
      break;
    }

    case 'raise': {
      const wasOpen = s.currentBet === 0;
      moved = a.to - p.committed;
      const increment = a.to - s.currentBet;
      commit(p, moved);
      s.pot += moved;

      // A raise smaller than the last full increment (only possible as a short all-in)
      // does not reopen betting for players who have already acted.
      const fullRaise = increment >= s.lastRaiseSize;
      if (fullRaise) s.lastRaiseSize = increment;
      s.currentBet = a.to;

      for (const q of s.players) {
        if (q.seat === a.seat || q.folded || q.allIn) continue;
        if (fullRaise) {
          q.hasActed = false;
          q.mayReraise = true;
        } else if (q.committed < s.currentBet) {
          // Still owes chips, so must act again — but may not re-raise.
          q.hasActed = false;
        }
      }
      p.mayReraise = false;

      const word = p.allIn
        ? verb(p.name, 'goes all-in', 'go all-in')
        : wasOpen
          ? verb(p.name, 'bets', 'bet')
          : verb(p.name, 'raises to', 'raise to');
      text = p.allIn ? `${p.name} ${word} (${fmt(a.to)}).` : `${p.name} ${word} ${fmt(a.to)}.`;
      break;
    }
  }

  p.hasActed = true;
  s.log.push({
    seq: s.log.length,
    seat: a.seat,
    name: p.name,
    stage: state.stage,
    action: a.type,
    amount: moved,
    potAfter: s.pot,
    text,
  });

  return advance(s);
}

/* ------------------------------------------------- street / round machinery */

const STREETS: Record<string, { next: Stage; cards: number }> = {
  preflop: { next: 'flop', cards: 3 },
  flop: { next: 'turn', cards: 1 },
  turn: { next: 'river', cards: 1 },
};

function advance(s: HandState): HandState {
  // Everyone folded to one player: hand ends immediately, no cards shown.
  const live = liveSeats(s);
  if (live.length === 1) return settle(s, false);

  const roundClosed = live.every(
    (p) => p.allIn || (p.hasActed && p.committed === s.currentBet),
  );
  if (!roundClosed) {
    s.toAct = nextActable(s, s.toAct);
    return s;
  }

  // Round closed — sweep committed chips and move to the next street.
  for (const p of s.players) {
    p.committed = 0;
    p.hasActed = false;
    p.mayReraise = true;
  }
  s.currentBet = 0;
  s.lastRaiseSize = s.blinds.bb;

  if (s.stage === 'river') return settle(s, true);

  const street = STREETS[s.stage];
  s.stage = street.next;
  for (let i = 0; i < street.cards; i++) s.board.push(s.deck.pop() as Card);

  // Fewer than two players can still act: run the remaining board out with no betting.
  if (actableSeats(s).length < 2) return advance(s);

  // Postflop, action starts left of the button (the big blind, heads-up).
  s.toAct = nextActable(s, s.button);
  return s;
}

function settle(s: HandState, showdown: boolean): HandState {
  s.stage = 'showdown';
  const live = liveSeats(s);

  if (showdown && live.length > 1) {
    s.revealed = live.map((p) => p.seat);
  }

  s.finalPot = s.pot;
  s.awards = distribute(s);
  // Chips leave the pot and land in stacks, so the pot must drop to zero or the
  // same chips are counted twice by anything summing the table.
  s.pot = 0;
  for (const award of s.awards) {
    playerAt(s, award.seat).stack += award.amount;
    s.log.push({
      seq: s.log.length,
      seat: award.seat,
      name: award.name,
      stage: 'showdown',
      action: 'check',
      amount: award.amount,
      potAfter: 0,
      text: award.handName
        ? `${award.name} ${verb(award.name, 'wins', 'win')} ${fmt(award.amount)} with ${award.handName}.`
        : `${award.name} ${verb(award.name, 'wins', 'win')} ${fmt(award.amount)}.`,
    });
  }

  s.stage = 'complete';
  s.toAct = -1;
  return s;
}

/* -------------------------------------------------------------------- misc */

/** "You fold" / "Claude folds" — the human seat takes the second person. */
function verb(name: string, thirdPerson: string, secondPerson: string): string {
  return name === 'You' ? secondPerson : thirdPerson;
}

export function fmt(n: number): string {
  return n.toLocaleString('en-US');
}

/** Button moves to the next seat that still has chips. */
export function nextButton(s: HandState): number {
  const n = s.players.length;
  for (let i = 1; i <= n; i++) {
    const p = s.players[(s.button + i) % n];
    if (p.stack > 0) return p.seat;
  }
  return s.button;
}

export type { LogEntry };
