"use client";

import { NotDeployed } from "@/components/NotDeployed";
import { EmptyState, ListSkeleton } from "@/components/States";
import { NetworkDot } from "@/components/NetworkSwitcher";
import { Notice, errorMessage } from "@/components/ui";
import { ConnectWallet, shortAddress, useWallet } from "@/components/Wallet";
import { formatUsdc } from "@/lib/amount";
import { useNetwork } from "@/lib/network-context";
import { txUrl } from "@/lib/networks";
import { useActivity, type ActivityItem } from "@/lib/useActivity";
import { formatDate } from "@/lib/useGift";

const COPY: Record<ActivityItem["kind"], { title: (i: ActivityItem) => string; sign: string; icon: string }> = {
  created: { title: (i) => `Created gift #${i.giftId}`, sign: "−", icon: "🎁" },
  opened: { title: (i) => `${shortAddress(i.counterparty ?? "")} opened gift #${i.giftId}`, sign: "", icon: "✨" },
  received: { title: (i) => `Received gift #${i.giftId}`, sign: "+", icon: "🎉" },
  reclaimed: { title: (i) => `Reclaimed gift #${i.giftId}`, sign: "+", icon: "↩︎" },
};

export default function ActivityPage() {
  const { network } = useNetwork();
  const { address, isConnected } = useWallet();
  const activity = useActivity(network, address);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight">Activity</h1>
        <p className="mt-1 flex items-center gap-2 text-sm text-muted" data-testid="activity-network">
          <NetworkDot id={network.id} /> {network.chainName}
        </p>
      </div>

      {!network.giftContractAddress ? (
        <NotDeployed network={network} />
      ) : !isConnected ? (
        <>
          <p className="text-muted">Connect your wallet to see gifts you&apos;ve sent and received.</p>
          <ConnectWallet />
        </>
      ) : activity.error ? (
        <Notice tone="error">{errorMessage(activity.error)}</Notice>
      ) : activity.isLoading ? (
        <ListSkeleton label="Loading activity" />
      ) : !activity.data?.length ? (
        <EmptyState title="Nothing here yet" body={`Your gift activity on ${network.chainName} will appear here.`} />
      ) : (
        <ul className="divide-y divide-line rounded-3xl bg-surface ring-1 ring-line" data-testid="activity-list">
          {activity.data.map((item, i) => {
            const c = COPY[item.kind];
            const url = item.txHash ? txUrl(network, item.txHash) : undefined;
            return (
              <li key={`${item.kind}-${item.giftId}-${item.blockNumber}-${i}`} className="flex items-center gap-3 px-4 py-3.5">
                <span aria-hidden className="text-xl">
                  {c.icon}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{c.title(item)}</p>
                  <p className="text-xs text-muted">
                    {item.timestamp ? formatDate(item.timestamp) : `Block ${item.blockNumber}`}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-0.5">
                  <span className="tabular text-sm font-bold whitespace-nowrap">
                    {c.sign}
                    {formatUsdc(item.amount)} <span className="font-semibold text-muted">USDC</span>
                  </span>
                  {url && (
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-muted transition-colors hover:text-box"
                    >
                      View tx
                    </a>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
