'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActionBar, type HumanAction } from './ActionBar';
import { HandHistory } from './HandHistory';
import { PlayingCard } from './PlayingCard';
import { Seat } from './Seat';
import { seatLayout, slotFor } from '@/lib/poker/seats';
import type { GameView } from '@/lib/game/types';

const STORAGE_KEY = 'texas-hold-llm:matchId';
const HUMAN_SEAT = 0;

export default function PokerTable() {
  const [view, setView] = useState<GameView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const call = useCallback(async (url: string, body?: unknown) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body ?? {}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'request failed');
      setView(data as GameView);
      localStorage.setItem(STORAGE_KEY, (data as GameView).matchId);
      return data as GameView;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'request failed');
      return null;
    } finally {
      setBusy(false);
    }
  }, []);

  const newGame = useCallback(() => call('/api/game'), [call]);

  // Resume the last match on reload; start a fresh one if there is nothing to resume.
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) {
      void newGame();
      return;
    }
    (async () => {
      setBusy(true);
      const res = await fetch(`/api/game?matchId=${saved}`);
      setBusy(false);
      if (res.ok) setView(await res.json());
      else void newGame();
    })();
  }, [newGame]);

  const act = (a: HumanAction) =>
    view && call('/api/action', { matchId: view.matchId, action: a });
  const deal = () => view && call('/api/deal', { matchId: view.matchId });

  const seated = useMemo(() => view?.players.filter((p) => !p.busted) ?? [], [view]);
  const slots = seatLayout(Math.max(2, seated.length));

  // While a request is in flight it is, by definition, an agent's move.
  const thinkingSeat =
    busy && view && view.stage !== 'complete' && view.toAct !== HUMAN_SEAT ? view.toAct : null;
  const thinkingName = thinkingSeat !== null
    ? (view?.players.find((p) => p.seat === thinkingSeat)?.name ?? null)
    : null;

  const yourTurn = !!view && view.stage !== 'complete' && view.toAct === HUMAN_SEAT;
  const winners = new Set(view?.awards.map((a) => a.seat) ?? []);

  if (!view) {
    return (
      <main className="flex h-screen items-center justify-center text-slate-400">
        {error ? <span className="text-rose-400">{error}</span> : 'Dealing in…'}
      </main>
    );
  }

  return (
    <main className="relative mx-auto flex h-screen min-h-[860px] max-w-[1600px] flex-col">
      <TopBar view={view} onNewGame={newGame} busy={busy} />

      <div className="relative flex-1">
        {/* felt */}
        <div className="absolute left-1/2 top-1/2 h-[clamp(500px,64vh,620px)] w-[clamp(880px,76vw,1200px)] -translate-x-1/2 -translate-y-1/2">
          <div className="absolute inset-0 rounded-[50%] border-[16px] border-[var(--rail)] bg-[radial-gradient(ellipse_at_50%_35%,#17714a_0%,var(--felt)_45%,var(--felt-edge)_100%)] shadow-[0_35px_90px_rgba(0,0,0,0.6),inset_0_0_80px_rgba(0,0,0,0.35)]" />

          {/* pot */}
          <div className="absolute left-1/2 top-[30%] flex -translate-x-1/2 flex-col items-center rounded-2xl bg-black/25 px-7 py-2">
            {view.stage === 'complete' && view.awards.length > 0 ? (
              view.awards.map((a) => (
                <div key={a.seat} className="whitespace-nowrap text-center">
                  <div className="text-[13px] text-emerald-200/80">
                    {a.handName ?? 'uncontested'}
                  </div>
                  <div className="text-[22px] font-bold leading-tight text-amber-300">
                    {a.name} +{a.amount.toLocaleString()}
                  </div>
                </div>
              ))
            ) : (
              <>
                <span className="text-[13px] text-emerald-200/80">Total Pot</span>
                <span className="text-[30px] font-bold tabular-nums leading-tight text-white">
                  {view.pot.toLocaleString()}
                </span>
              </>
            )}
          </div>

          {/* board */}
          <div className="absolute left-1/2 top-[52%] flex -translate-x-1/2 -translate-y-1/2 gap-2.5">
            {view.board.map((c, i) => (
              <PlayingCard key={c} card={c} delay={i * 80} />
            ))}
            {view.board.length === 0 && (
              <span className="text-sm tracking-[0.3em] text-emerald-200/40">PRE-FLOP</span>
            )}
          </div>

          {seated.map((p) => (
            <Seat
              key={p.seat}
              player={p}
              slot={slots[slotFor(p.seat, HUMAN_SEAT, seated.length)]}
              isButton={p.seat === view.button}
              toAct={view.stage !== 'complete' && p.seat === view.toAct}
              thinking={thinkingSeat === p.seat}
              won={view.stage === 'complete' && winners.has(p.seat)}
            />
          ))}
        </div>

      </div>

      <div className="flex items-end justify-between gap-6 px-6 pb-6">
        <HandHistory log={view.log} agentEvents={view.agentEvents} waitingOn={thinkingName} />
        {error && (
          <div className="rounded-lg border border-rose-800 bg-rose-950/60 px-3 py-2 text-sm text-rose-300">
            {error}
          </div>
        )}
        {view.stage === 'complete' ? (
          <BetweenHands view={view} onDeal={deal} busy={busy} />
        ) : (
          <ActionBar
            legal={view.legal}
            pot={view.pot}
            busy={busy}
            yourTurn={yourTurn}
            onAct={act}
          />
        )}
      </div>
    </main>
  );
}

function TopBar({
  view,
  onNewGame,
  busy,
}: {
  view: GameView;
  onNewGame: () => void;
  busy: boolean;
}) {
  return (
    <header className="flex items-center justify-between px-6 py-4">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2.5">
          <span className="text-[30px] leading-none">♠</span>
          <div className="leading-none">
            <div className="text-[21px] font-bold tracking-[0.14em]">AI POKER</div>
            <div className="mt-1 text-[10px] tracking-[0.3em] text-slate-500">HUMAN VS AI</div>
          </div>
        </div>
        <div className="h-9 w-px bg-slate-700/70" />
        <div className="text-[13px] leading-tight text-slate-300">
          <div className="font-semibold">No-Limit Texas Hold&apos;em</div>
          <div className="text-slate-500">
            Blinds {view.blinds.sb} / {view.blinds.bb} · Hand #{view.handNo}
          </div>
        </div>
      </div>

      <button
        onClick={onNewGame}
        disabled={busy}
        className="rounded-xl border border-[var(--pod-edge)] bg-[#131b26] px-4 py-2.5 text-[13px] font-semibold text-slate-200 transition hover:bg-[#1b2533] disabled:opacity-40"
      >
        New Game
      </button>
    </header>
  );
}

/** The action bar slot between hands: who won, and the button to deal the next one. */
function BetweenHands({
  view,
  onDeal,
  busy,
}: {
  view: GameView;
  onDeal: () => void;
  busy: boolean;
}) {
  return (
    <div className="flex w-[520px] flex-col gap-3 rounded-2xl border border-[var(--pod-edge)] bg-[#0d1219]/95 p-4 shadow-2xl backdrop-blur">
      <div className="text-[15px]">
        {view.awards.map((a) => (
          <div key={a.seat} className="text-amber-200">
            <span className="font-bold">{a.name}</span> {a.name === 'You' ? 'win' : 'wins'}{' '}
            {a.amount.toLocaleString()}
            {a.handName ? ` with ${a.handName}` : ''}
          </div>
        ))}
      </div>
      {view.matchOver ? (
        <div className="text-sm text-slate-400">Match over — start a new game to play again.</div>
      ) : (
        <button
          onClick={onDeal}
          disabled={busy}
          className="rounded-xl bg-[#1f9d55] py-3 text-[15px] font-bold text-white transition hover:bg-[#25b463] disabled:opacity-40"
        >
          {busy ? 'Dealing\u2026' : 'Next Hand'}
        </button>
      )}
    </div>
  );
}
