import { fmt } from '../poker/dealer';
import type { LegalActions } from '../poker/legal';
import { cardText } from '../poker/cards';
import { playerAt, type HandState } from '../poker/state';

export const SYSTEM_PROMPT = `You are a strong, disciplined No-Limit Texas Hold'em player seated at a real table.

You are shown a picture of the table from your own seat, plus a short state block with the
numbers that must be exact. Read the picture for board texture, position, stack sizes and how
your opponents have been betting. Trust the state block for your stack, the pot, what it costs
to call, and your legal raise range.

How to play:
- Fold weak hands rather than calling out of curiosity. Folding is free money saved.
- Raise for value with strong hands and as a bluff when the board favours your story. Do not
  make tiny raises; size between half the pot and the full pot in most spots.
- Position matters. Play tighter out of position, wider in position.
- Consider what your opponent's line represents before calling a big bet on the river.
- Do not slow-play strong hands on wet boards.

You must call exactly one tool. Only the tools that are legal right now are available to you,
so choose among what you are given. Put one sentence of honest reasoning in \`thinking\`.
Add \`tableTalk\` only occasionally, and keep it light.`;

export function stateBlock(s: HandState, la: LegalActions): string {
  const me = playerAt(s, s.toAct);
  const others = s.players.filter((p) => p.seat !== s.toAct && !p.busted);
  const headsUp = s.players.filter((p) => !p.busted).length === 2;

  const lines = [
    `STAGE:      ${s.stage}`,
    `YOUR CARDS: ${me.hole ? me.hole.map(cardText).join(' ') : '--'}`,
    `BOARD:      ${s.board.length ? s.board.map(cardText).join(' ') : '(none yet)'}`,
    `YOUR STACK: ${fmt(me.stack)}`,
    `POT:        ${fmt(s.pot)}`,
    la.toCall > 0
      ? `TO CALL:    ${fmt(la.toCall)}${la.check ? '' : '  (checking is not available)'}`
      : `TO CALL:    0  (checking is free)`,
    la.raise
      ? `RAISE:      min ${fmt(la.raise.min)}  max ${fmt(la.raise.max)} (all-in)`
      : `RAISE:      not available`,
    `POSITION:   ${positionOf(s, me.seat, headsUp)}`,
    `BLINDS:     ${fmt(s.blinds.sb)} / ${fmt(s.blinds.bb)}`,
    `OPPONENTS:  ${others
      .map((p) => `${p.name} ${fmt(p.stack)}${p.folded ? ' (folded)' : p.allIn ? ' (all-in)' : ''}`)
      .join(' | ')}`,
  ];

  const recent = s.log.slice(-6).map((e) => `  ${e.text}`);
  if (recent.length) lines.push('THIS HAND:', ...recent);

  return lines.join('\n');
}

function positionOf(s: HandState, seat: number, headsUp: boolean): string {
  if (seat === s.button) {
    return headsUp
      ? 'button / small blind (you act first preflop, last after the flop)'
      : 'button (you act last after the flop)';
  }
  return headsUp ? 'big blind (you act last preflop, first after the flop)' : 'out of position';
}
