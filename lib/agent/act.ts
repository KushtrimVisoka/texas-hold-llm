import { generateText, isStepCount } from 'ai';
import { agentModel, maxRetries, timeoutMs } from './model';
import { legalActions, type LegalActions } from '../poker/legal';
import { playerAt, type Action, type HandState } from '../poker/state';
import { SYSTEM_PROMPT, stateBlock } from './prompt';
import { renderTable } from './render';
import { pokerTools, type AgentDecision, type ToolName } from './tools';

const VISION = (process.env.VISION_MODE ?? 'on') !== 'off';

export interface TurnResult {
  action: Action;
  decision: AgentDecision;
  /** True when the model's raise size had to be pulled into the legal range. */
  clamped: boolean;
  /** Set when the model failed and the safe default was used instead. */
  fallbackReason: string | null;
  png: Buffer | null;
  latencyMs: number;
  usage: { input?: number; output?: number };
}

/** Runs one agent decision and returns a dealer-ready action. Never throws. */
export async function runAgentTurn(s: HandState): Promise<TurnResult> {
  const la = legalActions(s);
  const started = Date.now();
  const png = VISION ? await renderTable(s, s.toAct) : null;

  try {
    const decision = await withTimeout(askModel(s, la, png), timeoutMs);
    const { action, clamped } = toAction(decision, s, la);
    return {
      action,
      decision: decision.decision,
      clamped,
      fallbackReason: null,
      png,
      latencyMs: Date.now() - started,
      usage: decision.usage,
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return {
      action: safeDefault(s, la),
      decision: {
        tool: la.check ? 'stand' : 'fold',
        // Keep this short: the full reason travels separately in `fallbackReason`.
        input: { thinking: 'Model unavailable — played the safe default.' },
      } as AgentDecision,
      clamped: false,
      fallbackReason: reason,
      png,
      latencyMs: Date.now() - started,
      usage: {},
    };
  }
}

async function askModel(
  s: HandState,
  la: LegalActions,
  png: Buffer | null,
): Promise<{ decision: AgentDecision; usage: { input?: number; output?: number } }> {
  const me = playerAt(s, s.toAct);

  const content: Record<string, unknown>[] = [{ type: 'text', text: stateBlock(s, la) }];
  if (png) {
    content.unshift({
      type: 'text',
      text: 'Here is the table from your seat. You are the seat at the bottom.',
    });
    content.push({ type: 'file', mediaType: 'image/png', data: png });
  }

  const result = await generateText({
    model: agentModel(),
    system: `${SYSTEM_PROMPT}\n\nYou are playing as "${me.name}".`,
    messages: [{ role: 'user', content: content as never }],
    tools: pokerTools,
    // Only the tools that are legal this turn are put in front of the model, so an
    // illegal action is unreachable rather than merely discouraged.
    activeTools: activeToolsFor(la),
    toolChoice: 'required',
    stopWhen: isStepCount(1),
    temperature: 0.8,
    maxRetries,
  });

  const call = result.toolCalls[0];
  if (!call) throw new Error('model returned no tool call');

  return {
    decision: { tool: call.toolName as ToolName, input: call.input } as AgentDecision,
    usage: { input: result.usage?.inputTokens, output: result.usage?.outputTokens },
  };
}

function activeToolsFor(la: LegalActions): ToolName[] {
  const tools: ToolName[] = ['stand'];
  if (la.fold) tools.unshift('fold');
  if (la.raise) tools.push('raise');
  return tools;
}

/** Maps a tool call onto a dealer action, clamping rather than rejecting a near-miss. */
export function toAction(
  d: { decision: AgentDecision } | AgentDecision,
  s: HandState,
  la: LegalActions,
): { action: Action; clamped: boolean } {
  const decision = 'decision' in d ? d.decision : d;
  const seat = s.toAct;

  switch (decision.tool) {
    case 'fold':
      if (!la.fold) return { action: { type: 'check', seat }, clamped: true };
      return { action: { type: 'fold', seat }, clamped: false };

    case 'stand':
      return { action: la.check ? { type: 'check', seat } : { type: 'call', seat }, clamped: false };

    case 'raise': {
      if (!la.raise) return { action: safeDefault(s, la), clamped: true };
      const want = Math.round(decision.input.amount);
      const to = Math.min(Math.max(want, la.raise.min), la.raise.max);
      return { action: { type: 'raise', seat, to }, clamped: to !== want };
    }
  }
}

/** Never let a model failure hang the table: check when free, otherwise fold. */
function safeDefault(s: HandState, la: LegalActions): Action {
  return la.check ? { type: 'check', seat: s.toAct } : { type: 'fold', seat: s.toAct };
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`model timed out after ${ms}ms`)), ms),
    ),
  ]);
}
