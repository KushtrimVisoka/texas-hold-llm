import type { Card } from './cards';

export type Stage = 'preflop' | 'flop' | 'turn' | 'river' | 'showdown' | 'complete';
export type PlayerKind = 'human' | 'agent';

export interface Player {
  seat: number;
  name: string;
  kind: PlayerKind;
  /** Visual identity for the seat pod: matches a key in components/avatars. */
  avatar: string;
  stack: number;
  /** Chips committed in the CURRENT betting round. */
  committed: number;
  /** Chips committed across the whole hand — drives side-pot tiers. */
  totalCommitted: number;
  hole: [Card, Card] | null;
  folded: boolean;
  allIn: boolean;
  /** Has acted since the last aggressive action in this round. */
  hasActed: boolean;
  /**
   * False once this player has acted and only a SHORT all-in has come back to them.
   * A raise below a full increment does not reopen the betting, so they may call or
   * fold but not re-raise.
   */
  mayReraise: boolean;
  /** Out of chips between hands — seat stays visible but sits out. */
  busted: boolean;
}

export type Action =
  | { type: 'fold'; seat: number }
  | { type: 'check'; seat: number }
  | { type: 'call'; seat: number }
  /** `to` is the TOTAL committed this round after the raise (raise-TO, not raise-by). */
  | { type: 'raise'; seat: number; to: number };

export type ActionType = Action['type'];

export interface LogEntry {
  seq: number;
  seat: number;
  name: string;
  stage: Stage;
  action: ActionType;
  /** Chips moved by this action. */
  amount: number;
  potAfter: number;
  text: string;
}

export interface PotAward {
  seat: number;
  name: string;
  amount: number;
  /** Absent when everyone else folded. */
  handName?: string;
  cards?: Card[];
}

export interface HandState {
  handId: string;
  matchId: string;
  handNo: number;
  seed: number;
  deck: Card[];
  board: Card[];
  stage: Stage;
  players: Player[];
  button: number;
  toAct: number;
  currentBet: number;
  /** Size of the last raise — the minimum increment for the next one. */
  lastRaiseSize: number;
  pot: number;
  /** The pot as it stood at showdown; `pot` itself drops to zero once chips are paid out. */
  finalPot: number;
  blinds: { sb: number; bb: number };
  log: LogEntry[];
  awards: PotAward[];
  /** Seats whose cards are face-up at showdown. */
  revealed: number[];
}

export const liveSeats = (s: HandState) => s.players.filter((p) => !p.folded && !p.busted);
export const actableSeats = (s: HandState) => liveSeats(s).filter((p) => !p.allIn);
export const playerAt = (s: HandState, seat: number) => {
  const p = s.players.find((q) => q.seat === seat);
  if (!p) throw new Error(`no player at seat ${seat}`);
  return p;
};
