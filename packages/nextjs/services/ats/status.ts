// Server-only: builds the desk's full status payload (bond, investors, activity) with every
// balance, supply and approval flag read fresh from the chain. Shared by the status route and
// every mutating route, so each action's response reflects the result immediately.
import { getOperatorConfig } from "./clients";
import { readBondView, readInvestorView } from "./read";
import { getDesk } from "./state";
import type { Address } from "viem";
import type { BondTerms, DeskStatus, InvestorView } from "~~/types/ats";

export async function buildDeskStatus(): Promise<DeskStatus> {
  const operator = getOperatorConfig();
  const desk = getDesk();

  let bond: BondTerms | null = null;
  if (desk.bond) {
    try {
      const view = await readBondView(desk.bond.address);
      bond = {
        address: desk.bond.address,
        contractId: desk.bond.contractId,
        name: view.name,
        symbol: view.symbol,
        isin: view.isin,
        currency: view.currency,
        faceValue: view.faceValue,
        startingDateIso: desk.bond.startingDateIso,
        maturityDateIso: view.maturityDateIso,
        maxSupply: view.maxSupply,
        totalSupply: view.totalSupply,
      };
    } catch (error) {
      console.error("[ats/status] failed to read bond", error);
    }
  }

  const bondAddress: Address | undefined = desk.bond?.address;
  const investors: InvestorView[] = await Promise.all(
    desk.investors.map(async investor => {
      if (!bondAddress) return { ...investor, approved: false, balance: 0 };
      try {
        const view = await readInvestorView(bondAddress, investor.address);
        return { ...investor, approved: view.approved, balance: view.balance };
      } catch (error) {
        console.error("[ats/status] failed to read investor", error);
        return { ...investor, approved: false, balance: 0 };
      }
    }),
  );

  return {
    configured: operator.configured,
    configError: operator.configured ? undefined : operator.error,
    bond,
    investors,
    activity: desk.activity,
  };
}
