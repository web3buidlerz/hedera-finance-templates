/** Keep a whole-number field editable, including empty. "01" becomes "1"; "" stays "". */
export function wholeNumberText(raw: string): string {
  return raw.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
}

/** Same for a rate, so "0.01" and a trailing dot while typing both survive. */
export function decimalText(raw: string): string {
  const cleaned = raw.replace(/[^\d.]/g, "");
  const dot = cleaned.indexOf(".");
  if (dot === -1) return cleaned.replace(/^0+(?=\d)/, "");
  const head = cleaned.slice(0, dot).replace(/^0+(?=\d)/, "");
  const tail = cleaned.slice(dot + 1).replace(/\./g, "");
  return `${head}.${tail}`;
}
