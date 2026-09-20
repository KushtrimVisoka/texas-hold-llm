import { type Action, type HandState, playerAt } from './state';

export interface LegalActions {
  fold: boolean;
  check: boolean;
  call: { amount: number } | false;
  /** min/max are raise-TO totals for the current betting round. */
  raise: { min: number; max: number } | false;
  toCall: number;
}

/**
 * The single source of truth for what the seat to act may do.
 * Drives the human's buttons AND the agent's `activeTools`, so the two cannot drift.
 */
export function legalActions(s: HandState): LegalActions {
  if (s.stage === 'showdown' || s.stage === 'complete') {
    return { fold: false, check: false, call: false, raise: false, toCall: 0 };
  }

  const p = playerAt(s, s.toAct);
  const toCall = Math.max(0, s.currentBet - p.committed);

  if (p.folded || p.allIn || p.busted) {
    return { fold: false, check: false, call: false, raise: false, toCall: 0 };
  }

  const maxTo = p.committed + p.stack;
  // You can only aggress if you have chips beyond what it costs to call.
  const canAggress = maxTo > s.currentBet;

  return {
    toCall,
    // Folding when checking is free is legal but never correct; the UI and the
    // agent's toolset both hide it.
    fold: toCall > 0,
    check: toCall === 0,
    call: toCall > 0 ? { amount: Math.min(toCall, p.stack) } : false,
    raise: canAggress
      ? {
          // A short all-in is allowed even below the normal minimum.
          min: Math.min(s.currentBet + s.lastRaiseSize, maxTo),
          max: maxTo,
        }
      : false,
  };
}

export function isLegal(s: HandState, a: Action): boolean {
  if (a.seat !== s.toAct) return false;
  const la = legalActions(s);
  switch (a.type) {
    case 'fold':
      return la.fold;
    case 'check':
      return la.check;
    case 'call':
      return la.call !== false;
    case 'raise':
      return la.raise !== false && a.to >= la.raise.min && a.to <= la.raise.max;
  }
}

export function describeIllegal(s: HandState, a: Action): string {
  if (a.seat !== s.toAct) return `seat ${a.seat} acted out of turn (seat ${s.toAct} to act)`;
  const la = legalActions(s);
  if (a.type === 'raise' && la.raise) {
    return `raise to ${a.to} outside [${la.raise.min}, ${la.raise.max}]`;
  }
  return `${a.type} is not available (toCall=${la.toCall})`;
}
