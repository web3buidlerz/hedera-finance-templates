import { NextResponse } from "next/server";
import {
  freezeHolder,
  grantKyc,
  resolveTarget,
  transferToHolder,
  unfreezeHolder,
} from "~~/app/api/hedera/audit/_lib/actions";
import { getOperator, getOperatorClient, hasOperatorEnv } from "~~/app/api/hedera/audit/_lib/operator";
import { nextEntry, submitEntryAsIssuer } from "~~/app/api/hedera/audit/_lib/publish";
import { getDesk, requireSetUp } from "~~/app/api/hedera/audit/_lib/state";
import { ACTION_EVENT, type TokenAction } from "~~/services/hcsAudit/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_ACTIONS: readonly TokenAction[] = ["grant_kyc", "transfer", "freeze", "unfreeze"];

export async function POST(req: Request) {
  if (!hasOperatorEnv()) {
    return NextResponse.json({ error: "No operator configured." }, { status: 400 });
  }

  const body = (await req.json().catch(() => null)) as { action?: string; amount?: number; account?: string } | null;
  const action = body?.action as TokenAction | undefined;
  if (!action || !VALID_ACTIONS.includes(action)) {
    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  }

  const desk = getDesk();
  try {
    requireSetUp(desk);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }

  const tokenId = desk.tokenId;
  const client = getOperatorClient();
  const { accountId: operatorId } = getOperator();
  let holderAccountId: string;
  try {
    holderAccountId = resolveTarget(body?.account, desk.holderAccountId, operatorId.toString());
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }

  let amount: number | null = null;
  let outcome: { tx: string; result: string };

  if (action === "transfer") {
    const rawAmount = Number(body?.amount);
    if (!Number.isInteger(rawAmount) || rawAmount <= 0) {
      return NextResponse.json({ error: "Transfer amount must be a positive whole number." }, { status: 400 });
    }
    amount = rawAmount;
    outcome = await transferToHolder(client, tokenId, operatorId.toString(), holderAccountId, rawAmount);
  } else if (action === "grant_kyc") {
    outcome = await grantKyc(client, tokenId, holderAccountId);
  } else if (action === "freeze") {
    outcome = await freezeHolder(client, tokenId, holderAccountId);
  } else {
    outcome = await unfreezeHolder(client, tokenId, holderAccountId);
  }

  const entry = nextEntry(desk, {
    event: ACTION_EVENT[action],
    token: tokenId,
    account: holderAccountId,
    amount,
    tx: outcome.tx,
    result: outcome.result,
  });

  const { sequenceNumber } = await submitEntryAsIssuer(client, desk, entry);

  return NextResponse.json({ entry, sequenceNumber });
}
