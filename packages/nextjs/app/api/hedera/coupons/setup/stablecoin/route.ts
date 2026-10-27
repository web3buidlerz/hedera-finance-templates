import { NextResponse } from "next/server";
import { AccountId, TokenCreateTransaction, TokenSupplyType } from "@hiero-ledger/sdk";
import { getHederaClient, getOperatorAccountId, getOperatorConfigError } from "~~/services/coupons/operator";
import { getDeskState, setStablecoin } from "~~/services/coupons/state";
import { STABLECOIN_DECIMALS } from "~~/utils/coupons/constants";

/** Creates the desk's HTS stablecoin, treasury the operator. Idempotent. */
export async function POST() {
  const configError = getOperatorConfigError();
  if (configError) return NextResponse.json({ error: configError }, { status: 400 });

  const existing = getDeskState().stablecoin;
  if (existing) return NextResponse.json({ stablecoin: existing });

  try {
    const client = getHederaClient();
    const operatorId = AccountId.fromString(getOperatorAccountId());

    const response = await new TokenCreateTransaction()
      .setTokenName("Coupon Desk Stablecoin")
      .setTokenSymbol("mUSD")
      .setDecimals(STABLECOIN_DECIMALS)
      .setInitialSupply(10_000_000 * 10 ** STABLECOIN_DECIMALS)
      .setSupplyType(TokenSupplyType.Infinite)
      .setTreasuryAccountId(operatorId)
      .execute(client);
    const receipt = await response.getReceipt(client);
    const tokenId = receipt.tokenId;
    if (!tokenId) throw new Error("Token creation did not return a token id");

    const stablecoin = {
      tokenId: tokenId.toString(),
      evmAddress: `0x${tokenId.toSolidityAddress()}` as `0x${string}`,
      decimals: STABLECOIN_DECIMALS,
      symbol: "mUSD",
    };
    setStablecoin(stablecoin);
    return NextResponse.json({ stablecoin });
  } catch (e) {
    console.error("[api/hedera/coupons/setup/stablecoin]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to create stablecoin" },
      { status: 500 },
    );
  }
}
