"use client";

import { useQuery } from "@tanstack/react-query";
import type { Address, Hex, PublicClient } from "viem";
import { usePublicClient } from "wagmi";
import { arcGiftAbi } from "./abi";
import type { NetworkConfig } from "./networks";

export type ActivityItem = {
  kind: "created" | "received" | "opened" | "reclaimed";
  giftId: bigint;
  amount: bigint;
  counterparty?: Address;
  blockNumber: bigint;
  timestamp?: number;
  txHash?: Hex;
};

const MAX_GIFTS = 25;

/**
 * A wallet's ArcGift activity on ONE network: gifts it created, claims on those gifts, its
 * reclaims, and gifts it received. Built from on-chain indexes (getGiftsBySender,
 * getGiftsClaimedBy, getClaims) plus single-block log lookups for tx hashes — Arc RPCs cap
 * eth_getLogs ranges, so nothing scans history.
 */
export function useActivity(network: NetworkConfig, address: Address | undefined) {
  const client = usePublicClient({ chainId: network.chainId });
  const contract = network.giftContractAddress;
  return useQuery({
    queryKey: ["activity", network.id, network.chainId, contract, address],
    enabled: !!client && !!contract && !!address,
    refetchInterval: 15_000,
    queryFn: () => loadActivity(client as PublicClient, contract!, address!),
  });
}

async function loadActivity(client: PublicClient, address: Address, wallet: Address): Promise<ActivityItem[]> {
  const gift = { address, abi: arcGiftAbi } as const;
  const [sent, received] = await Promise.all([
    client.readContract({ ...gift, functionName: "getGiftsBySender", args: [wallet] }),
    client.readContract({ ...gift, functionName: "getGiftsClaimedBy", args: [wallet] }),
  ]);
  const items: ActivityItem[] = [];

  await Promise.all(
    [...sent].slice(-MAX_GIFTS).map(async (id) => {
      const [g, claims] = await Promise.all([
        client.readContract({ ...gift, functionName: "getGift", args: [id] }),
        client.readContract({ ...gift, functionName: "getClaims", args: [id] }),
      ]);
      items.push({ kind: "created", giftId: id, amount: g.totalAmount, blockNumber: g.createdBlock });
      for (const c of claims) {
        items.push({ kind: "opened", giftId: id, amount: c.amount, counterparty: c.recipient, blockNumber: c.blockNumber });
      }
      if (g.reclaimed) {
        items.push({
          kind: "reclaimed",
          giftId: id,
          amount: g.totalAmount - g.claimedAmount,
          blockNumber: g.reclaimedBlock,
        });
      }
    }),
  );

  await Promise.all(
    [...received].slice(-MAX_GIFTS).map(async (id) => {
      const [g, claims] = await Promise.all([
        client.readContract({ ...gift, functionName: "getGift", args: [id] }),
        client.readContract({ ...gift, functionName: "getClaims", args: [id] }),
      ]);
      const mine = claims.find((c) => c.recipient.toLowerCase() === wallet.toLowerCase());
      if (mine) {
        items.push({ kind: "received", giftId: id, amount: mine.amount, counterparty: g.sender, blockNumber: mine.blockNumber });
      }
    }),
  );

  // Resolve tx hashes and times with one single-block query per distinct block.
  const blocks = [...new Set(items.map((i) => i.blockNumber))];
  const byBlock = new Map<bigint, { timestamp: number; logs: { name: string; giftId?: bigint; who?: string; tx: Hex }[] }>();
  await Promise.all(
    blocks.map(async (b) => {
      const [block, logs] = await Promise.all([
        client.getBlock({ blockNumber: b }),
        client.getContractEvents({ ...gift, fromBlock: b, toBlock: b }),
      ]);
      byBlock.set(b, {
        timestamp: Number(block.timestamp),
        logs: logs.map((l) => {
          const args = l.args as { giftId?: bigint; recipient?: Address; sender?: Address };
          return { name: l.eventName, giftId: args.giftId, who: (args.recipient ?? args.sender)?.toLowerCase(), tx: l.transactionHash };
        }),
      });
    }),
  );

  const EVENT: Record<ActivityItem["kind"], string> = {
    created: "GiftCreated",
    opened: "GiftClaimed",
    received: "GiftClaimed",
    reclaimed: "GiftReclaimed",
  };
  for (const item of items) {
    const b = byBlock.get(item.blockNumber);
    if (!b) continue;
    item.timestamp = b.timestamp;
    const who = item.kind === "received" ? wallet.toLowerCase() : item.kind === "opened" ? item.counterparty?.toLowerCase() : undefined;
    item.txHash = b.logs.find(
      (l) => l.name === EVENT[item.kind] && l.giftId === item.giftId && (who === undefined || l.who === who),
    )?.tx;
  }

  return items.sort((a, b) => (a.blockNumber === b.blockNumber ? 0 : a.blockNumber > b.blockNumber ? -1 : 1));
}
