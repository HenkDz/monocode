import { expect, test, type Locator, type Page } from "@playwright/test";

const evidence = process.env.CCFB4_EVIDENCE ?? "test-results/ccfb4/screenshots";

async function scrollDrawer(page: Page, drawer: Locator, body = drawer.locator(".modal-panel > div")) {
  await drawer.locator(".modal-panel").evaluate(el => Promise.all(el.getAnimations().map(animation => animation.finished)));
  const close = drawer.getByRole("button", { name: "Close", exact: true });
  const header = drawer.locator(".modal-panel > header");
  const before = await header.boundingBox();
  expect(await body.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
  await body.hover();
  await page.mouse.wheel(0, 600);
  await expect.poll(() => body.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
  await body.evaluate(el => { el.scrollTop = el.scrollHeight; });
  expect(await body.evaluate(el => Math.abs(el.scrollHeight - el.clientHeight - el.scrollTop) <= 1)).toBe(true);
  await expect(close).toBeInViewport({ ratio: 1 });
  expect((await header.boundingBox())!.y).toBe(before!.y);
  return body;
}

for (const width of [1440, 390]) for (const theme of ["dark", "light"]) {
  test(`all actual drawer callers scroll and keep Close reachable ${width} ${theme}`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/*", route => new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort());
    await page.addInitScript(() => {
      Object.assign(window, { copiedPath: "" });
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
        writeText: async (text: string) => { Object.assign(window, { copiedPath: text }); },
      } });
    });
    await page.setViewportSize({ width, height: 700 });
    await page.goto(`/tests/browser/cc7u-workbench.html?scenario=failed&drawerStress=yes&theme=${theme}`);
    const details = page.locator("[data-workbench-header]").getByRole("button", { name: "Details", exact: true });
    await details.click();
    const drawer = page.getByRole("dialog", { name: "Session details", exact: true });
    const summary = drawer.getByRole("button", { name: /Private credential copies:/ });
    await expect(summary).toContainText("24 (4 in use)");
    await expect(summary).toHaveAttribute("aria-expanded", "false");
    await summary.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${evidence}/summary-${width}-${theme}.png` });
    await summary.focus();
    await page.keyboard.press("Enter");
    const list = drawer.getByRole("list", { name: "Private credential contexts" });
    await expect(list.getByRole("listitem")).toHaveCount(12);
    await expect(list.getByRole("listitem").first()).toContainText("Base context");
    await expect(list.getByRole("listitem").first().getByRole("button", { name: "Clear inactive private credentials", exact: true })).toHaveCount(0);
    const inactive = list.getByRole("listitem").nth(2);
    await inactive.getByRole("button", { name: "Clear inactive private credentials", exact: true }).click();
    await expect(inactive).toContainText("including any changed login");
    await inactive.getByRole("button", { name: "Cancel", exact: true }).click();
    const body = await scrollDrawer(page, drawer);
    await list.getByRole("listitem").last().scrollIntoViewIfNeeded();
    await list.getByRole("listitem").last().evaluate(el => el.scrollIntoView({ block: "center" }));
    await expect(list.getByRole("listitem").last()).toBeInViewport({ ratio: 1 });
    await expect(drawer.getByRole("button", { name: "Close", exact: true })).toBeInViewport({ ratio: 1 });
    await page.screenshot({ path: `${evidence}/contexts-${width}-${theme}.png` });
    await body.evaluate(el => { el.scrollTop = 0; });
    const copy = drawer.getByRole("button", { name: "Copy selected Codex home path", exact: true });
    await copy.click();
    expect(await page.evaluate(() => (window as unknown as { copiedPath: string }).copiedPath)).toBe("//?/C:/Users/synthetic/.codex");
    await expect(copy).toHaveAttribute("title", "//?/C:/Users/synthetic/.codex");
    await expect(drawer.getByText("C:/Users/synthetic/.codex", { exact: true })).toBeVisible();
    await summary.click();
    await expect(list).toBeHidden();
    await summary.click();
    await expect(list).toBeVisible();
    const last = drawer.getByRole("button").last();
    await last.focus();
    await page.keyboard.press("Tab");
    await expect(drawer.getByRole("button", { name: "Close", exact: true })).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(last).toBeFocused();
    expect(await drawer.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await drawer.getByRole("button", { name: "Close", exact: true }).click();
    await expect(details).toBeFocused();

    if (width === 390) await page.locator(".cc7u-work-toggle").click();
    const manager = page.getByRole("button", { name: "Read team message", exact: false });
    await manager.click();
    const message = page.getByRole("dialog", { name: "Review hand-off", exact: true });
    await scrollDrawer(page, message);
    await expect(message.locator("time")).toBeInViewport({ ratio: 1 });
    await page.keyboard.press("Escape");
    await expect(manager).toBeFocused();
    const error = page.getByRole("button", { name: "Error details", exact: true });
    await error.click();
    const diagnostic = page.getByRole("dialog", { name: "Storage error details", exact: true });
    await scrollDrawer(page, diagnostic, diagnostic.locator("pre"));
    await diagnostic.getByRole("button", { name: "Copy details", exact: true }).click();
    expect(await page.evaluate(() => (window as unknown as { copiedPath: string }).copiedPath)).toBe(await diagnostic.locator("pre").textContent());
    await diagnostic.getByRole("button", { name: "Close", exact: true }).click();
    await expect(error).toBeFocused();
    expect(errors).toEqual([]);
    expect(await page.evaluate(() => (window as unknown as { workbenchFixture: { events: { action: string }[] } }).workbenchFixture.events.filter(event => event.action === "retire-credentials"))).toEqual([]);
  });
}
