import { expect, test } from "@playwright/test";
const baseline = process.env.A8_BASELINE === "1";
test.beforeEach(async ({ page }) => {
  await page.route("**/*", route => new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort());
});
test("production callers isolate two checkouts, Changes and Create PR; update has no command", async ({ page }) => {
  await page.goto("/tests/browser/ccux1-a8.html?delay=yes");
  await expect.poll(() => page.evaluate(() => (window as any).a8Fixture.events.filter((e: any) => e.command === "git_diff_index").length)).toBe(1);
  await page.getByRole("button", { name: "Project 2", exact: true }).click();
  const panel = page.getByRole("tabpanel", { name: "Worktree", exact: true });
  await expect(panel).toContainText("current.tsx");
  await page.evaluate(() => (window as any).a8Fixture.finishOld());
  await expect(panel).not.toContainText("old.tsx");
  if (!baseline) await expect(panel).not.toContainText("C:/synthetic/");
  else await expect(panel).toContainText("C:/synthetic/browser-link-4/src/current.tsx");
  await panel.getByRole("button", { name: "Changes", exact: true }).click();
  await expect(page.locator("[data-changes-target]")).toContainText('"cwd":"C:/synthetic/browser-link-4"');
  await expect(page.locator("[data-changes-target]")).toContainText('"path":"C:/synthetic/browser-link-4"');
  await expect(panel.getByRole("button", { name: "Update from main", exact: true })).toBeDisabled();
  await panel.getByRole("button", { name: "Create PR", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Create pull request", exact: true });
  await expect(dialog.getByLabel("Base branch")).toHaveValue("main");
  await dialog.getByRole("button", { name: "Create PR", exact: true }).click();
  await expect(dialog).toContainText("Commit and publish this branch first");
  await page.evaluate(() => (window as any).a8Fixture.clean());
  await dialog.getByRole("button", { name: "Create PR", exact: true }).click();
  await expect(dialog).toContainText("Captured synthetic PR command");
  const events = await page.evaluate(() => (window as any).a8Fixture.events);
  expect(events.filter((e: any) => e.command === "sidebar-tab")).toEqual([{ command: "sidebar-tab", args: { tab: "changes", cwd: "C:/synthetic/browser-link-4" } }]);
  expect(events.filter((e: any) => e.command === "git_pr_create")).toEqual([{ command: "git_pr_create", args: { cwd: "C:/synthetic/browser-link-4", title: "feature/checkout", body: "", base: "main", head: "feature/checkout" } }]);
  expect(events.filter((e: any) => e.command.includes("update"))).toEqual([]);
  expect(events.filter((e: any) => e.command.startsWith("git_pr") || e.command === "git_diff_index").every((e: any) => ["C:/synthetic/browser-link-3", "C:/synthetic/browser-link-4"].includes(e.args.cwd))).toBe(true);
  console.log(JSON.stringify({ evidence: "A8 command targets", events }));
});
test("a project's linked main checkout keeps its concrete root for Changes", async ({ page }) => {
  await page.goto("/tests/browser/ccux1-a8.html?linked=yes");
  await page.getByRole("button", { name: "Project 2", exact: true }).click();
  await page.getByRole("button", { name: "Worktree main", exact: true }).click();
  const panel = page.getByRole("tabpanel", { name: "Worktree", exact: true });
  await expect(panel).toContainText("old.tsx");
  if (!baseline) {
    await expect(panel).toContainText("Lives in C:/synthetic/browser-link-3 (the repo's main checkout)");
    await expect(page.getByRole("button", { name: "Worktree main", exact: true })).toContainText("outside project");
  }
  await panel.getByRole("button", { name: "Changes", exact: true }).click();
  await expect(page.locator("[data-changes-target]")).toContainText('"cwd":"C:/synthetic/browser-link-3"');
  await expect(page.locator("[data-changes-target]")).toContainText('"projectCwd":"C:/synthetic/browser-link-4"');
  await expect(panel.getByRole("button", { name: "Update from main", exact: true })).toBeDisabled();
});
for (const width of [390, 1440]) for (const theme of ["dark", "light"]) test(`selected checkout panel ${width} ${theme}`, async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.setViewportSize({ width, height: 1000 });
  await page.goto(`/tests/browser/ccux1-a8.html?theme=${theme}&outside=yes&linked=yes`);
  await page.getByRole("button", { name: "Project 2", exact: true }).click();
  const panel = page.getByRole("tabpanel", { name: "Worktree", exact: true });
  await expect(panel).toContainText("current.tsx");
  if (!baseline) {
    await expect(panel).toContainText("No pull request yet");
    await expect(panel.getByRole("button", { name: /current.tsx/ })).not.toContainText("C:/synthetic/browser-link-4");
    await expect(panel.getByRole("button", { name: /foreign.ts/ })).toHaveAttribute("title", "C:/synthetic/browser-link-3-other/foreign.ts");
    await expect(panel.locator('[data-file-status="modified"]')).toHaveCount(2);
    await expect(panel.locator('[data-file-status="added"]')).toHaveCount(1);
    await expect(panel.locator('[data-file-status="deleted"]')).toHaveCount(1);
  }
  expect(await panel.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.screenshot({ path: `test-results/ccux1-a8${baseline ? "-baseline" : ""}/frames/${baseline ? "baseline" : "fixed"}-${width}-${theme}.png` });
  if (!baseline) {
    await page.getByRole("button", { name: "Worktree main", exact: true }).click();
    await expect(panel).toContainText("Lives in C:/synthetic/browser-link-3 (the repo's main checkout)");
    await expect(panel.getByRole("button", { name: /old.tsx/ })).toBeVisible();
    expect(await panel.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.screenshot({ path: `test-results/ccux1-a8/frames/outside-${width}-${theme}.png` });
  }
  expect(errors).toEqual([]);
});
