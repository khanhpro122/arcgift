import type { Page } from "@playwright/test";
import networks from "../src/config/networks.json";
import { ACCOUNTS, CHAINS, E2E, claimGift, createGift, expect, test, walletCalls, walletPage } from "./fixtures";

// Network-switching behaviour. Testnet/Mainnet use the real config in src/config/networks.json
// (read-only RPC calls); gift transactions run on the E2E target network.

const LABEL: Record<string, string> = { testnet: "Testnet", mainnet: "Mainnet", local: "Local" };
/** A network other than the E2E target, for "switch away and back" checks. */
const OTHER = E2E.network === "testnet" ? "mainnet" : "testnet";

async function pick(page: Page, name: string) {
  await page.getByTestId("network-switcher").click();
  await page.getByRole("option", { name: new RegExp(name) }).click();
  await expect(page.getByTestId("network-switcher")).toContainText(name);
}

async function connectFromNavbar(page: Page) {
  await page.getByRole("banner").getByRole("button", { name: "Connect" }).click();
}

test.describe.configure({ mode: "serial" });

test("first load is Mainnet; the choice persists across reloads; the footer says whose money it is", async ({ browser }) => {
  const page = await walletPage(browser, ACCOUNTS.sender, { network: null });
  await page.goto("/");
  await expect(page.getByTestId("network-switcher")).toContainText("Mainnet");
  await expect(page.getByTestId("footer-network-note")).toHaveText("Arc Mainnet · Transactions use real USDC");

  await pick(page, "Testnet");
  await expect(page.getByTestId("footer-network-note")).toHaveText("Arc Testnet · Use test funds only");
  await pick(page, "Mainnet");
  await expect(page.getByTestId("footer-network-note")).toHaveText("Arc Mainnet · Transactions use real USDC");
  expect(await page.evaluate(() => localStorage.getItem("arcgift:network"))).toBe("mainnet");

  await page.reload();
  await expect(page.getByTestId("network-switcher")).toContainText("Mainnet");
  await expect(page.getByTestId("footer-network-note")).toHaveText("Arc Mainnet · Transactions use real USDC");

  await pick(page, "Testnet");
  await expect(page.getByTestId("footer-network-note")).toHaveText("Arc Testnet · Use test funds only");
  await page.reload();
  await expect(page.getByTestId("network-switcher")).toContainText("Testnet");
  await page.context().close();
});

test("navbar USDC balance always belongs to the selected network", async ({ browser }) => {
  const page = await walletPage(browser, ACCOUNTS.sender, { network: E2E.network });
  await page.goto("/");
  await connectFromNavbar(page);
  const balance = page.getByTestId("usdc-balance");

  await expect(balance).toHaveAttribute("data-network", E2E.network);
  await expect(balance).not.toContainText("…");
  const targetText = await balance.textContent();

  for (const id of ["testnet", "mainnet"] as const) {
    if (id === E2E.network) continue;
    await pick(page, LABEL[id]);
    await expect(balance).toHaveAttribute("data-network", id);
    await expect(balance).not.toContainText("…", { timeout: 30_000 }); // read from that network's RPC
  }

  await pick(page, LABEL[E2E.network]);
  await expect(balance).toHaveAttribute("data-network", E2E.network);
  await expect(balance).toHaveText(targetText!);
  await page.context().close();
});

test("wallet on the wrong network: navbar and flows offer Switch Network, which switches the wallet", async ({
  browser,
}) => {
  const page = await walletPage(browser, ACCOUNTS.sender, { network: "mainnet", chainId: CHAINS.testnet });
  await page.goto("/create/group");
  await connectFromNavbar(page);
  const navSwitch = page.getByRole("banner").getByRole("button", { name: "Switch to Arc Mainnet" });
  await expect(navSwitch).toBeVisible();
  await navSwitch.click();
  expect(await walletCalls(page)).toContain(`switch:0x${CHAINS.mainnet.toString(16)}`);
  await expect(navSwitch).toHaveCount(0);
  await expect(page.getByRole("banner").getByRole("button", { name: /0x/ })).toBeVisible();

  // Selecting another network flips it back to "wrong network" until the wallet follows.
  await pick(page, LABEL[E2E.network]);
  await expect(page.getByRole("banner").getByRole("button", { name: /Switch to/ })).toBeVisible();
  await page.context().close();
});

test("networks without an ArcGift contract disable every transaction and say so", async ({ browser }) => {
  const undeployed = (["testnet", "mainnet"] as const).filter((id) => !networks[id].giftContractAddress);
  test.skip(undeployed.length === 0, "ArcGift is deployed on every network");
  const page = await walletPage(browser, ACCOUNTS.sender, { network: undeployed[0] });
  for (const id of undeployed) {
    await page.goto("/");
    await pick(page, LABEL[id]);
    for (const path of ["/create", "/create/group", "/dashboard", "/activity"]) {
      await page.goto(path);
      await expect(page.getByTestId("not-deployed")).toContainText("ArcGift contract is not deployed on this network yet.");
    }
    await page.goto("/create/group");
    await expect(page.getByRole("main").getByRole("button", { name: /create (group )?gift/i })).toHaveCount(0);
    await page.goto(`/gift/1?network=${id}#k=${"ab".repeat(32)}`);
    await expect(page.getByTestId("not-deployed")).toBeVisible();
  }
  await page.context().close();
});

test("gift URLs: ?network= selects the network; missing or unknown falls back to Testnet", async ({ browser }) => {
  const page = await walletPage(browser, ACCOUNTS.sender, { network: null });
  const key = "ab".repeat(32);

  await page.goto(`/gift/7?network=mainnet#k=${key}`);
  await expect(page.getByTestId("network-switcher")).toContainText("Mainnet");
  await expect(page.getByTestId("footer-network-note")).toHaveText("Arc Mainnet · Transactions use real USDC");

  // Missing param never guesses Mainnet, even though Mainnet is now the stored choice
  await page.goto(`/gift/7#k=${key}`);
  await expect(page.getByTestId("network-switcher")).toContainText("Testnet");
  await page.goto(`/gift/7?network=arc-mainnet#k=${key}`);
  await expect(page.getByTestId("network-switcher")).toContainText("Testnet");

  // Switching from the navbar on a gift page rewrites ?network= and keeps the #key
  await pick(page, "Mainnet");
  await expect(page).toHaveURL(new RegExp(`/gift/7\\?network=mainnet#k=${key}$`));
  await page.context().close();
});

test("gift links, QR and share targets carry the network; the gift only loads on its own network", async ({
  browser,
}) => {
  const sender = await walletPage(browser, ACCOUNTS.sender);
  const link = await createGift(sender, { group: true, amount: "0.4", people: 2, mode: "Fixed" });
  const url = new URL(link);
  expect(url.searchParams.get("network")).toBe(E2E.network);

  // Open the same link but on another network: never loaded against the wrong contract
  const viewer = await walletPage(browser, ACCOUNTS.dave, { network: null });
  await viewer.goto(`${url.pathname}?network=${OTHER}${url.hash}`);
  await expect(viewer.getByRole("heading", { name: "You received a gift" })).toHaveCount(0);
  if (networks[OTHER].giftContractAddress) {
    // The other network's contract may have its own gift with this id; the link key won't match it.
    await expect(
      viewer.getByRole("heading", { name: /^(Gift not found on this network\.|This link doesn't match this gift)$/ }),
    ).toBeVisible();
  } else {
    await expect(viewer.getByTestId("not-deployed")).toBeVisible();
  }
  // …and the correct network button brings it back
  await viewer.getByTestId("network-switcher").click();
  await viewer.getByRole("option", { name: new RegExp(LABEL[E2E.network]) }).click();
  await expect(viewer.getByRole("heading", { name: "You received a gift" })).toBeVisible();
  await sender.context().close();
  await viewer.context().close();
});

test("activity, dashboard, form and claim state never leak between networks", async ({ browser }) => {
  const sender = await walletPage(browser, ACCOUNTS.sender);
  const link = await createGift(sender, { group: true, amount: "0.3", people: 3, mode: "Random" });
  const id = new URL(link).pathname.split("/")[2];
  await claimGift(browser, link, ACCOUNTS.alice);

  // Activity on the target network shows this gift with explorer links for that network
  await sender.goto("/activity");
  await expect(sender.getByTestId("activity-network")).toContainText(E2E.network === "local" ? "Local" : "Arc Testnet");
  const list = sender.getByTestId("activity-list");
  await expect(list).toContainText(`Created gift #${id}`);
  await expect(list).toContainText(`opened gift #${id}`);
  const txLinks = list.getByRole("link", { name: "View tx" });
  await expect(txLinks.first()).toHaveAttribute("href", new RegExp(`^${E2E.explorer}/tx/0x`));

  // Switch away: nothing from the target network is shown
  await pick(sender, LABEL[OTHER]);
  await expect(sender.getByTestId("activity-network")).toContainText(networks[OTHER].chainName);
  await expect(sender.getByText(`Created gift #${id}`)).toHaveCount(0);
  await sender.goto("/dashboard");
  await expect(sender.getByTestId("gift-list")).toHaveCount(0);

  // …and back again: it's all still there
  await pick(sender, LABEL[E2E.network]);
  await expect(sender.getByTestId("gift-list")).toContainText(`#${id}`);

  // Create form state is reset by a network switch
  await sender.goto("/create/group");
  await sender.getByPlaceholder("100").fill("12.34");
  await pick(sender, LABEL[OTHER]);
  await pick(sender, LABEL[E2E.network]);
  await expect(sender.getByPlaceholder("100")).toHaveValue("");

  // Recipient's activity shows the gift they received
  const alice = await walletPage(browser, ACCOUNTS.alice);
  await alice.goto("/activity");
  await connectFromNavbar(alice).catch(() => {});
  await expect(alice.getByTestId("activity-list")).toContainText(`Received gift #${id}`);
  await sender.context().close();
  await alice.context().close();
});

test("the network check runs right before sending: a silent wallet chain change blocks the transaction", async ({
  browser,
}) => {
  const page = await walletPage(browser, ACCOUNTS.sender);
  await page.goto("/create");
  await page.getByRole("main").getByRole("button", { name: /connect wallet/i }).click();
  await page.getByPlaceholder("100").fill("0.1");
  const createButton = page.getByRole("main").getByRole("button", { name: /create gift/i });
  await expect(createButton).toBeEnabled();

  // The wallet moves to another chain without telling the page
  await page.evaluate((c) => (window as unknown as { __setChain: (c: string, s: boolean) => void }).__setChain(c, true), `0x${CHAINS[OTHER].toString(16)}`);
  await createButton.click();
  await expect(page.getByText(/Your wallet is on a different network\. Switch to .+ and try again\./)).toBeVisible();
  expect(await walletCalls(page)).not.toContain("eth_sendTransaction");
  await page.context().close();
});
