"use client";

import { useState } from "react";
import type { DeskStateResponse } from "~~/hooks/coupons/useDeskState";
import { decimalText, wholeNumberText } from "~~/utils/coupons/numberField";

type Props = {
  desk: DeskStateResponse | undefined;
  onIssued: (address: `0x${string}`) => void;
};

export function IssueBondForm({ desk, onIssued }: Props) {
  const [name, setName] = useState("Acme Coupon Bond");
  const [faceValue, setFaceValue] = useState("1000");
  const [couponRate, setCouponRate] = useState("1");
  const [periodMinutes, setPeriodMinutes] = useState("2");
  const [couponCount, setCouponCount] = useState("3");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const disabled = !desk?.factory || Boolean(desk?.configError) || !desk?.stablecoin;
  const termsComplete = [faceValue, couponRate, periodMinutes, couponCount].every(
    value => value !== "" && value !== "." && Number.isFinite(Number(value)),
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/hedera/coupons/bonds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          faceValue: Number(faceValue),
          couponRatePercent: Number(couponRate),
          periodMinutes: Number(periodMinutes),
          couponCount: Number(couponCount),
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to issue bond");
      onIssued(body.address);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to issue bond");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form className="card bg-base-100 shadow border border-base-300" onSubmit={handleSubmit}>
      <div className="card-body gap-2 !p-4">
        <div>
          <h3 className="card-title text-base">Issue a bond</h3>
          <p className="text-sm text-base-content/70 m-0">Set its terms and issue it through the factory.</p>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="bond-name" className="text-xs text-base-content/60">
            Name
          </label>
          <input
            id="bond-name"
            type="text"
            className="input input-bordered input-sm"
            value={name}
            onChange={e => setName(e.target.value)}
            disabled={disabled}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor="bond-face-value" className="text-xs text-base-content/60">
              Face value (stablecoin)
            </label>
            <input
              id="bond-face-value"
              type="text"
              inputMode="numeric"
              className="input input-bordered input-sm"
              value={faceValue}
              onChange={e => setFaceValue(wholeNumberText(e.target.value))}
              disabled={disabled}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="bond-coupon-rate" className="text-xs text-base-content/60">
              Coupon rate (% of face value)
            </label>
            <input
              id="bond-coupon-rate"
              type="text"
              inputMode="decimal"
              className="input input-bordered input-sm"
              value={couponRate}
              onChange={e => setCouponRate(decimalText(e.target.value))}
              disabled={disabled}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="bond-period-minutes" className="text-xs text-base-content/60">
              Minutes between coupons
            </label>
            <input
              id="bond-period-minutes"
              type="text"
              inputMode="numeric"
              className="input input-bordered input-sm"
              value={periodMinutes}
              onChange={e => setPeriodMinutes(wholeNumberText(e.target.value))}
              disabled={disabled}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="bond-coupon-count" className="text-xs text-base-content/60">
              Number of coupons
            </label>
            <input
              id="bond-coupon-count"
              type="text"
              inputMode="numeric"
              className="input input-bordered input-sm"
              value={couponCount}
              onChange={e => setCouponCount(wholeNumberText(e.target.value))}
              disabled={disabled}
            />
          </div>
        </div>
        <p className="text-xs text-base-content/60 m-0">
          Minutes stand in for a real coupon period (e.g. six months), shortened here so it can be watched.
        </p>

        <button
          id="issue-bond"
          type="submit"
          className="btn btn-primary btn-sm self-start"
          disabled={disabled || isSubmitting || !termsComplete}
        >
          {isSubmitting ? "Issuing…" : "Issue bond"}
        </button>
        {error && <p className="text-xs text-error m-0">{error}</p>}
      </div>
    </form>
  );
}
