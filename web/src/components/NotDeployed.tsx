import type { NetworkConfig } from "@/lib/networks";

/** Shown instead of any transaction action when ArcGift has no contract on this network. */
export function NotDeployed({ network }: { network: NetworkConfig }) {
  return (
    <p role="status" data-testid="not-deployed" className="rounded-2xl bg-ribbon/15 px-4 py-3 text-sm leading-relaxed">
      ArcGift contract is not deployed on this network yet.
      <span className="block text-muted">{network.chainName} · chain {network.chainId}</span>
    </p>
  );
}
