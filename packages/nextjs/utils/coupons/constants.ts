/** Shared constants for the coupon bond desk (client and server). */

/** HBAR reserved per remaining coupon so the bond can pay for its own `scheduleCall`s. */
export const HBAR_RESERVE_PER_COUPON = 3;

/**
 * The most stablecoin one funding call will move. The desk mints 10,000,000, and a demo bond
 * needs thousands; a request for more than this is a mistake or someone else's idea.
 */
export const MAX_FUNDING_WHOLE = 1_000_000;

/** Decimals the desk's HTS stablecoin is created with. */
export const STABLECOIN_DECIMALS = 6;

export const MIRROR_BASE: Record<string, string> = {
  testnet: "https://testnet.mirrornode.hedera.com",
  mainnet: "https://mainnet.mirrornode.hedera.com",
};

export const HEDERA_TESTNET_CHAIN_ID = 296;
