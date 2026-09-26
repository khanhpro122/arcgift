import { defineConfig, devices } from "@playwright/test";
import { CHAIN_PORT, E2E, IS_TESTNET, WEB_PORT } from "./e2e/target";

const web = {
  command: `npx next dev --port ${WEB_PORT}`,
  url: E2E.web,
  timeout: 180_000,
  reuseExistingServer: false,
  // Testnet/Mainnet come from src/config/networks.json. Locally, the dev-only "Local" network
  // is switched on and pointed at anvil.
  env: (IS_TESTNET
    ? { NEXT_DIST_DIR: ".next-e2e" }
    : {
        NEXT_DIST_DIR: ".next-e2e",
        NEXT_PUBLIC_ENABLE_LOCAL_NETWORK: "true",
        NEXT_PUBLIC_LOCAL_RPC_URL: E2E.rpc,
        NEXT_PUBLIC_LOCAL_EXPLORER_URL: E2E.explorer ?? "",
        NEXT_PUBLIC_LOCAL_USDC_ADDRESS: E2E.usdc,
        NEXT_PUBLIC_LOCAL_GIFT_ADDRESS: E2E.gift,
      }) as Record<string, string>,
};

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: IS_TESTNET ? 240_000 : 90_000,
  expect: { timeout: IS_TESTNET ? 60_000 : 20_000 },
  reporter: [["list"]],
  use: { baseURL: E2E.web, trace: "retain-on-failure", ...devices["Pixel 7"] },
  webServer: IS_TESTNET
    ? [web]
    : [{ command: "node e2e/chain.mjs", url: `http://127.0.0.1:${CHAIN_PORT + 1}`, timeout: 120_000, reuseExistingServer: false }, web],
});
