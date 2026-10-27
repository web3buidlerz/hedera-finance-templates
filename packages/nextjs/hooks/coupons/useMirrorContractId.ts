"use client";

import { useQuery } from "@tanstack/react-query";

/** Resolves a contract's Hedera contract id (e.g. "0.0.1234") from its EVM address. */
export function useMirrorContractId(address: `0x${string}` | undefined) {
  return useQuery({
    queryKey: ["mirror-contract-id", address],
    queryFn: async (): Promise<string | null> => {
      const params = new URLSearchParams({ path: `/api/v1/contracts/${address}`, network: "testnet" });
      const res = await fetch(`/api/hedera/mirror?${params}`, { cache: "no-store" });
      if (!res.ok) return null;
      const data = await res.json();
      return typeof data.contract_id === "string" ? data.contract_id : null;
    },
    enabled: Boolean(address),
    refetchInterval: 10000,
  });
}
