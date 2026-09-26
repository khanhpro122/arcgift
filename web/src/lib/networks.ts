import { defineChain, getAddress, isAddress, type Address, type Chain } from "viem";
import { arc, arcTestnet, foundry } from "viem/chains";
import raw from "@/config/networks.json";

/**
 * The single source of truth for every network-dependent value in ArcGift.
 *
 * Values live in src/config/networks.json (also read by scripts/preflight.mjs). The runtime
 * network selector picks one of these entries; nothing network-specific is read from env for
 * testnet/mainnet. The only env-driven network is "local" (anvil) for development and E2E,
 * which exists only when NEXT_PUBLIC_ENABLE_LOCAL_NETWORK=true.
 *
 * `usdcAddress` is the USDC token. `giftContractAddress` is ArcGift's own escrow contract —
 * null until it is deployed on that network. Never put an ArcClaim address here.
 */
export type Network = "testnet" | "mainnet";
export type NetworkId = Network | "local";

export type NetworkConfig = {
  id: NetworkId;
  name: string;
  chainName: string;
  chainId: number;
  rpcUrl: string;
  explorerUrl: string | null;
  usdcAddress: Address;
  usdcDecimals: number;
  giftContractAddress: Address | null;
  chain: Chain;
};

/** The network the app opens on (production is live on Arc Mainnet; Testnet stays selectable). */
export const DEFAULT_NETWORK: NetworkId = "mainnet";
/** A gift link whose `?network=` is missing or unknown never resolves to Mainnet. */
export const LINK_FALLBACK_NETWORK: NetworkId = "testnet";
export const EXPECTED_CHAIN_IDS = { testnet: 5042002, mainnet: 5042 } as const;

type RawEntry = Omit<NetworkConfig, "chain" | "usdcAddress" | "giftContractAddress" | "id"> & {
  id: string;
  usdcAddress: string;
  giftContractAddress: string | null;
};

function addr(value: string | null | undefined, label: string): Address | null {
  if (value === null || value === undefined || value === "") return null;
  if (!isAddress(value, { strict: false })) throw new Error(`networks: ${label} is not a valid address`);
  return getAddress(value);
}

function build(id: NetworkId, entry: RawEntry, base: Chain): NetworkConfig {
  const usdcAddress = addr(entry.usdcAddress, `${id}.usdcAddress`);
  if (!usdcAddress) throw new Error(`networks: ${id}.usdcAddress is required`);
  const giftContractAddress = addr(entry.giftContractAddress, `${id}.giftContractAddress`);
  if (giftContractAddress && giftContractAddress === usdcAddress) {
    throw new Error(`networks: ${id}.giftContractAddress must be the ArcGift contract, not USDC`);
  }
  const chain = defineChain({
    ...base,
    id: entry.chainId,
    name: entry.chainName,
    rpcUrls: { default: { http: [entry.rpcUrl] } },
    blockExplorers: entry.explorerUrl ? { default: { name: "Explorer", url: entry.explorerUrl } } : undefined,
  });
  return { ...entry, id, usdcAddress, giftContractAddress, chain };
}

export function buildNetworks(source: { testnet: RawEntry; mainnet: RawEntry }, local?: RawEntry) {
  const testnet = build("testnet", source.testnet, arcTestnet);
  const mainnet = build("mainnet", source.mainnet, arc);

  if (testnet.chainId !== EXPECTED_CHAIN_IDS.testnet) throw new Error("networks: testnet chainId must be 5042002");
  if (mainnet.chainId !== EXPECTED_CHAIN_IDS.mainnet) throw new Error("networks: mainnet chainId must be 5042");
  if (mainnet.giftContractAddress && mainnet.giftContractAddress === testnet.giftContractAddress) {
    throw new Error("networks: mainnet must never point at the testnet ArcGift contract");
  }
  if (/testnet/i.test(`${mainnet.rpcUrl} ${mainnet.explorerUrl}`)) {
    throw new Error("networks: mainnet config contains a testnet URL");
  }

  const networks: Partial<Record<NetworkId, NetworkConfig>> = { testnet, mainnet };
  if (local) networks.local = build("local", local, foundry);
  return networks as Record<Network, NetworkConfig> & Partial<Record<"local", NetworkConfig>>;
}

// Dev/E2E only. Must reference NEXT_PUBLIC_* literally so Next.js can inline them.
const localEntry: RawEntry | undefined =
  process.env.NEXT_PUBLIC_ENABLE_LOCAL_NETWORK === "true"
    ? {
        id: "local",
        name: "Local",
        chainName: "Local dev chain",
        chainId: 31337,
        rpcUrl: process.env.NEXT_PUBLIC_LOCAL_RPC_URL ?? "http://127.0.0.1:8545",
        explorerUrl: process.env.NEXT_PUBLIC_LOCAL_EXPLORER_URL ?? null,
        usdcAddress: process.env.NEXT_PUBLIC_LOCAL_USDC_ADDRESS ?? "",
        usdcDecimals: 6,
        giftContractAddress: process.env.NEXT_PUBLIC_LOCAL_GIFT_ADDRESS ?? null,
      }
    : undefined;

export const NETWORKS = buildNetworks(raw as { testnet: RawEntry; mainnet: RawEntry }, localEntry);

export const NETWORK_IDS = (["testnet", "mainnet", "local"] as const).filter((id) => NETWORKS[id]) as NetworkId[];

export function isNetworkId(value: unknown): value is NetworkId {
  return typeof value === "string" && (NETWORK_IDS as string[]).includes(value);
}

export function getNetwork(id: NetworkId): NetworkConfig {
  const n = NETWORKS[id];
  if (!n) throw new Error(`Unknown network ${id}`);
  return n;
}

/** Network from a `?network=` query value. Missing or unknown → Testnet, never Mainnet. */
export function networkFromParam(value: string | string[] | undefined | null): NetworkId {
  const v = Array.isArray(value) ? value[0] : value;
  return isNetworkId(v) ? v : LINK_FALLBACK_NETWORK;
}

export function networkByChainId(chainId: number | undefined): NetworkConfig | undefined {
  return NETWORK_IDS.map(getNetwork).find((n) => n.chainId === chainId);
}

export function txUrl(network: NetworkConfig, hash: string): string | undefined {
  return network.explorerUrl ? `${network.explorerUrl}/tx/${hash}` : undefined;
}

export function addressUrl(network: NetworkConfig, address: string): string | undefined {
  return network.explorerUrl ? `${network.explorerUrl}/address/${address}` : undefined;
}
