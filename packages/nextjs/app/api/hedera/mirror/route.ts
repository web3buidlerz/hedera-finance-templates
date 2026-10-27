import { NextResponse } from "next/server";
import { MIRROR_BASE } from "~~/utils/coupons/constants";

/**
 * Thin passthrough to the Hedera mirror node, in the same spirit as `/api/hedera/account`.
 * The coupon desk reads coupon history (contract logs) and investor balances (account token
 * balances) from here instead of server memory, so they reflect what the network actually did.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const path = searchParams.get("path");
  const network = (searchParams.get("network") ?? "testnet").toLowerCase();

  if (!path || !path.startsWith("/api/v1/")) {
    return NextResponse.json({ error: "Missing or invalid mirror node path" }, { status: 400 });
  }

  const base = MIRROR_BASE[network] ?? MIRROR_BASE.testnet;
  const forwarded = new URLSearchParams(searchParams);
  forwarded.delete("path");
  forwarded.delete("network");
  const query = forwarded.toString();
  const url = `${base}${path}${query ? `?${query}` : ""}`;

  try {
    const res = await fetch(url, { cache: "no-store" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      return NextResponse.json({ error: "Mirror node request failed", status: res.status, body }, { status: 502 });
    }
    return NextResponse.json(body);
  } catch (e) {
    console.error("[api/hedera/mirror]", e);
    return NextResponse.json({ error: "Mirror node request failed" }, { status: 502 });
  }
}
