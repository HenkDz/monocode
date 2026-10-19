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
  await page.getByRole("link", { name: /Decisions/ }).click();
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
    await page.screenshot({ path: `${frames}/keyboard-autonomy-${width}-${theme}.png` });
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

test("actual trusted Continue permits new original-goal questions and refuses old answers after Stop and reload", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto("/tests/browser/ccvision-v2-continuation.html");
  await page.getByRole("button", { name: "Unrelated control", exact: true }).click();
  await expect(page.getByRole("status").last()).toContainText("recent direct gesture");
  await page.getByRole("button", { name: "Wrong run control", exact: true }).click();
  await expect(page.getByRole("status").last()).toContainText("recent direct gesture");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).continuationProof.run.status)).toBe("active");
  await page.getByRole("button", { name: "Receive current Manager question", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).continuationProof.decisions.length)).toBe(1);
  await page.getByRole("button", { name: "Stop Manager", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).continuationProof.decisions[0].deliveryState)).toBe("stale");
  const old = await page.evaluate(() => (window as any).continuationProof.decisions[0]);
  const blocked = await page.evaluate(async () => {
    const proof = (window as any).continuationProof;
    return Promise.all([proof.programmatic(), proof.forged()].map(async (work: Promise<unknown>) => { try { await work; return "accepted"; } catch (error) { return String(error); } }));
  });
  expect(blocked.every(message => message !== "accepted")).toBe(true);
  const proceed = page.getByRole("button", { name: "Continue", exact: true });
  await expect(proceed).toBeEnabled(); await proceed.focus(); await page.keyboard.press("Enter");
  await expect.poll(() => page.evaluate(() => (window as any).continuationProof.run.status)).toBe("active");
  await page.getByRole("button", { name: "Receive current Manager question", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).continuationProof.decisions.length)).toBe(2);
  const current = await page.evaluate(() => (window as any).continuationProof.decisions[1]);
  expect(current.identity.goalId).toBe(old.identity.goalId); expect(current.identity.generation).toBeGreaterThan(old.identity.generation);
  await page.getByRole("button", { name: "Try old answer", exact: true }).click();
  await expect(page.getByRole("status").last()).toContainText("retired");
  expect(await page.evaluate(() => (window as any).continuationProof.decisions[0].status)).toBe(old.status);
  await page.getByRole("button", { name: "Stop Manager", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).continuationProof.run.status)).toBe("paused");
  await page.reload();
  await expect(page.getByRole("button", { name: "Continue", exact: true })).toBeEnabled();
  expect(await page.evaluate(() => (window as any).continuationProof.publications)).toEqual([]);
  expect(await page.evaluate(() => (window as any).continuationProof.run.status)).toBe("paused");
  expect(errors).toEqual([]);
});

for (const gesture of ["click", "Enter"] as const) test(`actual committed Manager Send requires one trusted ${gesture} and persists exactly one user block`, async ({ page }) => {
  await page.goto("/tests/browser/ccvision-v2-continuation.html");
  const field = page.getByRole("textbox", { name: "Message Manager", exact: true });
  await field.fill(`Continue current bounded work by ${gesture}`);
  if (gesture === "click") await page.getByRole("button", { name: "Send", exact: true }).click(); else await field.press("Enter");
  await expect.poll(() => page.evaluate(() => (window as any).continuationProof.publications.length)).toBe(1);
  const proof = await page.evaluate(() => {
    const p = (window as any).continuationProof;
    return { status: p.run.status, active: p.run.decisionContinuedAt, pending: p.run.decisionContinuePendingAt,
      stage: p.stageSaves, activated: p.activeSaves, blocks: p.disk["manager-continuation"].blocks.filter((block: any) => block.role === "user") };
  });
  expect(proof.status).toBe("active"); expect(proof.active).toBeGreaterThan(0); expect(proof.pending).toBeUndefined();
  expect(proof.stage).toBeGreaterThan(0); expect(proof.activated).toBeGreaterThan(0); expect(proof.blocks).toHaveLength(2);
  expect(proof.blocks[1].text).toBe(`Continue current bounded work by ${gesture}`); expect(proof.blocks[1].internal).toBeUndefined();
  expect(await page.evaluate(() => { try { (window as any).continuationProof.replay(); return "accepted"; } catch (error) { return String(error); } })).toContain("recent direct gesture");
  await page.getByRole("button", { name: "Stop Manager", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).continuationProof.run.status)).toBe("paused");
  const epoch = await page.evaluate(() => (window as any).continuationProof.run.decisionContinuedAt);
  await page.evaluate(async () => { try { await (window as any).continuationProof.peerSend(); } catch {} });
  expect(await page.evaluate(() => (window as any).continuationProof.run.decisionContinuedAt)).toBe(epoch);
  expect(await page.evaluate(() => (window as any).continuationProof.publications.length)).toBe(1);
  await page.reload();
  await expect(page.getByRole("button", { name: "Continue", exact: true })).toBeEnabled();
  await page.evaluate(async () => { try { await (window as any).continuationProof.peerSend(); } catch {} });
  expect(await page.evaluate(() => (window as any).continuationProof.publications)).toEqual([]);
});

test("actual activation stays paused and refuses questions between commit and readback", async ({ page }) => {
  await page.goto("/tests/browser/ccvision-v2-continuation.html");
  await page.evaluate(() => (window as any).continuationProof.mode("activation-read"));
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).continuationProof.readWaiting)).toBe(true);
  expect(await page.evaluate(() => (window as any).continuationProof.run.status)).toBe("paused");
  await page.getByRole("button", { name: "Receive current Manager question", exact: true }).click();
  await expect(page.getByRole("status").last()).toContainText("unambiguous original goal");
  expect(await page.evaluate(() => (window as any).continuationProof.decisions)).toEqual([]);
  expect(await page.evaluate(() => (window as any).continuationProof.publications)).toEqual([]);
  await page.evaluate(() => { const proof = (window as any).continuationProof; proof.mode("normal"); proof.releaseRead(); });
  // The attempted synthetic turn changed the recipient; activation must refuse rather than publish.
  await expect.poll(() => page.evaluate(() => (window as any).continuationProof.run.status)).toBe("paused");
  expect(await page.evaluate(() => (window as any).continuationProof.publications)).toEqual([]);
});

test("actual Continue versus Stop during probe clears pending on disk and reload accepts a fresh gesture", async ({ page }) => {
  await page.goto("/tests/browser/ccvision-v2-continuation.html");
  await page.evaluate(() => (window as any).continuationProof.mode("probe"));
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).continuationProof.probeWaiting)).toBe(true);
  await page.getByRole("button", { name: "Stop Manager", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).continuationProof.disk.engine.decisionContinuePendingAt)).toBeUndefined();
  await page.evaluate(() => { const proof = (window as any).continuationProof; proof.mode("normal"); proof.releaseProbe(); });
  await expect(page.getByRole("button", { name: "Continue", exact: true })).toBeEnabled();
  expect(await page.evaluate(() => (window as any).continuationProof.publications)).toEqual([]);
  await page.reload();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).continuationProof.run.status)).toBe("active");
  expect(await page.evaluate(() => (window as any).continuationProof.publications.length)).toBe(1);
});

for (const failure of ["stage-save-fail", "stage-read-fail"] as const) test(`actual ${failure} leaves continuation inert and recoverable after reload`, async ({ page }) => {
  await page.goto("/tests/browser/ccvision-v2-continuation.html");
  await page.evaluate(mode => (window as any).continuationProof.mode(mode), failure);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("unavailable");
  expect(await page.evaluate(() => (window as any).continuationProof.publications)).toEqual([]);
  expect(await page.evaluate(() => (window as any).continuationProof.run.status)).toBe("paused");
  await page.reload();
  await expect(page.getByRole("button", { name: "Continue", exact: true })).toBeEnabled();
  expect(await page.evaluate(() => (window as any).continuationProof.publications)).toEqual([]);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).continuationProof.publications.length)).toBe(1);
});

for (const changed of ["account", "home", "generation", "original", "disk-original", "goal", "owner", "receipt"] as const) test(`actual Continue refuses ${changed} changes across the provider probe`, async ({ page }) => {
  await page.goto("/tests/browser/ccvision-v2-continuation.html");
  await page.evaluate(() => (window as any).continuationProof.mode("probe"));
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).continuationProof.probeWaiting)).toBe(true);
  await page.evaluate(kind => { const proof = (window as any).continuationProof; proof.mutate(kind); proof.mode("normal"); proof.releaseProbe(); }, changed);
  await expect(page.getByRole("alert")).toBeVisible();
  expect(await page.evaluate(() => (window as any).continuationProof.run.status)).toBe("paused");
  expect(await page.evaluate(() => (window as any).continuationProof.publications)).toEqual([]);
  expect(await page.evaluate(() => (window as any).continuationProof.activeSaves)).toBe(0);
});

test("actual trusted gesture expires while a continuation is still preparing", async ({ page }) => {
  await page.goto("/tests/browser/ccvision-v2-continuation.html");
  await page.evaluate(() => (window as any).continuationProof.mode("probe"));
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).continuationProof.probeWaiting)).toBe(true);
  await page.evaluate(() => {
    const now = Date.now.bind(Date); Date.now = () => now() + 5001;
    const proof = (window as any).continuationProof; proof.mode("normal"); proof.releaseProbe();
  });
  await expect(page.getByRole("alert")).toContainText("expired");
  expect(await page.evaluate(() => (window as any).continuationProof.publications)).toEqual([]);
});
