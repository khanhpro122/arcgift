/**
 * Arc Testnet integration run — real chain, real USDC (0x3600…), real deployed ArcGift.
 * Uses the same client libs as the app (allocation, claimKey, message).
 *
 *   npm --prefix web run test:testnet   (uses testnet.giftContractAddress from src/config/networks.json)
 *
 * Wallets come from contracts/.testnet-wallets.txt (deployer + 3 recipients, testnet only).
 * Writes every tx hash to docs/testnet-run.json.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  createWalletClient,
  erc20Abi,
  getAddress,
  http,
  parseEventLogs,
  type Hex,
} from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { arcTestnet } from "viem/chains";
import networks from "../src/config/networks.json";
import { arcGiftAbi } from "../src/lib/abi";
import { randomAllocations } from "../src/lib/allocation";
import { newClaimKey, signClaim } from "../src/lib/claimKey";
import { decryptMessage, encryptMessage } from "../src/lib/message";

const TESTNET = networks.testnet;
const RPC = TESTNET.rpcUrl;
const USDC = getAddress(TESTNET.usdcAddress);
const DEPLOYED = !!TESTNET.giftContractAddress;
const GIFT = getAddress(TESTNET.giftContractAddress ?? "0x0000000000000000000000000000000000000000");
const EXPLORER = TESTNET.explorerUrl;
const root = join(__dirname, "../..");

const chain = { ...arcTestnet, rpcUrls: { default: { http: [RPC] } } };
const pub = createPublicClient({ chain, transport: http(RPC) });

const keys = Object.fromEntries(
  readFileSync(join(root, "contracts/.testnet-wallets.txt"), "utf8")
    .trim()
    .split(/\r?\n/)
    .map((l) => l.split(" "))
    .map(([name, , pk]) => [name, privateKeyToAccount(pk as Hex)]),
) as Record<"deployer" | "recipient1" | "recipient2" | "recipient3", PrivateKeyAccount>;
const sender = keys.deployer;
const recipients = [keys.recipient1, keys.recipient2, keys.recipient3];

const log: { step: string; tx: Hex; url: string }[] = [];
const wallet = (a: PrivateKeyAccount) => createWalletClient({ account: a, chain, transport: http(RPC) });

async function send(step: string, a: PrivateKeyAccount, req: Parameters<ReturnType<typeof wallet>["writeContract"]>[0]) {
  const hash = await wallet(a).writeContract(req);
  const receipt = await pub.waitForTransactionReceipt({ hash });
  expect(receipt.status, step).toBe("success");
  log.push({ step, tx: hash, url: `${EXPLORER}/tx/${hash}` });
  writeFileSync(join(root, "docs/testnet-run.json"), JSON.stringify({ contract: GIFT, runs: log }, null, 2));
  return receipt;
}

async function revertName(fn: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await fn();
  } catch (e) {
    const err = e instanceof BaseError ? e.walk((x) => x instanceof ContractFunctionRevertedError) : null;
    return err instanceof ContractFunctionRevertedError ? err.data?.errorName : String(e);
  }
  return undefined;
}

async function createGift(opts: {
  mode: 0 | 1;
  total: bigint;
  n: number;
  allocations?: bigint[];
  expiresIn: number;
  message?: string;
  step: string;
}) {
  const { privateKey, signer } = newClaimKey();
  const message = await encryptMessage(privateKey, opts.message ?? "");
  const block = await pub.getBlock();
  await send(`${opts.step}: approve`, sender, {
    address: USDC,
    abi: erc20Abi,
    functionName: "approve",
    args: [GIFT, opts.total],
    chain,
    account: sender,
  });
  const receipt = await send(`${opts.step}: createGift`, sender, {
    address: GIFT,
    abi: arcGiftAbi,
    functionName: "createGift",
    args: [
      {
        mode: opts.mode,
        totalAmount: opts.total,
        recipients: opts.n,
        allocations: opts.allocations ?? [],
        expiresAt: Number(block.timestamp) + opts.expiresIn,
        claimSigner: signer,
        message,
      },
    ],
    chain,
    account: sender,
  });
  const [ev] = parseEventLogs({ abi: arcGiftAbi, eventName: "GiftCreated", logs: receipt.logs });
  return { id: ev.args.giftId, key: privateKey };
}

async function claim(step: string, id: bigint, key: Hex, who: PrivateKeyAccount) {
  const signature = await signClaim(key, { chainId: chain.id, contract: GIFT, giftId: id, recipient: who.address });
  const before = await pub.getBalance({ address: who.address });
  const receipt = await send(step, who, {
    address: GIFT,
    abi: arcGiftAbi,
    functionName: "claim",
    args: [id, who.address, signature],
    chain,
    account: who,
  });
  const [ev] = parseEventLogs({ abi: arcGiftAbi, eventName: "GiftClaimed", logs: receipt.logs });
  // Native balance (18 dec) == ERC-20 balance (6 dec) × 1e12: gift in, gas out, exactly.
  const after = await pub.getBalance({ address: who.address });
  const gas = receipt.gasUsed * receipt.effectiveGasPrice;
  expect(after - before).toBe(ev.args.amount * 10n ** 12n - gas);
  return ev.args.amount;
}

const usdc = (x: number) => BigInt(Math.round(x * 1e6));

describe.skipIf(!DEPLOYED)("Arc Testnet on-chain run", () => {
  beforeAll(async () => {
    expect(await pub.getChainId()).toBe(5042002);
    expect(await pub.readContract({ address: GIFT, abi: arcGiftAbi, functionName: "usdc" })).toBe(USDC);
    // Give recipients a little USDC for gas (gas on Arc is paid in USDC).
    for (const r of recipients) {
      const bal = await pub.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [r.address] });
      if (bal < usdc(0.2)) {
        await send(`fund gas for ${r.address}`, sender, {
          address: USDC,
          abi: erc20Abi,
          functionName: "transfer",
          args: [r.address, usdc(0.3)],
          chain,
          account: sender,
        });
      }
    }
  }, 180_000);

  it("fixed group gift: 3 USDC / 3 → three claims, message, double claim, sold out", async () => {
    const { id, key } = await createGift({
      mode: 0,
      total: usdc(3),
      n: 3,
      expiresIn: 7 * 86400,
      message: "Happy Birthday! ❤️",
      step: "fixed",
    });
    const payload = await pub.readContract({ address: GIFT, abi: arcGiftAbi, functionName: "getMessage", args: [id] });
    expect(await decryptMessage(key, payload)).toBe("Happy Birthday! ❤️");

    expect(await claim("fixed: claim 1", id, key, recipients[0])).toBe(usdc(1));

    // Double claim is checked while slots remain; once sold out, SoldOut takes precedence.
    const sig = await signClaim(key, { chainId: chain.id, contract: GIFT, giftId: id, recipient: recipients[0].address });
    expect(
      await revertName(() =>
        pub.simulateContract({
          account: recipients[0],
          address: GIFT,
          abi: arcGiftAbi,
          functionName: "claim",
          args: [id, recipients[0].address, sig],
        }),
      ),
    ).toBe("AlreadyClaimed");

    for (const [i, r] of recipients.slice(1).entries())
      expect(await claim(`fixed: claim ${i + 2}`, id, key, r)).toBe(usdc(1));

    const sig4 = await signClaim(key, { chainId: chain.id, contract: GIFT, giftId: id, recipient: sender.address });
    expect(
      await revertName(() =>
        pub.simulateContract({ account: sender, address: GIFT, abi: arcGiftAbi, functionName: "claim", args: [id, sender.address, sig4] }),
      ),
    ).toBe("SoldOut");
    expect(await pub.readContract({ address: GIFT, abi: arcGiftAbi, functionName: "status", args: [id] })).toBe(1);
    const claims = await pub.readContract({ address: GIFT, abi: arcGiftAbi, functionName: "getClaims", args: [id] });
    expect(claims.map((c) => c.recipient)).toEqual(recipients.map((r) => r.address));
  }, 300_000);

  it("random group gift: CSPRNG split committed, each claim gets its slot, sum exact", async () => {
    const total = usdc(2);
    const allocations = randomAllocations(total, 3);
    const { id, key } = await createGift({ mode: 1, total, n: 3, allocations, expiresIn: 3 * 86400, step: "random" });
    expect(await pub.readContract({ address: GIFT, abi: arcGiftAbi, functionName: "getAllocations", args: [id] })).toEqual(
      allocations,
    );
    let sum = 0n;
    for (const [i, r] of recipients.entries()) {
      const got = await claim(`random: claim ${i + 1}`, id, key, r);
      expect(got).toBe(allocations[i]);
      sum += got;
    }
    expect(sum).toBe(total);
    expect(await pub.readContract({ address: GIFT, abi: arcGiftAbi, functionName: "remaining", args: [id] })).toBe(0n);
  }, 300_000);

  it(
    "real expiry: claim before, rejected after, sender reclaims unclaimed part once",
    async () => {
      const { id, key } = await createGift({ mode: 0, total: usdc(1), n: 2, expiresIn: 10 * 60 + 30, step: "expiry" });
      expect(await claim("expiry: claim before expiry", id, key, recipients[0])).toBe(usdc(0.5));
      expect(
        await revertName(() =>
          pub.simulateContract({ account: sender, address: GIFT, abi: arcGiftAbi, functionName: "reclaim", args: [id] }),
        ),
      ).toBe("GiftNotExpired");

      const gift = await pub.readContract({ address: GIFT, abi: arcGiftAbi, functionName: "getGift", args: [id] });
      for (;;) {
        const b = await pub.getBlock();
        if (b.timestamp >= BigInt(gift.expiresAt)) break;
        await new Promise((r) => setTimeout(r, 15_000));
      }

      const sig = await signClaim(key, { chainId: chain.id, contract: GIFT, giftId: id, recipient: recipients[1].address });
      expect(
        await revertName(() =>
          pub.simulateContract({
            account: recipients[1],
            address: GIFT,
            abi: arcGiftAbi,
            functionName: "claim",
            args: [id, recipients[1].address, sig],
          }),
        ),
      ).toBe("GiftExpired");

      const receipt = await send("expiry: reclaim", sender, {
        address: GIFT,
        abi: arcGiftAbi,
        functionName: "reclaim",
        args: [id],
        chain,
        account: sender,
      });
      const [ev] = parseEventLogs({ abi: arcGiftAbi, eventName: "GiftReclaimed", logs: receipt.logs });
      expect(ev.args.amount).toBe(usdc(0.5));
      expect(
        await revertName(() =>
          pub.simulateContract({ account: sender, address: GIFT, abi: arcGiftAbi, functionName: "reclaim", args: [id] }),
        ),
      ).toBe("GiftAlreadyReclaimed");
      expect(await pub.readContract({ address: GIFT, abi: arcGiftAbi, functionName: "status", args: [id] })).toBe(3);
    },
    20 * 60_000,
  );
});

