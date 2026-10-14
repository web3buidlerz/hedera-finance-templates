import type { PrivateKey } from "@hiero-ledger/sdk";
import type { AuditEntry, Publisher } from "~~/services/hcsAudit/types";
import { ZERO_HASH } from "~~/services/hcsAudit/types";

/**
 * A HashPack-signed entry that has been built and handed to the wallet, but
 * not yet confirmed to have landed on the topic. Only one action is ever in
 * flight at a time (the UI disables actions while one runs).
 */
export type PendingEntry = {
  entry: AuditEntry;
  entryBytes: Uint8Array;
  expectedPayer: string;
};

export type Desk = {
  topicId: string | null;
  tokenId: string | null;
  holderAccountId: string | null;
  holderKey: PrivateKey | null;
  outsiderAccountId: string | null;
  outsiderKey: PrivateKey | null;
  lastHash: string;
  publishers: Publisher[];
  pending: PendingEntry | null;
};

function freshDesk(): Desk {
  return {
    topicId: null,
    tokenId: null,
    holderAccountId: null,
    holderKey: null,
    outsiderAccountId: null,
    outsiderKey: null,
    lastHash: ZERO_HASH,
    publishers: [],
    pending: null,
  };
}

// Stashed on globalThis so Next.js dev-mode module reloads (HMR) reuse the
// same in-memory desk instead of silently resetting it on every edit.
// Surviving a server restart is explicitly not required.
const globalForDesk = globalThis as unknown as { __hcsAuditDesk?: Desk };

export function getDesk(): Desk {
  if (!globalForDesk.__hcsAuditDesk) {
    globalForDesk.__hcsAuditDesk = freshDesk();
  }
  return globalForDesk.__hcsAuditDesk;
}

/** Running setup again starts a fresh trail. */
export function resetDesk(): Desk {
  globalForDesk.__hcsAuditDesk = freshDesk();
  return globalForDesk.__hcsAuditDesk;
}

export function requireSetUp(
  desk: Desk,
): asserts desk is Desk & { topicId: string; tokenId: string; holderAccountId: string } {
  if (!desk.topicId || !desk.tokenId || !desk.holderAccountId) {
    throw new Error("Run setup before performing actions.");
  }
}
