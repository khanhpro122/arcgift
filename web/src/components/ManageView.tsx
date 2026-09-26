"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { useConfig } from "wagmi";
import { simulateContract, waitForTransactionReceipt, writeContract } from "wagmi/actions";
import { arcGiftAbi } from "@/lib/abi";
import { formatUsdc } from "@/lib/amount";
import { buildGiftLink } from "@/lib/claimKey";
import { getNetwork, txUrl, type NetworkConfig, type NetworkId } from "@/lib/networks";
import { findGiftKey } from "@/lib/giftStore";
import {
  formatDate,
  parseGiftId,
  timeLeft,
  useClaims,
  useGift,
  useNow,
  useReclaimTx,
  type GiftData,
} from "@/lib/useGift";
import { assertWalletOn } from "@/lib/wagmi";
import { useGiftMessage, useSyncNetwork } from "./ClaimView";
import { NotDeployed } from "./NotDeployed";
import { Progress } from "./Progress";
import { SharePanel } from "./SharePanel";
import { StatusBadge } from "./StatusBadge";
import { Button, Notice, Spinner, errorMessage } from "./ui";
import { ConnectWallet, WrongNetwork, shortAddress, useWallet } from "./Wallet";

export function ManageView({ rawId, networkId }: { rawId: string; networkId: NetworkId }) {
  const network = getNetwork(networkId);
  useSyncNetwork(networkId);
  const id = parseGiftId(rawId);
  const { address, isConnected } = useWallet(network);
  const { data: gift, notFound, isLoading, error, refetch } = useGift(network, id);

  if (!network.giftContractAddress) return <NotDeployed network={network} />;
  if (id === null || notFound) return <Notice tone="error">Gift not found on this network.</Notice>;
  if (error) return <Notice tone="error">{errorMessage(error)}</Notice>;
  if (!isConnected) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-3xl font-extrabold tracking-tight">Gift #{rawId}</h1>
        <p className="text-muted">Connect the wallet that created this gift to manage it.</p>
        <ConnectWallet />
      </div>
    );
  }
  if (isLoading || !gift) return <p className="text-muted" aria-busy>Loading gift…</p>;
  if (gift.sender.toLowerCase() !== address?.toLowerCase()) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-3xl font-extrabold tracking-tight">Gift #{rawId}</h1>
        <Notice>Only the wallet that created this gift can see its details.</Notice>
      </div>
    );
  }
  return <Detail network={network} gift={gift} onChange={() => refetch()} />;
}

function Detail({ network, gift, onChange }: { network: NetworkConfig; gift: GiftData; onChange: () => void }) {
  const now = useNow();
  const key = useQuery({
    queryKey: ["giftKey", network.id, network.giftContractAddress, gift.id.toString()],
    queryFn: () => findGiftKey(network, gift.id, gift.claimSigner) ?? null,
    staleTime: Infinity,
  });
  const message = useGiftMessage(network, gift.id, key.data, gift.message);
  const claims = useClaims(network, gift.id, gift.claimedCount);
  const reclaimTx = useReclaimTx(network, gift.id, gift.reclaimed ? gift.reclaimedBlock : undefined);
  const link = key.data ? buildGiftLink(window.location.origin, network.id, gift.id, key.data) : null;

  return (
    <div className="flex flex-col gap-7">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm text-muted">
            {gift.recipients > 1 ? "Group gift" : "Gift"} #{gift.id.toString()}
          </p>
          <h1 className="tabular text-4xl font-extrabold tracking-tight">
            {formatUsdc(gift.totalAmount)} <span className="text-xl text-muted">USDC</span>
          </h1>
        </div>
        <StatusBadge status={gift.status} />
      </div>

      <Progress gift={gift} />

      <dl className="grid grid-cols-2 gap-x-4 gap-y-4 text-sm">
        <Fact label="Recipients" value={`${gift.recipients}`} />
        <Fact label="Distribution" value={gift.mode === "random" ? "Random" : "Fixed"} />
        <Fact label="Claimed" value={`${formatUsdc(gift.claimedAmount)} USDC`} />
        <Fact label="Remaining" value={`${formatUsdc(gift.remaining)} USDC`} />
        <Fact label="Created" value={formatDate(gift.createdAt)} />
        <Fact
          label="Expires"
          value={`${formatDate(gift.expiresAt)}${gift.status === "active" && now ? ` (${timeLeft(gift.expiresAt, now)})` : ""}`}
        />
      </dl>

      {gift.message !== "0x" && (
        <section className="flex flex-col gap-2">
          <h2 className="font-semibold">Message</h2>
          <p className="rounded-2xl bg-surface p-4 whitespace-pre-line ring-1 ring-line">
            {message.data ?? <span className="text-muted">Encrypted. Open it on the device you created it on to read it.</span>}
          </p>
        </section>
      )}

      {gift.status === "expired" && gift.remaining > 0n && <Reclaim network={network} gift={gift} onDone={onChange} />}

      {gift.reclaimed && (
        <Notice>
          You reclaimed the unopened {formatUsdc(gift.totalAmount - gift.claimedAmount)} USDC.{" "}
          {reclaimTx.data && txUrl(network, reclaimTx.data) && (
            <a href={txUrl(network, reclaimTx.data)} target="_blank" rel="noopener noreferrer" className="font-semibold underline">
              View transaction
            </a>
          )}
        </Notice>
      )}

      {gift.status === "active" && (
        <section className="flex flex-col gap-3">
          <h2 className="font-semibold">Share</h2>
          {link ? (
            <SharePanel id={gift.id} link={link} networkId={network.id} compact />
          ) : (
            key.isFetched && (
              <Notice>The link for this gift is saved on the device you created it on. It can&apos;t be recovered here.</Notice>
            )
          )}
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">Claims</h2>
        {gift.claimedCount === 0 ? (
          <p className="text-sm text-muted">No one has opened this gift yet.</p>
        ) : (
          <ul className="divide-y divide-line rounded-2xl bg-surface ring-1 ring-line" data-testid="claims-list">
            {(claims.data ?? []).map((c, i) => (
              <li key={`${c.recipient}-${i}`} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                <span className="tabular text-muted">{shortAddress(c.recipient)}</span>
                <span className="tabular ml-auto font-semibold">{formatUsdc(c.amount)} USDC</span>
                {c.txHash && txUrl(network, c.txHash) ? (
                  <a href={txUrl(network, c.txHash)} target="_blank" rel="noopener noreferrer" className="text-box underline">
                    Tx
                  </a>
                ) : (
                  <span className="w-5" />
                )}
              </li>
            ))}
            {claims.isLoading && <li className="px-4 py-3 text-sm text-muted">Loading claims…</li>}
          </ul>
        )}
      </section>

      <div className="flex flex-col gap-2">
        <Link href="/dashboard" className="text-center text-sm font-semibold text-box hover:underline">
          Back to my gifts
        </Link>
      </div>
    </div>
  );
}

function Reclaim({ network, gift, onDone }: { network: NetworkConfig; gift: GiftData; onDone: () => void }) {
  const config = useConfig();
  const { address, onRightChain } = useWallet(network);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  async function reclaim() {
    if (!address || !network.giftContractAddress) return;
    const chainId = network.chainId;
    setPending(true);
    setError(null);
    try {
      await assertWalletOn(network);
      const { request } = await simulateContract(config, {
        chainId,
        account: address,
        address: network.giftContractAddress,
        abi: arcGiftAbi,
        functionName: "reclaim",
        args: [gift.id],
      });
      await assertWalletOn(network); // re-checked right before the wallet prompt
      const hash = await writeContract(config, request);
      setTxHash(hash);
      const receipt = await waitForTransactionReceipt(config, { chainId, hash });
      if (receipt.status !== "success") throw new Error("The reclaim transaction failed on-chain.");
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded-3xl bg-ribbon/15 p-5">
      <h2 className="text-xl font-extrabold">Gift expired</h2>
      <dl className="tabular grid grid-cols-2 gap-2 text-sm">
        <Fact label="Claimed" value={`${formatUsdc(gift.claimedAmount)} USDC`} />
        <Fact label="Unclaimed" value={`${formatUsdc(gift.remaining)} USDC`} />
      </dl>
      {!onRightChain ? (
        <WrongNetwork network={network} />
      ) : (
        <Button className="min-h-14 w-full text-[17px]" disabled={pending} onClick={reclaim}>
          {pending && <Spinner />}
          <span key={String(pending)}>{pending ? "Reclaiming…" : `Reclaim ${formatUsdc(gift.remaining)} USDC`}</span>
        </Button>
      )}
      {txHash && pending && txUrl(network, txHash) && (
        <a href={txUrl(network, txHash)} target="_blank" rel="noopener noreferrer" className="text-center text-sm underline">
          View pending transaction
        </a>
      )}
      {error && <Notice tone="error">{error}</Notice>}
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted">{label}</dt>
      <dd className="tabular font-semibold">{value}</dd>
    </div>
  );
}

