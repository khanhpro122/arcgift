"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useNetwork } from "@/lib/network-context";
import { NETWORK_IDS, getNetwork, type NetworkId } from "@/lib/networks";

const DOT: Record<NetworkId, string> = {
  testnet: "bg-amber-500",
  mainnet: "bg-emerald-500",
  local: "bg-sky-500",
};

export function NetworkDot({ id }: { id: NetworkId }) {
  return <span aria-hidden className={`inline-block size-2 shrink-0 rounded-full ${DOT[id]}`} />;
}

/**
 * Navbar network selector. On a gift page the network is part of the URL, so switching rewrites
 * `?network=` (keeping the #k= key) and the page reloads that gift on the new network.
 */
export function NetworkSwitcher() {
  const { network, setNetwork } = useNetwork();
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  function choose(id: NetworkId) {
    setOpen(false);
    if (id === network.id) return;
    if (pathname.startsWith("/gift/")) {
      // The URL owns the network on gift pages; the page syncs the selection from it.
      const params = new URLSearchParams(window.location.search);
      params.set("network", id);
      params.delete("tx"); // a tx hash belongs to the network it was sent on
      router.replace(`${pathname}?${params}${window.location.hash}`);
      return;
    }
    setNetwork(id);
  }

  return (
    <div className="relative" ref={ref}>
      <button
        data-testid="network-switcher"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Network: ${network.name}`}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex h-9 items-center gap-2 rounded-full bg-surface px-3 text-sm font-semibold ring-1 ring-line hover:ring-muted"
      >
        <NetworkDot id={network.id} />
        {network.name}
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden className="text-muted">
          <path d="M1 3l4 4 4-4" stroke="currentColor" strokeWidth="1.6" fill="none" />
        </svg>
      </button>
      {open && (
        <div className="absolute left-0 z-20 mt-2 w-48 rounded-2xl bg-surface p-1 shadow-lg ring-1 ring-line">
          <p className="px-3 pt-2 pb-1 text-xs text-muted">Arc network</p>
          <ul role="listbox" aria-label="Arc network">
            {NETWORK_IDS.map((id) => {
              const n = getNetwork(id);
              const selected = id === network.id;
              return (
                <li key={id} role="option" aria-selected={selected}>
                  <button
                    onClick={() => choose(id)}
                    className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm hover:bg-tissue"
                  >
                    <NetworkDot id={id} />
                    <span className="flex-1">{n.name}</span>
                    {selected && <span aria-hidden>✓</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
