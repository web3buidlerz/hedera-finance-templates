import { NextResponse } from "next/server";
import { cancelPendingEntry, confirmWalletEntry } from "~~/app/api/hedera/audit/_lib/publish";
import { getDesk } from "~~/app/api/hedera/audit/_lib/state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * HashPack mode, step 2: the browser reports what HashPack did. The server
 * trusts none of it beyond the transaction id — it looks the transaction up
 * on the mirror node itself, confirms it was paid by the authorised wallet
 * and succeeded, and only then advances the chain.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { transactionId?: string; cancelled?: boolean } | null;
  const desk = getDesk();

  if (body?.cancelled) {
    cancelPendingEntry(desk);
    return NextResponse.json({ ok: true, cancelled: true });
  }

  if (!body?.transactionId) {
    return NextResponse.json({ error: "Missing transactionId." }, { status: 400 });
  }

  try {
    const { entry } = await confirmWalletEntry(desk, body.transactionId);
    return NextResponse.json({ ok: true, entry });
  } catch (error) {
    // Whatever went wrong, the pending entry never landed: don't advance the chain,
    // but don't leave it stuck open either.
    cancelPendingEntry(desk);
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
