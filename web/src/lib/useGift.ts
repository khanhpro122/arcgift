"use client";

import { useQuery } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import { zeroAddress, type Address, type Hex } from "viem";
import { usePublicClient, useReadContracts } from "wagmi";
import { arcGiftAbi } from "./abi";
import type { NetworkConfig } from "./networks";

export const STATUS = ["active", "soldOut", "expired", "reclaimed"] as const;
export type GiftStatus = (typeof STATUS)[number];

export const STATUS_LABEL: Record<GiftStatus, string> = {
  active: "Active",
  soldOut: "All opened",
  expired: "Expired",
  reclaimed: "Reclaimed",
};

export type GiftData = {
  id: bigint;
  sender: Address;
  expiresAt: number;
  createdAt: number;
  recipients: number;
  claimedCount: number;
  mode: "fixed" | "random";
  reclaimed: boolean;
  claimSigner: Address;
  totalAmount: bigint;
  claimedAmount: bigint;
  createdBlock: bigint;
  reclaimedBlock: bigint;
  status: GiftStatus;
  remaining: bigint;
  nextAllocation: bigint;
  message: Hex;
};

/** Parse a route param into a gift id, or null if it can't be one. */
export function parseGiftId(raw: string): bigint | null {
  return /^\d{1,30}$/.test(raw) && raw !== "0" ? BigInt(raw) : null;
}

/** ArcGift contract descriptor for a network, or undefined if it isn't deployed there. */
export function giftContract(network: NetworkConfig) {
  return network.giftContractAddress
    ? ({ address: network.giftContractAddress, abi: arcGiftAbi } as const)
    : undefined;
}

/** Reads a gift on one specific network and polls so group progress stays live. */
export function useGift(network: NetworkConfig, id: bigint | null, { poll = 5000 }: { poll?: number | false } = {}) {
  const gift = giftContract(network);
  const enabled = id !== null && !!gift;
  const c = { address: network.giftContractAddress ?? zeroAddress, abi: arcGiftAbi, chainId: network.chainId } as const;
  const args = [id ?? 0n] as const;
  const q = useReadContracts({
    allowFailure: true,
    contracts: [
      { ...c, functionName: "getGift", args },
      { ...c, functionName: "status", args },
      { ...c, functionName: "remaining", args },
      { ...c, functionName: "nextAllocation", args },
      { ...c, functionName: "getMessage", args },
    ],
    query: { enabled, refetchInterval: poll },
  });

  let data: GiftData | undefined;
  let notFound = false;
  const r = q.data;
  if (r && id !== null) {
    const [g, status, remaining, next, message] = r;
    if (g.status === "failure") {
      notFound = /GiftNotFound/.test(String(g.error));
    } else if (
      status.status === "success" &&
      remaining.status === "success" &&
      next.status === "success" &&
      message.status === "success"
    ) {
      const v = g.result;
      data = {
        id,
        sender: v.sender,
        expiresAt: v.expiresAt,
        createdAt: v.createdAt,
        recipients: v.recipients,
        claimedCount: v.claimedCount,
        mode: v.mode === 1 ? "random" : "fixed",
        reclaimed: v.reclaimed,
        claimSigner: v.claimSigner,
        totalAmount: v.totalAmount,
        claimedAmount: v.claimedAmount,
        createdBlock: v.createdBlock,
        reclaimedBlock: v.reclaimedBlock,
        status: STATUS[status.result],
        remaining: remaining.result,
        nextAllocation: next.result,
        message: message.result,
      };
    }
  }
  return { data, notFound, isLoading: q.isLoading, error: notFound ? null : q.error, refetch: q.refetch };
}

export type ClaimRow = { recipient: Address; amount: bigint; blockNumber: bigint; txHash?: Hex };

/**
 * Claim history. Records are stored on-chain with their block number, so each tx hash is
 * found with a single-block log query (Arc RPCs cap eth_getLogs ranges at ~10k blocks).
 */
export function useClaims(network: NetworkConfig, id: bigint | null, claimedCount: number | undefined) {
  const client = usePublicClient({ chainId: network.chainId });
  const gift = giftContract(network);
  return useQuery({
    queryKey: ["claims", network.id, network.giftContractAddress, id?.toString(), claimedCount],
    enabled: id !== null && !!gift && !!client && claimedCount !== undefined,
    queryFn: async (): Promise<ClaimRow[]> => {
      const records = await client!.readContract({ ...gift!, functionName: "getClaims", args: [id!] });
      const blocks = [...new Set(records.map((r) => r.blockNumber))];
      const hashes = new Map<string, Hex>();
      await Promise.all(
        blocks.map(async (b) => {
          const logs = await client!.getContractEvents({
            ...gift!,
            eventName: "GiftClaimed",
            args: { giftId: id! },
            fromBlock: b,
            toBlock: b,
          });
          for (const l of logs) if (l.args.recipient) hashes.set(`${b}-${l.args.recipient.toLowerCase()}`, l.transactionHash);
        }),
      );
      return records.map((r) => ({
        recipient: r.recipient,
        amount: r.amount,
        blockNumber: r.blockNumber,
        txHash: hashes.get(`${r.blockNumber}-${r.recipient.toLowerCase()}`),
      }));
    },
  });
}

/** Single-block lookup for the reclaim tx. */
export function useReclaimTx(network: NetworkConfig, id: bigint | null, block: bigint | undefined) {
  const client = usePublicClient({ chainId: network.chainId });
  const gift = giftContract(network);
  return useQuery({
    queryKey: ["reclaimTx", network.id, network.giftContractAddress, id?.toString(), block?.toString()],
    enabled: id !== null && !!gift && !!client && !!block,
    queryFn: async () => {
      const logs = await client!.getContractEvents({
        ...gift!,
        eventName: "GiftReclaimed",
        args: { giftId: id! },
        fromBlock: block!,
        toBlock: block!,
      });
      return logs[0]?.transactionHash ?? null;
    },
  });
}

// ------------------------------------------------------------------ time

function subscribeClock(cb: () => void) {
  const t = setInterval(cb, 30_000);
  return () => clearInterval(t);
}

/** Current unix time in seconds, refreshed every 30s; 0 during SSR. */
export function useNow() {
  return useSyncExternalStore(
    subscribeClock,
    () => Math.floor(Date.now() / 30_000) * 30,
    () => 0,
  );
}

export function timeLeft(expiresAt: number, now: number): string {
  const d = duration(expiresAt - now);
  return d ? `${d} left` : "Expired";
}

/** "6d 23h" / "5h 12m" / "3m"; null once the time has passed. */
export function duration(s: number): string | null {
  if (s <= 0) return null;
  const d = Math.floor(s / 86_400);
  const h = Math.floor((s % 86_400) / 3600);
  const m = Math.max(1, Math.floor((s % 3600) / 60));
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function formatDate(unix: number) {
  return new Date(unix * 1000).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}
