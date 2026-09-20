import { NextResponse } from 'next/server';
import { z } from 'zod';
import { agentSeats, currentView, newMatch } from '@/lib/game/engine';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NewGame = z.object({
  blinds: z.object({ sb: z.number().int().positive(), bb: z.number().int().positive() }).optional(),
  startingStack: z.number().int().positive().optional(),
  agents: z.number().int().min(1).max(5).optional(),
});

export async function POST(req: Request) {
  try {
    const body = NewGame.parse(await req.json().catch(() => ({})));
    const stack = body.startingStack ?? 30_000;
    const agents = body.agents ?? 1;

    const seats = [
      { seat: 0, name: 'You', kind: 'human' as const, avatar: 'human', stack },
      ...agentSeats(agents, stack),
    ];

    return NextResponse.json(await newMatch({ seats, blinds: body.blinds }));
  } catch (err) {
    return NextResponse.json({ error: message(err) }, { status: 400 });
  }
}

export async function GET(req: Request) {
  const matchId = new URL(req.url).searchParams.get('matchId');
  if (!matchId) return NextResponse.json({ error: 'matchId required' }, { status: 400 });
  const view = await currentView(matchId);
  return view
    ? NextResponse.json(view)
    : NextResponse.json({ error: 'match not found' }, { status: 404 });
}

function message(err: unknown) {
  return err instanceof Error ? err.message : 'unexpected error';
}
