import { expect, test } from "@playwright/test";
const fixture = "/tests/browser/ccgoal-authorized-work.html";

test("direct Manager design -> persisted digest -> implementation, foreign refusal, Mission navigation and Stop", async ({ page }, info) => {
  await page.goto(fixture);
  await expect(page.getByRole("heading", { name: "Browser Link Manager" })).toBeVisible();
  await page.evaluate(() => (window as any).ccgoal.designs());
  await expect.poll(() => page.evaluate(() => (window as any).ccgoal.snapshot().runs[0].tasks.length)).toBe(2);
  await page.evaluate(() => (window as any).ccgoal.digest());
  await page.evaluate(() => (window as any).ccgoal.restart());
  await page.reload();
  await expect(page.getByRole("heading", { name: "Browser Link Manager" })).toBeVisible();
  await page.evaluate(() => (window as any).ccgoal.consumeDigest());
  const foreign = await page.evaluate(async () => { try { await (window as any).ccgoal.foreign(); return "allowed"; } catch (error) { return String(error); } });
  expect(foreign).toContain("one-click confirmation");
  await page.evaluate(() => (window as any).ccgoal.implementation());
  await expect.poll(() => page.evaluate(() => (window as any).ccgoal.snapshot().runs[0].tasks.length)).toBe(3);
  const snapshot = await page.evaluate(() => (window as any).ccgoal.snapshot());
  expect(snapshot.goals).toHaveLength(1);
  expect(snapshot.goals[0].userMessageId).toBe("original-request");
  expect(snapshot.runs[0].tasks.every((task: any) => task.monoGoalId === snapshot.goals[0].id)).toBe(true);
  expect(snapshot.grandProjects[0].path).toBe("/browser-link-4");
  await page.getByRole("button", { name: "Mission control", exact: true }).click();
  await expect(page.getByText("have bot features built robustly").first()).toBeVisible();
  await page.getByRole("button", { name: /^have bot features built robustly/ }).click();
  await expect(page.getByRole("button", { name: "Open Browser Link Manager", exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath("authorized-flow.png"), fullPage: true });
  await page.getByRole("button", { name: "Open Browser Link Manager", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Browser Link Manager" })).toBeVisible();
  await page.evaluate(() => (window as any).ccgoal.stop());
  expect(await page.evaluate(() => (window as any).ccgoal.snapshot().goals[0].state)).toBe("cancelled");
});

for (const surface of ["conversation", "attention"]) test(`unanchored event -> one-click Continue from ${surface} -> one implementation`, async ({ page }, info) => {
  await page.goto(fixture + "?theme=light");
  await expect(page.getByRole("heading", { name: "Browser Link Manager" })).toBeVisible();
  expect(await page.evaluate(() => (window as any).ccgoal.unanchored())).toContain("one-click confirmation");
  if (surface === "attention") await page.getByRole("button", { name: "Attention", exact: true }).click();
  await expect(page.getByRole("button", { name: "Continue this request", exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath(`continue-${surface}.png`), fullPage: true });
  await page.getByRole("button", { name: "Continue this request", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).ccgoal.snapshot().session.queuedMessages?.length)).toBe(1);
  await page.evaluate(() => (window as any).ccgoal.consumeContinue());
  await expect.poll(() => page.evaluate(() => (window as any).ccgoal.snapshot().runs[0].tasks.length)).toBe(1);
  const snapshot = await page.evaluate(() => (window as any).ccgoal.snapshot());
  expect(snapshot.events.filter((event: any) => event.action === "goal-delivered")).toHaveLength(1);
  expect(snapshot.goals).toHaveLength(1);
  expect(snapshot.runs[0].tasks[0].monoGoalId).toBe(snapshot.goals[0].id);
});
