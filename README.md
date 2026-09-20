# texas-hold-llm

No-Limit Texas Hold'em against LLM agents. The dealer is hard-coded; the agents decide by
looking at a **rendered screenshot of the table** and calling one of three tools.

Ships heads-up against a local model via **Ollama** (Anthropic is a one-variable swap). The
engine, layout and renderer are all N-player, so extra agents are a config change, not a rewrite.

---

## Running it

```bash
npm install
npm run dev
```

Open http://localhost:3000. The defaults target Ollama at `http://localhost:11434` with
`gemma4:latest`, so if that is what you have running there is nothing to configure.

### Picking an Ollama model

The agent is handed an **image** and must answer with a **tool call**, so the model needs both
capabilities. Plenty of models have one and not the other.

```bash
ollama show gemma4:latest | grep -iA1 capabilities   # want: vision AND tools
```

`gemma4:latest` (8B) has both and plays a coherent game — it reads its own cards off the render,
recognises top pair, and sizes bets sensibly. Expect **10–25s per decision** on a laptop, so a
full hand takes a minute or two. The timeout defaults to 120s for Ollama to suit that.

To use Anthropic instead:

```bash
echo 'LLM_PROVIDER=anthropic'          >> .env.local
echo 'AGENT_MODEL=claude-sonnet-5'     >> .env.local
echo 'ANTHROPIC_API_KEY=sk-ant-...'    >> .env.local
```

If the model is unreachable the app still runs end to end — every agent turn falls back to
check-if-free-else-fold and records why, which is the intended behaviour.

```bash
npm test          # 23 tests: rules engine, renderer, full game loop
npm run build
```

### Environment

| Variable | Default | Meaning |
|---|---|---|
| `LLM_PROVIDER` | `ollama` | `ollama` or `anthropic`. |
| `AGENT_MODEL` | `gemma4:latest` | Model id. Needs `vision` + `tools`. |
| `OLLAMA_BASE_URL` | `http://localhost:11434/v1` | Ollama's OpenAI-compatible endpoint. |
| `ANTHROPIC_API_KEY` | — | Only when `LLM_PROVIDER=anthropic`. |
| `AGENT_TIMEOUT_MS` | 120s ollama / 20s anthropic | Patience per decision. |
| `AGENT_MAX_RETRIES` | `1` | Retries before the fallback. |
| `VISION_MODE` | `on` | `off` sends the text state block only — the A/B arm. |
| `DB_PATH` | `./data/poker.db` | SQLite file. |
| `RENDER_DIR` | `./renders` | Where agent screenshots are archived. |

---

## How a turn works

```
POST /api/action { matchId, action }
  1. load HandState                          SQLite
  2. reduce(state, humanAction)               dealer
  3. while it is an agent's turn and the hand is live:
       png      = renderTable(state, pov)     satori -> resvg
       decision = runAgentTurn(state)         AI SDK -> one tool call
       action   = toAction(decision)          validate + clamp
       state    = reduce(state, action)       dealer
       persist decision + render
  4. return the redacted view
```

Step 3 is a loop, not a step: after you check the agent may bet, and once the street advances it
can be first to act again. It drains until it is your turn or the hand ends.

---

## The dealer

`lib/poker/dealer.ts` is a **pure reducer** — `reduce(state, action) => state`. No I/O, no ambient
randomness (the deck comes from `state.seed`), so `seed + action log` replays any hand exactly.

It owns every rule so the model never has to:

| Rule | Where |
|---|---|
| Deterministic deck | `mulberry32(seed)` Fisher–Yates in `cards.ts` |
| Heads-up blinds | Button posts the SB, acts first preflop and last after the flop |
| Big blind option | Falls out of `hasActed`: the BB has not acted even when its chips match |
| Min-raise | `to >= currentBet + lastRaiseSize` |
| All-in for less | Does not reopen betting — `mayReraise` goes false for players who already acted |
| Side pots | Contribution tiers from `totalCommitted`, odd chips left of the button |
| Showdown | `pokersolver` over 7 cards, ties split |

`legalActions(state)` is the single source of truth for what the seat to act may do. It drives the
human's buttons **and** the agent's toolset, so the two cannot drift.

---

## The agent

Three tools, none of which declare `execute` — in AI SDK 7 that returns the call to the server
instead of running it, keeping the dealer the only thing that can mutate state.

```ts
fold  ({ thinking, tableTalk? })
stand ({ thinking, tableTalk? })            // checks if free, otherwise calls
raise ({ amount, thinking, tableTalk? })    // amount = raise-TO, not raise-by
```

The important line is in `lib/agent/act.ts`:

```ts
activeTools: activeToolsFor(legalActions(state)),
toolChoice: 'required',
stopWhen: isStepCount(1),
```

Only the legal tools are put in front of the model, so **an illegal action is unreachable rather
than discouraged**. The agent cannot fold when checking is free, because `fold` is not in its
schema that turn. `toolChoice: 'required'` plus a one-step cap means exactly one decision per turn,
no loop.

### Failure policy

Poker cannot hang on a model.

| Failure | Response |
|---|---|
| Raise outside `[min, max]` | Clamped. No retry — a near-miss on sizing is not worth a round-trip. |
| No tool call, API error, timeout | Check if free, else fold. Logged with `fallback_reason`. |

Two details exist because of local models specifically. `thinking` carries **no length cap**: a
cap is enforced by schema validation, so a chatty model would fail its own tool call and get
folded by the policy above — losing a good decision over prose. And retries default to **1**, not
the SDK's 2, because three attempts at 20s each would take a minute to arrive at the same fold.

### What the agent sees

`lib/agent/render.tsx` draws the table with satori and rasterises with resvg — about 40ms, no
headless browser, works on serverless.

It renders **from `HandState`, not from the browser**, which makes it three things at once:

- **The security boundary.** Hole cards for any seat other than `pov` are drawn face-down, so a
  leak is impossible by construction. A test asserts the render is byte-identical when the
  opponent's cards change.
- **Replayable.** The same hand always produces the same image.
- **Trustworthy.** The client never supplies state, only an intent.

Suit pips are drawn as SVG paths (`lib/poker/suits.ts`) rather than typed as characters — the
bundled Inter subset has no suit glyphs and would put tofu boxes on the agent's screenshot.

Alongside the image goes a short text block with the numbers that must be exact: stack, pot,
to-call, and the legal raise range. Vision models misread small numerals, and a misread pot is an
illegal raise. Board texture, position and betting patterns still come from the picture — an 8B
local model reads them off the render reliably.

Every render is archived and linked from its decision row:

```
GET /api/render/[handId]?seq=4     # exactly what the agent saw at step 4
GET /api/render/[handId]           # the live table
```

---

## Data

```
matches          stacks, blinds, button, current hand
hands            seed, button, full state JSON, awards
actions          every action in order, with running pot
agent_decisions  tool, input, thinking, table talk, render path,
                 latency, tokens, clamped, fallback_reason
```

`hands.seed` + `actions` replays a hand from nothing. `agent_decisions` is the eval set: swap
models, re-run the same seeds, compare.

---

## Layout

`lib/poker/seats.ts` holds seat positions as percentages, shared by the React table and the satori
renderer so your screen and the agent's picture always agree on who sits where. Slot 0 is always
the point-of-view seat at the bottom; `slotFor()` rotates the table.

The table is a desktop layout and wants roughly 1280×860 or more; below that the action bar moves
below the fold and the page scrolls.

Layouts exist for 2–6 seats. Every agent seat runs the same configured model, so seats are named
after it (`Gemma`, `Gemma 2`, …) rather than given borrowed brand names that would misrepresent
who is actually playing. To seat more:

```bash
curl -X POST localhost:3000/api/game -H 'content-type: application/json' \
  -d '{"agents":4,"startingStack":30000}'
```

---

## Layout of the code

```
app/
  page.tsx                      the table
  api/game/route.ts             new match / read current view
  api/action/route.ts           human action, then drains agent turns
  api/deal/route.ts             next hand
  api/render/[handId]/route.ts  agent screenshots
lib/
  poker/    cards, state, dealer, legal, showdown, seats, suits
  agent/    model (provider choice), tools, prompt, render, act
  game/     engine (orchestration, redaction)
  db/       client, repo
components/ PokerTable, Seat, ActionBar, HandHistory, PlayingCard, Avatar
```

---

## Notes

- `next.config.ts` externalises `satori`, `harfbuzzjs`, `yoga-wasm-web`, `better-sqlite3` and
  `@resvg/resvg-js`. They ship native addons or `.wasm` side files that do not survive Next's
  server bundling — satori's harfbuzz in particular resolves to a bogus `/ROOT` path.
- A page load while it is an agent's turn resumes the hand rather than parking on it, so a reload
  mid-turn cannot strand the table.
- **Deployment:** SQLite and the render archive both live on local disk, so this wants a host with
  a persistent filesystem (a VM, Fly, Railway) rather than serverless. The build emits
  "dynamic filesystem access" warnings for the same reason — reading the font files, the database
  and the archived renders at runtime. On Vercel you would move the database to Turso or Postgres
  and the renders to blob storage; nothing above that boundary changes.
- See [PLAN.md](PLAN.md) for the design rationale this was built from.
