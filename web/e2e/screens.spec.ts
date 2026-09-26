import { ACCOUNTS, connect, createGift, expect, test, walletPage } from "./fixtures";

// Visual review only: SCREENSHOTS=/path npx playwright test screens
const out = process.env.SCREENSHOTS;
test.skip(!out, "set SCREENSHOTS=<dir> to capture screens");

for (const scheme of ["light", "dark"] as const) {
  test(`screens (${scheme})`, async ({ browser }) => {
    const shot = async (page: import("@playwright/test").Page, name: string) => {
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
      await page.screenshot({ path: `${out}/${scheme}-${name}.png`, fullPage: true });
    };
    const fresh = await walletPage(browser, ACCOUNTS.sender, { network: null, chainId: 5042002 });
    await fresh.goto("/");
    await fresh.getByRole("banner").getByRole("button", { name: "Connect" }).click();
    await expect(fresh.getByTestId("usdc-balance")).not.toContainText("…");
    await shot(fresh, "00-testnet-home");
    await fresh.getByTestId("network-switcher").click();
    await shot(fresh, "00-network-menu");
    await fresh.getByRole("option", { name: /Mainnet/ }).click();
    await fresh.goto("/create/group");
    await shot(fresh, "00-mainnet-create");
    await fresh.context().close();

    const sender = await walletPage(browser, ACCOUNTS.sender);
    await sender.goto("/");
    await shot(sender, "01-home");
    await sender.goto("/create/group");
    await sender.getByPlaceholder("100").fill("100");
    await sender.locator('textarea[name="message"]').fill("Thanks for being part of the community ❤️");
    await shot(sender, "02-create-group");
    const link = await createGift(sender, {
      group: true,
      amount: "100",
      people: 10,
      mode: "Random",
      message: "Thanks for being part of the community ❤️",
    });
    await shot(sender, "03-created");

    const alice = await walletPage(browser, ACCOUNTS.alice);
    await alice.goto(link);
    await expect(alice.getByRole("heading", { name: "You received a gift" })).toBeVisible();
    await shot(alice, "04-received");
    await connect(alice);
    await alice.getByRole("button", { name: "Open gift" }).click();
    await expect(alice.getByRole("heading", { name: "You opened your gift! 🎉" })).toBeVisible({ timeout: 60_000 });
    await shot(alice, "05-opened");

    await sender.goto("/dashboard");
    await expect(sender.getByTestId("gift-list")).toContainText("claimed");
    await shot(sender, "07-dashboard");
    await sender.getByTestId("gift-list").getByRole("link").first().click();
    await expect(sender.getByText(/\/ 10 opened/)).toBeVisible();
    await shot(sender, "08-manage");
    await sender.context().close();
    await alice.context().close();
  });
}
