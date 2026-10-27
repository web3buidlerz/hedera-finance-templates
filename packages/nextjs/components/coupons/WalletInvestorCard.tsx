"use client";

import { hederaTestnet } from "viem/chains";
import { useAccount, useSwitchChain, useWriteContract } from "wagmi";
import { useMirrorAccount } from "~~/hooks/coupons/useMirrorAccount";
import type { Stablecoin } from "~~/services/coupons/state";
import { hip719Abi } from "~~/utils/coupons/abi";

type Props = {
  stablecoin: Stablecoin | null | undefined;
  walletInvestor: { evmAddress: `0x${string}` } | null;
  onAdd: (address: `0x${string}`) => void;
};

/** The wallet investor: the learner's own MetaMask account, optionally given a position. */
export function WalletInvestorCard({ stablecoin, walletInvestor, onAdd }: Props) {
  const { address, isConnected, chain } = useAccount();
  const { switchChain } = useSwitchChain();
  const onWrongNetwork = isConnected && chain?.id !== hederaTestnet.id;

  const mirror = useMirrorAccount(walletInvestor?.evmAddress, stablecoin?.tokenId);
  const { writeContractAsync, isPending: isAssociating } = useWriteContract();

  const handleAssociate = async () => {
    if (!stablecoin) return;
    try {
      await writeContractAsync({
        address: stablecoin.evmAddress,
        abi: hip719Abi,
        functionName: "associate",
        chainId: hederaTestnet.id,
      });
      mirror.refetch();
    } catch {
      // Left to the wallet's own UI (e.g. the user rejected the request).
    }
  };

  let walletState: string;
  if (!isConnected) {
    walletState = "Connect your wallet to add it as an investor.";
  } else if (onWrongNetwork) {
    walletState = "Switch to Hedera testnet to add your wallet as an investor.";
  } else if (!walletInvestor) {
    walletState = 'Press "Add my wallet as an investor" to give your wallet a position.';
  } else if (!mirror.data?.associated) {
    walletState = "Associate the stablecoin so your wallet can receive coupons.";
  } else {
    walletState = "You're set -- coupons will arrive automatically once the bond is running.";
  }

  return (
    <div className="card bg-base-100 shadow border border-base-300">
      <div className="card-body gap-2 !p-4">
        <div>
          <h3 className="card-title text-base">Your wallet</h3>
          <p className="text-sm text-base-content/70 m-0">
            Optionally give your connected wallet a position; coupons arrive without you signing anything.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {onWrongNetwork && (
            <button type="button" className="btn btn-sm" onClick={() => switchChain({ chainId: hederaTestnet.id })}>
              Switch to Hedera testnet
            </button>
          )}
          <button
            id="add-wallet-investor"
            type="button"
            className="btn btn-primary btn-sm"
            disabled={!isConnected || Boolean(onWrongNetwork) || Boolean(walletInvestor) || !address}
            onClick={() => address && onAdd(address as `0x${string}`)}
          >
            Add my wallet as an investor
          </button>
          {walletInvestor && !mirror.data?.associated && (
            <button
              id="associate-stablecoin"
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={isAssociating || !stablecoin}
              onClick={handleAssociate}
            >
              {isAssociating ? "Associating…" : "Associate the stablecoin"}
            </button>
          )}
        </div>
        <p id="wallet-state" className="text-sm text-base-content/70 m-0">
          {walletState}
        </p>
      </div>
    </div>
  );
}
