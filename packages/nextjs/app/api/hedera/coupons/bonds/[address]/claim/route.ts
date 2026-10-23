import { NextResponse } from "next/server";
import { callBond, getOperatorConfigError } from "~~/services/coupons/operator";
import { requireKnownBond } from "~~/services/coupons/state";
import { couponBondAbi } from "~~/utils/coupons/abi";

/**
 * Pays a holder what an earlier coupon could not deliver — because they had not associated
 * the stablecoin, say. The contract sends it to the holder whoever calls, so the desk can do
 * it on their behalf and no holder needs HBAR of their own to be paid.
 */
export async function POST(req: Request, { params }: { params: Promise<{ address: string }> }) {
  const configError = getOperatorConfigError();
  if (configError) return NextResponse.json({ error: configError }, { status: 400 });

  const { address } = await params;
  let bondAddress: `0x${string}`;
  try {
    bondAddress = requireKnownBond(address);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown bond" }, { status: 400 });
  }

  let body: { holder?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  if (!body.holder || !/^0x[0-9a-fA-F]{40}$/.test(body.holder)) {
    return NextResponse.json({ error: "A valid holder EVM address is required" }, { status: 400 });
  }

  try {
    const hash = await callBond(bondAddress, couponBondAbi, "claimFor", [body.holder as `0x${string}`]);
    return NextResponse.json({ txHash: hash });
  } catch (e) {
    console.error("[api/hedera/coupons/bonds/[address]/claim]", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed to pay what is owed" }, { status: 500 });
  }
}
