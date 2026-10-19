import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
type State = { calls: { command: string; args: Record<string, unknown> }[]; sends: { id: string; text: string }[]; pending: boolean; fingerprint: string; logFails: boolean; finish(): void; logs(): { kind: string; requiresReply: boolean; summary: string }[] };
const state = (page: Page) => page.evaluate(() => { const value = (window as unknown as { actualV4a: State }).actualV4a; return { calls: value.calls, sends: value.sends, logs: value.logs() }; });
const nav = (page: Page, name: string) => page.getByRole("navigation", { name: "Workspace" }).getByRole("button", { name, exact: true });
const firstAsk = (page: Page) => page.locator(".decision-card").filter({ has: page.getByRole("heading", { name: "Install fixture?", exact: true }) });
const installs = (value: Awaited<ReturnType<typeof state>>) => value.calls.filter(call => call.command === "install_project_skill");

test("actual App Ask renderer keeps native double-click isolated from the next protected answer; ordinary answers never install", async ({ page }) => {
  await page.goto("/tests/browser/ccvision-v4a-actual.html"); await nav(page, "Decisions").click();
  const card = firstAsk(page), installCard = card.locator(".integration-request");
  await expect(card.locator(".decision-context")).toHaveText("Inspect this local package to read the project");
  const legacy = page.locator(".decision-card").filter({ has: page.getByRole("heading", { name: "Install legacy prose?", exact: true }) });
  await expect(legacy.locator(".integration-request")).toHaveCount(0);
  await installCard.getByRole("button", { name: "Inspect files", exact: true }).click();
  await installCard.getByRole("button", { name: "Install", exact: true }).dblclick();
  await expect(installCard.getByRole("status")).toHaveText("Installed in browser-link-4");
  expect(installs(await state(page))).toHaveLength(1); expect((await state(page)).sends).toHaveLength(0);
  await card.getByRole("button", { name: "Review install", exact: true }).dblclick();
  await expect.poll(async () => (await state(page)).sends.length).toBe(1);
  const protectedCard = page.locator(".decision-card").filter({ has: page.getByRole("heading", { name: "Send a project update?", exact: true }) });
  await protectedCard.getByRole("button", { name: "Review update", exact: true }).click();
  await expect.poll(async () => (await state(page)).sends.length).toBe(2);
  expect(installs(await state(page))).toHaveLength(1);
});

test("actual App page locks duplicate cards and refreshes real rows after native success despite activity-log failure, then archives safely", async ({ page }) => {
  await page.goto("/tests/browser/ccvision-v4a-actual.html?duplicate"); await nav(page, "Integrations").click();
  const cards = page.locator(".integration-request"), first = cards.nth(0), second = cards.nth(1);
  await first.getByRole("button", { name: "Inspect files", exact: true }).click();
  await second.getByRole("button", { name: "Inspect files", exact: true }).click();
  await page.evaluate(() => { const value = (window as unknown as { actualV4a: State }).actualV4a; value.pending = true; value.logFails = true; });
  await first.getByRole("button", { name: "Install", exact: true }).dblclick();
  await expect(second.getByRole("button", { name: "Install", exact: true })).toBeDisabled();
  expect(installs(await state(page))).toEqual([{ command: "install_project_skill", args: { project: "C:/synthetic/browser-link-4", name: "fixture", source: "C:/synthetic/source/fixture", expectedProjectIdentity: "windows:1:2", expectedFingerprint: "a".repeat(64) } }]);
  await page.evaluate(() => { (window as unknown as { actualV4a: State }).actualV4a.finish(); });
  await expect(first.getByRole("status")).toHaveText("Installed in browser-link-4");
  const row = page.locator(".integration-row").filter({ hasText: "fixture" });
  await expect(row).toHaveCount(1); await expect(second.getByRole("status")).toHaveText("Installed in browser-link-4");
  await expect(page.getByText("Available to Atlas", { exact: true })).toHaveCount(0);
  expect((await state(page)).logs).toHaveLength(0); expect((await state(page)).sends).toHaveLength(0);
  await page.evaluate(() => { (window as unknown as { actualV4a: State }).actualV4a.logFails = false; });
  await row.getByRole("button", { name: "Inspect to remove", exact: true }).click();
  await row.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(page.locator(".integration-row").filter({ hasText: "fixture" })).toHaveCount(0);
  await expect(first.getByRole("button", { name: "Inspect files", exact: true })).toBeEnabled();
  const observed = await state(page); expect(observed.calls.filter(call => call.command === "archive_project_skill")).toEqual([{ command: "archive_project_skill", args: { project: "C:/synthetic/browser-link-4", name: "fixture", expectedProjectIdentity: "windows:1:2", expectedFingerprint: "a".repeat(64) } }]);
  expect(observed.logs).toHaveLength(1); expect(observed.logs[0]).toMatchObject({ kind: "info", requiresReply: false });
});

test("actual App adapter refuses synthetic install, preserves fingerprint refusal/retry, and Not now only sends an ordinary answer", async ({ page }) => {
  await page.goto("/tests/browser/ccvision-v4a-actual.html?duplicate"); await nav(page, "Decisions").click();
  const card = firstAsk(page).first().locator(".integration-request");
  await card.getByRole("button", { name: "Inspect files", exact: true }).click();
  await card.getByRole("button", { name: "Install", exact: true }).evaluate(button => (button as HTMLButtonElement).click());
  await expect(card.getByRole("alert")).toContainText("button yourself"); expect(installs(await state(page))).toHaveLength(0);
  await card.getByRole("button", { name: "Inspect files", exact: true }).click();
  await page.evaluate(() => { (window as unknown as { actualV4a: State }).actualV4a.fingerprint = "b".repeat(64); });
  await card.getByRole("button", { name: "Install", exact: true }).click();
  await expect(card.getByRole("alert")).toContainText("source changed"); expect((await state(page)).logs).toHaveLength(0);
  await card.getByRole("button", { name: "Inspect files", exact: true }).click();
  await card.getByRole("button", { name: "Install", exact: true }).click();
  await expect(card.getByRole("status")).toHaveText("Installed in browser-link-4");
  expect(installs(await state(page)).at(-1)!.args.expectedFingerprint).toBe("b".repeat(64));
  await firstAsk(page).nth(1).locator(".integration-request").getByRole("button", { name: "Not now", exact: true }).click();
  await expect.poll(async () => (await state(page)).sends.length).toBe(1);
  expect(installs(await state(page))).toHaveLength(2);
  await nav(page, "Integrations").click();
  expect((await state(page)).sends[0].text).toContain("Not now");
  await expect(page.locator(".integration-row").filter({ hasText: "fixture" })).toHaveCount(1);
});

test("Integrations is reachable without pending asks; exact selected consumer proof and real writer are visible in prototype frames", async ({ page }) => {
  await page.goto("/tests/browser/ccvision-v4a-actual.html?empty"); await nav(page, "Integrations").click();
  await expect(page.getByRole("heading", { name: "Integrations", exact: true })).toBeVisible();
  await expect(page.locator(".integration-request")).toHaveCount(0);
  const frames = resolve("test-results/ccvision-v4a-actual-frames"); mkdirSync(frames, { recursive: true });
  for (const [width, theme] of [[1600, "dark"], [390, "light"]] as const) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(`/tests/browser/ccvision-v4a-actual.html?selected&theme=${theme}`); await nav(page, "Integrations").click();
    const card = page.locator(".integration-request");
    await card.getByRole("button", { name: "Inspect files", exact: true }).click();
    await card.getByRole("button", { name: "Install", exact: true }).click();
    await expect(page.getByText("Available to Atlas", { exact: true })).toBeVisible();
    const observed = await state(page); expect(observed.sends).toHaveLength(0); expect(observed.logs).toHaveLength(1);
    expect(observed.logs[0].summary).toContain("Installed fixture in C:/synthetic/browser-link-4 · by you");
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("monocode:mono-roster")!).find((mono: { id: string }) => mono.id === "worker").skillsPolicy)).toEqual({ mode: "custom", enabled: ["fixture-id"] });
    for (const text of ["Connect", "Access request", "delivery unverified"]) await expect(page.getByText(text, { exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: resolve(frames, `integrations-${width}-${theme}.png`), fullPage: true });
  }
});
