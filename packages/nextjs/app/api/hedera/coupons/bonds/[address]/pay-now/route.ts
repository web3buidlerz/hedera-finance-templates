import { NextResponse } from "next/server";
import { callBond, getOperatorConfigError } from "~~/services/coupons/operator";
import { requireKnownBond } from "~~/services/coupons/state";
import { couponBondAbi } from "~~/utils/coupons/abi";

/**
 * `payCoupon()` may be called by anyone once a coupon is due; this is the server-signed path
 * for the `#pay-now` fallback button (no wallet is required to press it).
 */
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
    const hash = await callBond(bondAddress, couponBondAbi, "payCoupon");
    return NextResponse.json({ txHash: hash });
  } catch (e) {
    console.error("[api/hedera/coupons/bonds/[address]/pay-now]", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed to pay the coupon" }, { status: 500 });
  }
}
