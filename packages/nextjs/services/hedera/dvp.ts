// Deep import, not the package root: the root re-exports a Reown/AppKit (ethers-dependent) tree
// that this server-only module has no use for and shouldn't pull into the API route bundle.
import { transactionToBase64String } from "@hashgraph/hedera-wallet-connect/dist/lib/shared/utils.js";
import {
  AccountCreateTransaction,
  Client,
  Hbar,
  PrivateKey,
  PublicKey,
  ScheduleCreateTransaction,
  ScheduleDeleteTransaction,
  ScheduleSignTransaction,
  Timestamp,
  TokenAssociateTransaction,
  TokenCreateTransaction,
  TokenGrantKycTransaction,
  TokenMintTransaction,
  TransactionId,
  TransactionReceiptQuery,
  TransferTransaction,
} from "@hiero-ledger/sdk";
import { GENESIS_HASH, createAuditTopic, publishAuditEvent } from "~~/services/hedera/audit";
import { getOperatorClient } from "~~/services/hedera/client";
import { formatBaseUnits, toBaseUnits } from "~~/services/hedera/format";
import {
  fetchAccountPublicKey,
  fetchPartyBalances,
  fetchScheduleInfo,
  waitForMirrorIndexing,
} from "~~/services/hedera/mirror";
import type { SetupStepId } from "~~/services/hedera/setupSteps";
import {
  BuyerChoice,
  DemoParty,
  Market,
  PAYMENT_DECIMALS,
  SECURITY_DECIMALS,
  SettlementMode,
  Trade,
  WalletRole,
  findTrade,
  getMarket,
  requireMarket,
  setMarket,
} from "~~/services/hedera/store";
import {
  BUYER_INITIAL_PAYMENT,
  type MarketSnapshot,
  ON_SIGNATURE_EXPIRY_MINUTES,
  type PartySnapshot,
  SELLER_INITIAL_SECURITY,
  UNVERIFIED_BUYER_INITIAL_PAYMENT,
} from "~~/services/hedera/types";

// Hedera refuses a schedule whose body matches one that still exists (executed schedules
// linger until expiry), so an identical repeat trade needs a distinct memo.
const tradeMemo = () => `DvP trade ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
// The operator pays every fee; demo accounts only co-sign, so they need almost no HBAR.
const DEMO_ACCOUNT_OPENING_BALANCE = new Hbar(1);

async function partySnapshot(accountId: string, market: Market): Promise<PartySnapshot> {
  const balances = await fetchPartyBalances(accountId, market.securityTokenId, market.paymentTokenId);
  return {
    accountId,
    balances: {
      security: formatBaseUnits(balances.security, SECURITY_DECIMALS),
      payment: formatBaseUnits(balances.payment, PAYMENT_DECIMALS),
    },
  };
}

async function buildSnapshot(market: Market): Promise<MarketSnapshot> {
  const [seller, buyer, unverifiedBuyer, walletSeller, walletBuyer] = await Promise.all([
    partySnapshot(market.seller.accountId, market),
    partySnapshot(market.buyer.accountId, market),
    partySnapshot(market.unverifiedBuyer.accountId, market),
    market.walletSeller ? partySnapshot(market.walletSeller.accountId, market) : Promise.resolve(null),
    market.walletBuyer ? partySnapshot(market.walletBuyer.accountId, market) : Promise.resolve(null),
  ]);

  return {
    securityTokenId: market.securityTokenId,
    paymentTokenId: market.paymentTokenId,
    auditTopicId: market.auditTopicId,
    seller,
    buyer,
    unverifiedBuyer,
    walletSeller,
    walletBuyer,
    // Newest first, per the trades list.
    trades: [...market.trades].reverse().map(t => ({
      scheduleId: t.scheduleId,
      status: t.status,
      settlementResult: t.settlementResult,
      quantity: t.quantity,
      price: t.price,
      buyerChoice: t.buyerChoice,
      sellerIsWallet: t.sellerIsWallet,
      buyerIsWallet: t.buyerIsWallet,
      settlementMode: t.settlementMode,
      expiresAt: t.expiresAt,
      settlesAt: t.settlesAt,
      proposedAt: t.proposedAt,
    })),
  };
}

/** Resolves the account that plays the chosen buyer side for a new trade. */
function resolveBuyerAccountId(market: Market, buyerChoice: BuyerChoice): string {
  if (buyerChoice === "unverifiedBuyer") return market.unverifiedBuyer.accountId;
  return market.walletBuyer?.accountId ?? market.buyer.accountId;
}

async function createDemoAccount(client: Client): Promise<DemoParty> {
  const key = PrivateKey.generateECDSA();
  const receipt = await (
    await new AccountCreateTransaction()
      .setKeyWithoutAlias(key.publicKey)
      .setInitialBalance(DEMO_ACCOUNT_OPENING_BALANCE)
      .execute(client)
  ).getReceipt(client);
  if (!receipt.accountId) throw new Error("Account creation did not return an account id");
  return { accountId: receipt.accountId.toString(), privateKey: key.toStringRaw() };
}

async function createSecurityToken(client: Client, treasury: string): Promise<string> {
  const operatorKey = client.operatorPublicKey;
  if (!operatorKey) throw new Error("Operator key is not available on the client");
  const receipt = await (
    await new TokenCreateTransaction()
      .setTokenName("DvP Security")
      .setTokenSymbol("DVPS")
      .setDecimals(SECURITY_DECIMALS)
      .setInitialSupply(SELLER_INITIAL_SECURITY)
      .setTreasuryAccountId(treasury)
      .setAdminKey(operatorKey)
      .setSupplyKey(operatorKey)
      .setKycKey(operatorKey)
      .setFreezeKey(operatorKey)
      .execute(client)
  ).getReceipt(client);
  if (!receipt.tokenId) throw new Error("Security token creation did not return a token id");
  return receipt.tokenId.toString();
}

async function createPaymentToken(client: Client, treasury: string): Promise<string> {
  const operatorKey = client.operatorPublicKey;
  if (!operatorKey) throw new Error("Operator key is not available on the client");
  const totalSupply = toBaseUnits(BUYER_INITIAL_PAYMENT + UNVERIFIED_BUYER_INITIAL_PAYMENT, PAYMENT_DECIMALS);
  const receipt = await (
    await new TokenCreateTransaction()
      .setTokenName("DvP Stablecoin")
      .setTokenSymbol("DVPC")
      .setDecimals(PAYMENT_DECIMALS)
      .setInitialSupply(totalSupply)
      .setTreasuryAccountId(treasury)
      .setAdminKey(operatorKey)
      .setSupplyKey(operatorKey)
      .execute(client)
  ).getReceipt(client);
  if (!receipt.tokenId) throw new Error("Stablecoin creation did not return a token id");
  return receipt.tokenId.toString();
}

async function associateBoth(
  client: Client,
  party: DemoParty,
  securityTokenId: string,
  paymentTokenId: string,
): Promise<void> {
  const key = PrivateKey.fromStringECDSA(party.privateKey);
  const tx = new TokenAssociateTransaction()
    .setAccountId(party.accountId)
    .setTokenIds([securityTokenId, paymentTokenId])
    .freezeWith(client);
  const signed = await tx.sign(key);
  const response = await signed.execute(client);
  await response.getReceipt(client);
}

async function grantSecurityKyc(client: Client, securityTokenId: string, accountId: string): Promise<void> {
  const response = await new TokenGrantKycTransaction()
    .setTokenId(securityTokenId)
    .setAccountId(accountId)
    .execute(client);
  await response.getReceipt(client);
}

/**
 * Runs each setup step in order, reporting it to `onStep` as it starts and finishes so the page
 * can show progress. `detail` carries the ids a step created.
 */
export async function setupMarket(
  onStep: (step: SetupStepId, status: "active" | "done", detail?: string) => void = () => undefined,
): Promise<MarketSnapshot> {
  const client = getOperatorClient();
  const step = async <T>(id: SetupStepId, run: () => Promise<T>, detail?: (result: T) => string): Promise<T> => {
    onStep(id, "active");
    const result = await run();
    onStep(id, "done", detail?.(result));
    return result;
  };
  try {
    const operatorId = client.operatorAccountId;
    if (!operatorId) throw new Error("Operator account id is not available on the client");

    // One transaction at a time: submitting several from the same payer in the same instant
    // can draw a transient BUSY response from a testnet node, even though each is independent.
    const [seller, buyer, unverifiedBuyer] = await step(
      "accounts",
      async () => [await createDemoAccount(client), await createDemoAccount(client), await createDemoAccount(client)],
      accounts => accounts.map(a => a.accountId).join(", "),
    );

    const securityTokenId = await step(
      "security",
      () => createSecurityToken(client, operatorId.toString()),
      id => id,
    );
    const paymentTokenId = await step(
      "stablecoin",
      () => createPaymentToken(client, operatorId.toString()),
      id => id,
    );

    await step("associate", async () => {
      for (const party of [seller, buyer, unverifiedBuyer]) {
        await associateBoth(client, party, securityTokenId, paymentTokenId);
      }
    });

    await step("kyc", async () => {
      await grantSecurityKyc(client, securityTokenId, seller.accountId);
      await grantSecurityKyc(client, securityTokenId, buyer.accountId);
    });

    await step("fund", async () => {
      const securityAmount = toBaseUnits(SELLER_INITIAL_SECURITY, SECURITY_DECIMALS);
      const buyerPaymentAmount = toBaseUnits(BUYER_INITIAL_PAYMENT, PAYMENT_DECIMALS);
      const unverifiedBuyerPaymentAmount = toBaseUnits(UNVERIFIED_BUYER_INITIAL_PAYMENT, PAYMENT_DECIMALS);
      const fundingResponse = await new TransferTransaction()
        .addTokenTransfer(securityTokenId, operatorId.toString(), -securityAmount)
        .addTokenTransfer(securityTokenId, seller.accountId, securityAmount)
        .addTokenTransfer(paymentTokenId, operatorId.toString(), -(buyerPaymentAmount + unverifiedBuyerPaymentAmount))
        .addTokenTransfer(paymentTokenId, buyer.accountId, buyerPaymentAmount)
        .addTokenTransfer(paymentTokenId, unverifiedBuyer.accountId, unverifiedBuyerPaymentAmount)
        .execute(client);
      await fundingResponse.getReceipt(client);
      await waitForMirrorIndexing(fundingResponse.transactionId.toString());
    });

    const auditTopicId = await step(
      "topic",
      () => createAuditTopic(client),
      id => id,
    );

    const market: Market = {
      securityTokenId,
      paymentTokenId,
      auditTopicId,
      auditPrevHash: GENESIS_HASH,
      auditQueue: Promise.resolve(),
      seller,
      buyer,
      unverifiedBuyer,
      walletSeller: null,
      walletBuyer: null,
      trades: [],
      pendingWalletProposal: null,
    };
    setMarket(market);

    return await buildSnapshot(market);
  } finally {
    client.close();
  }
}

/** Current market snapshot, or null if no market has been set up yet in this server process. */
export async function getSnapshot(): Promise<MarketSnapshot | null> {
  const market = getMarket();
  if (!market) return null;
  return await buildSnapshot(market);
}

function buildTransferTransaction(
  market: Market,
  sellerAccountId: string,
  buyerAccountId: string,
  quantity: number,
  price: number,
): TransferTransaction {
  const quantityBase = toBaseUnits(quantity, SECURITY_DECIMALS);
  const priceBase = toBaseUnits(price, PAYMENT_DECIMALS);
  return new TransferTransaction()
    .addTokenTransfer(market.securityTokenId, sellerAccountId, -quantityBase)
    .addTokenTransfer(market.securityTokenId, buyerAccountId, quantityBase)
    .addTokenTransfer(market.paymentTokenId, buyerAccountId, -priceBase)
    .addTokenTransfer(market.paymentTokenId, sellerAccountId, priceBase)
    .setTransactionMemo("DvP settlement");
}

type Timing = { expiresAt: Date; settlesAt: Date | null };

/**
 * A trade settling on the Buyer's signature expires 30 minutes after it is proposed; a trade
 * settling at a set time expires (and is scheduled to execute) at that time instead.
 */
function computeTiming(settlementMode: SettlementMode, settlementDelayMinutes?: number): Timing {
  if (settlementMode === "atTime") {
    if (
      settlementDelayMinutes == null ||
      !Number.isInteger(settlementDelayMinutes) ||
      settlementDelayMinutes < 1 ||
      settlementDelayMinutes > 60
    ) {
      throw new Error("Settlement delay must be a whole number of minutes from 1 to 60.");
    }
    const at = new Date(Date.now() + settlementDelayMinutes * 60_000);
    return { expiresAt: at, settlesAt: at };
  }
  return { expiresAt: new Date(Date.now() + ON_SIGNATURE_EXPIRY_MINUTES * 60_000), settlesAt: null };
}

/** Builds the (unfrozen) schedule-create transaction shared by the demo and wallet Seller flows. */
function scheduleCreateTx(
  market: Market,
  sellerAccountId: string,
  buyerAccountId: string,
  quantity: number,
  price: number,
  adminKey: PublicKey,
  timing: Timing,
): ScheduleCreateTransaction {
  return buildTransferTransaction(market, sellerAccountId, buyerAccountId, quantity, price)
    .schedule()
    .setScheduleMemo(tradeMemo())
    .setAdminKey(adminKey)
    .setExpirationTime(Timestamp.fromDate(timing.expiresAt))
    .setWaitForExpiry(timing.settlesAt != null);
}

/** Fetches a wallet account's public key from the mirror node, as a `PublicKey` ready to use as a schedule's admin key. */
async function fetchWalletPublicKey(accountId: string): Promise<PublicKey> {
  const { type, key } = await fetchAccountPublicKey(accountId);
  return type === "ED25519" ? PublicKey.fromStringED25519(key) : PublicKey.fromStringECDSA(key);
}

/**
 * The security has 0 decimals and the stablecoin 6, so a fractional quantity or a price below
 * one micro-unit would be silently rounded by `toBaseUnits` into a different trade than shown.
 */
function assertValidTerms(quantity: number, price: number): void {
  if (!Number.isInteger(quantity) || quantity < 1) throw new Error("Quantity must be a whole number of at least 1.");
  if (!(price > 0) || Math.round(price * 10 ** PAYMENT_DECIMALS) !== price * 10 ** PAYMENT_DECIMALS) {
    throw new Error(`Price must be positive, with at most ${PAYMENT_DECIMALS} decimals.`);
  }
}

function hasPendingOrScheduledTrade(market: Market): boolean {
  return market.trades.some(t => t.status === "PENDING" || t.status === "SCHEDULED");
}

/** Seller (demo account) proposes and signs the scheduled two-leg transfer. */
export async function proposeTradeDemo(
  quantity: number,
  price: number,
  buyerChoice: BuyerChoice,
  settlementMode: SettlementMode,
  settlementDelayMinutes?: number,
): Promise<MarketSnapshot> {
  const market = requireMarket();
  if (market.walletSeller) throw new Error("Seller is a connected wallet; use the wallet signing flow.");
  assertValidTerms(quantity, price);
  const timing = computeTiming(settlementMode, settlementDelayMinutes);

  const client = getOperatorClient();
  try {
    const sellerAccountId = market.seller.accountId;
    const buyerAccountId = resolveBuyerAccountId(market, buyerChoice);
    const sellerKey = PrivateKey.fromStringECDSA(market.seller.privateKey);

    const scheduleTx = scheduleCreateTx(
      market,
      sellerAccountId,
      buyerAccountId,
      quantity,
      price,
      sellerKey.publicKey,
      timing,
    ).freezeWith(client);
    const signed = await scheduleTx.sign(sellerKey);
    const response = await signed.execute(client);
    const receipt = await response.getReceipt(client);
    if (!receipt.scheduleId || !receipt.scheduledTransactionId) {
      throw new Error("Schedule creation did not return a schedule id");
    }

    const trade: Trade = {
      scheduleId: receipt.scheduleId.toString(),
      scheduledTransactionId: receipt.scheduledTransactionId.toString(),
      quantity,
      price,
      buyerChoice,
      sellerAccountId,
      buyerAccountId,
      sellerIsWallet: false,
      buyerIsWallet: buyerChoice === "buyer" && market.walletBuyer != null,
      status: "PENDING",
      settlementResult: null,
      settlementMode,
      expiresAt: timing.expiresAt.toISOString(),
      settlesAt: timing.settlesAt?.toISOString() ?? null,
      proposedAt: new Date().toISOString(),
    };
    market.trades.push(trade);

    await publishAuditEvent(client, market, {
      event: "proposed",
      schedule: trade.scheduleId,
      quantity,
      price,
      seller: sellerAccountId,
      buyer: buyerAccountId,
      tx: response.transactionId.toString(),
      result: "SUCCESS",
    });

    return await buildSnapshot(market);
  } finally {
    client.close();
  }
}

/** Buyer (demo account) signs the pending schedule. On-signature trades execute immediately; set-time trades wait. */
export async function signTradeDemo(scheduleId: string): Promise<MarketSnapshot> {
  const market = requireMarket();
  const trade = findTrade(market, scheduleId);
  if (trade.status !== "PENDING") throw new Error("Trade is not pending a signature.");
  if (trade.buyerIsWallet) throw new Error("Buyer is a connected wallet; use the wallet signing flow.");

  const client = getOperatorClient();
  try {
    const buyerKeyHex =
      trade.buyerChoice === "unverifiedBuyer" ? market.unverifiedBuyer.privateKey : market.buyer.privateKey;
    const buyerKey = PrivateKey.fromStringECDSA(buyerKeyHex);

    const signTx = new ScheduleSignTransaction().setScheduleId(trade.scheduleId).freezeWith(client);
    const signed = await signTx.sign(buyerKey);
    const response = await signed.execute(client);
    await response.getReceipt(client);

    await publishAuditEvent(client, market, {
      event: "signed",
      schedule: trade.scheduleId,
      quantity: trade.quantity,
      price: trade.price,
      seller: trade.sellerAccountId,
      buyer: trade.buyerAccountId,
      tx: response.transactionId.toString(),
      result: "SUCCESS",
    });

    if (trade.settlementMode === "onSignature") await finalizeTrade(trade, client, market);
    else trade.status = "SCHEDULED";

    return await buildSnapshot(market);
  } finally {
    client.close();
  }
}

/** The Seller (demo account) cancels a trade that has not yet executed, expired or been cancelled. */
export async function cancelTradeDemo(scheduleId: string): Promise<MarketSnapshot> {
  const market = requireMarket();
  const trade = findTrade(market, scheduleId);
  if (trade.sellerIsWallet) throw new Error("Seller is a connected wallet; use the wallet signing flow.");
  if (trade.status !== "PENDING" && trade.status !== "SCHEDULED") throw new Error("Trade can no longer be cancelled.");

  const client = getOperatorClient();
  try {
    const sellerKey = PrivateKey.fromStringECDSA(market.seller.privateKey);
    const tx = new ScheduleDeleteTransaction().setScheduleId(trade.scheduleId).freezeWith(client);
    const signed = await tx.sign(sellerKey);
    const response = await signed.execute(client);
    await response.getReceipt(client);

    trade.status = "CANCELLED";
    await publishAuditEvent(client, market, {
      event: "cancelled",
      schedule: trade.scheduleId,
      quantity: trade.quantity,
      price: trade.price,
      seller: trade.sellerAccountId,
      buyer: trade.buyerAccountId,
      tx: response.transactionId.toString(),
      result: "SUCCESS",
    });
    return await buildSnapshot(market);
  } finally {
    client.close();
  }
}

/**
 * Settles the result of a schedule's execution (whether triggered by this process's own sign
 * call, or discovered later by the reconciler for a set-time trade). Guarded against running
 * twice for the same trade: an explicit sign can race the background reconciler, both seeing
 * the trade still unsettled before either has written its outcome, which would otherwise publish
 * the settlement's audit entry twice. The guard check-and-set below is synchronous (no `await`
 * between them), so only the first caller to reach it ever proceeds.
 */
async function finalizeTrade(trade: Trade, client: Client, market: Market): Promise<void> {
  if (trade.finalizing || trade.status === "SETTLED" || trade.status === "REJECTED") return;
  trade.finalizing = true;

  const settleReceipt = await new TransactionReceiptQuery()
    .setTransactionId(trade.scheduledTransactionId)
    .setValidateStatus(false)
    .execute(client);
  const resultCode = settleReceipt.status.toString();
  trade.status = resultCode === "SUCCESS" ? "SETTLED" : "REJECTED";
  trade.settlementResult = resultCode;
  // Even on REJECTED no balance moved, but the schedule's execution is itself a mirror-indexed
  // transaction; waiting for it keeps the snapshot we're about to build from going stale.
  await waitForMirrorIndexing(trade.scheduledTransactionId);
  await publishAuditEvent(client, market, {
    event: trade.status === "SETTLED" ? "settled" : "rejected",
    schedule: trade.scheduleId,
    quantity: trade.quantity,
    price: trade.price,
    seller: trade.sellerAccountId,
    buyer: trade.buyerAccountId,
    tx: trade.scheduledTransactionId,
    result: resultCode,
  });
}

/**
 * Catches up a trade with what the network has done to its schedule since it was last checked: a
 * set-time execution, or an expiry past its deadline without every signature. Settlement by the
 * Buyer's explicit sign call is handled inline by `signTradeDemo`/`completeWalletBuyerSign`
 * instead; this only needs to notice what happens on its own.
 */
async function reconcileTrade(market: Market, trade: Trade, client: Client): Promise<void> {
  if (trade.status !== "PENDING" && trade.status !== "SCHEDULED") return;

  // A trade still PENDING (the Buyer never signed) past its deadline is EXPIRED — even though,
  // for a waitForExpiry (set-time) schedule, Hedera attempts execution anyway at expiry with only
  // the Seller's signature and fails it (e.g. INVALID_SIGNATURE). That failure is an artifact of
  // the scheduling mechanism, not a DvP rejection: the trade never reached agreement, so check
  // this before asking the mirror node what happened to the schedule's execution.
  if (trade.status === "PENDING" && Date.now() > new Date(trade.expiresAt).getTime()) {
    trade.status = "EXPIRED";
    await publishAuditEvent(client, market, {
      event: "expired",
      schedule: trade.scheduleId,
      quantity: trade.quantity,
      price: trade.price,
      seller: trade.sellerAccountId,
      buyer: trade.buyerAccountId,
      tx: null,
      result: null,
    });
    return;
  }

  // Only a fully-signed (SCHEDULED) trade — or one still within its deadline — can genuinely
  // settle or be rejected by the network.
  const info = await fetchScheduleInfo(trade.scheduleId);
  if (!info) return;

  if (info.executedTimestamp) {
    await finalizeTrade(trade, client, market);
    return;
  }
  if (info.deleted) {
    // Normally set directly by the cancel flow; this is just a safety net against a missed update.
    trade.status = "CANCELLED";
  }
}

const RECONCILE_INTERVAL_MS = 4000;

declare global {
  // eslint-disable-next-line no-var
  var __dvpReconciler: ReturnType<typeof setInterval> | undefined;
}

async function reconcileMarket(): Promise<void> {
  const market = getMarket();
  if (!market) return;
  const unsettled = market.trades.filter(t => t.status === "PENDING" || t.status === "SCHEDULED");
  if (unsettled.length === 0) return;

  const client = getOperatorClient();
  try {
    for (const trade of unsettled) {
      try {
        await reconcileTrade(market, trade, client);
      } catch (e) {
        console.error("[dvp reconciler]", trade.scheduleId, e);
      }
    }
  } finally {
    client.close();
  }
}

/**
 * Starts the background loop that notices set-time settlements and expiries on its own, without
 * depending on a user pressing anything. Idempotent across hot reloads via a `globalThis` guard,
 * same trick as the market store itself.
 */
function ensureReconciler(): void {
  if (globalThis.__dvpReconciler) return;
  globalThis.__dvpReconciler = setInterval(() => void reconcileMarket(), RECONCILE_INTERVAL_MS);
}
ensureReconciler();

/** Builds the unsigned, wallet-payer ScheduleCreateTransaction for a HashPack seller to sign and submit. */
export async function prepareWalletSellerPropose(
  quantity: number,
  price: number,
  buyerChoice: BuyerChoice,
  settlementMode: SettlementMode,
  settlementDelayMinutes?: number,
): Promise<string> {
  const market = requireMarket();
  if (!market.walletSeller) throw new Error("No wallet is onboarded as Seller.");
  assertValidTerms(quantity, price);
  const timing = computeTiming(settlementMode, settlementDelayMinutes);

  const client = getOperatorClient();
  try {
    const sellerAccountId = market.walletSeller.accountId;
    market.pendingWalletProposal = {
      quantity,
      price,
      buyerChoice,
      settlementMode,
      settlementDelayMinutes: settlementDelayMinutes ?? 0,
    };
    const buyerAccountId = resolveBuyerAccountId(market, buyerChoice);
    const sellerPublicKey = await fetchWalletPublicKey(sellerAccountId);

    const scheduleTx = scheduleCreateTx(
      market,
      sellerAccountId,
      buyerAccountId,
      quantity,
      price,
      sellerPublicKey,
      timing,
    )
      .setTransactionId(TransactionId.generate(sellerAccountId))
      .freezeWith(client);

    return transactionToBase64String(scheduleTx);
  } finally {
    client.close();
  }
}

/** Records the schedule a HashPack seller just created and submitted. */
export async function completeWalletSellerPropose(transactionId: string): Promise<MarketSnapshot> {
  const market = requireMarket();
  if (!market.walletSeller) throw new Error("No wallet is onboarded as Seller.");
  const terms = market.pendingWalletProposal;
  if (!terms) throw new Error("No proposal was prepared for the wallet Seller.");
  if (!transactionId.startsWith(`${market.walletSeller.accountId}@`)) {
    throw new Error("That transaction was not submitted by the onboarded Seller wallet.");
  }
  const { quantity, price, buyerChoice, settlementMode, settlementDelayMinutes } = terms;

  const client = getOperatorClient();
  try {
    const receipt = await new TransactionReceiptQuery().setTransactionId(transactionId).execute(client);
    if (!receipt.scheduleId || !receipt.scheduledTransactionId) {
      throw new Error("Schedule creation did not return a schedule id");
    }

    const sellerAccountId = market.walletSeller.accountId;
    const buyerAccountId = resolveBuyerAccountId(market, buyerChoice);
    const timing = computeTiming(settlementMode, settlementDelayMinutes);

    const trade: Trade = {
      scheduleId: receipt.scheduleId.toString(),
      scheduledTransactionId: receipt.scheduledTransactionId.toString(),
      quantity,
      price,
      buyerChoice,
      sellerAccountId,
      buyerAccountId,
      sellerIsWallet: true,
      buyerIsWallet: buyerChoice === "buyer" && market.walletBuyer != null,
      status: "PENDING",
      settlementResult: null,
      settlementMode,
      expiresAt: timing.expiresAt.toISOString(),
      settlesAt: timing.settlesAt?.toISOString() ?? null,
      proposedAt: new Date().toISOString(),
    };
    market.trades.push(trade);
    market.pendingWalletProposal = null;

    await publishAuditEvent(client, market, {
      event: "proposed",
      schedule: trade.scheduleId,
      quantity,
      price,
      seller: sellerAccountId,
      buyer: buyerAccountId,
      tx: transactionId,
      result: "SUCCESS",
    });

    return await buildSnapshot(market);
  } finally {
    client.close();
  }
}

/** Builds the unsigned, wallet-payer ScheduleSignTransaction for a HashPack buyer to sign and submit. */
export async function prepareWalletBuyerSign(scheduleId: string): Promise<string> {
  const market = requireMarket();
  const trade = findTrade(market, scheduleId);
  if (!market.walletBuyer) throw new Error("No wallet is onboarded as Buyer.");
  if (trade.status !== "PENDING") throw new Error("Trade is not pending a signature.");
  if (!trade.buyerIsWallet) throw new Error("This trade's buyer is a demo account, not your wallet.");

  const client = getOperatorClient();
  try {
    const tx = new ScheduleSignTransaction()
      .setScheduleId(trade.scheduleId)
      .setTransactionId(TransactionId.generate(market.walletBuyer.accountId))
      .freezeWith(client);
    return transactionToBase64String(tx);
  } finally {
    client.close();
  }
}

/** Reads back the result after a HashPack buyer signed the schedule, settling on-signature trades right away. */
export async function completeWalletBuyerSign(scheduleId: string, transactionId: string): Promise<MarketSnapshot> {
  const market = requireMarket();
  const trade = findTrade(market, scheduleId);
  if (trade.status !== "PENDING" || !trade.buyerIsWallet) throw new Error("No trade is waiting for your signature.");

  const client = getOperatorClient();
  try {
    // Throws with the network's status if HashPack's ScheduleSign itself failed.
    await new TransactionReceiptQuery().setTransactionId(transactionId).execute(client);

    await publishAuditEvent(client, market, {
      event: "signed",
      schedule: trade.scheduleId,
      quantity: trade.quantity,
      price: trade.price,
      seller: trade.sellerAccountId,
      buyer: trade.buyerAccountId,
      tx: transactionId,
      result: "SUCCESS",
    });

    if (trade.settlementMode === "onSignature") await finalizeTrade(trade, client, market);
    else trade.status = "SCHEDULED";

    return await buildSnapshot(market);
  } finally {
    client.close();
  }
}

/** Builds the unsigned, wallet-payer ScheduleDeleteTransaction for a HashPack seller to cancel their trade. */
export async function prepareWalletSellerCancel(scheduleId: string): Promise<string> {
  const market = requireMarket();
  const trade = findTrade(market, scheduleId);
  if (!market.walletSeller || !trade.sellerIsWallet) throw new Error("This trade's Seller is not a connected wallet.");
  if (trade.status !== "PENDING" && trade.status !== "SCHEDULED") throw new Error("Trade can no longer be cancelled.");

  const client = getOperatorClient();
  try {
    const tx = new ScheduleDeleteTransaction()
      .setScheduleId(trade.scheduleId)
      .setTransactionId(TransactionId.generate(market.walletSeller.accountId))
      .freezeWith(client);
    return transactionToBase64String(tx);
  } finally {
    client.close();
  }
}

/** Records a HashPack seller's cancellation. */
export async function completeWalletSellerCancel(scheduleId: string, transactionId: string): Promise<MarketSnapshot> {
  const market = requireMarket();
  const trade = findTrade(market, scheduleId);
  if (!market.walletSeller) throw new Error("No wallet is onboarded as Seller.");
  if (!transactionId.startsWith(`${market.walletSeller.accountId}@`)) {
    throw new Error("That transaction was not submitted by the onboarded Seller wallet.");
  }

  const client = getOperatorClient();
  try {
    await new TransactionReceiptQuery().setTransactionId(transactionId).execute(client);
    trade.status = "CANCELLED";
    await publishAuditEvent(client, market, {
      event: "cancelled",
      schedule: trade.scheduleId,
      quantity: trade.quantity,
      price: trade.price,
      seller: trade.sellerAccountId,
      buyer: trade.buyerAccountId,
      tx: transactionId,
      result: "SUCCESS",
    });
    return await buildSnapshot(market);
  } finally {
    client.close();
  }
}

/** Builds the unsigned, wallet-payer token association for onboarding a connected wallet. */
/**
 * The operator is the issuer and the treasury of both tokens, so it cannot also take a side of
 * the trade: funding it would be a transfer to itself that moves nothing.
 */
function assertNotOperator(client: Client, accountId: string): void {
  if (client.operatorAccountId?.toString() === accountId) {
    throw new Error(
      `${accountId} is the operator account that issues both tokens. Connect a different HashPack account to trade.`,
    );
  }
}

/**
 * Who may onboard: not the operator, not a demo party (that would, for example, hand KYC to the
 * unverified Buyer), not twice in the same role, and not while a trade is pending or scheduled.
 * Returns whether the account already joined in the other role, so its association is done.
 */
function checkOnboarding(market: Market, client: Client, role: WalletRole, accountId: string): boolean {
  if (role !== "seller" && role !== "buyer") throw new Error('role must be "seller" or "buyer"');
  assertNotOperator(client, accountId);
  if ([market.seller, market.buyer, market.unverifiedBuyer].some(p => p.accountId === accountId)) {
    throw new Error(`${accountId} is one of the demo accounts. Connect your own HashPack account.`);
  }
  if (hasPendingOrScheduledTrade(market)) {
    throw new Error("A trade is pending or scheduled; it must settle, expire or be cancelled before onboarding.");
  }
  const current = role === "seller" ? market.walletSeller : market.walletBuyer;
  if (current?.accountId === accountId) throw new Error(`${accountId} is already onboarded as ${role}.`);
  const other = role === "seller" ? market.walletBuyer : market.walletSeller;
  return other?.accountId === accountId;
}

/**
 * The unsigned token association for HashPack to sign, or null when the wallet already
 * associated both tokens while onboarding for the other role.
 */
export async function prepareOnboardWallet(role: WalletRole, accountId: string): Promise<string | null> {
  const market = requireMarket();
  const client = getOperatorClient();
  try {
    if (checkOnboarding(market, client, role, accountId)) return null;
    const tx = new TokenAssociateTransaction()
      .setAccountId(accountId)
      .setTokenIds([market.securityTokenId, market.paymentTokenId])
      .setTransactionId(TransactionId.generate(accountId))
      .freezeWith(client);
    return transactionToBase64String(tx);
  } finally {
    client.close();
  }
}

/** Grants KYC and funds a wallet that associated both tokens, then adopts it for `role`. */
export async function completeOnboardWallet(role: WalletRole, accountId: string): Promise<MarketSnapshot> {
  const market = requireMarket();
  const client = getOperatorClient();
  try {
    const joinedInOtherRole = checkOnboarding(market, client, role, accountId);
    if (!joinedInOtherRole) await grantSecurityKyc(client, market.securityTokenId, accountId);

    const operatorId = client.operatorAccountId;
    if (!operatorId) throw new Error("Operator account id is not available on the client");

    const [tokenId, amount] =
      role === "seller"
        ? [market.securityTokenId, toBaseUnits(SELLER_INITIAL_SECURITY, SECURITY_DECIMALS)]
        : [market.paymentTokenId, toBaseUnits(BUYER_INITIAL_PAYMENT, PAYMENT_DECIMALS)];
    // Setup hands the whole initial supply to the demo parties; mint the wallet's share.
    await (await new TokenMintTransaction().setTokenId(tokenId).setAmount(amount).execute(client)).getReceipt(client);
    const response = await new TransferTransaction()
      .addTokenTransfer(tokenId, operatorId.toString(), -amount)
      .addTokenTransfer(tokenId, accountId, amount)
      .execute(client);
    await response.getReceipt(client);
    await waitForMirrorIndexing(response.transactionId.toString());

    if (role === "seller") market.walletSeller = { accountId };
    else market.walletBuyer = { accountId };
    return await buildSnapshot(market);
  } finally {
    client.close();
  }
}
