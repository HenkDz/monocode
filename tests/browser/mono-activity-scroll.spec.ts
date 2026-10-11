import { expect, test } from "@playwright/test";

for (const mode of ["work", "solo", "team"]) {
  test(`mouse wheel scrolls ${mode} Activity content`, async ({ page }) => {
    await page.goto(`/tests/browser/mono-activity.html?mode=${mode}`, {
      waitUntil: "commit",
    });
    const panel = page.locator(mode === "work" ? "[data-mono-work]" : "aside");
    const scroller = panel.locator(".overflow-y-auto").first();
    await expect(scroller).toBeVisible();
    if (mode === "work")
      await expect
        .poll(() =>
          panel.evaluate((el) => getComputedStyle(el.parentElement!).transform),
        )
        .toBe("none");
    await page.evaluate(() => document.fonts.ready);
    await expect
      .poll(() => scroller.evaluate((el) => el.scrollHeight - el.clientHeight))
      .toBeGreaterThan(400);
    const box = (await scroller.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + 160);
    await page.mouse.wheel(0, 400);
    await expect
      .poll(() => scroller.evaluate((el) => el.scrollTop))
      .toBeGreaterThan(200);
    await page.mouse.wheel(0, -400);
    await expect
      .poll(() => scroller.evaluate((el) => el.scrollTop))
      .toBeLessThanOrEqual(1);
    expect(
      await page.evaluate(() => document.scrollingElement!.scrollTop),
    ).toBe(0);
  });
}

test("deletion can minimize while only its branch is disabled", async ({
  page,
}, testInfo) => {
  await page.goto("/tests/browser/mono-activity.html?mode=delete", {
    waitUntil: "commit",
  });
  const remove = page.getByRole("button", {
    name: "Delete worktree",
    exact: true,
  });
  await expect(remove).toBeEnabled();
  await remove.click();
  await expect(page.getByRole("dialog")).toHaveAttribute("aria-modal", "false");
  await expect(page.locator(".modal-backdrop")).toHaveCount(0);
  await page.getByRole("group", { name: "Worktree filter" }).getByRole("button", { name: "All", exact: true }).click();
  const other = page.getByRole("button", {
    name: "Open worktree other",
    exact: true,
  });
  await other.click();
  await expect(
    page.getByText("Other worktree opened", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Minimize", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".modal-backdrop")).toHaveCount(0);
  await expect(page.getByRole("status")).toContainText("Deleting worktree");
  const branch = page.locator('[data-worktree="/fixture/worktree"]');
  await expect(
    branch.locator('button[aria-label="Open worktree feature"]'),
  ).toBeDisabled();
  await expect(branch).toContainText("Deleting…");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  expect(
    await branch
      .locator(".rounded-full svg")
      .evaluate((el) => getComputedStyle(el).animationName),
  ).toBe("spin");
  await branch.screenshot({ path: testInfo.outputPath("deleting-branch.png") });
  await page
    .getByRole("button", { name: "Show progress", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveAttribute("aria-modal", "false");
  await page.getByRole("button", { name: "Minimize", exact: true }).click();
  await other.click();
  await page.evaluate(() =>
    (window as unknown as { completeDeletion: () => void }).completeDeletion(),
  );
  await expect(page.getByRole("status")).toHaveCount(0);
  await expect(
    branch.locator('button[aria-label="Open worktree feature"]'),
  ).toBeEnabled();
  await expect(
    page.getByText("Worktree deleted", { exact: true }),
  ).toBeVisible();
});
