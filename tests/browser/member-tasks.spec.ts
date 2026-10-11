import { expect, test } from "@playwright/test";

test.setTimeout(120_000);

for (const [width, height, mode] of [
  [1000, 800, "dark"],
  [360, 640, "light"],
  [700, 400, "history"],
] as const) {
  test(`tasks stay bounded at ${width}x${height} with ${mode} layout`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height });
    await page.goto(`/tests/browser/member-tasks.html?mode=${mode}`, {
      waitUntil: "commit",
    });
    const log = page.getByRole("region", { name: "Member work log" });
    await expect(log).toBeVisible({ timeout: 90_000 });
    const cards = log.locator("[data-member-task]");
    const history = log.getByRole("tab", {
      name: "History",
      exact: true,
    });
    const current = log.getByRole("tab", { name: "Current", exact: true });
    const composer = page.getByRole("textbox", { name: "Message Rowan" });
    await expect(cards).toHaveCount(mode === "history" ? 0 : 5);
    await expect(history).toHaveAttribute("aria-selected", "false");
    if (mode !== "history") {
      await expect(cards.first()).toHaveAttribute(
        "data-member-task",
        "Waiting for your decision",
      );
      await expect(cards.first()).toContainText("Needs you");
    }
    const composerBefore = (await composer.boundingBox())!;
    await history.click();
    await expect(cards).toHaveCount(5);
    const scroller = page.locator("[data-fixture-work]");
    expect(
      await scroller.evaluate((el) => el.clientHeight),
    ).toBeLessThanOrEqual(Math.min(height * 0.3, 256) + 1);
    const box = (await scroller.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, 500);
    await expect
      .poll(() => scroller.evaluate((el) => el.scrollTop))
      .toBeGreaterThan(100);
    const next = log.getByRole("button", { name: "Next assignments", exact: true });
    for (let i = 1; i < 24; i++) await next.click();
    await expect(log.getByRole("navigation", { name: "Assignment pages" })).toContainText("24 / 24");
    await expect(next).toBeDisabled();
    const finalCard = log.locator(
      '[data-member-task="Completed assignment 0"]',
    );
    await finalCard.getByRole("button", { name: "Open", exact: true }).click();
    await expect(page.getByRole("dialog")).toContainText("Verify the routing");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await current.click();
    await expect(cards).toHaveCount(mode === "history" ? 0 : 5);
    if (mode !== "history") await expect(cards.first()).toBeInViewport();
    await expect(composer).toHaveValue("Keep my draft");
    const composerAfter = (await composer.boundingBox())!;
    expect(composerAfter.y).toBeCloseTo(composerBefore.y, 0);
    expect(composerAfter.y + composerAfter.height).toBeLessThanOrEqual(height);
    expect(
      await page
        .locator("[data-fixture-chat]")
        .evaluate((el) => el.clientHeight),
    ).toBeGreaterThan(height * 0.3);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    expect(
      await page.evaluate(() => document.scrollingElement!.scrollTop),
    ).toBe(0);
    await page.screenshot({
      path: testInfo.outputPath(`member-tasks-${mode}-${width}.png`),
    });
  });
}
