"use client";

import { createContext, Fragment, useCallback, useContext, useSyncExternalStore, type ReactNode } from "react";
import { DEFAULT_NETWORK, getNetwork, isNetworkId, type NetworkConfig, type NetworkId } from "./networks";

/**
 * Selected network: one source of truth, persisted as `arcgift:network` in localStorage.
 * Server render and first hydration use Testnet; the stored choice is applied right after.
 */
export const NETWORK_STORAGE_KEY = "arcgift:network";

const listeners = new Set<() => void>();

function readStored(): NetworkId {
  try {
    const v = localStorage.getItem(NETWORK_STORAGE_KEY);
    if (isNetworkId(v)) return v;
  } catch {}
  return DEFAULT_NETWORK;
}

let current: NetworkId | null = null;

function snapshot(): NetworkId {
  if (current === null) current = readStored();
  return current;
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === NETWORK_STORAGE_KEY) {
      current = readStored();
      cb();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

export function selectNetwork(id: NetworkId) {
  if (!isNetworkId(id) || id === current) return;
  current = id;
  try {
    localStorage.setItem(NETWORK_STORAGE_KEY, id);
  } catch {}
  listeners.forEach((l) => l());
}

type Ctx = { network: NetworkConfig; setNetwork: (id: NetworkId) => void };
const NetworkContext = createContext<Ctx | null>(null);

export function NetworkProvider({ children }: { children: ReactNode }) {
  const id = useSyncExternalStore(subscribe, snapshot, () => DEFAULT_NETWORK);
  const setNetwork = useCallback((next: NetworkId) => selectNetwork(next), []);
  return <NetworkContext.Provider value={{ network: getNetwork(id), setNetwork }}>{children}</NetworkContext.Provider>;
}

export function useNetwork(): Ctx {
  const ctx = useContext(NetworkContext);
  if (!ctx) throw new Error("useNetwork must be used inside NetworkProvider");
  return ctx;
}

/**
 * Remounts everything below it when the network changes, so no form, claim, transaction or
 * gift state from one network can survive into another.
 */
export function NetworkBoundary({ children }: { children: ReactNode }) {
  const { network } = useNetwork();
  return <Fragment key={network.id}>{children}</Fragment>;
}
