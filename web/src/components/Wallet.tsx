"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useConnect, useConnection, useConnectors, useDisconnect, useSwitchChain } from "wagmi";
import { useNetwork } from "@/lib/network-context";
import type { NetworkConfig } from "@/lib/networks";
import { Button, Notice, Spinner, errorMessage } from "./ui";

export function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

const noopSubscribe = () => () => {};

/** Full-width connect control used inside flows (claim, create). */
export function ConnectWallet({ label = "Connect wallet" }: { label?: string }) {
  const connectors = useConnectors();
  const { connect, isPending, error, variables } = useConnect();
  const [open, setOpen] = useState(false);

  // EIP-6963 wallets come with a name + icon; drop the generic "Injected" if a real one exists.
  const named = connectors.filter((c) => c.id !== "injected");
  const list = named.length > 0 ? named : connectors;
  const noBrowserWallet = useSyncExternalStore(
    noopSubscribe,
    () => !("ethereum" in window),
    () => false,
  );

  if (list.length === 1 || !open) {
    return (
      <div className="flex w-full flex-col gap-3">
        <Button
          className="w-full"
          disabled={isPending}
          onClick={() => (list.length === 1 ? connect({ connector: list[0] }) : setOpen(true))}
        >
          {isPending && <Spinner />}
          <span key={label}>{label}</span>
        </Button>
        {noBrowserWallet && named.length === 0 && (
          <Notice>No wallet found in this browser. On a phone, open this page inside your wallet app&apos;s browser.</Notice>
        )}
        {error && <Notice tone="error">{errorMessage(error)}</Notice>}
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col gap-2">
      {list.map((c) => (
        <Button
          key={c.uid}
          variant="quiet"
          className="w-full justify-start"
          disabled={isPending}
          onClick={() => connect({ connector: c })}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- wallet icons are data: URIs */}
          {c.icon && <img src={c.icon} alt="" className="size-6 rounded-md" />}
          <span className="flex-1 text-left">{c.name}</span>
          {isPending && variables?.connector === c && <Spinner />}
        </Button>
      ))}
      {error && <Notice tone="error">{errorMessage(error)}</Notice>}
    </div>
  );
}

/** Shown in flows when the wallet is not on the network this page is using. */
export function WrongNetwork({ network }: { network?: NetworkConfig }) {
  const selected = useNetwork().network;
  const target = network ?? selected;
  const { switchChain, isPending, error } = useSwitchChain();
  return (
    <div className="flex w-full flex-col gap-3 rounded-3xl bg-ribbon/15 p-5" role="alert">
      <p className="font-bold">Wrong network</p>
      <p className="text-sm text-muted">You&apos;re connected to the wrong network.</p>
      <Button className="w-full" disabled={isPending} onClick={() => switchChain({ chainId: target.chainId })}>
        {isPending && <Spinner />}
        <span>Switch to {target.chainName}</span>
      </Button>
      {error && <Notice tone="error">{errorMessage(error)}</Notice>}
    </div>
  );
}

/** Wallet state relative to a network (defaults to the selected one). */
export function useWallet(network?: NetworkConfig) {
  const selected = useNetwork().network;
  const target = network ?? selected;
  const { address, chainId, isConnected, status } = useConnection();
  return {
    address,
    chainId,
    isConnected,
    isReconnecting: status === "reconnecting" || status === "connecting",
    onRightChain: isConnected && chainId === target.chainId,
  };
}

/** Navbar wallet control: connect, switch network, or show the address (with disconnect). */
export function WalletButton() {
  const { network } = useNetwork();
  const { address, isConnected, onRightChain } = useWallet();
  const connectors = useConnectors();
  const { connect, isPending: connecting } = useConnect();
  const { switchChain, isPending: switching } = useSwitchChain();
  const { disconnect } = useDisconnect();
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

  const chip = "inline-flex h-9 items-center gap-2 rounded-full px-3 text-sm font-semibold whitespace-nowrap";

  if (!isConnected || !address) {
    const named = connectors.filter((c) => c.id !== "injected");
    const connector = (named.length ? named : connectors)[0];
    return (
      <button
        className={`${chip} bg-ink text-tissue hover:opacity-90`}
        disabled={connecting || !connector}
        onClick={() => connector && connect({ connector })}
      >
        {connecting && <Spinner />}
        <span>Connect</span>
      </button>
    );
  }

  if (!onRightChain) {
    return (
      <button
        className={`${chip} bg-ribbon text-ink hover:opacity-90`}
        disabled={switching}
        onClick={() => switchChain({ chainId: network.chainId })}
      >
        {switching && <Spinner />}
        <span>Switch to {network.chainName}</span>
      </button>
    );
  }

  return (
    <div className="relative" ref={ref}>
      <button
        className={`${chip} tabular bg-surface text-muted ring-1 ring-line hover:text-ink`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {shortAddress(address)}
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-20 mt-2 w-44 rounded-2xl bg-surface p-1 shadow-lg ring-1 ring-line">
          <button
            role="menuitem"
            className="w-full rounded-xl px-3 py-2 text-left text-sm hover:bg-tissue"
            onClick={() => {
              setOpen(false);
              disconnect();
            }}
          >
            Disconnect
          </button>
        </div>
      )}
    </div>
  );
}
