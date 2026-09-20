import { NextResponse } from 'next/server';
import { z } from 'zod';
import { dealHand } from '@/lib/game/engine';
import { getMatch } from '@/lib/db/repo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({ matchId: z.string().min(1) });

export async function POST(req: Request) {
  try {
    const { matchId } = Body.parse(await req.json());
    const match = getMatch(matchId);
    if (!match) return NextResponse.json({ error: 'match not found' }, { status: 404 });
    return NextResponse.json(await dealHand(match));
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'unexpected error' },
      { status: 400 },
    );
  }
}
