"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useNetwork } from "@/lib/network-context";
import { addressUrl, type NetworkConfig } from "@/lib/networks";
import { NetworkDot } from "./NetworkSwitcher";
import { shortAddress } from "./Wallet";

const PRODUCT = [
  { href: "/create/group", label: "Create Gift" },
  { href: "/dashboard", label: "My Gifts" },
  { href: "/activity", label: "Activity" },
];

/** What each network means for the user's money — facts only, no invented status. */
const FUNDS: Record<NetworkConfig["id"], string> = {
  testnet: "Use test funds only",
  mainnet: "Transactions use real USDC",
  local: "For development only",
};

const linkClass = "inline-block py-1.5 text-muted transition-colors hover:text-box";

function Column({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="mb-1 text-xs font-semibold tracking-wide text-ink uppercase">{title}</p>
      {children}
    </div>
  );
}

/**
 * Site footer. Every link points somewhere real: app routes, the home page's "How it works", and
 * the selected network's explorer page for the ArcGift contract (only when one is deployed).
 * Gift pages are a focused flow, so they get the compact version below the result.
 */
export function Footer() {
  const { network } = useNetwork();
  const pathname = usePathname();
  const compact = pathname.startsWith("/gift/");
  const contract = network.giftContractAddress;
  const contractUrl = contract ? addressUrl(network, contract) : undefined;
  const year = new Date().getFullYear();

  const bottom = (
    <div className="flex flex-col gap-1 text-xs text-muted sm:flex-row sm:items-center sm:justify-between">
      <p>© {year} ArcGift · Built on Arc</p>
      <p className="flex items-center gap-1.5" data-testid="footer-network-note">
        <NetworkDot id={network.id} />
        {network.chainName} · {FUNDS[network.id]}
      </p>
    </div>
  );

  if (compact) {
    return (
      <footer className="w-full border-t border-line/60">
        <div className="mx-auto w-full max-w-5xl px-4 pt-6 pb-7">{bottom}</div>
      </footer>
    );
  }

  return (
    <footer className="w-full border-t border-line/60" data-testid="site-footer">
      <div className="mx-auto w-full max-w-5xl px-4 pt-12 pb-8">
        <div className="grid grid-cols-2 gap-x-6 gap-y-9 text-sm sm:grid-cols-[1.6fr_1fr_1fr_1.2fr]">
          <div className="col-span-2 flex flex-col gap-2 sm:col-span-1">
            <Link href="/" aria-label="ArcGift home" className="flex w-fit items-center gap-1.5">
              <Image src="/brand/arcgift-mark.png" alt="" width={313} height={251} className="h-7 w-auto" />
              <Image
                src="/brand/arcgift-wordmark-light.png"
                alt="ArcGift"
                width={628}
                height={155}
                className="h-[17px] w-auto dark:hidden"
              />
              <Image
                src="/brand/arcgift-wordmark-dark.png"
                alt="ArcGift"
                width={628}
                height={155}
                className="hidden h-[17px] w-auto dark:block"
              />
            </Link>
            <p className="font-semibold">Send USDC like a gift.</p>
            <p className="text-muted">Simple, programmable gifting on Arc.</p>
          </div>

          <Column title="Product">
            {PRODUCT.map((l) => (
              <Link key={l.href} href={l.href} className={linkClass}>
                {l.label}
              </Link>
            ))}
          </Column>

          <Column title="Resources">
            <Link href="/#how-it-works" className={linkClass}>
              How it works
            </Link>
            {contractUrl && (
              <a href={contractUrl} target="_blank" rel="noopener noreferrer" className={linkClass}>
                Contract <span aria-hidden>↗</span>
              </a>
            )}
          </Column>

          <Column title="Network">
            <p className="flex items-center gap-2 py-1.5 font-semibold">
              <NetworkDot id={network.id} />
              {network.chainName}
            </p>
            {contract && <p className="tabular text-muted">{shortAddress(contract)}</p>}
          </Column>
        </div>

        <div className="mt-10 border-t border-line/60 pt-6">{bottom}</div>
      </div>
    </footer>
  );
}
