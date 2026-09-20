import { tool } from 'ai';
import { z } from 'zod';

// Deliberately unbounded. A length cap here is enforced by schema validation, so a
// chatty model would fail the call and get folded by the failure policy — losing a
// perfectly good decision over prose. Brevity is requested, not required; the UI clamps.
const thinking = z
  .string()
  .describe('One short sentence of private reasoning. Recorded in the hand history.');

const tableTalk = z
  .string()
  .optional()
  .describe('Optional brief remark spoken at the table. Flavor only; never reveals your cards.');

/**
 * Three tools, matching the three things a player can do.
 *
 * None of them declare `execute`: in AI SDK 7 a tool without `execute` returns the
 * call to the caller instead of running it, which keeps the dealer the only thing
 * that can mutate game state.
 */
export const pokerTools = {
  fold: tool({
    description:
      'Forfeit the hand and lose whatever you have already committed. ' +
      'Only offered when you are facing a bet.',
    inputSchema: z.object({ thinking, tableTalk }),
  }),

  stand: tool({
    description:
      'Stay in the hand for the minimum: check if there is nothing to call, otherwise call ' +
      'the current bet. If calling costs more than your stack you are called all-in automatically.',
    inputSchema: z.object({ thinking, tableTalk }),
  }),

  raise: tool({
    description:
      'Put in more chips. `amount` is the TOTAL you will have committed this betting round ' +
      '(raise-TO, not raise-by), and must fall between the min and max in the RAISE line of ' +
      'the state block. Setting it to the max is going all-in.',
    inputSchema: z.object({
      amount: z
        .number()
        .int()
        .positive()
        .describe('Total chips committed this round after the raise (raise-TO).'),
      thinking,
      tableTalk,
    }),
  }),
} as const;

export type ToolName = keyof typeof pokerTools;

export type AgentDecision =
  | { tool: 'fold'; input: { thinking: string; tableTalk?: string } }
  | { tool: 'stand'; input: { thinking: string; tableTalk?: string } }
  | { tool: 'raise'; input: { amount: number; thinking: string; tableTalk?: string } };
