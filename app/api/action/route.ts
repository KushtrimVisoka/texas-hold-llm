import { NextResponse } from 'next/server';
import { z } from 'zod';
import { applyHumanAction } from '@/lib/game/engine';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({
  matchId: z.string().min(1),
  action: z.discriminatedUnion('type', [
    z.object({ type: z.literal('fold') }),
    z.object({ type: z.literal('check') }),
    z.object({ type: z.literal('call') }),
    z.object({ type: z.literal('raise'), to: z.number().int().positive() }),
  ]),
});

export async function POST(req: Request) {
  try {
    const { matchId, action } = Body.parse(await req.json());
    // Seat is stamped server-side; the client cannot act for anyone but itself.
    const view = await applyHumanAction(matchId, { ...action, seat: 0 });
    return NextResponse.json(view);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'unexpected error' },
      { status: 400 },
    );
  }
}
