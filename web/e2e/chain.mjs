// Starts a fresh anvil chain, deploys MockUSDC + ArcGift, then serves a health check so
// Playwright only starts tests once contracts exist. Local E2E only.
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Override with E2E_CHAIN_PORT to run alongside another local chain (health = port + 1).
const RPC_PORT = Number(process.env.E2E_CHAIN_PORT ?? 8546);
const HEALTH_PORT = RPC_PORT + 1;
const ANVIL_KEY0 = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"; // public anvil test key
const contracts = join(dirname(fileURLToPath(import.meta.url)), "../../contracts");

// Use Foundry from PATH, or its default install dir when PATH doesn't include it.
const foundryBin = process.env.FOUNDRY_BIN ?? join(homedir(), ".foundry", "bin");
const tool = (name) => {
  const exe = join(foundryBin, process.platform === "win32" ? `${name}.exe` : name);
  return existsSync(exe) ? exe : name;
};

const anvil = spawn(tool("anvil"), ["--port", String(RPC_PORT), "--chain-id", "31337", "--silent"], { stdio: "inherit" });
const stop = () => anvil.kill();
process.on("exit", stop);
process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));

async function waitForRpc() {
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${RPC_PORT}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
      });
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("anvil did not start");
}

await waitForRpc();
const deploy = spawnSync(
  tool("forge"),
  ["script", "script/DeployLocal.s.sol", "--rpc-url", `http://127.0.0.1:${RPC_PORT}`, "--private-key", ANVIL_KEY0, "--broadcast"],
  { cwd: contracts, encoding: "utf8", shell: process.platform === "win32" },
);
if (deploy.status !== 0) {
  console.error(deploy.stdout, deploy.stderr);
  process.exit(1);
}
console.log(deploy.stdout.split("\n").filter((l) => /usdc|gift/.test(l)).join("\n"));
createServer((_, res) => res.end("ok")).listen(HEALTH_PORT, "127.0.0.1");
