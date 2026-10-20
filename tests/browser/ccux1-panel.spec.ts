import { expect, test } from "@playwright/test";

const evidence = "../cc-program/ccux1/part-c/captures";
async function corner(page: import("@playwright/test").Page) {
  for (const name of ["Minimize window", "Maximize window", "Close window"]) {
    const button = page.getByRole("button", { name, exact: true });
    await expect(button).toHaveCount(1);
    await expect(button).toBeInViewport();
    expect(await button.evaluate(element => {
      const r = element.getBoundingClientRect();
      return element.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
    })).toBe(true);
  }
  const close = (await page.getByRole("button", { name: "Close window", exact: true }).boundingBox())!;
  expect(close.y).toBe(0);
  expect(close.x + close.width).toBe(page.viewportSize()!.width);
}
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, "platform", { value: "Win32" }));
});
for (const width of [1600, 1024, 640]) for (const theme of ["dark", "light"]) {
  test(`production unified panel routes ${width} ${theme}`, async ({ page }) => {
    test.setTimeout(120000);
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.setViewportSize({ width, height: 950 });
    await page.goto(`/tests/browser/ccux1-panel.html?theme=${theme}`);
    await expect(page.getByRole("tablist", { name: "Project context" }).getByRole("tab")).toHaveText(["Goal", "Worktree", "Changes", "PRs", "Activity"]);
    for (const tab of ["Goal", "Worktree", "Changes", "PRs", "Activity"]) {
      await page.getByRole("tab", { name: tab, exact: true }).click();
      await expect(page.getByRole("tab", { name: tab, exact: true })).toHaveAttribute("aria-selected", "true");
      await corner(page);
      await page.screenshot({ path: `${evidence}/${tab.toLowerCase()}-${width}-${theme}.png` });
    }
    const chatOpen = (await page.locator("[data-chat]").boundingBox())!;
    await page.getByRole("button", { name: "Hide panel", exact: true }).click();
    await expect(page.locator("[data-workspace-context]")).toBeHidden();
    const chatClosed = (await page.locator("[data-chat]").boundingBox())!;
    if (width <= 1100) expect(chatOpen.width).toBe(chatClosed.width);
    await page.getByRole("button", { name: /Worktree feat\/chooser/ }).click();
    await expect(page.locator("[data-workspace-context]")).toBeHidden();
    await page.getByRole("button", { name: "Panel", exact: true }).click();
    await expect(page.getByRole("tab", { name: "Activity", exact: true })).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Control+b");
    await expect(page.locator("[data-workspace-context]")).toBeHidden();
    await page.keyboard.press("Control+b");
    await expect(page.getByRole("tab", { name: "Activity", exact: true })).toHaveAttribute("aria-selected", "true");
    expect(await page.evaluate(() => (window as any).panelFixture.events.filter((event: any) => event.command === "left-sidebar-toggle"))).toEqual([]);
    await page.getByRole("tab", { name: "PRs", exact: true }).click();
    await page.getByRole("button", { name: /^PR #41:/ }).click();
    await expect(page.getByRole("tab", { name: "Worktree", exact: true })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("tabpanel", { name: "Worktree", exact: true })).toContainText("feat/chooser");
    await page.getByRole("button", { name: "Hide panel", exact: true }).click();
    await page.locator('[data-workspace-mono="Atlas"]').click();
    await expect(page.getByRole("tab", { name: "Activity", exact: true })).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("[data-mono-details]")).toHaveCount(1);
    await expect(page.locator("aside.mono-details-panel")).toHaveCount(0);
    await corner(page);
    await page.screenshot({ path: `${evidence}/member-${width}-${theme}.png` });
    await page.getByRole("button", { name: "Hide panel", exact: true }).click();
    await page.evaluate(() => (window as any).panelFixture.firstOpen());
    await page.getByRole("button", { name: "Project settings", exact: true }).click();
    await expect(page.getByRole("tab", { name: "Activity", exact: true })).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("[data-mono-settings]")).toBeVisible();
    await corner(page);
    await page.screenshot({ path: `${evidence}/project-settings-${width}-${theme}.png` });
    await page.getByRole("button", { name: "Hide panel", exact: true }).click();
    await page.getByRole("button", { name: "Manager row", exact: true }).click();
    await expect(page.getByRole("tab", { name: "Activity", exact: true })).toHaveAttribute("aria-selected", "true");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  });
}
test("every page keeps one top-right titlebar control set with the panel open and closed", async ({ page }) => {
  test.setTimeout(120000);
  for (const width of [1600, 1024]) {
    await page.setViewportSize({ width, height: 950 });
    await page.goto("/tests/browser/ccux1-panel.html");
    for (const route of ['Command map', 'Decisions', 'Integrations', 'Usage', 'Inbox', 'Notes', 'Automations', 'Search', 'Settings', 'PR page']) {
      await page.getByRole("button", { name: "Hide panel", exact: true }).click();
      await page.getByRole("button", { name: route, exact: true }).click();
      await corner(page);
      await page.getByRole("button", { name: "Panel", exact: true }).click();
      await corner(page);
      await page.screenshot({ path: `${evidence}/page-${route.toLowerCase().replaceAll(' ', '-')}-${width}.png` });
    }
    await page.getByRole("button", { name: "Minimize window", exact: true }).press("Enter");
    await page.getByRole("button", { name: "Maximize window", exact: true }).click();
    await page.getByRole("button", { name: "Close window", exact: true }).press("Space");
    expect(await page.evaluate(() => (window as any).panelFixture.events.filter((event: any) => ["plugin:window|minimize", "plugin:window|toggle_maximize", "plugin:window|close"].includes(event.command)).map((event: any) => event.command))).toEqual(["plugin:window|minimize", "plugin:window|toggle_maximize", "plugin:window|close"]);
  }
});
