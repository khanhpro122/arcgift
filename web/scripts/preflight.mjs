// Network preflight: verifies config against the live chain before deploy or launch.
//   npm --prefix web run preflight -- ../contracts/.env.mainnet   (before deploying)
//   npm --prefix web run preflight -- --network mainnet            (before shipping the frontend)
// Exits non-zero on any problem. Read-only: never sends a transaction.
import { readFileSync } from "node:fs";
import { createPublicClient, erc20Abi, getAddress, http, isAddress, parseAbi } from "viem";

const EXPECTED = {
  "arc-testnet": { chainId: 5042002, rpcHost: "testnet" },
  "arc-mainnet": { chainId: 5042, rpcHost: "mainnet" },
};
// Arc USDC ERC-20 interface — https://docs.arc.io/arc/references/contract-addresses
const DOCS_USDC = "0x3600000000000000000000000000000000000000";

// Two modes:
//   --network testnet|mainnet  checks the app's src/config/networks.json entry (what users get)
//   <env file>                 checks a contracts/.env.* deploy file
const arg = process.argv[2];
if (!arg) throw new Error("usage: preflight --network <testnet|mainnet> | <env file>");
let env;
let label;
let rawText;
if (arg === "--network") {
  const id = process.argv[3];
  const all = JSON.parse(readFileSync(new URL("../src/config/networks.json", import.meta.url), "utf8"));
  const n = all[id];
  if (!n) throw new Error(`unknown network ${id}`);
  const other = all[id === "mainnet" ? "testnet" : "mainnet"];
  if (n.giftContractAddress && other?.giftContractAddress && n.giftContractAddress.toLowerCase() === other.giftContractAddress.toLowerCase()) {
    throw new Error(`${id}.giftContractAddress equals the other network's contract — refusing`);
  }
  env = {
    NETWORK: `arc-${id}`,
    RPC_URL: n.rpcUrl,
    USDC_ADDRESS: n.usdcAddress,
    CONTRACT_ADDRESS: n.giftContractAddress ?? "",
    EXPLORER_URL: n.explorerUrl,
  };
  label = `src/config/networks.json → ${id}`;
  rawText = JSON.stringify(n);
} else {
  rawText = readFileSync(arg, "utf8");
  env = Object.fromEntries(
    rawText
      .split(/\r?\n/)
      .filter((l) => /^\s*[A-Z_]+=/.test(l))
      .map((l) => {
        const i = l.indexOf("=");
        return [l.slice(0, i).trim().replace(/^NEXT_PUBLIC_/, ""), l.slice(i + 1).trim()];
      }),
  );
  label = arg;
}
const network = env.NETWORK;
const rpc = env.RPC_URL;
const usdc = env.USDC_ADDRESS;
const contract = env.CONTRACT_ADDRESS || env.GIFT_CONTRACT_ADDRESS;

const errors = [];
const ok = (msg) => console.log(`  ok  ${msg}`);
const fail = (msg) => {
  errors.push(msg);
  console.log(`  !!  ${msg}`);
};
const check = (cond, good, bad) => {
  if (cond) ok(good);
  else fail(bad);
};

console.log(`Preflight ${label}`);
const expected = EXPECTED[network];
if (!expected) fail(`NETWORK must be arc-testnet or arc-mainnet (got "${network}")`);
if (!rpc) fail("RPC_URL missing");
if (expected && rpc && !rpc.includes(expected.rpcHost)) fail(`RPC_URL does not look like ${network}: ${rpc}`);
if (network === "arc-mainnet") {
  if (/testnet/i.test(rawText.replace(/^#.*$/gm, ""))) fail("mainnet config still contains a testnet value");
  else ok("no testnet values in mainnet env");
}

if (rpc && expected) {
  const client = createPublicClient({ transport: http(rpc) });
  const chainId = await client.getChainId();
  check(chainId === expected.chainId, `chain id ${chainId}`, `chain id ${chainId} != ${expected.chainId}`);

  if (!usdc || !isAddress(usdc)) fail("USDC_ADDRESS missing/invalid");
  else {
    check(getAddress(usdc) === DOCS_USDC, "USDC address matches Arc docs", `USDC ${usdc} != docs ${DOCS_USDC}`);
    const [decimals, symbol] = await Promise.all([
      client.readContract({ address: usdc, abi: erc20Abi, functionName: "decimals" }),
      client.readContract({ address: usdc, abi: erc20Abi, functionName: "symbol" }),
    ]);
    check(decimals === 6, "USDC decimals 6", `USDC decimals ${decimals}`);
    check(symbol === "USDC", "USDC symbol", `USDC symbol ${symbol}`);
  }

  if (contract) {
    if (!isAddress(contract)) fail("CONTRACT_ADDRESS invalid");
    else {
      const code = await client.getCode({ address: contract });
      if (!code || code === "0x") fail("no code at CONTRACT_ADDRESS on this chain");
      else {
        const tokenInContract = await client.readContract({
          address: contract,
          abi: parseAbi(["function usdc() view returns (address)"]),
          functionName: "usdc",
        });
        check(
          getAddress(tokenInContract) === getAddress(usdc),
          "ArcGift.usdc() matches USDC_ADDRESS",
          `ArcGift.usdc() is ${tokenInContract}`,
        );
      }
    }
  } else console.log("  --  CONTRACT_ADDRESS not set (fine before first deploy)");
}

if (errors.length) {
  console.log(`\n${errors.length} problem(s). Do not deploy.`);
  process.exit(1);
}
console.log("\nAll checks passed.");
