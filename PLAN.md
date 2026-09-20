# texas-hold-llm — Implementation Plan

> **Historical design doc.** This is what the build was planned from; see
> [README.md](README.md) for how the code actually works. The main divergence: the agent runs on
> a local model through Ollama by default, not Anthropic, and the provider sits behind
> `lib/agent/model.ts`.

Heads-up Texas Hold'em: 1 human vs 1 LLM agent. Hard-coded dealer, LLM decides via tool calls on a
rendered screenshot of the table.

**Stack:** Next.js 16 (App Router) · SQLite (better-sqlite3 + Drizzle) · AI SDK 7 (`ai@7`) · Zod 4 ·
satori + resvg-js (table render) · pokersolver (showdown).

---

## 0. One design note before the details

You asked for the agent to act on a screenshot. That works, and the plan below builds it — but a
screenshot **alone** is not a safe contract for a betting game:

- Vision models misread small numerals. A misread pot or stack produces an *illegal* raise, and the
  agent then burns a retry on every street.
- Nothing is replayable. You can't diff "why did it shove here" across model versions.
- Cost/latency: ~1.5k image tokens × ~4 decisions/hand, on the critical path of every turn.

**Resolution:** the screenshot stays, and it's the *primary* input — but it is rendered
**server-side from the authoritative state** (not captured from the client, which is untrusted), and
it is accompanied by a ~6-line text block carrying only the four numbers that must be exact
(stack, pot, to-call, min/max raise). Everything else — board texture, opponent sizing history,
position, betting rhythm — the agent reads from the image. Legality is enforced by the dealer
regardless of what the model returns, so a misread can never corrupt the game.

Flip `VISION_MODE=off` to fall back to text-only and A/B the difference.

---

## 1. Architecture

```
app/
  page.tsx                     Table UI (client) — polls/streams hand state
  api/hand/route.ts            POST: start hand
  api/action/route.ts          POST: human action -> dealer -> (if agent's turn) agent turn
  api/render/[handId]/route.ts GET: PNG of table from agent's POV (debug + used internally)
lib/
  poker/
    cards.ts       deck, seeded shuffle
    state.ts       HandState types
    dealer.ts      reduce(state, action) -> state   <-- pure, the whole rules engine
    legal.ts       legalActions(state) -> LegalActions
    showdown.ts    pokersolver wrapper, side pots
  agent/
    tools.ts       fold / checkCall / raise  (Zod input schemas)
    render.tsx     satori JSX -> PNG buffer
    prompt.ts      system prompt + state block
    act.ts         runAgentTurn(state) -> Action
  db/
    schema.ts      Drizzle schema
    client.ts      better-sqlite3 singleton
```

**Single source of truth:** `HandState` lives in SQLite. The client renders it, the agent sees a
picture of it, but only `dealer.reduce` mutates it. The client never sends state — only an intent.

---

## 2. The dealer (hard-coded logic)

A **pure reducer**. No I/O, no randomness at call time (seed is in the state). This makes the whole
game replayable and unit-testable.

```ts
// lib/poker/state.ts
export type Card = `${'A'|'K'|'Q'|'J'|'T'|'9'|'8'|'7'|'6'|'5'|'4'|'3'|'2'}${'s'|'h'|'d'|'c'}`;
export type Stage = 'preflop' | 'flop' | 'turn' | 'river' | 'showdown' | 'complete';
export type Seat  = 0 | 1;              // 0 = human, 1 = agent

export interface Player {
  seat: Seat;
  stack: number;
  committed: number;      // chips in THIS betting round
  totalCommitted: number; // chips in the whole hand (for side pots)
  hole: [Card, Card] | null;
  folded: boolean;
  allIn: boolean;
  hasActed: boolean;      // acted since the last aggressive action
}

export interface HandState {
  handId: string;
  seed: number;           // -> deterministic deck
  deck: Card[];           // remaining, undealt
  board: Card[];
  stage: Stage;
  players: [Player, Player];
  button: Seat;           // heads-up: button posts SB and acts first preflop
  toAct: Seat;
  currentBet: number;     // highest `committed` this round
  lastRaiseSize: number;  // for min-raise; init = bigBlind
  pot: number;
  blinds: { sb: number; bb: number };
  log: LogEntry[];
}

export type Action =
  | { type: 'fold';  seat: Seat }
  | { type: 'check'; seat: Seat }
  | { type: 'call';  seat: Seat }
  | { type: 'raise'; seat: Seat; to: number };  // `to` = total committed this round (raise-TO)
```

### 2.1 `reduce(state, action)`

```ts
export function reduce(s: HandState, a: Action): HandState {
  assert(a.seat === s.toAct, 'out of turn');
  assert(isLegal(s, a), 'illegal action');       // legal.ts — same fn the agent is gated on

  const next = structuredClone(s);
  const p = next.players[a.seat];

  switch (a.type) {
    case 'fold':
      p.folded = true; break;

    case 'check':
      break;

    case 'call': {
      const amt = Math.min(s.currentBet - p.committed, p.stack);
      commit(p, amt); next.pot += amt;
      break;
    }

    case 'raise': {
      const amt = a.to - p.committed;
      commit(p, amt); next.pot += amt;
      next.lastRaiseSize = a.to - s.currentBet;
      next.currentBet = a.to;
      // an aggressive action re-opens the round for everyone else
      next.players.forEach(q => { if (q.seat !== a.seat) q.hasActed = false; });
      break;
    }
  }
  p.hasActed = true;
  next.log.push({ seat: a.seat, action: a, stage: s.stage, pot: next.pot });

  return advance(next);
}

function commit(p: Player, amt: number) {
  p.stack -= amt; p.committed += amt; p.totalCommitted += amt;
  if (p.stack === 0) p.allIn = true;
}
```

### 2.2 `advance` — the street state machine

```ts
function advance(s: HandState): HandState {
  // 1. Everyone but one folded -> hand over, no showdown.
  const live = s.players.filter(p => !p.folded);
  if (live.length === 1) return award(s, [live[0].seat]);

  // 2. Betting round closed?
  const closed = live.every(p => p.allIn || (p.hasActed && p.committed === s.currentBet));
  if (!closed) { s.toAct = other(s.toAct); return s; }

  // 3. Round closed -> collect, deal next street.
  s.players.forEach(p => { p.committed = 0; p.hasActed = false; });
  s.currentBet = 0;
  s.lastRaiseSize = s.blinds.bb;

  const runout = live.filter(p => !p.allIn).length < 2;  // all-in: deal remaining board, no betting

  switch (s.stage) {
    case 'preflop': s.stage = 'flop';  s.board.push(...draw(s, 3)); break;
    case 'flop':    s.stage = 'turn';  s.board.push(...draw(s, 1)); break;
    case 'turn':    s.stage = 'river'; s.board.push(...draw(s, 1)); break;
    case 'river':   return showdown(s);
  }
  if (runout) return advance(s);   // recurse straight to showdown

  // postflop heads-up: non-button (big blind) acts first
  s.toAct = other(s.button);
  return s;
}
```

### 2.3 Rules the dealer owns (so the LLM never has to)

| Rule | Implementation |
|---|---|
| Deterministic deck | `mulberry32(seed)` Fisher–Yates. Same seed -> same hand, forever. |
| Heads-up blinds | Button = SB, acts **first** preflop, **last** postflop. (Classic HU quirk.) |
| Min-raise | `to >= currentBet + lastRaiseSize`, unless it's an all-in for less. |
| All-in for less | Does **not** re-open betting if `< lastRaiseSize`. |
| Side pots | From sorted `totalCommitted` tiers. Trivial heads-up, but write it right for 6-max later. |
| Showdown | `pokersolver` on `hole ++ board` (7 cards) for each live player; `Hand.winners()` handles ties/chops. |
| Bust | `stack === 0` between hands -> match over. |

### 2.4 `legalActions` — the contract shared by UI *and* agent

```ts
// lib/poker/legal.ts
export interface LegalActions {
  fold: boolean;
  check: boolean;
  call: { amount: number } | false;
  raise: { min: number; max: number } | false;  // raise-TO totals
}

export function legalActions(s: HandState): LegalActions {
  const p = s.players[s.toAct];
  const toCall = s.currentBet - p.committed;
  const canAggress = p.stack > toCall;
  return {
    fold:  toCall > 0,
    check: toCall === 0,
    call:  toCall > 0 ? { amount: Math.min(toCall, p.stack) } : false,
    raise: canAggress
      ? { min: Math.min(s.currentBet + s.lastRaiseSize, p.committed + p.stack),
          max: p.committed + p.stack }               // max = all-in
      : false,
  };
}
```

This one function drives the human's button states **and** the agent's `activeTools`. Impossible for
them to drift.

---

## 3. The agent

### 3.1 Tools exposed

Three tools, matching your fold / stand / raise — with `stand` given correct poker semantics
(it's check when free, call when facing a bet; the agent shouldn't have to know which).

```ts
// lib/agent/tools.ts
import { tool } from 'ai';
import { z } from 'zod';

const thinking = z
  .string()
  .max(280)
  .describe('One sentence of private reasoning. Shown in the hand history, not to the human.');

const tableTalk = z
  .string()
  .max(120)
  .optional()
  .describe('Optional short remark spoken at the table. Flavor only.');

export const pokerTools = {
  fold: tool({
    description:
      'Forfeit the hand. You lose everything already committed to the pot. ' +
      'Only available when facing a bet — never fold when checking is free.',
    inputSchema: z.object({ thinking, tableTalk }),
    // no execute: the call is returned to the server, the dealer applies it
  }),

  stand: tool({
    description:
      'Stay in the hand for the minimum. Checks if there is nothing to call, ' +
      'otherwise calls the current bet. Going all-in to call a larger bet is handled automatically.',
    inputSchema: z.object({ thinking, tableTalk }),
  }),

  raise: tool({
    description:
      'Increase the bet. `amount` is the TOTAL you will have committed this betting round ' +
      '(raise-to, not raise-by). Must be between `raise.min` and `raise.max` from the state block. ' +
      'Setting it to `raise.max` is all-in.',
    inputSchema: z.object({
      amount: z.number().int().positive()
        .describe('Total chips committed this round after the raise (raise-TO).'),
      thinking,
      tableTalk,
    }),
  }),
} as const;
```

**Why no `execute`:** in AI SDK 7, a tool without `execute` returns the call to you instead of
running it. That's exactly what we want — the dealer is the only thing allowed to mutate state.

### 3.2 Input schema (what the agent receives)

Two content parts in a single user message:

**(a) The screenshot** — `type: 'file'`, `mediaType: 'image/png'`, rendered server-side.
**(b) The state block** — the numbers that must be exact:

```
YOUR STACK: 1,840
POT:        320
TO CALL:    80      (check is not available)
RAISE:      min 160  max 1,840 (all-in)
STAGE:      flop
POSITION:   button (you act first preflop, last postflop)
```

Everything else — your hole cards, the board, the opponent's stack and betting pattern — is read
off the image.

### 3.3 Output schema (what comes back)

```ts
export type AgentDecision =
  | { tool: 'fold';  input: { thinking: string; tableTalk?: string } }
  | { tool: 'stand'; input: { thinking: string; tableTalk?: string } }
  | { tool: 'raise'; input: { amount: number; thinking: string; tableTalk?: string } };
```

Mapped to a dealer `Action`:

```ts
function toAction(d: AgentDecision, s: HandState, la: LegalActions): Action {
  const seat = s.toAct;
  switch (d.tool) {
    case 'fold':  return { type: 'fold', seat };
    case 'stand': return la.check ? { type: 'check', seat } : { type: 'call', seat };
    case 'raise': {
      if (!la.raise) throw new IllegalDecision('raise not available');
      // clamp rather than reject — a near-miss on sizing shouldn't cost a round-trip
      const to = clamp(d.input.amount, la.raise.min, la.raise.max);
      return { type: 'raise', seat, to };
    }
  }
}
```

### 3.4 The turn

```ts
// lib/agent/act.ts
import { generateText } from 'ai';
import { pokerTools } from './tools';

export async function runAgentTurn(s: HandState): Promise<AgentDecision> {
  const la  = legalActions(s);
  const png = await renderTable(s, { pov: 1 });   // Buffer

  const result = await generateText({
    model: 'anthropic/claude-sonnet-5',
    system: SYSTEM_PROMPT,                        // persona + rules + sizing guidance
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: stateBlock(s, la) },
        { type: 'file', mediaType: 'image/png', data: png },
      ],
    }],
    tools: pokerTools,
    // <-- the key line: the model is only shown the tools that are legal right now
    activeTools: [
      ...(la.fold  ? ['fold']  as const : []),
      'stand',
      ...(la.raise ? ['raise'] as const : []),
    ],
    toolChoice: 'required',       // it must act; no bare prose
    stopWhen: isStepCount(1),     // exactly one decision, no loop
    temperature: 0.8,             // some spread, otherwise it plays identically every hand
  });

  const call = result.toolCalls[0];
  if (!call) throw new NoDecision();
  return { tool: call.toolName, input: call.input } as AgentDecision;
}
```

`activeTools` is doing the heavy lifting: **an illegal action is structurally unreachable**, not
prompted against. The model cannot fold when checking is free, because `fold` isn't in its schema.

### 3.5 Failure policy (poker can't hang)

| Failure | Response |
|---|---|
| Raise below min / above max | Clamp to `[min, max]`. No retry. |
| Malformed tool input | One retry via AI SDK `repairToolCall`. |
| No tool call / API error | Retry once, then **default: check if free, else fold**. Log it. |
| Timeout > 15s | Same default. The human never waits on a hung model. |

Every fallback is written to `agent_decisions` with `fallback_reason` so you can measure how often
the model actually fails.

### 3.6 The screenshot render

`satori` (JSX → SVG) + `@resvg/resvg-js` (SVG → PNG). ~40ms, no headless browser, works on
serverless — and because it renders from `HandState`, it's deterministic and replayable.

```tsx
// lib/agent/render.tsx
export async function renderTable(s: HandState, { pov }: { pov: Seat }): Promise<Buffer> {
  const svg = await satori(<TableView state={s} pov={pov} />, {
    width: 900, height: 600, fonts: [inter],
  });
  return new Resvg(svg).render().asPng();
}
```

`pov` hides the opponent's hole cards — the render is the *only* thing the agent sees, so it's
also the security boundary. `TableView` shares its layout primitives with the client React
component, so "what the agent sees" and "what you see" stay honest.

Each render is saved to `renders/{handId}/{n}.png` and referenced from the decision row — so you can
scrub through a hand and see exactly what the agent was looking at when it shoved.

---

## 4. Database (SQLite + Drizzle)

```ts
matches         id, created_at, human_stack, agent_stack, blinds_sb, blinds_bb,
                agent_model, status
hands           id, match_id, hand_no, seed, button_seat,
                final_state_json, board, winner_seat, pot, ended_at
actions         id, hand_id, seq, seat, stage, action_type, amount, pot_after
agent_decisions id, hand_id, action_seq, tool_name, input_json, thinking, table_talk,
                render_path, latency_ms, input_tokens, output_tokens,
                clamped INTEGER, fallback_reason TEXT NULL
```

`hands.seed` + `actions` = full replay from nothing. `agent_decisions` is your eval set: swap models,
re-run the same seeds, compare.

One `better-sqlite3` connection, WAL mode, in a module singleton. Writes are synchronous and fast
enough that no queue is needed at 1 agent.

---

## 5. Request flow

```
POST /api/action { handId, action }
  1. load HandState                     (SQLite)
  2. reduce(state, humanAction)         (dealer)
  3. while (state.toAct === AGENT && stage !== complete):
       png      = renderTable(state, { pov: AGENT })
       decision = runAgentTurn(state)   (AI SDK -> tool call)
       action   = toAction(decision)    (validate + clamp)
       state    = reduce(state, action) (dealer)
       persist decision + render
  4. persist state
  5. return { state: redact(state, POV_HUMAN), agentDecisions: [...] }
```

Step 3 is a `while`, not an `if`: after the human checks, the agent may bet, and after the human
calls, the street advances and the agent acts first again. The loop drains until it's the human's
turn or the hand ends.

`redact` strips the agent's hole cards until showdown — same function as the render's `pov`.

**Streaming:** v1 returns the whole batch. If the agent's turns feel abrupt, add an SSE endpoint that
emits each decision as it lands, so the UI can animate chips one action at a time.

---

## 6. Build order

| # | Milestone | Done when |
|---|---|---|
| 1 | `lib/poker/*` + Vitest | 40+ tests green: min-raise, all-in-for-less, HU blind order, split pots, runouts |
| 2 | SQLite schema + repo functions | A hand can be written, read back, and replayed from seed |
| 3 | Table UI, human vs. scripted bot | Playable end to end with a bot that always calls |
| 4 | `render.tsx` | `/api/render/[handId]` returns a legible PNG |
| 5 | `agent/*` wired in | Agent plays a full hand; decisions land in `agent_decisions` |
| 6 | Failure policy + fallbacks | Kill the API key mid-hand; game still completes |
| 7 | Hand history / replay viewer | Scrub a hand, see each render + `thinking` |

1–3 have zero LLM dependency, so the rules engine is proven correct before the agent can be blamed
for anything.

---

## 7. Scaling to N agents later

Nothing here is heads-up-specific except `advance`'s `toAct = other(...)` and the blind posting.
Both become "next live seat clockwise" for a ring game. `players` is already an array, side pots are
already tiered, and `pov` rendering already generalizes. Budget one afternoon.

Agent turns stay **sequential** — poker is turn-based, so there's no fan-out to parallelize, and
each agent must see the actions taken before it.

---

## 8. On the TypeSafe link

`docs.typesafe.ai` is a different shape of tool: constrained "System One" calls returning a choice
plus a probability distribution and confidence, rather than free-form tool calls.

It maps suspiciously well onto poker — `fold | stand | raise` **is** a Choice, and a confidence score
is exactly what you'd want to drive bet sizing. But it doesn't take image input, which is the
premise of this build.

Suggested use: not v1. Once the `agent_decisions` table has a few hundred rows, it's a clean
**A/B arm** — same seeds, same states, text-only, Choice-based — measured against the vision agent
on bb/100. Keep `runAgentTurn` behind an interface so the swap is one file.
