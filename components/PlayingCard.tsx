import { glyphOf, isRed, rankOf, type Card } from '@/lib/poker/cards';

const SIZES = {
  board: 'w-[68px] h-[96px] text-[30px]',
  hole: 'w-[62px] h-[88px] text-[28px]',
  seat: 'w-[42px] h-[60px] text-[19px]',
} as const;

export function PlayingCard({
  card,
  size = 'board',
  delay = 0,
}: {
  card: Card;
  size?: keyof typeof SIZES;
  delay?: number;
}) {
  return (
    <div
      className={`deal-in flex flex-col items-center justify-center rounded-[7px] border border-slate-300 bg-white font-bold leading-none shadow-lg ${SIZES[size]} ${
        isRed(card) ? 'text-[#d1344a]' : 'text-[#10151d]'
      }`}
      style={{ animationDelay: `${delay}ms` }}
    >
      <span>{rankOf(card)}</span>
      <span className="text-[0.78em] font-normal">{glyphOf(card)}</span>
    </div>
  );
}

export function CardBack({ size = 'seat' }: { size?: keyof typeof SIZES }) {
  return (
    <div
      className={`deal-in rounded-[7px] border-[3px] border-slate-100 shadow-lg ${SIZES[size]}`}
      style={{
        background:
          'repeating-linear-gradient(45deg, #2f5ea8 0 6px, #27508f 6px 12px)',
      }}
    />
  );
}
