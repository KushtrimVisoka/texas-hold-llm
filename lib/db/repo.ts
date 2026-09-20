import { randomUUID } from 'node:crypto';
import type { HandState } from '../poker/state';
import { getDb } from './client';

export interface SeatSpec {
  seat: number;
  name: string;
  kind: 'human' | 'agent';
  avatar: string;
  stack: number;
}

export interface MatchRow {
  id: string;
  blinds_sb: number;
  blinds_bb: number;
  agent_model: string;
  seats_json: string;
  button: number;
  hand_no: number;
  current_hand: string | null;
  status: string;
}

export interface AgentDecisionRow {
  handId: string;
  actionSeq: number;
  seat: number;
  stage: string;
  toolName: string;
  input: unknown;
  thinking?: string | null;
  tableTalk?: string | null;
  renderPath?: string | null;
  latencyMs?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  clamped?: boolean;
  fallbackReason?: string | null;
}

export function createMatch(opts: {
  seats: SeatSpec[];
  blinds: { sb: number; bb: number };
  agentModel: string;
}): MatchRow {
  const db = getDb();
  const id = randomUUID();
  db.prepare(
    `INSERT INTO matches (id, created_at, blinds_sb, blinds_bb, agent_model, seats_json, button, hand_no)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
  ).run(
    id,
    Date.now(),
    opts.blinds.sb,
    opts.blinds.bb,
    opts.agentModel,
    JSON.stringify(opts.seats),
    // Button starts on the last seat so the first rotation lands on seat 0.
    opts.seats.length - 1,
    );
  return getMatch(id)!;
}

export function getMatch(id: string): MatchRow | null {
  return (getDb().prepare('SELECT * FROM matches WHERE id = ?').get(id) as MatchRow) ?? null;
}

export function latestMatch(): MatchRow | null {
  return (
    (getDb()
      .prepare("SELECT * FROM matches WHERE status = 'active' ORDER BY created_at DESC LIMIT 1")
      .get() as MatchRow) ?? null
  );
}

export function updateMatch(
  id: string,
  patch: Partial<Pick<MatchRow, 'button' | 'hand_no' | 'current_hand' | 'status' | 'seats_json'>>,
) {
  const keys = Object.keys(patch);
  if (keys.length === 0) return;
  const sql = `UPDATE matches SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`;
  getDb()
    .prepare(sql)
    .run(...keys.map((k) => (patch as Record<string, unknown>)[k]), id);
}

export function insertHand(s: HandState) {
  getDb()
    .prepare(
      `INSERT INTO hands (id, match_id, hand_no, seed, button_seat, state_json, board, pot, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(s.handId, s.matchId, s.handNo, s.seed, s.button, JSON.stringify(s), '', s.pot, Date.now());
}

export function saveHand(s: HandState) {
  getDb()
    .prepare(
      `UPDATE hands SET state_json = ?, board = ?, pot = ?, awards_json = ?, ended_at = ?
       WHERE id = ?`,
    )
    .run(
      JSON.stringify(s),
      s.board.join(' '),
      s.finalPot || s.pot,
      s.awards.length ? JSON.stringify(s.awards) : null,
      s.stage === 'complete' ? Date.now() : null,
      s.handId,
    );
}

export function loadHand(handId: string): HandState | null {
  const row = getDb().prepare('SELECT state_json FROM hands WHERE id = ?').get(handId) as
    | { state_json: string }
    | undefined;
  return row ? (JSON.parse(row.state_json) as HandState) : null;
}

/** Appends only log entries not yet persisted, so repeated saves are idempotent. */
export function syncActions(s: HandState) {
  const db = getDb();
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO actions (hand_id, seq, seat, stage, action_type, amount, pot_after, text)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const tx = db.transaction((entries: HandState['log']) => {
    for (const e of entries) {
      stmt.run(s.handId, e.seq, e.seat, e.stage, e.action, e.amount, e.potAfter, e.text);
    }
  });
  tx(s.log);
}

export function insertAgentDecision(d: AgentDecisionRow) {
  getDb()
    .prepare(
      `INSERT INTO agent_decisions
        (hand_id, action_seq, seat, stage, tool_name, input_json, thinking, table_talk,
         render_path, latency_ms, input_tokens, output_tokens, clamped, fallback_reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      d.handId,
      d.actionSeq,
      d.seat,
      d.stage,
      d.toolName,
      JSON.stringify(d.input),
      d.thinking ?? null,
      d.tableTalk ?? null,
      d.renderPath ?? null,
      d.latencyMs ?? null,
      d.inputTokens ?? null,
      d.outputTokens ?? null,
      d.clamped ? 1 : 0,
      d.fallbackReason ?? null,
      Date.now(),
    );
}

export function handDecisions(handId: string) {
  return getDb()
    .prepare('SELECT * FROM agent_decisions WHERE hand_id = ? ORDER BY action_seq')
    .all(handId);
}
