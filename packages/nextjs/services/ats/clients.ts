// Server-only: viem clients talking to Hedera's JSON-RPC relay, and the operator account every
// issuer transaction is signed with. Private keys never leave this module.
import { HASHIO_TESTNET_RPC_URL } from "./constants";
import { parseOperatorKey } from "./operatorKey";
import { createPublicClient, createWalletClient, http } from "viem";
import type { Account } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import * as chains from "viem/chains";

export type OperatorConfig =
  | {
      configured: true;
      operatorAccountId: string;
      account: Account;
      publicClient: ReturnType<typeof createPublicClient>;
      walletClient: ReturnType<typeof createWalletClient>;
    }
  | { configured: false; error: string };

let cachedConfig: OperatorConfig | null = null;

export function getOperatorConfig(): OperatorConfig {
  if (cachedConfig) return cachedConfig;

  const operatorAccountId = process.env.HEDERA_OPERATOR_ID;
  const operatorKey = process.env.HEDERA_OPERATOR_KEY;

  if (!operatorAccountId || !operatorKey) {
    cachedConfig = {
      configured: false,
      error: "Set HEDERA_OPERATOR_ID and HEDERA_OPERATOR_KEY to configure the issuer.",
    };
    return cachedConfig;
  }

  const parsedKey = parseOperatorKey(operatorKey);
  if (!parsedKey.ok) {
    cachedConfig = { configured: false, error: parsedKey.error };
    return cachedConfig;
  }

  const account = privateKeyToAccount(parsedKey.privateKeyHex);
  const transport = http(HASHIO_TESTNET_RPC_URL);

  cachedConfig = {
    configured: true,
    operatorAccountId,
    account,
    publicClient: createPublicClient({ chain: chains.hederaTestnet, transport }),
    walletClient: createWalletClient({ chain: chains.hederaTestnet, transport, account }),
  };
  return cachedConfig;
}

/** Narrows a possibly-unconfigured operator to the configured shape, or throws its error. */
export function requireOperator() {
  const operator = getOperatorConfig();
  if (!operator.configured) throw new Error(operator.error);
  return operator;
}

let sharedPublicClient: ReturnType<typeof createPublicClient> | null = null;

/** Read-only client for chain reads that don't need the operator (bond/resolver views). */
export function getPublicClient() {
  if (!sharedPublicClient) {
    sharedPublicClient = createPublicClient({ chain: chains.hederaTestnet, transport: http(HASHIO_TESTNET_RPC_URL) });
  }
  return sharedPublicClient;
}
