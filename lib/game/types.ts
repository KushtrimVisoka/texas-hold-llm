import type { LegalActions } from '../poker/legal';
import type { Card } from '../poker/cards';
import type { HandState, Player } from '../poker/state';

export type { LegalActions };

export interface AgentEvent {
  seat: number;
  name: string;
  tool: string;
  thinking?: string;
  tableTalk?: string;
  amount?: number;
  clamped: boolean;
  fallbackReason: string | null;
  latencyMs: number;
  renderPath: string | null;
}

export type SeatView = Omit<Player, 'hole'> & { hole: Card[] | null; isYou: boolean };

export interface GameView {
  matchId: string;
  handId: string;
  handNo: number;
  stage: HandState['stage'];
  board: Card[];
  pot: number;
  button: number;
  toAct: number;
  blinds: { sb: number; bb: number };
  players: SeatView[];
  legal: LegalActions;
  log: HandState['log'];
  awards: HandState['awards'];
  agentEvents: AgentEvent[];
  canDeal: boolean;
  matchOver: boolean;
}
