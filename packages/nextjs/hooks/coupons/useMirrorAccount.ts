"use client";

import { useQuery } from "@tanstack/react-query";

export type MirrorAccountInfo = {
  accountId: string | null;
  tokenBalance: bigint;
  associated: boolean;
};

/** Reads an account's Hedera id, stablecoin association, and balance from the mirror node. */
export function useMirrorAccount(evmAddress: `0x${string}` | undefined, tokenId: string | undefined) {
  return useQuery({
    queryKey: ["mirror-account", evmAddress, tokenId],
    queryFn: async (): Promise<MirrorAccountInfo> => {
      const params = new URLSearchParams({ path: `/api/v1/accounts/${evmAddress}`, network: "testnet" });
      const res = await fetch(`/api/hedera/mirror?${params}`, { cache: "no-store" });
      if (!res.ok) return { accountId: null, tokenBalance: 0n, associated: false };
      const data = await res.json();
      const accountId: string | null = typeof data.account === "string" ? data.account : null;
      const tokens: { token_id: string; balance: number }[] = data.balance?.tokens ?? [];
      const match = tokenId ? tokens.find(t => t.token_id === tokenId) : undefined;
      return { accountId, tokenBalance: match ? BigInt(match.balance) : 0n, associated: Boolean(match) };
    },
    enabled: Boolean(evmAddress),
    refetchInterval: 5000,
  });
}
