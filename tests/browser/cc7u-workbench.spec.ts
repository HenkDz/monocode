import { expect, test } from "@playwright/test";

test.setTimeout(120_000);

for (const width of [1440, 1100]) {
  for (const theme of ["dark", "light"]) {
    for (const scenario of ["failed", "waiting", "working", "zero", "long-history"]) {
      test(`${scenario} Workbench at ${width}px ${theme}`, async ({ page }, testInfo) => {
        const errors: string[] = [];
        page.on("pageerror", error => errors.push(error.message));
        await page.setViewportSize({ width, height: 1000 });
        await page.goto(`/tests/browser/cc7u-workbench.html?scenario=${scenario}&theme=${theme}`, { waitUntil: "commit" });
        const header = page.locator("[data-workbench-header]");
        await expect(header).toBeVisible({ timeout: 90_000 });
        const work = page.locator("[data-member-work]");
        const conversation = page.locator("[data-workbench-conversation]");
        const composer = page.getByRole("textbox", { name: `Message ${["working", "waiting"].includes(scenario) ? "Native Core" : "Reviewer"}`, exact: true });
        await expect(work).toBeVisible();
        await expect(conversation).toBeVisible();
        await expect(composer).toHaveValue("Keep my draft");
        await expect(composer).toBeInViewport();
        await expect(header.locator("[data-workbench-metrics]")).toHaveCount(1);
        await expect(header).not.toContainText("cached");
        if (scenario === "failed") {
          await expect(work.getByRole("status", { name: "Codex storage needs repair" })).toBeVisible();
          await expect(work).toContainText("not started");
          await expect(header).toContainText("storage");
        } else if (scenario === "waiting") await expect(header).toContainText("Reviewer");
        else if (scenario === "working") await expect(header).toContainText("Running tool");
        else if (scenario === "zero") await expect(work).toContainText("No assignments yet");
        if (scenario === "long-history") {
          await work.getByRole("tab", { name: "History", exact: true }).click();
          await expect(work.locator("[data-member-task]")).toHaveCount(5);
          const firstPage = await work.locator("[data-member-task]").first().getAttribute("data-member-task");
          await work.getByRole("button", { name: "Next assignments", exact: true }).click();
          await expect(work.getByRole("navigation", { name: "Assignment pages" })).toContainText("2 / 6");
          expect(await work.locator("[data-member-task]").first().getAttribute("data-member-task")).not.toBe(firstPage);
          await work.getByRole("button", { name: "Previous assignments", exact: true }).click();
          await expect(work.locator("[data-member-task]").first()).toHaveAttribute("data-member-task", firstPage!);
          await work.getByRole("tab", { name: "All", exact: true }).click();
          await expect(work.locator("[data-member-task]")).toHaveCount(5);
          await work.getByRole("tab", { name: "Current", exact: true }).click();
          await expect(work.locator("[data-member-task]")).toHaveCount(1);
        }
        await expect(page.locator("[data-member-workbench] details, [data-member-workbench] summary")).toHaveCount(0);
        const dimensions = await page.evaluate(() => {
          const box = (selector: string) => document.querySelector(selector)!.getBoundingClientRect().toJSON();
          return { width: document.documentElement.scrollWidth, viewport: innerWidth, work: box("[data-member-work]"), conversation: box("[data-workbench-conversation]"), composer: box("[data-session-composer]") };
        });
        expect(dimensions.width).toBeLessThanOrEqual(width);
        expect(dimensions.work.right).toBeLessThanOrEqual(dimensions.conversation.x);
        expect(dimensions.composer.bottom).toBeLessThanOrEqual(1000);
        expect(errors).toEqual([]);
        await page.screenshot({ path: testInfo.outputPath(`${scenario}-${width}-${theme}.png`) });
      });
    }
  }
}

test("header actions and tab keyboard navigation preserve the composer draft", async ({ page }) => {
  await page.goto("/tests/browser/cc7u-workbench.html?scenario=working", { waitUntil: "commit" });
  const header = page.locator("[data-workbench-header]");
  await expect(header).toBeVisible({ timeout: 90_000 });
  const composer = page.getByRole("textbox", { name: "Message Native Core", exact: true });
  await header.getByRole("button", { name: "Message", exact: true }).click();
  await expect(composer).toBeFocused();
  await composer.fill("Keep the focused review boundary.");
  const tabs = page.getByRole("tablist", { name: "Member view" });
  await tabs.getByRole("tab", { name: "Conversation", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(tabs.getByRole("tab", { name: "Activity", exact: true })).toBeFocused();
  await expect(page.getByRole("tabpanel", { name: "Activity", exact: true })).toBeVisible();
  await expect(composer).toHaveValue("Keep the focused review boundary.");
  await page.keyboard.press("Home");
  await expect(tabs.getByRole("tab", { name: "Conversation", exact: true })).toBeFocused();
  await header.getByRole("button", { name: "Details", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Native Core");
  await page.keyboard.press("Escape");
  await expect(composer).toHaveValue("Keep the focused review boundary.");
  await header.getByRole("button", { name: "Steer", exact: true }).click();
  await expect(composer).toBeFocused();
});

test("assignment keyboard segments and direct details retain exact task identity", async ({ page }) => {
  await page.goto("/tests/browser/cc7u-workbench.html?scenario=long-history", { waitUntil: "commit" });
  const work = page.locator("[data-member-work]");
  await expect(work).toBeVisible({ timeout: 90_000 });
  const filter = work.getByRole("tablist", { name: "Assignment filter" });
  await filter.getByRole("tab", { name: "Current", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(filter.getByRole("tab", { name: "History", exact: true })).toBeFocused();
  await expect(filter.getByRole("tab", { name: "History", exact: true })).toHaveAttribute("aria-selected", "true");
  const card = work.locator("[data-member-task]").first();
  const title = await card.locator("strong").first().innerText();
  await card.getByRole("button", { name: "Open", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText(title);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await filter.getByRole("tab", { name: "History", exact: true }).focus();
  await page.keyboard.press("End");
  await expect(filter.getByRole("tab", { name: "All", exact: true })).toBeFocused();
});

test("member-owned saved session uses the Workbench and retains session title", async ({ page }) => {
  await page.goto("/tests/browser/cc7u-workbench.html?kind=session&scenario=failed", { waitUntil: "commit" });
  await expect(page.locator("[data-member-workbench]")).toBeVisible({ timeout: 90_000 });
  await expect(page.locator("[data-workbench-header]")).toContainText("Window activation review");
  await expect(page.locator("[data-workbench-header]")).toContainText("Reviewer");
  await expect(page.locator("[data-member-work]")).toContainText("Review native window");
});

test("narrow Work toggle keeps the composer reachable and retains history selection", async ({ page }) => {
  await page.setViewportSize({ width: 600, height: 800 });
  await page.goto("/tests/browser/cc7u-workbench.html?scenario=long-history&theme=light", { waitUntil: "commit" });
  await expect(page.locator("[data-workbench-header]")).toBeVisible({ timeout: 90_000 });
  const composer = page.getByRole("textbox", { name: "Message Reviewer", exact: true });
  await expect(composer).toBeInViewport();
  const toggle = page.getByRole("button", { name: /^Work(?: · Needs attention)?$/ });
  await toggle.click();
  const work = page.locator("[data-member-work]");
  await expect(work).toBeVisible();
  await work.getByRole("tab", { name: "History", exact: true }).click();
  await page.getByRole("button", { name: "Close work", exact: true }).click();
  await expect(composer).toBeInViewport();
  await toggle.click();
  await expect(work.getByRole("tab", { name: "History", exact: true })).toHaveAttribute("aria-selected", "true");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(600);
});
