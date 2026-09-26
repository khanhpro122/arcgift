import {
  ACCOUNTS,
  advanceTime,
  chain,
  claimGift,
  connect,
  createGift,
  E2E,
  expect,
  expectReceived,
  expectSpent,
  IS_TESTNET,
  CHAINS,
  readQr,
  test,
  usdcBalance,
  walletPage,
} from "./fixtures";
import { arcGiftAbi } from "../src/lib/abi";

const giftIdOf = (link: string) => new URL(link).pathname.split("/")[2];
const units = (usdc: string) => BigInt(Math.round(Number(usdc.replace(/,/g, "")) * 1e6));

test.describe.configure({ mode: "serial" });

test("single gift with message: create → approve → deposit → link/QR → claim → success", async ({ browser }) => {
  const sender = await walletPage(browser, ACCOUNTS.sender);
  const senderBefore = await usdcBalance(ACCOUNTS.sender);

  const note = "Chào bạn 👋\n\nMình gửi tặng bạn một món quà nhỏ.\nHy vọng bạn sẽ thích! 🎁";
  const link = await createGift(sender, { amount: "2.5", message: note });

  // Approve + createGift were both sent from the wallet
  const calls = await sender.evaluate(() => (window as unknown as { __walletCalls: string[] }).__walletCalls);
  expect(calls.filter((c) => c === "eth_sendTransaction")).toHaveLength(2);
  expectSpent(senderBefore - (await usdcBalance(ACCOUNTS.sender)), 2_500_000n);

  // Link carries its network in the query and the key only in the fragment
  expect(link).toMatch(new RegExp(String.raw`/gift/\d+\?network=${E2E.network}#k=[0-9a-f]{64}$`));

  // Copy link
  await sender.getByRole("button", { name: "Copy link" }).click();
  await expect(sender.getByRole("button", { name: "Link copied" })).toBeVisible();
  expect(await sender.evaluate(() => navigator.clipboard.readText())).toBe(link);

  // QR encodes the exact claim URL, and can be downloaded
  expect(await readQr(sender)).toBe(link);
  await expect(sender.getByRole("link", { name: "Download QR" })).toHaveAttribute(
    "download",
    new RegExp(String.raw`^arc-gift-${E2E.network}-\d+\.png$`),
  );
  await expect(sender.getByRole("link", { name: "Telegram" })).toHaveAttribute("href", /t\.me\/share/);
  await expect(sender.getByRole("link", { name: "Telegram" })).toHaveAttribute(
    "href",
    new RegExp(`network%3D${E2E.network}`),
  );
  await expect(sender.getByRole("link", { name: "Post on X" })).toHaveAttribute("href", new RegExp(`network%3D${E2E.network}`));

  // The note stays sealed until the gift is opened — also across a refresh.
  const alice = await walletPage(browser, ACCOUNTS.alice);
  const aliceBefore = await usdcBalance(ACCOUNTS.alice);
  await alice.goto(link);
  await expect(alice.getByRole("heading", { name: "You received a gift" })).toBeVisible();
  await connect(alice);
  await expect(alice.getByRole("button", { name: "Open gift" })).toBeVisible();
  await expect(alice.getByTestId("gift-message")).toHaveCount(0);
  await expect(alice.getByRole("button", { name: "Claim gift" })).toHaveCount(0);
  await alice.reload();
  await expect(alice.getByRole("button", { name: "Open gift" })).toBeVisible();
  await expect(alice.getByTestId("gift-message")).toHaveCount(0);

  await expect(alice.getByTestId("claimed-amount")).toHaveCount(0);

  // One action: "Open gift" sends the claim; the note (verbatim, blank line included) and the
  // amount from the receipt appear only once it's confirmed. No second "Claim" step.
  await alice.getByRole("button", { name: "Open gift" }).click();
  await expect(alice.getByRole("heading", { name: "You opened your gift! 🎉" })).toBeVisible({ timeout: 60_000 });
  expect(await alice.getByTestId("gift-message").locator("blockquote").textContent()).toBe(note);
  await expect(alice.getByTestId("claimed-amount")).toContainText("2.50");
  await expect(alice.getByText("✓ Sent to your wallet")).toBeVisible();
  await expect(alice.getByRole("button", { name: /Open gift|Claim gift/ })).toHaveCount(0);
  await expect(alice.getByRole("link", { name: "View transaction" })).toHaveAttribute(
    "href",
    new RegExp(`^${E2E.explorer}/tx/0x[0-9a-f]{64}$`),
  );
  expectReceived((await usdcBalance(ACCOUNTS.alice)) - aliceBefore, 2_500_000n);

  // A refresh reads the opened state back from the chain — no second transaction offered.
  await alice.reload();
  await expect(alice.getByRole("heading", { name: "You opened your gift! 🎉" })).toBeVisible();
  expect(await alice.getByTestId("gift-message").locator("blockquote").textContent()).toBe(note);
  await expect(alice.getByTestId("claimed-amount")).toContainText("2.50");
  await expect(alice.getByRole("button", { name: /Open gift|Claim gift/ })).toHaveCount(0);

  await sender.context().close();
  await alice.context().close();
});

test("group gift, random split: multiple wallets, live progress, sold out, dashboard", async ({ browser }) => {
  const sender = await walletPage(browser, ACCOUNTS.sender);
  const link = await createGift(sender, {
    group: true,
    amount: "1",
    people: 3,
    mode: "Random",
    message: "Thanks for being part of the community ❤️",
  });
  const id = giftIdOf(link);

  const first = await claimGift(browser, link, ACCOUNTS.alice);

  // Sender's manage page shows live progress
  await sender.goto(`/gift/${id}/manage?network=${E2E.network}`);
  await expect(sender.getByText("1 / 3 opened")).toBeVisible();
  await expect(sender.getByText("Thanks for being part of the community ❤️")).toBeVisible();

  const second = await claimGift(browser, link, ACCOUNTS.bob);
  const third = await claimGift(browser, link, ACCOUNTS.carol);

  // Every allocation paid, sum exact
  expect(units(first) + units(second) + units(third)).toBe(1_000_000n);

  // Progress updates without a reload (polling)
  await expect(sender.getByText("3 / 3 opened")).toBeVisible({ timeout: 15_000 });
  await expect(sender.getByText("1.00 USDC claimed")).toBeVisible();
  await expect(sender.getByTestId("gift-status")).toHaveText("All opened");
  await expect(sender.getByTestId("claims-list").getByRole("listitem")).toHaveCount(3);

  // A fourth wallet finds it sold out
  const dave = await walletPage(browser, ACCOUNTS.dave);
  await dave.goto(link);
  await expect(dave.getByRole("heading", { name: "All gifts have been opened" })).toBeVisible();

  // Dashboard card
  await sender.goto("/dashboard");
  const card = sender.getByTestId("gift-list").getByRole("link", { name: new RegExp(`Group gift #${id}`) });
  await expect(card).toContainText("3 / 3 claimed");
  await expect(card).toContainText("1.00");

  await sender.context().close();
  await dave.context().close();
});

test("random split with min/max: preview is exactly what's committed on-chain, within bounds", async ({ browser }) => {
  const sender = await walletPage(browser, ACCOUNTS.sender);
  await sender.goto("/create/group");
  await connect(sender);
  await sender.getByPlaceholder("100").fill("3");
  await sender.locator('input[name="people"]').fill("6");
  await sender.getByText("Random", { exact: true }).click();

  // Impossible bounds block creation with a clear message
  await sender.locator('input[name="min"]').fill("0.60");
  await expect(sender.getByText(/Minimum is too high for this total/)).toBeVisible();
  await expect(sender.getByRole("button", { name: /create group gift/i })).toBeDisabled();
  await sender.locator('input[name="min"]').fill("0.20");
  await sender.locator('input[name="max"]').fill("0.45");
  await expect(sender.getByText(/Maximum is too low for this total/)).toBeVisible();
  await sender.locator('input[name="max"]').fill("0.90");

  // Valid bounds: preview adds up; shuffle keeps the constraints
  const preview = sender.getByTestId("random-preview");
  await expect(sender.getByTestId("allocated-total")).toHaveText("Total allocated: 3.00 / 3.00 USDC ✓");
  const before = await preview.getByRole("listitem").allTextContents();
  await preview.getByRole("button", { name: "Shuffle again" }).click();
  await expect.poll(() => preview.getByRole("listitem").allTextContents()).not.toEqual(before);
  await expect(sender.getByTestId("allocated-total")).toHaveText("Total allocated: 3.00 / 3.00 USDC ✓");
  const shown = (await preview.getByRole("listitem").allTextContents()).map(units);

  await sender.getByRole("button", { name: /create group gift/i }).click();
  await expect(sender.getByRole("heading", { name: "Gift created" })).toBeVisible({ timeout: 60_000 });
  const id = BigInt(giftIdOf((await sender.getByTestId("gift-link").textContent())!.trim()));

  const onChain = await chain.readContract({ address: E2E.gift, abi: arcGiftAbi, functionName: "getAllocations", args: [id] });
  expect(onChain).toEqual(shown);
  expect(onChain.reduce((a, b) => a + b, 0n)).toBe(3_000_000n);
  for (const a of onChain) {
    expect(a >= 200_000n && a <= 900_000n, `${a} outside 0.20–0.90`).toBe(true);
  }
  await sender.context().close();
});

test("group gift, fixed split: equal amounts and one claim per wallet", async ({ browser }) => {
  const sender = await walletPage(browser, ACCOUNTS.sender);
  const link = await createGift(sender, { group: true, amount: "2", people: 4, mode: "Fixed" });

  // No message written → no note bubble after opening either; the share still shows.
  const viewer = await walletPage(browser, ACCOUNTS.carol);
  await viewer.goto(link);
  await expect(viewer.getByRole("heading", { name: "You received a gift" })).toBeVisible();
  await expect(viewer.getByTestId("gift-progress")).toBeVisible();
  await connect(viewer);
  await viewer.getByRole("button", { name: "Open gift" }).click();
  await expect(viewer.getByRole("heading", { name: "You opened your gift! 🎉" })).toBeVisible({ timeout: 60_000 });
  await expect(viewer.getByText("Your share")).toBeVisible();
  await expect(viewer.getByTestId("claimed-amount")).toContainText("0.50");
  await expect(viewer.getByTestId("gift-message")).toHaveCount(0);
  await viewer.context().close();

  expect(await claimGift(browser, link, ACCOUNTS.alice)).toBe("0.50");
  expect(await claimGift(browser, link, ACCOUNTS.bob)).toBe("0.50");

  const alice = await walletPage(browser, ACCOUNTS.alice);
  await alice.goto(link);
  await connect(alice);
  await expect(alice.getByRole("heading", { name: "You opened your gift! 🎉" })).toBeVisible();
  await expect(alice.getByTestId("claimed-amount")).toContainText("0.50");
  await sender.context().close();
  await alice.context().close();
});

test("wrong network: prompts to switch before creating", async ({ browser }) => {
  const other = E2E.network === "testnet" ? CHAINS.mainnet : CHAINS.testnet;
  const page = await walletPage(browser, ACCOUNTS.sender, { chainId: other });
  await page.goto("/create");
  await connect(page);
  const main = page.getByRole("main");
  await expect(main.getByText("Wrong network", { exact: true })).toBeVisible();
  await expect(main.getByText("You're connected to the wrong network.")).toBeVisible();
  await expect(main.getByRole("button", { name: /Create gift/ })).toHaveCount(0);
  await main.getByRole("button", { name: /Switch to/ }).click();
  await expect(main.getByRole("button", { name: /Create gift/ })).toBeVisible();
  await page.context().close();
});

test("failed transaction and bad links", async ({ browser }) => {
  const sender = await walletPage(browser, ACCOUNTS.sender);
  const link = await createGift(sender, { amount: "0.3" });
  await sender.context().close();

  const alice = await walletPage(browser, ACCOUNTS.alice);

  // Missing and wrong keys
  await alice.goto(link.split("#")[0]);
  await expect(alice.getByRole("heading", { name: "This link is incomplete" })).toBeVisible();
  await alice.goto(`${link.split("#")[0]}#k=${"ab".repeat(32)}`);
  await expect(alice.getByRole("heading", { name: "This link doesn't match this gift" })).toBeVisible();
  await alice.goto(`/gift/999999?network=${E2E.network}#k=${"ab".repeat(32)}`);
  await expect(alice.getByRole("heading", { name: "Gift not found on this network." })).toBeVisible();

  // User rejects in wallet → clear error, then succeeds on retry
  await alice.goto(link);
  await alice.reload();
  await connect(alice);
  await alice.evaluate(() => ((window as unknown as { __rejectNext: boolean }).__rejectNext = true));
  await alice.getByRole("button", { name: "Open gift" }).click();
  await expect(alice.getByText("Transaction cancelled. No changes were made.")).toBeVisible();
  await expect(alice.getByRole("heading", { name: "You received a gift" })).toBeVisible();
  await expect(alice.getByTestId("claimed-amount")).toHaveCount(0);
  await alice.getByRole("button", { name: "Open gift" }).click();
  await expect(alice.getByRole("heading", { name: "You opened your gift! 🎉" })).toBeVisible({ timeout: 60_000 });
  await alice.context().close();
});

// Runs last: moves chain time forward (local chain only; testnet expiry is covered by testnet/onchain.itest.ts).
test("expired gift: claims rejected, sender reclaims only the unclaimed part", async ({ browser }) => {
  test.skip(IS_TESTNET, "time can't be advanced on a real chain");
  const sender = await walletPage(browser, ACCOUNTS.sender);
  const link = await createGift(sender, { group: true, amount: "0.6", people: 3, mode: "Fixed" });
  const id = giftIdOf(link);
  expect(await claimGift(browser, link, ACCOUNTS.alice)).toBe("0.20");

  await advanceTime(8 * 24 * 3600);

  const bob = await walletPage(browser, ACCOUNTS.bob);
  await bob.goto(link);
  await expect(bob.getByRole("heading", { name: "This gift has expired" })).toBeVisible();
  await bob.context().close();

  const before = await usdcBalance(ACCOUNTS.sender);
  await sender.goto(`/gift/${id}/manage?network=${E2E.network}`);
  await expect(sender.getByRole("heading", { name: "Gift expired" })).toBeVisible();
  await sender.getByRole("button", { name: "Reclaim 0.40 USDC" }).click();
  await expect(sender.getByTestId("gift-status")).toHaveText("Reclaimed", { timeout: 30_000 });
  await expect(sender.getByText(/You reclaimed the unopened 0.40 USDC/)).toBeVisible();
  expectReceived((await usdcBalance(ACCOUNTS.sender)) - before, 400_000n);
  await expect(sender.getByRole("button", { name: /Reclaim/ })).toHaveCount(0);

  await sender.goto("/dashboard");
  await expect(sender.getByTestId("gift-list").getByRole("link", { name: new RegExp(`#${id}`) })).toContainText(
    "Reclaimed",
  );
  await sender.context().close();
});
