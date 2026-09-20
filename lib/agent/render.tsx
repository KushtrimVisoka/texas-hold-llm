import fs from 'node:fs';
import path from 'node:path';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { isRed, rankOf, suitOf, type Card } from '../poker/cards';
import { SUIT_PATH } from '../poker/suits';
import { fmt } from '../poker/dealer';
import { seatLayout, slotFor } from '../poker/seats';
import type { HandState, Player } from '../poker/state';
import type { SeatSlot } from '../poker/seats';

const WIDTH = 900;
const HEIGHT = 600;

let fonts: { name: string; data: Buffer; weight: 400 | 700; style: 'normal' }[] | null = null;

function loadFonts() {
  if (fonts) return fonts;
  const dir = path.join(process.cwd(), 'public', 'fonts');
  fonts = [
    { name: 'Inter', data: fs.readFileSync(path.join(dir, 'Inter-Regular.woff')), weight: 400, style: 'normal' },
    { name: 'Inter', data: fs.readFileSync(path.join(dir, 'Inter-Bold.woff')), weight: 700, style: 'normal' },
  ];
  return fonts;
}

/**
 * Renders the table as the agent sees it.
 *
 * This is the security boundary as well as the picture: hole cards for any seat other
 * than `pov` are drawn face-down, so a leak is impossible by construction. Because it
 * renders from HandState rather than screen-scraping a browser, the same hand always
 * produces the same image and can be replayed later.
 */
export async function renderTable(s: HandState, pov: number): Promise<Buffer> {
  const svg = await satori(<TableView state={s} pov={pov} />, {
    width: WIDTH,
    height: HEIGHT,
    fonts: loadFonts(),
  });
  return Buffer.from(new Resvg(svg, { fitTo: { mode: 'width', value: WIDTH } }).render().asPng());
}

const row = (extra: Record<string, unknown> = {}) => ({
  display: 'flex' as const,
  alignItems: 'center' as const,
  ...extra,
});

function TableView({ state, pov }: { state: HandState; pov: number }) {
  const seated = state.players.filter((p) => !p.busted);
  const slots = seatLayout(seated.length);

  return (
    <div
      style={{
        width: WIDTH,
        height: HEIGHT,
        display: 'flex',
        position: 'relative',
        backgroundColor: '#0c1017',
        fontFamily: 'Inter',
      }}
    >
      {/* felt */}
      <div
        style={{
          position: 'absolute',
          left: 70,
          top: 70,
          width: WIDTH - 140,
          height: HEIGHT - 175,
          borderRadius: 220,
          backgroundColor: '#12603d',
          border: '14px solid #2a1c14',
          display: 'flex',
        }}
      />

      {/* pot */}
      <div
        style={{
          position: 'absolute',
          top: 168,
          left: 0,
          width: WIDTH,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
        }}
      >
        <div style={{ fontSize: 15, color: '#9fd8bb' }}>Total Pot</div>
        <div style={{ fontSize: 34, fontWeight: 700, color: '#ffffff' }}>{fmt(state.pot)}</div>
      </div>

      {/* board */}
      <div
        style={{
          position: 'absolute',
          top: 240,
          left: 0,
          width: WIDTH,
          display: 'flex',
          justifyContent: 'center',
        }}
      >
        {state.board.map((c) => (
          <FaceCard key={c} card={c} w={62} h={88} />
        ))}
        {state.board.length === 0 && (
          <div style={{ fontSize: 16, color: '#7fbf9d' }}>pre-flop</div>
        )}
      </div>

      {seated.map((p) => {
        const slot = slots[slotFor(p.seat, pov, seated.length)];
        return (
          <SeatPod
            key={p.seat}
            player={p}
            slot={slot}
            isPov={p.seat === pov}
            isButton={p.seat === state.button}
            toAct={p.seat === state.toAct}
            revealed={state.revealed.includes(p.seat)}
          />
        );
      })}

      <div
        style={{
          position: 'absolute',
          left: 20,
          bottom: 14,
          fontSize: 14,
          color: '#5d6b7d',
          display: 'flex',
        }}
      >
        {`${state.stage.toUpperCase()}  ·  blinds ${fmt(state.blinds.sb)}/${fmt(state.blinds.bb)}  ·  hand #${state.handNo}`}
      </div>
    </div>
  );
}

function SeatPod({
  player,
  slot,
  isPov,
  isButton,
  toAct,
  revealed,
}: {
  player: Player;
  slot: SeatSlot;
  isPov: boolean;
  isButton: boolean;
  toAct: boolean;
  revealed: boolean;
}) {
  const showCards = isPov || revealed;
  const cx = (slot.x / 100) * WIDTH;
  const cy = (slot.y / 100) * HEIGHT;
  const status = player.folded ? 'Folded' : player.allIn ? 'All-in' : toAct ? 'To act' : 'In hand';
  const statusBg = player.folded ? '#3a2430' : player.allIn ? '#5b2230' : toAct ? '#1d4ed8' : '#1c2531';

  return (
    <div style={{ position: 'absolute', left: 0, top: 0, width: WIDTH, height: HEIGHT, display: 'flex' }}>
      {/* hole cards, tucked behind the pod */}
      <div
        style={{
          position: 'absolute',
          left: cx - 48,
          top: cy - 96,
          display: 'flex',
        }}
      >
        {player.hole && !player.folded ? (
          showCards ? (
            player.hole.map((c) => <FaceCard key={c} card={c} w={44} h={62} />)
          ) : (
            <>
              <BackCard />
              <BackCard />
            </>
          )
        ) : null}
      </div>

      <div
        style={{
          position: 'absolute',
          left: cx - 95,
          top: cy - 26,
          width: 190,
          display: 'flex',
          alignItems: 'center',
          padding: 10,
          borderRadius: 14,
          backgroundColor: player.folded ? 'rgba(14,19,27,0.85)' : '#0f151f',
          border: toAct ? '2px solid #3b82f6' : '2px solid #222c3a',
          opacity: player.folded ? 0.55 : 1,
        }}
      >
        <div
          style={{
            width: 42,
            height: 42,
            borderRadius: 21,
            backgroundColor: avatarColor(player.avatar),
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 18,
            fontWeight: 700,
            color: '#ffffff',
            marginRight: 10,
          }}
        >
          {player.name.slice(0, 1).toUpperCase()}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ ...row(), fontSize: 16, fontWeight: 700, color: '#eef2f7' }}>
            {player.name}
            {isButton ? (
              <div
                style={{
                  marginLeft: 6,
                  width: 17,
                  height: 17,
                  borderRadius: 9,
                  backgroundColor: '#f8fafc',
                  color: '#0c1017',
                  fontSize: 11,
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                D
              </div>
            ) : null}
          </div>
          <div style={{ fontSize: 17, fontWeight: 700, color: '#ffffff' }}>{fmt(player.stack)}</div>
          <div
            style={{
              marginTop: 3,
              paddingLeft: 7,
              paddingRight: 7,
              paddingTop: 1,
              paddingBottom: 1,
              borderRadius: 5,
              fontSize: 11,
              color: '#dbe4ef',
              backgroundColor: statusBg,
              display: 'flex',
            }}
          >
            {status}
          </div>
        </div>
      </div>

      {player.committed > 0 && (
        <div
          style={{
            position: 'absolute',
            left: (slot.chips.x / 100) * WIDTH - 36,
            top: (slot.chips.y / 100) * HEIGHT,
            display: 'flex',
            alignItems: 'center',
            paddingLeft: 8,
            paddingRight: 8,
            paddingTop: 3,
            paddingBottom: 3,
            borderRadius: 11,
            backgroundColor: 'rgba(6,10,16,0.82)',
            fontSize: 14,
            fontWeight: 700,
            color: '#ffd67e',
          }}
        >
          {fmt(player.committed)}
        </div>
      )}
    </div>
  );
}

function FaceCard({ card, w, h }: { card: Card; w: number; h: number }) {
  const color = isRed(card) ? '#d1344a' : '#10151d';
  const pip = Math.round(w * 0.38);
  return (
    <div
      style={{
        width: w,
        height: h,
        marginLeft: 4,
        marginRight: 4,
        borderRadius: 7,
        backgroundColor: '#ffffff',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        border: '1px solid #c9d2de',
      }}
    >
      <div style={{ fontSize: Math.round(w * 0.46), fontWeight: 700, color, lineHeight: 1 }}>
        {rankOf(card)}
      </div>
      <svg width={pip} height={pip} viewBox="0 0 24 24" style={{ marginTop: 2 }}>
        <path d={SUIT_PATH[suitOf(card)]} fill={color} />
      </svg>
    </div>
  );
}

function BackCard() {
  return (
    <div
      style={{
        width: 44,
        height: 62,
        marginLeft: 4,
        marginRight: 4,
        borderRadius: 7,
        backgroundColor: '#2f5ea8',
        border: '3px solid #e8edf5',
        display: 'flex',
      }}
    />
  );
}

function avatarColor(avatar: string): string {
  switch (avatar) {
    case 'claude':
      return '#d97757';
    case 'gpt':
      return '#0f9d76';
    case 'gemini':
      return '#3b7de8';
    case 'llama':
      return '#8b6bd4';
    case 'gemma':
      return '#4a90d9';
    case 'qwen':
      return '#6b4fd4';
    case 'deepseek':
      return '#2f6fd0';
    case 'bot':
      return '#4b5b70';
    default:
      return '#2a7fe8';
  }
}
