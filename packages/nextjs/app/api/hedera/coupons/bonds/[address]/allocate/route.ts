import { NextResponse } from "next/server";
import { callBond, getOperatorConfigError } from "~~/services/coupons/operator";
import { requireKnownBond } from "~~/services/coupons/state";
import { couponBondAbi } from "~~/utils/coupons/abi";

/** Sets a holder's allocated units on the bond. Issuer-only on-chain; signed here with the operator key. */
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

  let body: { holder?: string; units?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const holder = body.holder;
  const units = body.units;
  if (!holder || !/^0x[0-9a-fA-F]{40}$/.test(holder)) {
    return NextResponse.json({ error: "A valid holder EVM address is required" }, { status: 400 });
  }
  if (!Number.isInteger(units) || (units as number) < 0) {
    return NextResponse.json({ error: "Units must be a non-negative whole number" }, { status: 400 });
  }

  try {
    const hash = await callBond(bondAddress, couponBondAbi, "allocate", [
      holder as `0x${string}`,
      BigInt(units as number),
    ]);
    return NextResponse.json({ txHash: hash });
  } catch (e) {
    console.error("[api/hedera/coupons/bonds/[address]/allocate]", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed to allocate" }, { status: 500 });
  }
}
