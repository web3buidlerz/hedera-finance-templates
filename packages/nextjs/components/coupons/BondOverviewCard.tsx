"use client";

import { formatUnits } from "viem";
import { hederaTestnet } from "viem/chains";
import type { BondData } from "~~/hooks/coupons/useBond";
import { useMirrorContractId } from "~~/hooks/coupons/useMirrorContractId";
import { getBlockExplorerAddressLink } from "~~/utils/scaffold-hbar";

type Props = {
  bondAddress: `0x${string}`;
  bond?: BondData;
};

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export function BondOverviewCard({ bondAddress, bond }: Props) {
  const { data: contractId } = useMirrorContractId(bondAddress);

  return (
    <div className="card bg-base-100 shadow border border-base-300 overflow-hidden">
      <div className="card-body gap-2 !p-4 min-w-0">
        <div>
          <h3 className="card-title text-base">{bond?.name ?? "Bond"}</h3>
          <p className="text-sm text-base-content/70 m-0">What the network is doing with this bond right now.</p>
        </div>

        <div className="flex flex-col gap-2 text-sm min-w-0">
          <div className="min-w-0">
            <p className="text-xs text-base-content/60 m-0">Address</p>
            <a
              id="bond-address"
              href={getBlockExplorerAddressLink(hederaTestnet, bondAddress)}
              target="_blank"
              rel="noreferrer"
              className="link font-mono text-xs break-all block no-underline hover:underline"
            >
              {bondAddress}
            </a>
          </div>
          <div className="min-w-0">
            <p className="text-xs text-base-content/60 m-0">Contract id</p>
            {contractId ? (
              <a
                id="bond-contract-id"
                href={getBlockExplorerAddressLink(hederaTestnet, bondAddress)}
                target="_blank"
                rel="noreferrer"
                className="link text-xs no-underline hover:underline"
              >
                {contractId}
              </a>
            ) : (
              <span id="bond-contract-id" className="text-xs text-base-content/60">
                resolving…
              </span>
            )}
          </div>
        </div>

        {bond && (
          <div className="grid grid-cols-2 gap-2 text-sm border-t border-base-300 pt-2">
            <div>
              <p className="text-xs text-base-content/60 m-0">Face value</p>
              <p className="m-0">{bond.faceValue.toString()}</p>
            </div>
            <div>
              <p className="text-xs text-base-content/60 m-0">Coupon rate</p>
              <p className="m-0">{(Number(bond.couponRateBps) / 100).toFixed(2)}%</p>
            </div>
            <div>
              <p className="text-xs text-base-content/60 m-0">Period</p>
              <p className="m-0">{(Number(bond.periodSeconds) / 60).toFixed(0)} min</p>
            </div>
            <div>
              <p className="text-xs text-base-content/60 m-0">Coupons</p>
              <p className="m-0">{bond.couponCount.toString()}</p>
            </div>
          </div>
        )}

        <div className="border-t border-base-300 pt-2">
          <p className="text-xs text-base-content/60 m-0">Status</p>
          <p id="bond-status" className="font-semibold m-0">
            {bond?.status ?? "…"}
          </p>
        </div>

        {bond?.status === "RUNNING" && (
          <div className="flex flex-col gap-2 text-sm min-w-0">
            <div>
              <p className="text-xs text-base-content/60 m-0">Next coupon</p>
              <p id="next-coupon" className="m-0">
                #{bond.currentCoupon.toString()} due {new Date(Number(bond.dueTime) * 1000).toLocaleString()}
              </p>
            </div>
            <div className="min-w-0">
              <p className="text-xs text-base-content/60 m-0">Schedule</p>
              {bond.currentSchedule.toLowerCase() === ZERO_ADDRESS ? (
                <span id="schedule-address" className="text-xs text-warning">
                  scheduling failed — use Pay due coupon
                </span>
              ) : (
                <a
                  id="schedule-address"
                  href={getBlockExplorerAddressLink(hederaTestnet, bond.currentSchedule)}
                  target="_blank"
                  rel="noreferrer"
                  className="link font-mono text-xs break-all block no-underline hover:underline"
                >
                  {bond.currentSchedule}
                </a>
              )}
            </div>
          </div>
        )}

        {bond && (
          <p className="text-xs text-base-content/60 m-0">
            Owes {formatUnits(bond.stablecoinNeeded, 6)} stablecoin in total across every remaining coupon and
            principal.
          </p>
        )}
      </div>
    </div>
  );
}
