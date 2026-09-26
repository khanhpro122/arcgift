import { test as base, devices, expect, type Browser, type Page } from "@playwright/test";
import jsQR from "jsqr";
import { PNG } from "pngjs";
import { createPublicClient, createTestClient, createWalletClient, erc20Abi, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet, foundry } from "viem/chains";
import { ACCOUNTS, CHAINS, E2E, IS_TESTNET, SIGNERS, hexChain } from "./target";

export { ACCOUNTS, CHAINS, E2E, IS_TESTNET };

const viemChain = IS_TESTNET ? { ...arcTestnet, rpcUrls: { default: { http: [E2E.rpc] } } } : foundry;
export const chain = createPublicClient({ chain: viemChain, transport: http(E2E.rpc) });

export function usdcBalance(address: Address) {
  return chain.readContract({ address: E2E.usdc, abi: erc20Abi, functionName: "balanceOf", args: [address] });
}

/** Gas on Arc is paid in USDC from the same balance, so on testnet deltas include fees. */
const FEE_TOLERANCE = IS_TESTNET ? 100_000n : 0n; // 0.1 USDC
export function expectReceived(delta: bigint, amount: bigint) {
  expect(delta <= amount && delta >= amount - FEE_TOLERANCE, `received ${delta}, expected ~${amount}`).toBe(true);
}
export function expectSpent(delta: bigint, amount: bigint) {
  expect(delta >= amount && delta <= amount + FEE_TOLERANCE, `spent ${delta}, expected ~${amount}`).toBe(true);
}

export async function advanceTime(seconds: number) {
  if (IS_TESTNET) throw new Error("cannot move time on a real chain");
  const testClient = createTestClient({ chain: foundry, mode: "anvil", transport: http(E2E.rpc) });
  await testClient.increaseTime({ seconds });
  await testClient.mine({ blocks: 1 });
}

type WalletOpts = {
  rpc: string;
  account: string;
  startChainId: string;
  txChainId: string;
  knownChains: string[];
  remoteSign: boolean;
  network: string | null;
};

/**
 * A minimal EIP-1193 wallet injected into the page. It forwards reads to the target chain,
 * announces itself via EIP-6963, knows every Arc chain (so it can switch between them), and can
 * reject the next transaction or change chain silently to exercise failure paths.
 */
function walletScript(opts: WalletOpts) {
  const w = window as unknown as Record<string, unknown>;

  // Seed the app's selected network once per browser context (later choices persist normally).
  if (opts.network && !localStorage.getItem("e2e-seeded")) {
    localStorage.setItem("arcgift:network", opts.network);
    localStorage.setItem("e2e-seeded", "1");
  }

  let chainId = opts.startChainId;
  // Like a real wallet, remember that this site was granted access.
  let connected = sessionStorage.getItem("e2e-connected") === "1";
  const listeners: Record<string, ((...a: unknown[]) => void)[]> = {};
  const emit = (ev: string, ...a: unknown[]) => (listeners[ev] ?? []).forEach((f) => f(...a));
  w.__walletCalls = [] as string[];
  w.__setChain = (next: string, silent = false) => {
    chainId = next;
    if (!silent) emit("chainChanged", next);
  };

  async function rpc(method: string, params: unknown) {
    const res = await fetch(opts.rpc, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params: params ?? [] }),
    });
    const json = await res.json();
    if (json.error) throw Object.assign(new Error(json.error.message), { code: json.error.code, data: json.error.data });
    return json.result;
  }

  const provider = {
    async request({ method, params }: { method: string; params?: unknown[] }) {
      (w.__walletCalls as string[]).push(method);
      switch (method) {
        case "eth_requestAccounts":
          connected = true;
          sessionStorage.setItem("e2e-connected", "1");
          emit("connect", { chainId });
          return [opts.account];
        case "eth_accounts":
          return connected ? [opts.account] : [];
        case "eth_chainId":
          return chainId;
        case "net_version":
          return String(parseInt(chainId, 16));
        case "wallet_switchEthereumChain": {
          const next = (params?.[0] as { chainId: string }).chainId.toLowerCase();
          if (!opts.knownChains.includes(next)) throw Object.assign(new Error("Unrecognized chain"), { code: 4902 });
          chainId = next;
          (w.__walletCalls as string[]).push(`switch:${next}`);
          emit("chainChanged", chainId);
          return null;
        }
        case "wallet_addEthereumChain":
          return null;
        case "wallet_requestPermissions":
        case "wallet_getPermissions":
          return [{ parentCapability: "eth_accounts" }];
        case "wallet_revokePermissions":
          connected = false;
          sessionStorage.removeItem("e2e-connected");
          return null;
        case "eth_sendTransaction":
          if (w.__rejectNext) {
            w.__rejectNext = false;
            throw Object.assign(new Error("User rejected the request."), { code: 4001 });
          }
          // Only the target chain has contracts in this harness; anything else is a bug.
          if (chainId !== opts.txChainId) throw Object.assign(new Error(`Sent on wrong chain ${chainId}`), { code: 4901 });
          if (opts.remoteSign) return (w.__e2eSend as (tx: unknown) => Promise<string>)(params?.[0]);
          return rpc(method, params);
        default:
          return rpc(method, params);
      }
    },
    on(ev: string, f: (...a: unknown[]) => void) {
      (listeners[ev] ??= []).push(f);
    },
    removeListener(ev: string, f: (...a: unknown[]) => void) {
      listeners[ev] = (listeners[ev] ?? []).filter((x) => x !== f);
    },
  };

  w.ethereum = provider;
  const info = {
    uuid: "4a1c7e1e-0000-4000-8000-00000000e2e0",
    name: "E2E Wallet",
    icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32'/%3E",
    rdns: "dev.arcgift.e2e",
  };
  const announce = () =>
    window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info, provider }) }));
  window.addEventListener("eip6963:requestProvider", announce);
  announce();
}

/**
 * A fresh browser context with the test wallet.
 * @param chainId  chain the wallet starts on (default: the E2E target chain)
 * @param network  network pre-selected in the app (default: the E2E target; null = app default)
 */
export async function walletPage(
  browser: Browser,
  account: Address,
  { chainId = E2E.chainId, network = E2E.network as string | null }: { chainId?: number; network?: string | null } = {},
): Promise<Page> {
  const context = await browser.newContext({
    ...devices["Pixel 7"],
    baseURL: E2E.web,
    permissions: ["clipboard-read", "clipboard-write"],
  });
  if (IS_TESTNET) {
    const pk = SIGNERS[account.toLowerCase()];
    // Real chain: sign in Node with the testnet-only key and broadcast to the real RPC.
    await context.exposeFunction("__e2eSend", async (tx: { to: Hex; data?: Hex; value?: Hex; gas?: Hex }) => {
      if (!pk) throw new Error(`no testnet key for ${account}`);
      const client = createWalletClient({ account: privateKeyToAccount(pk), chain: viemChain, transport: http(E2E.rpc) });
      return client.sendTransaction({
        to: tx.to,
        data: tx.data,
        value: tx.value ? BigInt(tx.value) : undefined,
        gas: tx.gas ? BigInt(tx.gas) : undefined,
      });
    });
  }
  await context.addInitScript(walletScript, {
    rpc: E2E.rpc,
    account,
    startChainId: hexChain(chainId),
    txChainId: hexChain(E2E.chainId),
    knownChains: Object.values(CHAINS).map(hexChain),
    remoteSign: IS_TESTNET,
    network,
  } satisfies WalletOpts);
  return context.newPage();
}

export const walletCalls = (page: Page) =>
  page.evaluate(() => (window as unknown as { __walletCalls: string[] }).__walletCalls);

/** Decode the QR image on the page and return the URL it encodes. */
export async function readQr(page: Page): Promise<string> {
  const src = await page.getByTestId("gift-qr").getAttribute("src");
  const png = PNG.sync.read(Buffer.from(src!.split(",")[1], "base64"));
  const code = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
  if (!code) throw new Error("QR could not be decoded");
  return code.data;
}

/** Click the in-page "Connect wallet…" control (the navbar has its own "Connect"). */
export async function connect(page: Page) {
  await page.getByRole("main").getByRole("button", { name: /connect wallet/i }).click();
}

/** Fill and submit the create form; returns the gift link shown afterwards. */
export async function createGift(
  page: Page,
  opts: { group?: boolean; amount: string; people?: number; mode?: "Random" | "Fixed"; message?: string },
): Promise<string> {
  await page.goto(opts.group ? "/create/group" : "/create");
  await connect(page);
  await page.getByPlaceholder("100").fill(opts.amount);
  if (opts.group) {
    await page.locator('input[name="people"]').fill(String(opts.people ?? 3));
    await page.getByText(opts.mode ?? "Random", { exact: true }).click();
  }
  if (opts.message) await page.locator('textarea[name="message"]').fill(opts.message);
  await page.getByRole("button", { name: /create (group )?gift/i }).click();
  await expect(page.getByRole("heading", { name: "Gift created" })).toBeVisible({ timeout: 60_000 });
  return (await page.getByTestId("gift-link").textContent())!.trim();
}

/** Recipient flow: open link → connect → "Open gift" (the claim tx) → opened. Returns the shown amount text. */
export async function claimGift(browser: Browser, link: string, account: Address): Promise<string> {
  const page = await walletPage(browser, account, { network: null });
  await page.goto(link);
  await expect(page.getByRole("heading", { name: "You received a gift" })).toBeVisible();
  await connect(page);
  await page.getByRole("button", { name: "Open gift" }).click();
  await expect(page.getByRole("heading", { name: "You opened your gift! 🎉" })).toBeVisible({ timeout: 60_000 });
  const amount = (await page.getByTestId("claimed-amount").textContent())!;
  await page.context().close();
  return amount.replace("USDC", "").trim();
}

export const test = base;
export { expect };
