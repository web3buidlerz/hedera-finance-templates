import type { AuditEntry } from "~~/services/hcsAudit/types";

/**
 * Serializes an entry with a fixed key order. The exact bytes produced here are
 * what gets submitted as the HCS message, and what `prev` on the next entry
 * hashes. Always go through this function so hashing is reproducible both when
 * publishing (server) and when verifying (browser).
 */
export function serializeEntry(entry: AuditEntry): Uint8Array {
  const ordered: AuditEntry = {
    v: entry.v,
    event: entry.event,
    token: entry.token,
    account: entry.account,
    amount: entry.amount,
    tx: entry.tx,
    result: entry.result,
    prev: entry.prev,
  };
  return new TextEncoder().encode(JSON.stringify(ordered));
}

/** SHA-256 of the given bytes, as lowercase hex. Works in both Node (18+) and browsers via WebCrypto. */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes.slice().buffer as ArrayBuffer);
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

function isAuditEvent(value: unknown): value is AuditEntry["event"] {
  return (
    value === "issue" || value === "grant_kyc" || value === "transfer" || value === "freeze" || value === "unfreeze"
  );
}

/** Validates that a decoded JSON value has exactly the shape of an audit entry. */
export function isAuditEntry(value: unknown): value is AuditEntry {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    v.v === 1 &&
    isAuditEvent(v.event) &&
    typeof v.token === "string" &&
    (v.account === null || typeof v.account === "string") &&
    (v.amount === null || typeof v.amount === "number") &&
    typeof v.tx === "string" &&
    typeof v.result === "string" &&
    typeof v.prev === "string" &&
    v.prev.length === 64
  );
}

/** Decodes a base64 string to raw bytes. Always succeeds for well-formed base64, regardless of content. */
export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Parses raw message bytes as an audit entry, or null if they aren't one. */
export function parseEntryBytes(bytes: Uint8Array): AuditEntry | null {
  try {
    const parsed = JSON.parse(new TextDecoder().decode(bytes));
    return isAuditEntry(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Decodes a base64-encoded HCS message into an audit entry, or null if it isn't one. */
export function decodeEntryBase64(base64: string): { entry: AuditEntry; bytes: Uint8Array } | null {
  try {
    const bytes = base64ToBytes(base64);
    const entry = parseEntryBytes(bytes);
    return entry ? { entry, bytes } : null;
  } catch {
    return null;
  }
}
