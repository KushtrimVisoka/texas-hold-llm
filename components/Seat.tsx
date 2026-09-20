'use client';

import { Avatar } from './Avatar';
import { CardBack, PlayingCard } from './PlayingCard';
import type { SeatSlot } from '@/lib/poker/seats';
import type { SeatView } from '@/lib/game/types';

export function Seat({
  player,
  slot,
  isButton,
  toAct,
  thinking,
  won,
}: {
  player: SeatView;
  slot: SeatSlot;
  isButton: boolean;
  toAct: boolean;
  thinking: boolean;
  won: boolean;
}) {
  const status = thinking
    ? 'Thinking'
    : player.folded
      ? 'Folded'
      : player.allIn
        ? 'All-in'
        : toAct
          ? 'To act'
          : 'In hand';

  const statusClass = thinking
    ? 'bg-blue-600 text-white'
    : player.folded
      ? 'bg-slate-800 text-slate-400'
      : player.allIn
        ? 'bg-rose-900/80 text-rose-200'
        : toAct
          ? 'bg-blue-600/90 text-white'
          : 'bg-slate-800/80 text-slate-300';

  return (
    <>
      {/* hole cards tucked behind the pod */}
      {player.hole !== null || (!player.folded && !player.busted) ? (
        <div
          className="pointer-events-none absolute flex -translate-x-1/2 gap-1"
          style={{
            left: `${slot.x}%`,
            top: `${slot.y}%`,
            marginTop: -96,
          }}
        >
          {player.folded || player.busted ? null : player.hole ? (
            player.hole.map((c, i) => <PlayingCard key={c} card={c} size="seat" delay={i * 70} />)
          ) : (
            <>
              <CardBack />
              <CardBack />
            </>
          )}
        </div>
      ) : null}

      {/* pod */}
      <div
        className={`absolute w-[204px] -translate-x-1/2 -translate-y-1/2 rounded-2xl border-2 p-2.5 backdrop-blur transition ${
          toAct || thinking
            ? 'to-act border-blue-500 bg-[#0f151f]'
            : 'border-[var(--pod-edge)] bg-[var(--pod)]/95'
        } ${player.folded ? 'opacity-55' : ''} ${won ? 'ring-2 ring-amber-400' : ''}`}
        style={{ left: `${slot.x}%`, top: `${slot.y}%` }}
      >
        <div className="flex items-center gap-2.5">
          <Avatar avatar={player.avatar} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-[15px] font-bold text-slate-100">{player.name}</span>
              {isButton && (
                <span className="flex h-[17px] w-[17px] items-center justify-center rounded-full bg-white text-[10px] font-bold text-slate-900">
                  D
                </span>
              )}
            </div>
            <div className="text-[17px] font-bold tabular-nums text-white">
              {player.stack.toLocaleString()}
            </div>
          </div>
        </div>
        <div className={`mt-1.5 flex w-fit items-center gap-1 rounded px-2 py-0.5 text-[11px] ${statusClass}`}>
          {status}
          {thinking && (
            <span className="flex gap-0.5">
              <span className="dot">.</span>
              <span className="dot">.</span>
              <span className="dot">.</span>
            </span>
          )}
        </div>
      </div>

      {/* chips committed this round */}
      {player.committed > 0 && (
        <div
          className="absolute -translate-x-1/2 rounded-full bg-black/70 px-2.5 py-1 text-[13px] font-bold tabular-nums text-amber-300 shadow"
          style={{ left: `${slot.chips.x}%`, top: `${slot.chips.y}%` }}
        >
          {player.committed.toLocaleString()}
        </div>
      )}
    </>
  );
}
