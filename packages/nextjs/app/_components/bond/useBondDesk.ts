"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DeskStatus, IssueBondInput, IssueEvent, IssueStepId, StepStatus } from "~~/types/ats";
import { readNdjsonStream } from "~~/utils/ats/ndjson";

export type StepState = { status: StepStatus; error?: string; detail?: string };
export type StepsState = Record<IssueStepId, StepState>;

function describeStepDetail(event: IssueEvent & { status: "done" }): string | undefined {
  switch (event.step) {
    case "version":
      return `configuration version ${event.version}`;
    case "deploy":
      return `${event.address} (${event.contractId})`;
    case "investors":
      return event.investors.map(i => `${i.label}: ${i.address.slice(0, 6)}…${i.address.slice(-4)}`).join(", ");
    case "verify":
      return `${event.bond.totalSupply} issued of ${event.bond.maxSupply} max`;
    default:
      return undefined;
  }
}

const initialSteps: StepsState = {
  version: { status: "pending" },
  deploy: { status: "pending" },
  investors: { status: "pending" },
  verify: { status: "pending" },
};

async function postJson<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Request to ${url} failed.`);
  return data as T;
}

export function useBondDesk() {
  const [status, setStatus] = useState<DeskStatus | null>(null);
  const [statusLoaded, setStatusLoaded] = useState(false);

  const [steps, setSteps] = useState<StepsState>(initialSteps);
  const [issuing, setIssuing] = useState(false);
  const [issueError, setIssueError] = useState<string | null>(null);
  const [justIssued, setJustIssued] = useState(false);

  const [busyAddress, setBusyAddress] = useState<string | null>(null);
  const [addingWallet, setAddingWallet] = useState(false);

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refreshStatus = useCallback(async () => {
    const res = await fetch("/api/hedera/bond/status");
    const data = (await res.json()) as DeskStatus;
    if (mounted.current) setStatus(data);
    return data;
  }, []);

  useEffect(() => {
    refreshStatus().finally(() => {
      if (mounted.current) setStatusLoaded(true);
    });
  }, [refreshStatus]);

  const issueBond = useCallback(
    async (input: IssueBondInput) => {
      setIssueError(null);
      setJustIssued(false);
      setSteps(initialSteps);
      setIssuing(true);

      try {
        const res = await fetch("/api/hedera/bond/issue", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        });

        if (!res.ok || !res.body) {
          const data = await res.json().catch(() => ({}));
          throw new Error((data as { error?: string }).error ?? "Issuing the bond failed.");
        }

        let failed = false;
        await readNdjsonStream<IssueEvent>(res, event => {
          if (event.step === "result") {
            if (event.status === "failed") {
              failed = true;
              setIssueError(event.error);
            }
            return;
          }
          setSteps(prev => ({
            ...prev,
            [event.step]: {
              status: event.status,
              error: event.status === "failed" ? event.error : undefined,
              detail: event.status === "done" ? describeStepDetail(event) : undefined,
            },
          }));
        });

        await refreshStatus();
        if (!failed) setJustIssued(true);
      } catch (error) {
        setIssueError(error instanceof Error ? error.message : String(error));
      } finally {
        if (mounted.current) setIssuing(false);
      }
    },
    [refreshStatus],
  );

  const approveInvestor = useCallback(async (address: string) => {
    setBusyAddress(address);
    try {
      const data = await postJson<DeskStatus>(`/api/hedera/bond/investors/${address}/approve`, {});
      if (mounted.current) setStatus(data);
    } finally {
      if (mounted.current) setBusyAddress(null);
    }
  }, []);

  const revokeInvestor = useCallback(async (address: string) => {
    setBusyAddress(address);
    try {
      const data = await postJson<DeskStatus>(`/api/hedera/bond/investors/${address}/revoke`, {});
      if (mounted.current) setStatus(data);
    } finally {
      if (mounted.current) setBusyAddress(null);
    }
  }, []);

  const issueToInvestor = useCallback(async (address: string, amount: number) => {
    setBusyAddress(address);
    try {
      const data = await postJson<DeskStatus>(`/api/hedera/bond/investors/${address}/issue`, { amount });
      if (mounted.current) setStatus(data);
    } finally {
      if (mounted.current) setBusyAddress(null);
    }
  }, []);

  const addWalletInvestor = useCallback(async (address: string) => {
    setAddingWallet(true);
    try {
      const data = await postJson<DeskStatus>("/api/hedera/bond/investors/wallet", { address });
      if (mounted.current) setStatus(data);
    } finally {
      if (mounted.current) setAddingWallet(false);
    }
  }, []);

  const logActivity = useCallback(async (action: string, result: string, txHash?: string) => {
    const data = await postJson<DeskStatus>("/api/hedera/bond/activity", { action, result, txHash });
    if (mounted.current) setStatus(data);
  }, []);

  return {
    status,
    statusLoaded,
    refreshStatus,
    steps,
    issuing,
    issueError,
    justIssued,
    clearJustIssued: () => setJustIssued(false),
    issueBond,
    busyAddress,
    approveInvestor,
    revokeInvestor,
    issueToInvestor,
    addingWallet,
    addWalletInvestor,
    logActivity,
  };
}
