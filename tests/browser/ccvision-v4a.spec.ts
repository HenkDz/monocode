import { expect, test, type Page } from "@playwright/test";
type Fixture = { calls: { command: string; args: Record<string, unknown> }[]; logs: string[]; answers: string[]; changed: boolean; pending: boolean; finish(): void };
const state = (page: Page) => page.evaluate(() => (window as unknown as { v4a: Fixture }).v4a);
const cards = (page: Page) => page.locator(".integration-request");

test("trusted Install locks duplicate cards, pins inspection, and succeeds despite log failure", async ({ page }) => {
  await page.goto("/tests/browser/ccvision-v4a.html?log-fails");
  const first = cards(page).nth(0), second = cards(page).nth(1);
  await first.getByRole("button", { name: "Inspect files", exact: true }).click();
  await second.getByRole("button", { name: "Inspect files", exact: true }).click();
  await expect(first).toContainText("SKILL.md · 12 bytes");
  await page.evaluate(() => { (window as unknown as { v4a: Fixture }).v4a.pending = true; });
  // Two trusted clicks in the same browser gesture still produce one native call.
  await first.getByRole("button", { name: "Install", exact: true }).dblclick();
  await expect(second.getByRole("button", { name: "Install", exact: true })).toBeDisabled();
  let observed = await state(page);
  const installs = observed.calls.filter(call => call.command === "install_project_skill");
  expect(installs).toHaveLength(1);
  expect(installs[0].args).toEqual({ project: "C:/synthetic/v4a-project", source: "C:/synthetic/local/fixture", name: "fixture", expectedProjectIdentity: "windows:1:2", expectedFingerprint: "a".repeat(64) });
  await page.evaluate(() => { (window as unknown as { v4a: Fixture }).v4a.finish(); });
  await expect(first.getByRole("status")).toHaveText("Installed in Synthetic project");
  await expect(second.getByRole("button", { name: "Install", exact: true })).toBeEnabled();
  observed = await state(page); expect(observed.logs).toHaveLength(1);
  expect(observed.logs[0]).toContain("Installed fixture in C:/synthetic/v4a-project · by you");
  await expect(page.getByText("Access request", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Connect", exact: true })).toHaveCount(0);
  await expect(page.getByText("Hidden MCP", { exact: true })).toHaveCount(0);
});

test("synthetic Install and Not now do not install; native fingerprint refusal stays visible", async ({ page }) => {
  await page.goto("/tests/browser/ccvision-v4a.html");
  const card = cards(page).nth(0);
  await card.getByRole("button", { name: "Inspect files", exact: true }).click();
  await card.getByRole("button", { name: "Install", exact: true }).evaluate(button => (button as HTMLButtonElement).click());
  await expect(card.getByRole("alert")).toContainText("button yourself");
  await cards(page).nth(1).getByRole("button", { name: "Not now", exact: true }).click();
  expect((await state(page)).answers).toEqual(["Not now"]);
  expect((await state(page)).calls.filter(call => call.command === "install_project_skill")).toHaveLength(0);
  await card.getByRole("button", { name: "Inspect files", exact: true }).click();
  await page.evaluate(() => { (window as unknown as { v4a: Fixture }).v4a.changed = true; });
  await card.getByRole("button", { name: "Install", exact: true }).click();
  await expect(card.getByRole("alert")).toContainText("source changed");
  await expect(card.getByRole("button", { name: "Install", exact: true })).toBeDisabled();
  expect((await state(page)).logs).toHaveLength(0);
  await card.getByRole("button", { name: "Not now", exact: true }).click();
  await expect(card.getByRole("status")).toHaveText("Not now");
  expect((await state(page)).calls.filter(call => call.command === "install_project_skill")).toHaveLength(1);
});

test("Remove first re-inspects the installed package then archives exact inspected bytes on trusted click", async ({ page }) => {
  await page.goto("/tests/browser/ccvision-v4a.html");
  const row = page.locator(".integration-row").filter({ hasText: "installed-fixture" });
  await row.getByRole("button", { name: "Inspect to remove", exact: true }).click();
  let observed = await state(page);
  expect(observed.calls).toEqual([{ command: "inspect_project_skill", args: { project: "C:/synthetic/v4a-project", source: "C:/synthetic/v4a-project/.agents/skills/installed-fixture", name: "installed-fixture" } }]);
  await row.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(row).toContainText("Removed from Synthetic project");
  observed = await state(page);
  expect(observed.calls.filter(call => call.command === "archive_project_skill")).toEqual([{ command: "archive_project_skill", args: { project: "C:/synthetic/v4a-project", name: "installed-fixture", expectedProjectIdentity: "windows:1:2", expectedFingerprint: "a".repeat(64) } }]);
  expect(observed.logs).toHaveLength(1);
});
