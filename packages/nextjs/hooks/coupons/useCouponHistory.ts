"use client";

import { useQuery } from "@tanstack/react-query";
import { decodeEventLog } from "viem";
import { couponBondAbi } from "~~/utils/coupons/abi";

export type CouponEntry = {
  key: string;
  coupon: number;
  consensusTime: string; // ISO
  outcome: "PAID" | "MISSED" | "UNPAID" | "PRINCIPAL REPAID";
  totalPaid?: bigint;
  txHash: `0x${string}`;
};

type MirrorLog = { data: string; topics: string[]; timestamp: string; transaction_hash: string };

/**
 * Coupon history, read straight from the bond's events on the mirror node -- so it shows
 * payments nobody on this page triggered.
 */
export function useCouponHistory(bondAddress: `0x${string}` | undefined) {
  return useQuery({
    queryKey: ["coupon-history", bondAddress],
    queryFn: async (): Promise<CouponEntry[]> => {
      const params = new URLSearchParams({
        path: `/api/v1/contracts/${bondAddress}/results/logs`,
        network: "testnet",
        order: "desc",
        limit: "100",
      });
      const res = await fetch(`/api/hedera/mirror?${params}`, { cache: "no-store" });
      if (!res.ok) return [];
      const data = await res.json();
      const logs: MirrorLog[] = data.logs ?? [];

      const entries: CouponEntry[] = [];
      for (const log of logs) {
        try {
          const decoded = decodeEventLog({
            abi: couponBondAbi,
            data: log.data as `0x${string}`,
            topics: log.topics as [`0x${string}`, ...`0x${string}`[]],
          });
          const consensusTime = new Date(Number(log.timestamp.split(".")[0]) * 1000).toISOString();
          const txHash = log.transaction_hash as `0x${string}`;

          if (decoded.eventName === "CouponPaid") {
            const { coupon, totalPaid } = decoded.args as { coupon: bigint; totalPaid: bigint };
            entries.push({
              key: `${txHash}-paid`,
              coupon: Number(coupon),
              consensusTime,
              outcome: "PAID",
              totalPaid,
              txHash,
            });
          } else if (decoded.eventName === "PrincipalRepaid") {
            const { coupon, totalPaid } = decoded.args as { coupon: bigint; totalPaid: bigint };
            entries.push({
              key: `${txHash}-principal`,
              coupon: Number(coupon),
              consensusTime,
              outcome: "PRINCIPAL REPAID",
              totalPaid,
              txHash,
            });
          } else if (decoded.eventName === "CouponUnpaid") {
            const { coupon, holder } = decoded.args as { coupon: bigint; holder: `0x${string}` };
            entries.push({
              key: `${txHash}-unpaid-${holder}`,
              coupon: Number(coupon),
              consensusTime,
              outcome: "UNPAID",
              txHash,
            });
          } else if (decoded.eventName === "CouponMissed") {
            const { coupon } = decoded.args as { coupon: bigint };
            entries.push({ key: `${txHash}-missed`, coupon: Number(coupon), consensusTime, outcome: "MISSED", txHash });
          }
        } catch {
          // Not a coupon event (Allocated/Started/CouponScheduled/SchedulingFailed/Stopped); skip.
        }
      }
      return entries;
    },
    enabled: Boolean(bondAddress),
    refetchInterval: 5000,
  });
}
