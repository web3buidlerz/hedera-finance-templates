import { AccountId, Client, TopicMessageSubmitTransaction, TransactionId } from "@hiero-ledger/sdk";
import type { Desk } from "~~/app/api/hedera/audit/_lib/state";
import { serializeEntry, sha256Hex } from "~~/services/hcsAudit/entry";
import { fetchMirrorTransaction } from "~~/services/hcsAudit/mirror";
import type { AuditEntry } from "~~/services/hcsAudit/types";

/** Builds the next entry, chaining it to the last one that actually landed on the topic. */
export function nextEntry(desk: Desk, fields: Omit<AuditEntry, "prev" | "v">): AuditEntry {
  return { v: 1, prev: desk.lastHash, ...fields };
}

/** Submits an entry signed by the operator (always a valid publisher) and advances the chain on success. */
export async function submitEntryAsIssuer(
  client: Client,
  desk: Desk,
  entry: AuditEntry,
): Promise<{ sequenceNumber: number }> {
  if (!desk.topicId) throw new Error("No audit topic configured.");
  const bytes = serializeEntry(entry);
  const response = await new TopicMessageSubmitTransaction().setTopicId(desk.topicId).setMessage(bytes).execute(client);
  const receipt = await response.getReceipt(client);
  desk.lastHash = await sha256Hex(bytes);
  return { sequenceNumber: receipt.topicSequenceNumber?.toNumber() ?? 0 };
}

/** Builds (but does not sign) the HCS submission for a HashPack-authored entry, payer = the wallet. */
export async function prepareEntryForWallet(
  client: Client,
  desk: Desk,
  entry: AuditEntry,
  walletAccountId: string,
): Promise<{ transactionBytes: string }> {
  if (!desk.topicId) throw new Error("No audit topic configured.");
  const entryBytes = serializeEntry(entry);
  const transaction = await new TopicMessageSubmitTransaction()
    .setTopicId(desk.topicId)
    .setMessage(entryBytes)
    .setTransactionId(TransactionId.generate(AccountId.fromString(walletAccountId)))
    .freezeWith(client);
  desk.pending = { entry, entryBytes, expectedPayer: walletAccountId };
  return { transactionBytes: Buffer.from(transaction.toBytes()).toString("base64") };
}

/**
 * Confirms a HashPack-signed submission actually landed: paid by the
 * authorised wallet, and succeeded. Only then does the chain advance. Polls
 * briefly for mirror node indexing lag.
 */
export async function confirmWalletEntry(desk: Desk, transactionId: string): Promise<{ entry: AuditEntry }> {
  const pending = desk.pending;
  if (!pending) throw new Error("No pending entry to confirm.");

  let mirrorTx = null;
  for (let attempt = 0; attempt < 6 && !mirrorTx; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, 2000));
    mirrorTx = await fetchMirrorTransaction(transactionId);
  }

  if (!mirrorTx) throw new Error("Could not find the submitted transaction on the mirror node.");
  if (mirrorTx.name !== "CONSENSUSSUBMITMESSAGE" || mirrorTx.entity_id !== desk.topicId) {
    throw new Error("Submitted transaction does not match the expected audit topic message.");
  }
  if (!transactionId.startsWith(`${pending.expectedPayer}@`)) {
    throw new Error("Submitted transaction was not paid by the authorised wallet.");
  }
  if (mirrorTx.result !== "SUCCESS") {
    throw new Error(`Submission failed on-chain: ${mirrorTx.result}`);
  }

  desk.lastHash = await sha256Hex(pending.entryBytes);
  desk.pending = null;
  return { entry: pending.entry };
}

/** Discards a pending entry without advancing the chain (signature cancelled, etc). */
export function cancelPendingEntry(desk: Desk): void {
  desk.pending = null;
}
