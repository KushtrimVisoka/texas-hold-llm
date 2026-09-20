'use client';

import { useEffect, useRef } from 'react';
import type { AgentEvent, GameView } from '@/lib/game/types';

export function HandHistory({
  log,
  agentEvents,
  waitingOn,
}: {
  log: GameView['log'];
  agentEvents: AgentEvent[];
  waitingOn: string | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight, behavior: 'smooth' });
  }, [log.length, waitingOn]);

  const thoughts = new Map(agentEvents.map((e) => [e.seat, e]));

  return (
    <div className="w-[300px] rounded-2xl border border-[var(--pod-edge)] bg-[#0d1219]/95 p-4 shadow-2xl backdrop-blur">
      <div className="mb-2 text-[15px] font-bold text-slate-200">Hand History</div>
      <div className="mb-2 h-px bg-[var(--pod-edge)]" />
      <div ref={ref} className="max-h-[164px] space-y-1 overflow-y-auto pr-1 text-[13px] leading-relaxed">
        {log.length === 0 && <div className="text-slate-500">Waiting for the deal…</div>}
        {log.map((e) => (
          <div key={e.seq} className="text-slate-300">
            {e.text}
          </div>
        ))}
        {waitingOn && <div className="text-blue-400">{waitingOn} is thinking…</div>}
      </div>

      {agentEvents.length > 0 && (
        <div className="mt-3 border-t border-[var(--pod-edge)] pt-2.5">
          {[...thoughts.values()].slice(-1).map((e) => (
            <div key={e.seat} className="text-[12px] leading-snug">
              {e.tableTalk && <div className="mb-1 italic text-amber-300">“{e.tableTalk}”</div>}
              {/* Unbounded by schema on purpose, so clamp it here instead. */}
              {e.thinking && <div className="line-clamp-4 text-slate-500">{e.thinking}</div>}
              {e.fallbackReason && (
                // The full error can be a paragraph; keep one line here and put the
                // rest on the tooltip so the panel does not blow out.
                <div className="mt-1 truncate text-rose-400" title={e.fallbackReason}>
                  fallback: {e.fallbackReason}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
