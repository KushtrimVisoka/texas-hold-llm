import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'holdllm-'));
process.env.DB_PATH = path.join(tmp, 'test.db');
process.env.RENDER_DIR = path.join(tmp, 'renders');
// Point the agent at a closed port with a short fuse. Every turn then takes the
// fallback path, deterministically and fast, whether or not a real model happens to
// be running on this machine. That is exactly what we want to assert: a dead model
// must not stop the table.
process.env.LLM_PROVIDER = 'ollama';
process.env.OLLAMA_BASE_URL = 'http://127.0.0.1:1/v1';
process.env.AGENT_TIMEOUT_MS = '3000';
process.env.AGENT_MAX_RETRIES = '0';

const { newMatch, applyHumanAction, dealHand } = await import('../lib/game/engine');
const { getMatch, handDecisions } = await import('../lib/db/repo');

describe('game engine', () => {
  let matchId: string;

  beforeAll(async () => {
    const view = await newMatch();
    matchId = view.matchId;
  });

  it('deals a hand and stops on the human', async () => {
    const view = await newMatch();
    expect(view.stage).not.toBe('complete');
    expect(view.toAct).toBe(0);
    expect(view.players).toHaveLength(2);
    expect(view.pot).toBe(300);
  });

  it('never leaks the agent’s hole cards before showdown', async () => {
    const view = await newMatch();
    const agent = view.players.find((p) => !p.isYou)!;
    expect(agent.hole).toBeNull();
    // Every non-human seat must come back stripped; the human sees only their own.
    for (const p of view.players) {
      if (!p.isYou) expect(p.hole).toBeNull();
    }
    expect(view.players.find((p) => p.isYou)!.hole).toHaveLength(2);
  });

  it('records a fallback decision instead of hanging when the model is unavailable', async () => {
    const view = await applyHumanAction(matchId, { type: 'call', seat: 0 });
    const rows = handDecisions(view.handId) as { fallback_reason: string | null }[];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].fallback_reason).toBeTruthy();
    expect(view.agentEvents[0].tool).toMatch(/stand|fold/);
  });

  it('writes a render of what the agent was shown', async () => {
    const view = await newMatch();
    const after = await applyHumanAction(view.matchId, { type: 'call', seat: 0 });
    const rows = handDecisions(after.handId) as { render_path: string }[];
    expect(rows[0].render_path).toBeTruthy();
    expect(fs.existsSync(rows[0].render_path)).toBe(true);
  });

  it('plays a hand to completion and carries stacks into the next one', async () => {
    const start = await newMatch();
    let view = start;
    let guard = 0;
    while (view.stage !== 'complete' && guard++ < 40) {
      const a = view.legal;
      view = await applyHumanAction(view.matchId, {
        seat: 0,
        ...(a.check ? { type: 'check' as const } : { type: 'call' as const }),
      });
    }
    expect(view.stage).toBe('complete');
    expect(view.awards.length).toBeGreaterThan(0);

    const totalAfter = view.players.reduce((n, p) => n + p.stack, 0);
    expect(totalAfter).toBe(60_000);

    const match = getMatch(view.matchId)!;
    const seats = JSON.parse(match.seats_json) as { stack: number }[];
    expect(seats.reduce((n, s) => n + s.stack, 0)).toBe(60_000);

    const next = await dealHand(getMatch(view.matchId)!);
    expect(next.handNo).toBe(2);
    expect(next.players.reduce((n, p) => n + p.stack, 0) + next.pot).toBe(60_000);
    expect(next.button).not.toBe(view.button);
  });
});
