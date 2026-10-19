import { expect, test } from "@playwright/test";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
const frames = "test-results/ccvision-v2/frames";

test("compares approved decisions prototype", async ({ page }) => {
  await page.goto(pathToFileURL(resolve("../cc-program/vision/index.html")).href);
  await expect(page).toHaveTitle(/Command Map/);
  await page.screenshot({ path: `${frames}/prototype-map.png` });
  await page.goto(pathToFileURL(resolve("../cc-program/vision/workspace.html")).href);
  await expect(page.locator(".side")).toContainText("Search or ask the Boss");
  await page.getByText("Decisions", { exact: true }).click();
  await page.screenshot({ path: `${frames}/prototype-workspace.png` });
});

for (const [width, theme] of [[1440, "dark"], [860, "light"], [390, "dark"]] as const) {
  test(`actual App ingress/actions/answer consumer and reload ${width} ${theme}`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/*", route => new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort());
    await page.setViewportSize({ width, height: 950 });
    await page.goto(`/tests/browser/ccvision-v2.html?theme=${theme}`);
    await expect(page.getByRole("heading", { name: "Nothing needs your decision" })).toBeVisible();
    const everything = page.getByRole("button", { name: "Everything", exact: true });
    // A real keyboard-generated click is trusted even without an existing goal.
    await everything.focus(); await page.keyboard.press("Enter");
    await expect(everything).toHaveAttribute("aria-pressed", "true");
    expect(await page.evaluate(() => (window as any).decisionProof.goals.length)).toBe(0);
    await page.getByRole("button", { name: "Send original request", exact: true }).click();
    await page.getByRole("button", { name: "Receive authenticated team question", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Which parser approach?", exact: true })).toBeVisible();
    await expect(page.getByRole("complementary", { name: "Decision notifications" }).locator("p")).toHaveCount(1);
    await page.screenshot({ path: `${frames}/pending-${width}-${theme}.png` });
    expect(await page.evaluate(() => (window as any).decisionProof.goals.length)).toBe(1);
    await page.getByRole("button", { name: "Reuse the parser", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Nothing needs your decision" })).toBeVisible();
    await page.getByRole("button", { name: "Flush retained delivery", exact: true }).click();
    await expect.poll(() => page.evaluate(() => (window as any).decisionProof.sessions.find((session: any) => session.id === "worker-browser").queuedMessages?.length ?? 0)).toBe(1);
    await page.getByRole("button", { name: "Consume retained answer", exact: true }).click();
    await expect.poll(() => page.evaluate(() => (window as any).decisionProof.submissions)).toBe(1);
    await page.getByRole("button", { name: "Consume retained answer", exact: true }).click();
    expect(await page.evaluate(() => (window as any).decisionProof.submissions)).toBe(1);
    await page.reload();
    await page.getByRole("button", { name: "Decision log", exact: true }).click();
    await expect(page.locator(".decision-log")).toContainText("Reuse the parser");
    await expect(page.getByRole("complementary", { name: "Decision notifications" }).locator("p")).toHaveCount(0);
    const proof = await page.evaluate(() => {
      const proof = (window as any).decisionProof;
      return { goals: proof.goals.length, status: proof.ledger[0].status,
        internal: proof.sessions.find((session: any) => session.id === "worker-browser").blocks.filter((block: any) => block.monoDecision).map((block: any) => block.internal),
        queue: proof.sessions.find((session: any) => session.id === "worker-browser").queuedMessages };
    });
    expect(proof).toEqual({ goals: 1, status: "decided", internal: [true], queue: undefined });
    await page.screenshot({ path: `${frames}/log-${width}-${theme}.png` });
    expect(errors).toEqual([]);
  });
}

test("quarantine survives reload and actual trusted re-raise keeps the old ID non-authoritative", async ({ page }) => {
  await page.goto("/tests/browser/ccvision-v2.html?quarantine");
  await expect(page.getByText("Earlier decision history is unreadable", { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "View", exact: true }).click();
  await expect(page.getByText("Old unreadable question", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).decisionProof.ledger)).toEqual([]);
  await page.getByRole("button", { name: "Send original request", exact: true }).click();
  await page.getByRole("button", { name: "Ask the Manager to re-raise", exact: true }).click();
  await expect(page.getByText("Saved. Delivery follows the original work context.", { exact: true })).toBeVisible();
  const retained = await page.evaluate(() => (window as any).decisionProof.disk.engine.wakeState.events);
  expect(retained).toHaveLength(1);
  expect(retained[0].id).toMatch(/^decision-reraise:/);
  expect(retained[0].text).toContain("NEW decision ID");
  expect(await page.evaluate(() => (window as any).decisionProof.goals.length)).toBe(1);
  await page.getByRole("button", { name: "Receive authenticated team question", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Which parser approach?", exact: true })).toBeVisible();
  const ids = await page.evaluate(() => (window as any).decisionProof.ledger.map((decision: any) => decision.id));
  expect(ids).toEqual(["worker-browser:question"]);
  await page.reload();
  await expect(page.getByText("Earlier decision history is unreadable", { exact: true })).toBeVisible();
});
