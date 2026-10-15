export const formatDate = (iso: string): string =>
  new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

export const formatNumber = (n: number): string => n.toLocaleString();

export const shortAddress = (address: string): string => `${address.slice(0, 6)}…${address.slice(-4)}`;
