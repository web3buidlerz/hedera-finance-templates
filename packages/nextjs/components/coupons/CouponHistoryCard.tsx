"use client";

import { formatUnits } from "viem";
import { hederaTestnet } from "viem/chains";
import { useCouponHistory } from "~~/hooks/coupons/useCouponHistory";
import { getBlockExplorerTxLink } from "~~/utils/scaffold-hbar";

type Props = {
  bondAddress: `0x${string}`;
  stablecoinDecimals: number;
};

export function CouponHistoryCard({ bondAddress, stablecoinDecimals }: Props) {
  const { data: entries, isLoading } = useCouponHistory(bondAddress);

  return (
    <div className="card bg-base-100 shadow border border-base-300">
      <div className="card-body gap-2 !p-4">
        <div>
          <h3 className="card-title text-base">Coupon history</h3>
          <p className="text-sm text-base-content/70 m-0">
            Read straight from the bond&apos;s events on the mirror node -- nobody on this page triggers these.
          </p>
        </div>
        <div id="coupons" className="flex flex-col gap-2">
          {isLoading && <p className="text-sm text-base-content/60">Loading…</p>}
          {!isLoading && (!entries || entries.length === 0) && (
            <p className="text-sm text-base-content/60">No coupons have been paid yet.</p>
          )}
          {entries?.map(entry => (
            <div
              key={entry.key}
              className="coupon-entry flex flex-wrap items-center justify-between gap-2 text-sm py-2 border-b border-base-300 last:border-b-0"
            >
              <span className="font-semibold">Coupon #{entry.coupon}</span>
              <span className="text-xs text-base-content/60">{new Date(entry.consensusTime).toLocaleString()}</span>
              <span
                className={
                  entry.outcome === "MISSED"
                    ? "badge badge-warning badge-sm"
                    : entry.outcome === "PRINCIPAL REPAID"
                      ? "badge badge-success badge-sm"
                      : "badge badge-info badge-sm"
                }
              >
                {entry.outcome}
              </span>
              <span className="font-mono text-xs">
                {entry.totalPaid !== undefined ? formatUnits(entry.totalPaid, stablecoinDecimals) : "0"}
              </span>
              <a
                href={getBlockExplorerTxLink(hederaTestnet.id, entry.txHash)}
                target="_blank"
                rel="noreferrer"
                className="link text-xs no-underline hover:underline"
              >
                tx
              </a>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
