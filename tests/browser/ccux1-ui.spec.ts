import { expect, test, type Locator } from "@playwright/test";

const evidence = "../cc-program/ccux1/ui/captures";
async function hit(button: Locator) {
  expect(await button.evaluate(el => {
    const rect = el.getBoundingClientRect();
    return el.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
  })).toBe(true);
}
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, "platform", { value: "Win32" }));
});
for (const [width, theme] of [[1440, "dark"], [480, "light"], [1440, "light"], [480, "dark"]] as const) {
  test(`actual App presentation callers and calm integrations ${width} ${theme}`, async ({ page }) => {
    test.setTimeout(90_000);
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.setViewportSize({ width, height: 800 });
    const icons = new Set<string>();
    for (const [key, label] of [["commandMap", "Command map"], ["decisions", "Decisions"], ["integrations", "Integrations"], ["usage", "Usage"], ["inbox", "Inbox"], ["notes", "Notes"], ["automations", "Automations"]]) {
      await page.goto(`/tests/browser/ccux1-ui.html?theme=${theme}&page=${key}`);
      const tab = page.locator("[data-title-tab-active]");
      await expect(tab).toHaveCount(1);
      await expect(tab).toHaveAttribute("aria-label", label);
      await expect(tab).toHaveAttribute("title", label);
      await expect(tab.locator("svg")).toHaveCount(1);
      icons.add(await tab.locator("svg").innerHTML());
      await expect(page).toHaveTitle(new RegExp(label));
    }
    expect(icons.size).toBe(7);
    await expect(page.getByText("Uses your GitHub login on this PC", { exact: true })).toBeVisible();
    await expect(page.getByText("account not pinned")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Back to conversation|^Decisions$/ })).toHaveCount(1); // Sidebar Decisions only.
    const meter = page.getByRole("meter", { name: "Codex Fixture remaining" });
    await expect(meter).toHaveAttribute("aria-valuenow", "100");
    await expect(meter).toHaveAttribute("title", "Codex · Fixture: 100% left");
    await meter.hover();
    await expect(page.locator("footer")).toContainText(/(0% used|100% left) · resets 6d 23h/);
    await page.goto(`/tests/browser/ccux1-ui.html?theme=${theme}&page=integrations&empty=true`);
    await expect(page.getByText("When a Manager needs a skill, it'll ask you here. Installed skills show up in this list.")).toBeVisible();
    await expect(page.locator("main button")).toHaveCount(0);
    await page.screenshot({ path: `${evidence}/integrations-empty-${width}-${theme}.png` });
    expect(errors).toEqual([]);
  });
}

test("window controls stay at the actual top-right with few/many tabs; classic Mono pages keep their identity", async ({ page }) => {
  for (const width of [480, 1440]) {
    await page.setViewportSize({ width, height: 800 });
    for (const extra of [0, 25]) {
      await page.goto(`/tests/browser/ccux1-ui.html?page=integrations&extra=${extra}`);
      for (const name of ["Minimize window", "Maximize window", "Close window"]) {
        const control = page.getByRole("button", { name, exact: true });
        await expect(control).toHaveCount(1); await expect(control).toBeInViewport(); await hit(control);
        await expect(control).toHaveAttribute("data-tauri-drag-region", "false");
      }
      const bounds = (await page.getByRole("button", { name: "Close window", exact: true }).boundingBox())!;
      expect(bounds.y).toBe(0); expect(bounds.x + bounds.width).toBe(width);
      await page.getByRole("button", { name: "Minimize window", exact: true }).press("Enter");
      await page.getByRole("button", { name: "Maximize window", exact: true }).click();
      await page.getByRole("button", { name: "Close window", exact: true }).press("Space");
      expect(await page.evaluate(() => (window as any).ccux1Events)).toEqual(["plugin:window|minimize", "plugin:window|toggle_maximize", "plugin:window|close"]);
      if (extra) await page.screenshot({ path: `${evidence}/many-tabs-${width}.png` });
    }
  }
  for (const state of ["mono", "manager"]) {
    await page.goto(`/tests/browser/ccux1-ui.html?page=decisions&classic=true&${state}=true`);
    await expect(page.locator("[data-title-tab-active]")).toHaveAttribute("aria-label", "Decisions");
  }
});

test("zero count disappears; positive counts stay far-right without moving icons", async ({ page }) => {
  for (const count of [0, 1, 12, 100]) {
    await page.goto(`/tests/browser/ccux1-ui.html?count=${count}`);
    const decision = page.locator("aside").getByRole("button", { name: "Decisions", exact: true });
    const badge = decision.locator("span[aria-hidden]");
    await expect(badge).toHaveCount(count ? 1 : 0);
    const map = page.locator("aside").getByRole("button", { name: "Command map", exact: true });
    expect((await decision.locator("svg").boundingBox())!.x).toBe((await map.locator("svg").boundingBox())!.x);
    if (count) {
      await expect(badge).toHaveText(count > 99 ? "99+" : String(count));
      const row = (await decision.boundingBox())!, bounds = (await badge.boundingBox())!;
      expect(row.x + row.width - bounds.x - bounds.width).toBe(8);
    }
  }
});
