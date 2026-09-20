import fs from 'node:fs';
import path from 'node:path';
import { loadHand } from '@/lib/db/repo';
import { renderTable } from '@/lib/agent/render';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const RENDER_ROOT = path.resolve(process.env.RENDER_DIR ?? 'renders');

/**
 * Serves the exact picture the agent was shown at a given point in a hand, or renders
 * the current state live when no `seq` is given. This is the debugging surface for
 * "why on earth did it do that".
 */
export async function GET(req: Request, ctx: { params: Promise<{ handId: string }> }) {
  const { handId } = await ctx.params;
  const url = new URL(req.url);
  const seq = url.searchParams.get('seq');

  if (seq !== null) {
    // handId and seq are coerced before use, so the path cannot escape the root.
    const file = path.join(RENDER_ROOT, path.basename(handId), `${Number(seq)}.png`);
    if (!fs.existsSync(file)) return new Response('no render for that step', { status: 404 });
    return png(fs.readFileSync(file));
  }

  const state = loadHand(handId);
  if (!state) return new Response('hand not found', { status: 404 });
  const pov = Number(url.searchParams.get('pov') ?? state.toAct);
  return png(await renderTable(state, Number.isFinite(pov) && pov >= 0 ? pov : 1));
}

function png(body: Buffer) {
  return new Response(new Uint8Array(body), {
    headers: { 'content-type': 'image/png', 'cache-control': 'no-store' },
  });
}
