import type { Chain, Transport } from "viem";
import { createConfig, http } from "wagmi";
import { getConnection } from "wagmi/actions";
import { injected } from "wagmi/connectors";
import { NETWORK_IDS, getNetwork, type NetworkConfig } from "./networks";

// Wallet connection per docs.arc.io/integrate/connect-to-arc (viem + wagmi). Every network is
// registered with its own transport; reads always pass the selected network's chainId, so
// Testnet and Mainnet data never share a client or a cache entry.
const networks = NETWORK_IDS.map(getNetwork);
const chains = networks.map((n) => n.chain) as [Chain, ...Chain[]];
const transports = Object.fromEntries(networks.map((n) => [n.chainId, http(n.rpcUrl)])) as Record<number, Transport>;

export const wagmiConfig = createConfig({
  chains,
  connectors: [injected()],
  transports,
  ssr: true,
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}

export class WrongNetworkError extends Error {
  constructor(public readonly network: NetworkConfig) {
    super(`Your wallet is on a different network. Switch to ${network.chainName} and try again.`);
    this.name = "WrongNetworkError";
  }
}

/**
 * Called immediately before every transaction (approve, create, claim, reclaim). It asks the
 * wallet itself for its current chain (not cached app state), and refuses to continue unless it
 * equals the ArcGift network in use.
 */
export async function assertWalletOn(network: NetworkConfig) {
  const { connector, status } = getConnection(wagmiConfig);
  if (status !== "connected" || !connector) throw new Error("Connect your wallet first.");
  const live = await connector.getChainId();
  if (live !== network.chainId) throw new WrongNetworkError(network);
}
