import { NextResponse } from "next/server";
import { callBond, getOperatorConfigError } from "~~/services/coupons/operator";
import { requireKnownBond } from "~~/services/coupons/state";
import { couponBondAbi } from "~~/utils/coupons/abi";

/** Issuer calls `stop()`: cancels the pending schedule and halts the bond. */
export async function POST(_req: Request, { params }: { params: Promise<{ address: string }> }) {
  const configError = getOperatorConfigError();
  if (configError) return NextResponse.json({ error: configError }, { status: 400 });

  const { address } = await params;
  let bondAddress: `0x${string}`;
  try {
    bondAddress = requireKnownBond(address);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown bond" }, { status: 400 });
  }

  try {
    const hash = await callBond(bondAddress, couponBondAbi, "stop");
    return NextResponse.json({ txHash: hash });
  } catch (e) {
    console.error("[api/hedera/coupons/bonds/[address]/stop]", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed to stop the bond" }, { status: 500 });
  }
}
