import { expect, test } from "@playwright/test";

test.setTimeout(120_000);

for (const width of [1440, 1100, 390]) {
  for (const theme of ["dark", "light"]) {
    test(`Workbench drawers keep their facts and pointer actions in view at ${width}px ${theme}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.addInitScript(() => {
        Object.assign(window, { copiedDetails: "" });
        Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (text: string) => Object.assign(window, { copiedDetails: text }) } });
      });
      await page.goto(`/tests/browser/cc7u-workbench.html?scenario=failed&theme=${theme}`, { waitUntil: "commit" });
      const header = page.locator("[data-workbench-header]");
      await expect(header).toBeVisible({ timeout: 90_000 });
      const details = header.getByRole("button", { name: "Details", exact: true });
      await details.click();
      const drawer = page.locator('[role="dialog"].cc7u-drawer');
      await expect(drawer).toBeVisible();
      const geometry = await drawer.evaluate(element => {
        const panel = element.getBoundingClientRect(), wrapper = element.parentElement!;
        return { x: panel.x, y: panel.y, right: panel.right, bottom: panel.bottom, translate: getComputedStyle(wrapper).translate };
      });
      expect(geometry.x).toBeGreaterThanOrEqual(0);
      expect(geometry.y).toBe(0);
      expect(geometry.right).toBe(width);
      expect(geometry.bottom).toBe(1000);
      expect(geometry.translate).toBe("none");
      await expect(drawer.locator("dt").first()).toBeInViewport({ ratio: 1 });
      await testInfo.attach("session-details", { body: await page.screenshot(), contentType: "image/png" });
      await drawer.getByRole("button", { name: "Close", exact: true }).click();
      await expect(details).toBeFocused();
      if (width === 390) await page.locator(".cc7u-work-toggle").click();
      const errorDetails = page.getByRole("button", { name: "Error details", exact: true });
      await errorDetails.click();
      const copy = drawer.getByRole("button", { name: "Copy details", exact: true });
      await expect(copy).toBeInViewport({ ratio: 1 });
      await copy.click();
      expect(await page.evaluate(() => (window as unknown as { copiedDetails: string }).copiedDetails)).toContain("SQLITE_BUSY");
      await testInfo.attach("error-details", { body: await page.screenshot(), contentType: "image/png" });
      await page.keyboard.press("Escape");
      await expect(drawer).toHaveCount(0);
      await expect(errorDetails).toBeFocused();
    });
  }
}

for (const theme of ["dark", "light"]) {
  test(`saved full output supports selection of actual rendered glyphs in ${theme}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`/tests/browser/cc7u-workbench.html?scenario=failed&kind=historical-session&theme=${theme}`, { waitUntil: "commit" });
    await expect(page.locator("[data-workbench-header]")).toBeVisible({ timeout: 90_000 });
    const opener = page.getByLabel("Tool call: Read window lifecycle and routing", { exact: true }).locator("..").getByRole("button", { name: "View full output", exact: true });
    await opener.click();
    const pre = page.getByRole("dialog").locator("pre");
    await expect(pre).toContainText("3 files read.");
    const point = await pre.evaluate(element => {
      const text = element.firstChild!, start = text.textContent!.indexOf("files");
      const range = document.createRange();
      range.setStart(text, start);
      range.setEnd(text, start + 5);
      const box = range.getBoundingClientRect();
      const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      return { ...point, ownsPointer: element.contains(document.elementFromPoint(point.x, point.y)) };
    });
    expect(point.ownsPointer).toBe(true);
    expect(await pre.evaluate(element => getComputedStyle(element).userSelect)).toBe("text");
    await page.mouse.click(point.x, point.y, { clickCount: 2 });
    expect(await page.evaluate(() => getSelection()?.toString())).toContain("files");
    await testInfo.attach("selected-output", { body: await page.screenshot(), contentType: "image/png" });
    await page.keyboard.press("Escape");
    await expect(opener).toBeFocused();
  });
}

for (const reuse of [false, true]) {
  test(`retired assignment returns focus to its filter and never opens reused identity (${reuse})`, async ({ page }) => {
    await page.goto("/tests/browser/member-tasks.html", { waitUntil: "commit" });
    const card = page.locator('[data-member-task="Waiting for your decision"]');
    await expect(card).toBeVisible({ timeout: 90_000 });
    await card.getByRole("button", { name: "Open", exact: true }).click();
    await expect(page.getByRole("dialog")).toContainText("Verify the routing and report the result.");
    await page.evaluate(reuse => (window as unknown as { retireFixtureTask: (id: string, reuse: boolean) => void }).retireFixtureTask("Waiting for your decision", reuse), reuse);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("tab", { name: "Current", exact: true })).toBeFocused();
    await expect(page.locator("body")).not.toContainText("Other Manager's assignment");
    await expect(page.getByRole("textbox", { name: "Message Rowan", exact: true })).toHaveValue("Keep my draft");
  });
}
