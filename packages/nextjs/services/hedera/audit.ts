/**
 * The HCS audit trail: one entry per event in a trade's life, chained by the SHA-256 of the
 * previous entry's exact message bytes so the log can be verified independently from the mirror
 * node, without trusting this server.
 */
import { Client, TopicCreateTransaction, TopicMessageSubmitTransaction } from "@hiero-ledger/sdk";
import { createHash } from "node:crypto";
import { fetchTopicMessages, mirrorTimestampToIso } from "~~/services/hedera/mirror";
import type { Market } from "~~/services/hedera/store";
import type { AuditEntrySnapshot } from "~~/services/hedera/types";

export const GENESIS_HASH = "0".repeat(64);

export type AuditEvent = "proposed" | "signed" | "settled" | "rejected" | "cancelled" | "expired";

type AuditMessage = {
  v: 1;
  event: AuditEvent;
  schedule: string;
  quantity: number;
  price: number;
  seller: string;
  buyer: string;
  tx: string | null;
  result: string | null;
  prev: string;
};

/** Creates the market's audit topic, submit key held by the operator. */
export async function createAuditTopic(client: Client): Promise<string> {
  const operatorKey = client.operatorPublicKey;
  if (!operatorKey) throw new Error("Operator key is not available on the client");
  const receipt = await (
    await new TopicCreateTransaction().setSubmitKey(operatorKey).setTopicMemo("DvP audit log").execute(client)
  ).getReceipt(client);
  if (!receipt.topicId) throw new Error("Topic creation did not return a topic id");
  return receipt.topicId.toString();
}

/**
 * Publishes one audit entry and advances the market's `prev` hash chain. Queued onto
 * `market.auditQueue` by every caller so concurrent events (a sign racing the background
 * reconciler, say) never land out of order and break the chain.
 */
export function publishAuditEvent(
  client: Client,
  market: Market,
  fields: Omit<AuditMessage, "v" | "prev">,
): Promise<void> {
  const task = market.auditQueue.then(async () => {
    if (!market.auditTopicId) return;
    const message: AuditMessage = { v: 1, prev: market.auditPrevHash, ...fields };
    const bytes = Buffer.from(JSON.stringify(message), "utf8");
    await (
      await new TopicMessageSubmitTransaction().setTopicId(market.auditTopicId).setMessage(bytes).execute(client)
    ).getReceipt(client);
    market.auditPrevHash = createHash("sha256").update(bytes).digest("hex");
  });
  // Swallow so one failed publish doesn't jam the queue for every later event; the error is still
  // visible to this call's own caller via the returned (unchained) promise below.
  market.auditQueue = task.catch(() => undefined);
  return task;
}

/** Reads the market's audit entries from the mirror node, newest first. */
export async function fetchAuditLog(topicId: string): Promise<AuditEntrySnapshot[]> {
  const messages = await fetchTopicMessages(topicId);
  const entries: AuditEntrySnapshot[] = [];
  for (const m of messages) {
    try {
      const parsed = JSON.parse(m.message) as AuditMessage;
      entries.push({
        sequenceNumber: m.sequenceNumber,
        consensusTime: mirrorTimestampToIso(m.consensusTimestamp),
        event: parsed.event,
        schedule: parsed.schedule,
        result: parsed.result,
        tx: parsed.tx,
      });
    } catch {
      // Not one of ours (shouldn't happen - the topic is only ever written by this app) - skip it.
    }
  }
  return entries.reverse();
}
