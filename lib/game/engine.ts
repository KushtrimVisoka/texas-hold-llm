import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { nextButton, reduce, startHand } from '../poker/dealer';
import { legalActions, type LegalActions } from '../poker/legal';
import { playerAt, type Action, type HandState, type Player } from '../poker/state';
import { runAgentTurn } from '../agent/act';
import { avatarFor, displayName, modelId } from '../agent/model';
import {
  createMatch,
  getMatch,
  insertAgentDecision,
  insertHand,
  loadHand,
  saveHand,
  syncActions,
  updateMatch,
  handDecisions,
  type MatchRow,
  type SeatSpec,
} from '../db/repo';

// Resolved once to an absolute base so the bundler can scope it and the join below
// is a plain path under a known root rather than an arbitrary runtime path.
const RENDER_ROOT = path.resolve(process.env.RENDER_DIR ?? 'renders');
const HUMAN_SEAT = 0;

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

export interface GameView {
  matchId: string;
  handId: string;
  handNo: number;
  stage: HandState['stage'];
  board: HandState['board'];
  pot: number;
  button: number;
  toAct: number;
  blinds: HandState['blinds'];
  players: (Omit<Player, 'hole'> & { hole: HandState['board'] | null; isYou: boolean })[];
  legal: LegalActions;
  log: HandState['log'];
  awards: HandState['awards'];
  agentEvents: AgentEvent[];
  /** True when the hand is over and a new one can be dealt. */
  canDeal: boolean;
  matchOver: boolean;
}

/* ------------------------------------------------------------------- match */

/**
 * Every agent seat runs the same configured model, so they are named after it rather
 * than given borrowed brand names that would misrepresent who is actually playing.
 */
export function agentSeats(count: number, stack: number): SeatSpec[] {
  return Array.from({ length: count }, (_, i) => ({
    seat: i + 1,
    name: count === 1 ? displayName() : `${displayName()} ${i + 1}`,
    kind: 'agent' as const,
    avatar: avatarFor(),
    stack,
  }));
}

export const DEFAULT_SEATS: SeatSpec[] = [
  { seat: 0, name: 'You', kind: 'human', avatar: 'human', stack: 30_000 },
  ...agentSeats(1, 30_000),
];

export async function newMatch(opts?: {
  seats?: SeatSpec[];
  blinds?: { sb: number; bb: number };
}): Promise<GameView> {
  const match = createMatch({
    seats: opts?.seats ?? DEFAULT_SEATS,
    blinds: opts?.blinds ?? { sb: 100, bb: 200 },
    agentModel: modelId,
  });
  return dealHand(match);
}

export async function dealHand(match: MatchRow): Promise<GameView> {
  const seats = JSON.parse(match.seats_json) as SeatSpec[];

  if (seats.filter((s) => s.stack > 0).length < 2) {
    updateMatch(match.id, { status: 'complete' });
    const last = match.current_hand ? loadHand(match.current_hand) : null;
    if (last) return await viewOf(last, [], true);
    throw new Error('match is over');
  }

  const handNo = match.hand_no + 1;
  const state = startHand({
    handId: randomUUID(),
    matchId: match.id,
    handNo,
    // Seeded from the match id and hand number, so the whole match replays.
    seed: hashSeed(`${match.id}:${handNo}`),
    seats,
    button: nextButtonFor(match, seats),
    blinds: { sb: match.blinds_sb, bb: match.blinds_bb },
  });

  insertHand(state);
  updateMatch(match.id, { hand_no: handNo, current_hand: state.handId, button: state.button });

  return drain(state);
}

function nextButtonFor(match: MatchRow, seats: SeatSpec[]): number {
  const fake = {
    button: match.button,
    players: seats.map((s) => ({ seat: s.seat, stack: s.stack })),
  } as HandState;
  return nextButton(fake);
}

/* ------------------------------------------------------------------ actions */

export async function applyHumanAction(matchId: string, action: Action): Promise<GameView> {
  const match = getMatch(matchId);
  if (!match?.current_hand) throw new Error('no hand in progress');

  const state = loadHand(match.current_hand);
  if (!state) throw new Error('hand not found');
  if (state.stage === 'complete') throw new Error('hand is already over');

  const actor = playerAt(state, state.toAct);
  if (actor.kind !== 'human' || actor.seat !== HUMAN_SEAT) {
    throw new Error('it is not your turn');
  }

  return drain(reduce(state, { ...action, seat: HUMAN_SEAT }));
}

/**
 * Reads the current hand, and resumes it if it stopped on an agent.
 *
 * A reload (or a request that failed after the human acted) can leave the hand parked
 * on an agent's turn. Without this the table would sit there forever, so a plain read
 * also drives the loop back to the human.
 */
export async function currentView(matchId: string): Promise<GameView | null> {
  const match = getMatch(matchId);
  if (!match?.current_hand) return null;
  const state = loadHand(match.current_hand);
  if (!state) return null;

  if (state.stage !== 'complete' && playerAt(state, state.toAct).kind === 'agent') {
    return drain(state);
  }
  return viewOf(state, recentDecisions(state), match.status === 'complete');
}

/**
 * Rebuilds the agent commentary for a hand from storage.
 *
 * A plain page load has no events of its own, so without this a reload would silently
 * drop the agent's reasoning for moves it already made.
 */
function recentDecisions(s: HandState): AgentEvent[] {
  const rows = handDecisions(s.handId) as {
    seat: number;
    tool_name: string;
    thinking: string | null;
    table_talk: string | null;
    render_path: string | null;
    latency_ms: number | null;
    clamped: number;
    fallback_reason: string | null;
  }[];

  return rows.slice(-4).map((r) => ({
    seat: r.seat,
    name: s.players.find((p) => p.seat === r.seat)?.name ?? `Seat ${r.seat}`,
    tool: r.tool_name,
    thinking: r.thinking ?? undefined,
    tableTalk: r.table_talk ?? undefined,
    clamped: r.clamped === 1,
    fallbackReason: r.fallback_reason,
    latencyMs: r.latency_ms ?? 0,
    renderPath: r.render_path,
  }));
}

/**
 * Runs every consecutive agent turn until it is the human's move or the hand ends.
 *
 * This is a loop rather than a single step: after the human checks the agent may bet,
 * and once the street advances the agent can be first to act again.
 */
async function drain(initial: HandState): Promise<GameView> {
  let state = initial;
  const events: AgentEvent[] = [];
  let guard = 0;

  persist(state);

  while (state.stage !== 'complete' && playerAt(state, state.toAct).kind === 'agent') {
    if (guard++ > 200) throw new Error('agent turn loop did not terminate');

    const seat = state.toAct;
    const agent = playerAt(state, seat);
    const turn = await runAgentTurn(state);
    const seq = state.log.length;

    const renderPath = turn.png ? writeRender(state.handId, seq, turn.png) : null;

    state = reduce(state, turn.action);
    persist(state);

    insertAgentDecision({
      handId: state.handId,
      actionSeq: seq,
      seat,
      stage: state.log[seq]?.stage ?? state.stage,
      toolName: turn.decision.tool,
      input: turn.decision.input,
      thinking: turn.decision.input.thinking,
      tableTalk: turn.decision.input.tableTalk ?? null,
      renderPath,
      latencyMs: turn.latencyMs,
      inputTokens: turn.usage.input ?? null,
      outputTokens: turn.usage.output ?? null,
      clamped: turn.clamped,
      fallbackReason: turn.fallbackReason,
    });

    events.push({
      seat,
      name: agent.name,
      tool: turn.decision.tool,
      thinking: turn.decision.input.thinking,
      tableTalk: turn.decision.input.tableTalk,
      amount: turn.action.type === 'raise' ? turn.action.to : undefined,
      clamped: turn.clamped,
      fallbackReason: turn.fallbackReason,
      latencyMs: turn.latencyMs,
      renderPath,
    });
  }

  if (state.stage === 'complete') settleMatch(state);
  return viewOf(state, events, false);
}

function persist(s: HandState) {
  saveHand(s);
  syncActions(s);
}

/** Writes the stacks back to the match so the next hand starts from them. */
function settleMatch(s: HandState) {
  const match = getMatch(s.matchId);
  if (!match) return;
  const seats: SeatSpec[] = (JSON.parse(match.seats_json) as SeatSpec[]).map((spec) => {
    const p = s.players.find((q) => q.seat === spec.seat);
    return p ? { ...spec, stack: p.stack } : spec;
  });
  const alive = seats.filter((x) => x.stack > 0).length;
  updateMatch(s.matchId, {
    seats_json: JSON.stringify(seats),
    button: s.button,
    status: alive < 2 ? 'complete' : 'active',
  });
}

function writeRender(handId: string, seq: number, png: Buffer): string {
  const dir = path.join(RENDER_ROOT, handId);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${seq}.png`);
  fs.writeFileSync(file, png);
  return file;
}

/* --------------------------------------------------------------- redaction */

/**
 * Builds the client's view. Hole cards for any seat other than the human are stripped
 * unless the hand reached showdown — the server never ships cards the human may not see.
 */
async function viewOf(s: HandState, agentEvents: AgentEvent[], matchOver: boolean): Promise<GameView> {
  const match = getMatch(s.matchId);
  const over = matchOver || match?.status === 'complete';

  return {
    matchId: s.matchId,
    handId: s.handId,
    handNo: s.handNo,
    stage: s.stage,
    board: s.board,
    pot: s.pot,
    button: s.button,
    toAct: s.toAct,
    blinds: s.blinds,
    players: s.players.map((p) => {
      const visible = p.seat === HUMAN_SEAT || s.revealed.includes(p.seat);
      const { hole, ...rest } = p;
      return { ...rest, hole: visible ? hole : null, isYou: p.seat === HUMAN_SEAT };
    }),
    legal:
      s.stage !== 'complete' && s.toAct === HUMAN_SEAT
        ? legalActions(s)
        : { fold: false, check: false, call: false, raise: false, toCall: 0 },
    log: s.log,
    awards: s.awards,
    agentEvents,
    canDeal: s.stage === 'complete' && !over,
    matchOver: !!over,
  };
}

function hashSeed(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
