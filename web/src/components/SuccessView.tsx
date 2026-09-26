"use client";

import Link from "next/link";
import { isHash, parseEventLogs, type Hex } from "viem";
import { useWaitForTransactionReceipt } from "wagmi";
import { arcGiftAbi } from "@/lib/abi";
import { formatUsdc } from "@/lib/amount";
import { getNetwork, txUrl, type NetworkId } from "@/lib/networks";
import { parseGiftId } from "@/lib/useGift";
import { useSyncNetwork } from "./ClaimView";
import { GiftBox } from "./GiftBox";
import { Notice } from "./ui";

/** Confirms a claim from its receipt, so the amount shown is what actually arrived. */
export function SuccessView({ rawId, tx, networkId }: { rawId: string; tx?: string; networkId: NetworkId }) {
  const network = getNetwork(networkId);
  useSyncNetwork(networkId);
  const id = parseGiftId(rawId);
  const hash = tx && isHash(tx) ? (tx as Hex) : undefined;
  const receipt = useWaitForTransactionReceipt({ hash, chainId: network.chainId, query: { enabled: !!hash } });
  const explorer = hash ? txUrl(network, hash) : undefined;

  const event =
    receipt.data &&
    parseEventLogs({ abi: arcGiftAbi, eventName: "GiftClaimed", logs: receipt.data.logs }).find(
      (e) => e.args.giftId === id && e.address.toLowerCase() === network.giftContractAddress?.toLowerCase(),
    );

  if (!hash || id === null) {
    return <Notice tone="error">This page needs a claim transaction. Open your gift link again.</Notice>;
  }
  if (receipt.isLoading) {
    return (
      <div className="flex flex-1 flex-col items-center pt-6 text-center" aria-busy>
        <GiftBox state="still" size={200} />
        <p className="mt-4 text-muted">Confirming your claim…</p>
      </div>
    );
  }
  if (receipt.isError || !event || receipt.data?.status !== "success") {
    return (
      <div className="flex flex-col gap-4 pt-6">
        <Notice tone="error">We couldn&apos;t confirm this claim. Check the transaction in the explorer.</Notice>
        {explorer && (
          <a href={explorer} target="_blank" rel="noopener noreferrer" className="text-center font-semibold text-box underline">
            View transaction
          </a>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col items-center text-center">
      <div className="pt-4 pb-2">
        <GiftBox state="open" size={220} />
      </div>
      <h1 className="text-3xl font-extrabold tracking-tight">Gift claimed! 🎉</h1>
      <p className="reveal-amount tabular mt-4 text-[3.2rem] leading-none font-extrabold tracking-tight" data-testid="claimed-amount">
        {formatUsdc(event.args.amount)}
        <span className="ml-2 text-2xl font-bold text-muted">USDC</span>
      </p>
      <p className="mt-3 text-[17px] text-muted">has been sent to your wallet.</p>
      <div className="mt-10 flex w-full flex-col gap-2">
        {explorer && (
          <a
            href={explorer}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-14 items-center justify-center rounded-full bg-ink text-[17px] font-semibold text-tissue hover:opacity-90"
          >
            View transaction
          </a>
        )}
        <Link
          href="/create"
          className="inline-flex min-h-12 items-center justify-center rounded-full bg-surface font-semibold ring-1 ring-line hover:ring-muted"
        >
          Send a gift of your own
        </Link>
      </div>
    </div>
  );
}
