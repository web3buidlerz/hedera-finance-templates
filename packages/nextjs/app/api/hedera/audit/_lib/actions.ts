import {
  Client,
  PrecheckStatusError,
  ReceiptStatusError,
  TokenFreezeTransaction,
  TokenGrantKycTransaction,
  TokenUnfreezeTransaction,
  TransferTransaction,
} from "@hiero-ledger/sdk";
import type { TokenAction } from "~~/services/hcsAudit/types";

export type ActionOutcome = { tx: string; result: string };

/**
 * Both `PrecheckStatusError` and `ReceiptStatusError` (the two ways the SDK
 * surfaces a non-SUCCESS network result) carry `.status` and `.transactionId`.
 * We want those regardless of success or failure: a refused action is still
 * logged, with the network's result code.
 */
function outcomeFromError(error: unknown): ActionOutcome {
  if (error instanceof ReceiptStatusError || error instanceof PrecheckStatusError) {
    return { tx: error.transactionId.toString(), result: error.status.toString() };
  }
  throw error;
}

export async function grantKyc(client: Client, tokenId: string, holderAccountId: string): Promise<ActionOutcome> {
  try {
    const response = await new TokenGrantKycTransaction()
      .setTokenId(tokenId)
      .setAccountId(holderAccountId)
      .execute(client);
    const receipt = await response.getReceipt(client);
    return { tx: response.transactionId.toString(), result: receipt.status.toString() };
  } catch (error) {
    return outcomeFromError(error);
  }
}

export async function freezeHolder(client: Client, tokenId: string, holderAccountId: string): Promise<ActionOutcome> {
  try {
    const response = await new TokenFreezeTransaction()
      .setTokenId(tokenId)
      .setAccountId(holderAccountId)
      .execute(client);
    const receipt = await response.getReceipt(client);
    return { tx: response.transactionId.toString(), result: receipt.status.toString() };
  } catch (error) {
    return outcomeFromError(error);
  }
}

export async function unfreezeHolder(client: Client, tokenId: string, holderAccountId: string): Promise<ActionOutcome> {
  try {
    const response = await new TokenUnfreezeTransaction()
      .setTokenId(tokenId)
      .setAccountId(holderAccountId)
      .execute(client);
    const receipt = await response.getReceipt(client);
    return { tx: response.transactionId.toString(), result: receipt.status.toString() };
  } catch (error) {
    return outcomeFromError(error);
  }
}

export async function transferToHolder(
  client: Client,
  tokenId: string,
  issuerAccountId: string,
  holderAccountId: string,
  amount: number,
): Promise<ActionOutcome> {
  try {
    const response = await new TransferTransaction()
      .addTokenTransfer(tokenId, issuerAccountId, -amount)
      .addTokenTransfer(tokenId, holderAccountId, amount)
      .execute(client);
    const receipt = await response.getReceipt(client);
    return { tx: response.transactionId.toString(), result: receipt.status.toString() };
  } catch (error) {
    return outcomeFromError(error);
  }
}

/**
 * The account an action applies to: the demo holder unless the caller names another testnet
 * account. The issuer cannot target itself (it is the token's treasury and key holder).
 */
export function resolveTarget(raw: unknown, holderAccountId: string, issuerAccountId: string): string {
  if (raw === undefined || raw === null || String(raw).trim() === "") return holderAccountId;
  const id = String(raw).trim();
  if (!/^0\.0\.\d+$/.test(id)) throw new Error("Target account must look like 0.0.1234.");
  if (id === issuerAccountId) throw new Error("The issuer cannot be the target of its own token actions.");
  return id;
}

export const TOKEN_ACTIONS: readonly TokenAction[] = ["grant_kyc", "transfer", "freeze", "unfreeze"];
