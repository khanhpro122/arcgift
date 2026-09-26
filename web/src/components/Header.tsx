"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { erc20Abi } from "viem";
import { useReadContract } from "wagmi";
import { formatUsdc } from "@/lib/amount";
import { useNetwork } from "@/lib/network-context";
import { NetworkSwitcher } from "./NetworkSwitcher";
import { WalletButton, useWallet } from "./Wallet";

const NAV = [
  { href: "/create/group", label: "Create Gift", match: "/create" },
  { href: "/dashboard", label: "My Gifts", match: "/dashboard" },
  { href: "/activity", label: "Activity", match: "/activity" },
];

/** USDC balance on the selected network. The query key includes the chain, so switching
 *  networks shows nothing until the new network's balance arrives. */
function UsdcBalance() {
  const { network } = useNetwork();
  const { address } = useWallet();
  const balance = useReadContract({
    address: network.usdcAddress,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    chainId: network.chainId,
    query: { enabled: !!address, refetchInterval: 15_000 },
  });
  if (!address) return null;
  return (
    <span
      data-testid="usdc-balance"
      data-network={network.id}
      className="tabular inline-flex h-9 items-center rounded-full bg-surface px-3 text-sm font-semibold whitespace-nowrap ring-1 ring-line"
    >
      {balance.data === undefined ? "…" : formatUsdc(balance.data)}
      <span className="ml-1 text-muted">USDC</span>
    </span>
  );
}

export function Header() {
  const pathname = usePathname();
  return (
    <header className="sticky top-0 z-30 w-full border-b border-line/60 bg-tissue/80 backdrop-blur-md">
      <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3">
        <Link href="/" aria-label="ArcGift home" className="flex shrink-0 items-center gap-1.5">
          {/* Brand assets from arcgift-brand-assets.zip, cleaned by scripts/brand-assets.cjs */}
          <Image src="/brand/arcgift-mark.png" alt="" width={313} height={251} priority className="h-8 w-auto" />
          <Image
            src="/brand/arcgift-wordmark-light.png"
            alt="ArcGift"
            width={628}
            height={155}
            priority
            className="h-[19px] w-auto dark:hidden"
          />
          <Image
            src="/brand/arcgift-wordmark-dark.png"
            alt="ArcGift"
            width={628}
            height={155}
            priority
            className="hidden h-[19px] w-auto dark:block"
          />
        </Link>
        <nav className="ml-auto flex items-center gap-3 text-sm sm:ml-4 sm:gap-4" aria-label="Main">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              aria-current={pathname.startsWith(n.match) ? "page" : undefined}
              className="whitespace-nowrap text-muted hover:text-ink aria-[current=page]:font-semibold aria-[current=page]:text-ink"
            >
              {n.label}
            </Link>
          ))}
        </nav>
        {/* Second row on phones, same row on wider screens */}
        <div className="flex w-full items-center gap-2 sm:ml-auto sm:w-auto">
          <NetworkSwitcher />
          <div className="ml-auto flex items-center gap-2 sm:ml-0">
            <UsdcBalance />
            <WalletButton />
          </div>
        </div>
      </div>
    </header>
  );
}
