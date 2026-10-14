import { base64ToBytes, parseEntryBytes, sha256Hex } from "~~/services/hcsAudit/entry";
import { MIRROR_BASE_URL, type MirrorTopicMessage, fetchMirrorTransaction } from "~~/services/hcsAudit/mirror";
import { type AuditEntry, ZERO_HASH } from "~~/services/hcsAudit/types";

export type FeedStatus = "VERIFIED" | "BROKEN" | "EMPTY";

export type FeedRow = {
  sequenceNumber: number;
  consensusTimestamp: string;
  payerAccountId: string;
  entry: AuditEntry | null;
  checks: { sequence: boolean; chain: boolean; transaction: boolean };
};

export type FeedResult = {
  status: FeedStatus;
  brokenAt?: { sequenceNumber: number; reason: string };
  rows: FeedRow[];
};

/**
 * Re-derives and checks the audit trail exactly as the regulator must: no
 * state is trusted except what the mirror node reports. Messages must be
 * oldest-first and contiguous from sequence 1.
 */
export async function verifyFeed(messages: MirrorTopicMessage[], baseUrl = MIRROR_BASE_URL): Promise<FeedResult> {
  if (messages.length === 0) return { status: "EMPTY", rows: [] };

  const rows: FeedRow[] = [];
  let prevBytes: Uint8Array | null = null;
  let brokenAt: { sequenceNumber: number; reason: string } | undefined;

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const expectedSequence = i + 1;
    const sequenceOk = msg.sequence_number === expectedSequence;

    const bytes = base64ToBytes(msg.message);
    const entry = parseEntryBytes(bytes);

    const expectedPrev = prevBytes ? await sha256Hex(prevBytes) : ZERO_HASH;
    const chainOk = entry !== null && entry.prev === expectedPrev;

    let txOk = false;
    if (entry) {
      const mirrorTx = await fetchMirrorTransaction(entry.tx, baseUrl);
      txOk = mirrorTx !== null && mirrorTx.result === entry.result;
    }

    rows.push({
      sequenceNumber: msg.sequence_number,
      consensusTimestamp: msg.consensus_timestamp,
      payerAccountId: msg.payer_account_id,
      entry,
      checks: { sequence: sequenceOk, chain: chainOk, transaction: txOk },
    });

    if (!brokenAt && !(sequenceOk && entry !== null && chainOk && txOk)) {
      const reason = !sequenceOk
        ? `expected sequence ${expectedSequence}, got ${msg.sequence_number}`
        : entry === null
          ? "message is not a valid audit entry"
          : !chainOk
            ? "prev does not match the hash of the previous message"
            : "referenced transaction result does not match the entry";
      brokenAt = { sequenceNumber: msg.sequence_number, reason };
    }

    prevBytes = bytes;
  }

  return { status: brokenAt ? "BROKEN" : "VERIFIED", brokenAt, rows };
}
