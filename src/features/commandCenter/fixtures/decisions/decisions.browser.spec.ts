import { expect, test } from "@playwright/test";
import { join } from "node:path";
test.beforeEach(async ({ page }) => { await page.goto("/"); await expect(page.getByRole("heading", { name: "Should we reuse the existing queue?" })).toBeVisible(); });
test("real click sends one ordinary queued user message; synthetic click sends nothing", async ({ page }) => {
  const option = page.getByRole("button", { name: "Reuse the existing queue Recommended" });
  await option.dispatchEvent("click");
  await expect(page.getByRole("alert")).toContainText("Couldn't reach Atlas");
  expect(await page.evaluate(() => window.decisionFixture.sends.length)).toBe(0);
  await option.dblclick();
  await expect(page.getByRole("status")).toContainText("Sent to Atlas");
  const sends = await page.evaluate(() => window.decisionFixture.sends);
  expect(sends).toEqual([{ sessionId: "worker-chat", text: 'Decision on your question "Should we reuse the existing queue?": go with "Reuse the existing queue".', attachments: [] }]);
  const queue = await page.evaluate(() => window.decisionFixture.queue());
  expect(queue?.queuedMessages).toHaveLength(1);
  expect(queue?.blocks[queue.blocks.length - 1]).toMatchObject({ role: "user", text: sends[0].text });
});
test("normal refusal or missing chat leaves a visible retry; moved/stopped chat retains normal queue behavior", async ({ page }) => {
  const option = page.getByRole("button", { name: "Reuse the existing queue Recommended" });
  await page.evaluate(() => window.decisionFixture.mode("missing")); await option.click();
  await expect(page.getByRole("alert")).toContainText("Couldn't reach Atlas");
  await page.evaluate(() => window.decisionFixture.mode("refuse")); await option.click();
  await expect(page.getByRole("alert")).toContainText("Couldn't reach Atlas");
  expect(await page.evaluate(() => window.decisionFixture.sends.length)).toBe(0);
  await page.evaluate(() => { window.decisionFixture.mode("normal"); window.decisionFixture.moved(); window.decisionFixture.pause(); });
  await option.click();
  await expect.poll(() => page.evaluate(() => window.decisionFixture.sends.length)).toBe(1);
  expect(await page.evaluate(() => window.decisionFixture.queue())).toMatchObject({ id: "worker-chat", cwd: "/synthetic/moved", queueStatus: "paused" });
  expect(await page.evaluate(() => window.decisionFixture.queueReady())).toEqual({ dispatch: false, steer: false });
  await page.evaluate(() => window.decisionFixture.typed("Typed follow-up"));
  expect(await page.evaluate(() => window.decisionFixture.queue()?.queuedMessages?.length)).toBe(2);
  await page.evaluate(() => window.decisionFixture.continueQueue());
  expect(await page.evaluate(() => window.decisionFixture.queueReady())).toEqual({ dispatch: true, steer: false });
});
test("delegation sends to the Boss normally, protected classes hide it, Boss replies are logged, autonomy needs a real click", async ({ page }) => {
  await expect(page.getByRole("button", { name: "Let the Boss decide" })).toHaveCount(1);
  const policy = page.getByRole("button", { name: "Everything", exact: true });
  await policy.dispatchEvent("click"); expect(await page.evaluate(() => window.decisionFixture.autonomy())).toBe("high-impact-only");
  await policy.click(); await expect(policy).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Let the Boss decide" }).click();
  await expect.poll(() => page.evaluate(() => window.decisionFixture.sends.length)).toBe(1);
  expect((await page.evaluate(() => window.decisionFixture.sends))[0]).toMatchObject({ sessionId: "boss-chat" });
  await page.evaluate(() => window.decisionFixture.bossReply());
  await page.getByRole("button", { name: "Decision log", exact: true }).click();
  await expect(page.locator(".decision-log")).toContainText("Boss");
  await expect(page.locator(".decisions-handled")).toContainText("1 decided by the team today");
});
test("inspectable dark, light and narrow frames preserve readable cards and log", async ({ page }) => {
  for (const [name, url, width] of [["dark", "/", 1280], ["light", "/?theme=light", 1280], ["narrow", "/?rail=1", 390]] as const) {
    await page.setViewportSize({ width, height: 1000 }); await page.goto(url);
    await expect(page.locator(".decision-card")).toHaveCount(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: join(process.env.CCV2_EVIDENCE_DIR!, `${name}.png`), fullPage: true });
  }
  await page.evaluate(() => window.decisionFixture.finish());
  await page.getByRole("button", { name: "Decision log", exact: true }).click();
  await expect(page.locator(".decision-log")).toContainText("No longer needed");
  await page.screenshot({ path: join(process.env.CCV2_EVIDENCE_DIR!, "log.png"), fullPage: true });
});
