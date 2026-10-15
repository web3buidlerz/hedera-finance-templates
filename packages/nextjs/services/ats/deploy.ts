// Server-only: orchestrates issuing a new bond through the ATS factory, emitting one event per
// step so the caller (the streaming API route) can report real progress as it happens.
import { factoryAbi, resolverAbi } from "./abi";
import { requireOperator } from "./clients";
import {
  ATS_FACTORY_CONTRACT_ID,
  ATS_RESOLVER_CONTRACT_ID,
  BOND_CONFIG_ID,
  DEFAULT_ADMIN_ROLE,
  GAS_LIMIT_DEPLOY_BOND,
  ROLE_CONTROL_LIST,
  ROLE_ISSUER,
  ZERO_ADDRESS,
} from "./constants";
import { decodeAtsError } from "./errors";
import { createDemoInvestor } from "./investors";
import { getContractEvmAddress, getContractIdForEvmAddress } from "./mirror";
import { readBondView } from "./read";
import { addActivity, addInvestor, resetDesk } from "./state";
import { stringToHex } from "viem";
import type { Address } from "viem";
import * as chains from "viem/chains";
import type { InvestorView, IssueBondInput, IssueEvent } from "~~/types/ats";

const MONTH_IN_SECONDS_APPROX = 30 * 24 * 3600;

export async function runIssueBond(input: IssueBondInput, emit: (event: IssueEvent) => void): Promise<void> {
  const operator = requireOperator();

  try {
    // --- Step 1: resolve the bond configuration's latest version -------------------------------
    emit({ step: "version", status: "active" });
    const [resolverAddress, factoryAddress] = await Promise.all([
      getContractEvmAddress(ATS_RESOLVER_CONTRACT_ID),
      getContractEvmAddress(ATS_FACTORY_CONTRACT_ID),
    ]);
    const version = await operator.publicClient.readContract({
      address: resolverAddress,
      abi: resolverAbi,
      functionName: "getLatestVersionByConfiguration",
      args: [BOND_CONFIG_ID],
    });
    if (version === 0n) {
      const message = "VersionZero: the bond configuration has no published version yet.";
      emit({ step: "version", status: "failed", error: message });
      emit({ step: "result", status: "failed", error: message });
      return;
    }
    emit({ step: "version", status: "done", version: version.toString() });

    // --- Step 2: deploy through the ATS factory -------------------------------------------------
    emit({ step: "deploy", status: "active" });

    const nowSeconds = Math.floor(Date.now() / 1000);
    const startingDate = BigInt(nowSeconds + 5 * 60); // a few minutes in the future
    const maturity = new Date((nowSeconds + 5 * 60) * 1000);
    maturity.setUTCMonth(maturity.getUTCMonth() + input.maturityMonths);
    let maturityDate = BigInt(Math.floor(maturity.getTime() / 1000));
    // setUTCMonth can land on a date that isn't exactly N*30 days out for short/irregular
    // months; keep it simple and consistent with the calendar rather than approximating.
    if (maturityDate <= startingDate) maturityDate = startingDate + BigInt(MONTH_IN_SECONDS_APPROX);

    const bondData = {
      security: {
        resolver: resolverAddress,
        maxSupply: BigInt(input.maxSupply),
        resolverProxyConfiguration: { key: BOND_CONFIG_ID, version },
        erc20MetadataInfo: { name: input.name, symbol: input.symbol, isin: input.isin, decimals: 0 },
        rbacs: [
          { role: DEFAULT_ADMIN_ROLE, members: [operator.account.address] },
          { role: ROLE_ISSUER, members: [operator.account.address] },
          { role: ROLE_CONTROL_LIST, members: [operator.account.address] },
        ],
        externalPauses: [] as Address[],
        externalControlLists: [] as Address[],
        externalKycLists: [] as Address[],
        compliance: ZERO_ADDRESS,
        identityRegistry: ZERO_ADDRESS,
        arePartitionsProtected: false,
        isMultiPartition: false,
        isControllable: true,
        isWhiteList: true,
        clearingActive: false,
        internalKycActivated: false,
        erc20VotesActivated: false,
      },
      bondDetails: {
        currency: stringToHex("USD", { size: 3 }),
        nominalValue: BigInt(Math.round(input.faceValue * 100)),
        nominalValueDecimals: 2,
        startingDate,
        maturityDate,
      },
      proceedRecipients: [] as Address[],
      proceedRecipientsData: [] as `0x${string}`[],
    };
    const regulation = {
      regulationType: 1,
      regulationSubType: 0,
      additionalSecurityData: { countriesControlListType: false, listOfCountries: "", info: "" },
    };

    let predictedAddress: Address;
    try {
      const sim = await operator.publicClient.simulateContract({
        address: factoryAddress,
        abi: factoryAbi,
        functionName: "deployBond",
        args: [bondData, regulation],
        account: operator.account,
        gas: GAS_LIMIT_DEPLOY_BOND,
      });
      predictedAddress = sim.result;
    } catch (error) {
      const decoded = decodeAtsError(error);
      emit({ step: "deploy", status: "failed", error: decoded.message });
      addActivity({ action: `Issue bond ${input.name} (${input.symbol})`, result: decoded.name });
      emit({ step: "result", status: "failed", error: decoded.message });
      return;
    }

    const txHash = await operator.walletClient.writeContract({
      address: factoryAddress,
      abi: factoryAbi,
      functionName: "deployBond",
      args: [bondData, regulation],
      account: operator.account,
      chain: chains.hederaTestnet,
      gas: GAS_LIMIT_DEPLOY_BOND,
    });
    const receipt = await operator.publicClient.waitForTransactionReceipt({ hash: txHash });
    const emittedFromPredicted = receipt.logs.some(log => log.address.toLowerCase() === predictedAddress.toLowerCase());
    if (receipt.status !== "success" || !emittedFromPredicted) {
      const message =
        receipt.status !== "success"
          ? "The deployment transaction failed on-chain."
          : "The deployment transaction did not emit any logs from the predicted bond address.";
      emit({ step: "deploy", status: "failed", error: message });
      addActivity({ action: `Issue bond ${input.name} (${input.symbol})`, result: "Error", txHash });
      emit({ step: "result", status: "failed", error: message });
      return;
    }

    const contractId = (await getContractIdForEvmAddress(predictedAddress)) ?? "pending";
    emit({ step: "deploy", status: "done", address: predictedAddress, contractId, txHash });

    resetDesk({
      address: predictedAddress,
      contractId,
      name: input.name,
      symbol: input.symbol,
      isin: input.isin,
      currency: "USD",
      faceValue: input.faceValue,
      startingDateIso: new Date(Number(startingDate) * 1000).toISOString(),
      maturityDateIso: new Date(Number(maturityDate) * 1000).toISOString(),
      maxSupply: input.maxSupply,
    });
    addActivity({ action: `Issued bond ${input.name} (${input.symbol})`, result: "SUCCESS", txHash });

    // --- Step 3: create the demo investors --------------------------------------------------
    emit({ step: "investors", status: "active" });
    const investorViews: InvestorView[] = [];
    for (const label of ["Investor A", "Investor B"] as const) {
      const { record, txHash: fundingTxHash } = await createDemoInvestor(label);
      addInvestor(record);
      addActivity({ action: `Created ${label}`, result: "SUCCESS", txHash: fundingTxHash });
      investorViews.push({
        label,
        address: record.address,
        hederaAccountId: record.hederaAccountId,
        approved: false,
        balance: 0,
      });
    }
    emit({ step: "investors", status: "done", investors: investorViews });

    // --- Step 4: read the bond back from the chain ------------------------------------------
    emit({ step: "verify", status: "active" });
    const view = await readBondView(predictedAddress);
    emit({
      step: "verify",
      status: "done",
      bond: {
        address: predictedAddress,
        contractId,
        name: view.name,
        symbol: view.symbol,
        isin: view.isin,
        currency: view.currency,
        faceValue: view.faceValue,
        startingDateIso: new Date(Number(startingDate) * 1000).toISOString(),
        maturityDateIso: view.maturityDateIso,
        maxSupply: view.maxSupply,
        totalSupply: view.totalSupply,
      },
    });

    emit({ step: "result", status: "done" });
  } catch (error) {
    const decoded = decodeAtsError(error);
    emit({ step: "result", status: "failed", error: decoded.message });
  }
}
