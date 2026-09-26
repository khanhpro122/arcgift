import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getAddress, getContractAddress, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import networks from "../src/config/networks.json";

/**
 * Where the browser E2E suite runs gift transactions:
 *  - local (default): fresh anvil + MockUSDC + ArcGift, exposed to the app as the dev-only
 *    "Local" network. Anvil signs for its unlocked accounts.
 *  - testnet (E2E_TARGET=testnet): real Arc Testnet using the ArcGift address recorded in
 *    src/config/networks.json. Transactions are signed in Node with the testnet-only keys in
 *    contracts/.testnet-wallets.txt and broadcast to the real RPC.
 * Network-switching tests always use the real Testnet/Mainnet config (read-only).
 */
export const TARGET = process.env.E2E_TARGET === "testnet" ? "testnet" : "local";
export const IS_TESTNET = TARGET === "testnet";

export const CHAIN_PORT = Number(process.env.E2E_CHAIN_PORT ?? 8546);
export const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 3100);

const anvilDeployer = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

export const CHAINS = {
  testnet: networks.testnet.chainId,
  mainnet: networks.mainnet.chainId,
  local: 31337,
};
export const hexChain = (id: number) => `0x${id.toString(16)}`;

export const E2E = IS_TESTNET
  ? {
      network: "testnet" as const,
      rpc: networks.testnet.rpcUrl,
      chainId: networks.testnet.chainId,
      explorer: networks.testnet.explorerUrl,
      web: `http://localhost:${WEB_PORT}`,
      usdc: getAddress(networks.testnet.usdcAddress),
      gift: networks.testnet.giftContractAddress
        ? getAddress(networks.testnet.giftContractAddress)
        : (() => {
            throw new Error("E2E_TARGET=testnet needs testnet.giftContractAddress in src/config/networks.json");
          })(),
    }
  : {
      network: "local" as const,
      rpc: `http://127.0.0.1:${CHAIN_PORT}`,
      chainId: CHAINS.local,
      explorer: "https://local-explorer.invalid",
      web: `http://localhost:${WEB_PORT}`,
      usdc: getContractAddress({ from: anvilDeployer, nonce: 0n }),
      gift: getContractAddress({ from: anvilDeployer, nonce: 1n }),
    };

/** Private keys used for remote signing on testnet (empty locally: anvil signs). */
export const SIGNERS: Record<string, Hex> = {};

function accounts() {
  if (!IS_TESTNET) {
    return {
      sender: anvilDeployer,
      alice: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
      bob: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
      carol: "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
      dave: "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65",
    } as Record<string, Address>;
  }
  const file = join(__dirname, "../../contracts/.testnet-wallets.txt");
  const keys = Object.fromEntries(
    readFileSync(file, "utf8")
      .trim()
      .split(/\r?\n/)
      .map((l) => l.split(" "))
      .map(([name, , pk]) => [name, pk as Hex]),
  );
  const map = { sender: keys.deployer, alice: keys.recipient1, bob: keys.recipient2, carol: keys.recipient3 };
  const out: Record<string, Address> = {};
  for (const [name, pk] of Object.entries(map)) {
    const addr = privateKeyToAccount(pk).address;
    out[name] = addr;
    SIGNERS[addr.toLowerCase()] = pk;
  }
  out.dave = "0x000000000000000000000000000000000000dEaD"; // only views a sold-out gift
  return out;
}

export const ACCOUNTS = accounts() as Record<"sender" | "alice" | "bob" | "carol" | "dave", Address>;
