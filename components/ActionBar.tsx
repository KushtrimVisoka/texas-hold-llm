'use client';

import { useEffect, useState } from 'react';
import type { LegalActions } from '@/lib/game/types';

export type HumanAction =
  | { type: 'fold' }
  | { type: 'check' }
  | { type: 'call' }
  | { type: 'raise'; to: number };

export function ActionBar({
  legal,
  pot,
  busy,
  yourTurn,
  onAct,
}: {
  legal: LegalActions;
  pot: number;
  busy: boolean;
  yourTurn: boolean;
  onAct: (a: HumanAction) => void;
}) {
  const raise = legal.raise === false ? null : legal.raise;
  const [amount, setAmount] = useState(raise ? raise.min : 0);

  // Re-anchor the slider whenever a new decision point opens.
  useEffect(() => {
    if (raise) setAmount((a) => Math.min(Math.max(a, raise.min), raise.max));
  }, [raise?.min, raise?.max]); // eslint-disable-line react-hooks/exhaustive-deps


  useEffect(() => {
    if (raise) setAmount(raise.min);
  }, [pot]); // eslint-disable-line react-hooks/exhaustive-deps

  const disabled = busy || !yourTurn;
  const fraction = (pct: number) => {
    if (!raise) return;
    const target = Math.round(legal.toCall + pot * pct);
    setAmount(Math.min(Math.max(target, raise.min), raise.max));
  };

  return (
    <div className="w-[520px] rounded-2xl border border-[var(--pod-edge)] bg-[#0d1219]/95 p-4 shadow-2xl backdrop-blur">
      {raise ? (
        <>
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="text-slate-400">Bet Amount</span>
            <span className="font-bold tabular-nums text-white">{amount.toLocaleString()}</span>
          </div>
          <input
            type="range"
            className="mb-4 w-full"
            min={raise.min}
            max={raise.max}
            step={Math.max(1, Math.floor((raise.max - raise.min) / 200) || 1)}
            value={amount}
            disabled={disabled}
            onChange={(e) => setAmount(Number(e.target.value))}
          />
        </>
      ) : (
        <div className="mb-3 text-sm text-slate-400">
          {yourTurn ? 'No raise available — you are covered.' : 'Waiting for the table…'}
        </div>
      )}

      <div className="grid grid-cols-3 gap-2.5">
        <button
          className="rounded-xl bg-[#c23b4b] py-3 text-[15px] font-bold text-white transition hover:bg-[#d24657] disabled:cursor-not-allowed disabled:opacity-35"
          disabled={disabled || !legal.fold}
          onClick={() => onAct({ type: 'fold' })}
        >
          Fold
        </button>

        {legal.check ? (
          <button
            className="rounded-xl bg-[#2563eb] py-3 text-[15px] font-bold text-white transition hover:bg-[#3b82f6] disabled:cursor-not-allowed disabled:opacity-35"
            disabled={disabled}
            onClick={() => onAct({ type: 'check' })}
          >
            Check
          </button>
        ) : (
          <button
            className="flex flex-col items-center rounded-xl bg-[#2563eb] py-2 text-[15px] font-bold leading-tight text-white transition hover:bg-[#3b82f6] disabled:cursor-not-allowed disabled:opacity-35"
            disabled={disabled || !legal.call}
            onClick={() => onAct({ type: 'call' })}
          >
            Call
            <span className="text-[13px] font-semibold tabular-nums opacity-90">
              {legal.call ? legal.call.amount.toLocaleString() : '—'}
            </span>
          </button>
        )}

        <button
          className="flex flex-col items-center rounded-xl bg-[#1f9d55] py-2 text-[15px] font-bold leading-tight text-white transition hover:bg-[#25b463] disabled:cursor-not-allowed disabled:opacity-35"
          disabled={disabled || !raise}
          onClick={() => raise && onAct({ type: 'raise', to: amount })}
        >
          {raise && amount >= raise.max ? 'All-in' : 'Raise'}
          <span className="text-[13px] font-semibold tabular-nums opacity-90">
            {raise ? amount.toLocaleString() : '—'}
          </span>
        </button>
      </div>

      <div className="mt-2.5 grid grid-cols-4 gap-2.5">
        {([['25%', 0.25], ['50%', 0.5], ['75%', 0.75]] as const).map(([label, pct]) => (
          <button
            key={label}
            className="rounded-lg border border-[var(--pod-edge)] bg-[#141c27] py-2 text-[13px] font-semibold text-slate-300 transition hover:bg-[#1b2635] disabled:opacity-35"
            disabled={disabled || !raise}
            onClick={() => fraction(pct)}
          >
            {label}
          </button>
        ))}
        <button
          className="rounded-lg border border-[var(--pod-edge)] bg-[#141c27] py-2 text-[13px] font-semibold text-slate-300 transition hover:bg-[#1b2635] disabled:opacity-35"
          disabled={disabled || !raise}
          onClick={() => raise && setAmount(raise.max)}
        >
          Max
        </button>
      </div>
    </div>
  );
}
