/**
 * Base-unit <-> whole-unit conversions for HTS token amounts, done with
 * BigInt so 6-decimal stablecoin math never hits floating point.
 */

/** Converts a base-unit integer amount to a plain whole-unit decimal string. */
export function formatBaseUnits(amount: bigint, decimals: number): string {
  const negative = amount < 0n;
  const abs = negative ? -amount : amount;
  if (decimals === 0) return `${negative ? "-" : ""}${abs.toString()}`;

  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const fraction = (abs % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole.toString()}${fraction ? `.${fraction}` : ""}`;
}

/** Converts a whole-unit amount (number, e.g. the trade ticket quantity) to base units. */
export function toBaseUnits(wholeUnits: number, decimals: number): bigint {
  if (!Number.isFinite(wholeUnits) || wholeUnits < 0) {
    throw new Error("Amount must be a non-negative finite number");
  }
  // Round to the token's decimals before scaling, so 10000 * 10^6 stays exact.
  const scaled = Math.round(wholeUnits * 10 ** decimals);
  return BigInt(scaled);
}
