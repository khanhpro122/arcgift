"use client";

import Link from "next/link";
import { useReadContract, useReadContracts } from "wagmi";
import { StatusBadge } from "@/components/StatusBadge";
import { Notice, errorMessage } from "@/components/ui";
import { ConnectWallet, useWallet } from "@/components/Wallet";
import { arcGiftAbi } from "@/lib/abi";
import { formatUsdc } from "@/lib/amount";
import { useNetwork } from "@/lib/network-context";
import { NotDeployed } from "@/components/NotDeployed";
import { EmptyState, ListSkeleton } from "@/components/States";
import { zeroAddress } from "viem";
import { STATUS, type GiftStatus } from "@/lib/useGift";

const MAX_SHOWN = 50;

type Row = {
  id: bigint;
  totalAmount: bigint;
  claimedAmount: bigint;
  recipients: number;
  claimedCount: number;
  reclaimed: boolean;
  status: GiftStatus;
};

export default function DashboardPage() {
  const { network } = useNetwork();
  const { address, isConnected } = useWallet();
  const gift = { address: network.giftContractAddress ?? zeroAddress, abi: arcGiftAbi, chainId: network.chainId } as const;

  const ids = useReadContract({
    ...gift,
    functionName: "getGiftsBySender",
    args: address ? [address] : undefined,
    query: { enabled: !!address && !!network.giftContractAddress, refetchInterval: 10_000 },
  });
  const newest = [...(ids.data ?? [])].reverse().slice(0, MAX_SHOWN);

  const details = useReadContracts({
    contracts: newest.flatMap((id) => [
      { ...gift, functionName: "getGift", args: [id] } as const,
      { ...gift, functionName: "status", args: [id] } as const,
    ]),
    allowFailure: false,
    query: { enabled: newest.length > 0, refetchInterval: 10_000 },
  });

  const rows: Row[] = newest.flatMap((id, i) => {
    const g = details.data?.[i * 2] as
      | { totalAmount: bigint; claimedAmount: bigint; recipients: number; claimedCount: number; reclaimed: boolean }
      | undefined;
    const s = details.data?.[i * 2 + 1] as number | undefined;
    return g && s !== undefined ? [{ id, ...g, status: STATUS[s] }] : [];
  });

  if (!network.giftContractAddress) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-3xl font-extrabold tracking-tight">My gifts</h1>
        <NotDeployed network={network} />
      </div>
    );
  }

  if (!isConnected) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-3xl font-extrabold tracking-tight">My gifts</h1>
        <p className="text-muted">Connect your wallet to see the gifts you&apos;ve sent.</p>
        <ConnectWallet />
      </div>
    );
  }

  const sum = (f: (r: Row) => bigint) => rows.reduce((a, r) => a + f(r), 0n);
  const totals = {
    created: rows.length,
    total: sum((r) => r.totalAmount),
    claimed: sum((r) => r.claimedAmount),
    remaining: sum((r) => (r.reclaimed ? 0n : r.totalAmount - r.claimedAmount)),
    expired: rows.filter((r) => r.status === "expired").length,
    reclaimable: sum((r) => (r.status === "expired" ? r.totalAmount - r.claimedAmount : 0n)),
  };

  return (
    <div className="flex flex-col gap-7">
      <div className="flex items-end justify-between">
        <h1 className="text-3xl font-extrabold tracking-tight">My gifts</h1>
        <Link href="/create/group" className="text-sm font-semibold text-box hover:underline">
          New gift
        </Link>
      </div>

      {(ids.error || details.error) && <Notice tone="error">{errorMessage(ids.error ?? details.error)}</Notice>}

      {ids.isLoading || (newest.length > 0 && !details.data && details.isLoading) ? (
        <ListSkeleton label="Loading gifts" />
      ) : ids.data && ids.data.length === 0 ? (
        <EmptyState title="No gifts yet" body="Create your first gift and share it with your friends." />
      ) : (
        <>
          <dl className="tabular grid grid-cols-3 gap-x-3 gap-y-4 rounded-3xl bg-surface p-5 text-sm ring-1 ring-line">
            <Stat label="Created" value={`${totals.created}`} />
            <Stat label="Sent" value={formatUsdc(totals.total)} />
            <Stat label="Claimed" value={formatUsdc(totals.claimed)} />
            <Stat label="Remaining" value={formatUsdc(totals.remaining)} />
            <Stat label="Expired" value={`${totals.expired}`} />
            <Stat label="Reclaimable" value={formatUsdc(totals.reclaimable)} highlight={totals.reclaimable > 0n} />
          </dl>

          <ul className="flex flex-col gap-3" data-testid="gift-list">
            {rows.map((r) => (
              <li key={r.id.toString()}>
                <Link
                  href={`/gift/${r.id}/manage?network=${network.id}`}
                  className="flex flex-col gap-3 rounded-3xl bg-surface p-5 ring-1 ring-line hover:ring-muted"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="flex items-center gap-2 font-semibold">
                      <span aria-hidden>🎁</span>
                      {r.recipients > 1 ? "Group gift" : "Gift"} #{r.id.toString()}
                    </span>
                    <StatusBadge status={r.status} />
                  </div>
                  <div className="flex items-baseline justify-between">
                    <span className="tabular text-2xl font-extrabold">
                      {formatUsdc(r.totalAmount)} <span className="text-base text-muted">USDC</span>
                    </span>
                    <span className="tabular text-sm text-muted">
                      {r.claimedCount} / {r.recipients} claimed
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-line">
                    <div
                      className="h-full rounded-full bg-ribbon"
                      style={{ width: `${Math.round((r.claimedCount / r.recipients) * 100)}%` }}
                    />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
          {(ids.data?.length ?? 0) > MAX_SHOWN && (
            <p className="text-center text-sm text-muted">Showing your {MAX_SHOWN} newest gifts.</p>
          )}
        </>
      )}
    </div>
  );
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div>
      <dt className="text-muted">{label}</dt>
      <dd className={`text-lg font-bold ${highlight ? "text-ribbon-deep" : ""}`}>{value}</dd>
    </div>
  );
}
