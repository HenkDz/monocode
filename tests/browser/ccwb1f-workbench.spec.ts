import { test, expect } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
const evidence = process.env.CCWB1_EVIDENCE ?? "test-results/ccwb1f";
mkdirSync(evidence, { recursive: true });
test.setTimeout(120_000);
async function task(page: any) {
  await page.setViewportSize({ width: 640, height: 1050 });
  await page.route("**/*", (route: any) =>
    new URL(route.request().url()).hostname === "127.0.0.1"
      ? route.continue()
      : route.abort(),
  );
  await page.goto("/tests/browser/ccwb1-workbench.html");
  await page
    .locator("[data-workbench-header]:visible")
    .getByRole("button", { name: "View live", exact: true })
    .click();
  await expect(page.locator("[data-view]")).toContainText("task-session");
}

test("explicit Task Queue waits even with background work", async ({
  page,
}) => {
  await task(page);
  await page.evaluate(() => {
    const h = (window as any).ccwb1.host;
    h.sessionsRef.current.find(
      (s: any) => s.id === "task-session",
    ).backgroundTasks = [{ id: "server", label: "dev server" }];
    h.setMonoViewId(null);
  });
  await page
    .getByRole("group", { name: "Message delivery" })
    .getByRole("button", { name: "Queue", exact: true })
    .click();
  await expect(page.locator(".cc7u-delivery:visible")).toHaveText(
    "Message will follow the current turn",
  );
  await page
    .locator("[data-session-composer] textarea:visible")
    .first()
    .fill("Wait until the current turn finishes");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  expect(
    await page.evaluate(() =>
      (window as any).ccwb1.events
        .filter((e: any) => e.action === "submit")
        .at(-1),
    ),
  ).toMatchObject({
    id: "task-session",
    options: { followUpBehavior: "queue" },
    behavior: "queue",
  });
  await page.screenshot({ path: `${evidence}/queue-background.png` });
});

for (const state of ["completed", "running"])
  test(`${state} historical worker shows only its dispatch report and baseline`, async ({
    page,
  }) => {
    await task(page);
    await page.evaluate(async (state) => {
      const { orchestrator } = await import(
        "/src/features/orchestration/model/orchestration.ts" as string
      );
      const run = orchestrator.snapshot()[0],
        task = run.tasks[0],
        old = run.dispatches[0];
      const worker = (window as any).ccwb1.host.sessionsRef.current.find(
        (s: any) => s.id === "task-session",
      );
      worker.busy = state === "running";
      if (!worker.busy) {
        worker.blocks[0].durationMs = 263000;
        worker.blocks[0].turnMetrics.endedAt = Date.now() - 10000;
        worker.blocks.find((b: any) => b.tool).tool.status = "completed";
      }
      old.state = state;
      old.result = "OLD DISPATCH REPORT";
      old.checkoutBaseline = {
        head: "old",
        fingerprint: "old",
        inheritedChangedPaths: ["old-file"],
      };
      task.sessionId = "new-worker";
      task.activeDispatchId = "new-dispatch";
      task.prompt = "NEW DISPATCH BRIEF";
      task.result = "NEW DISPATCH REPORT";
      task.reportArtifactId = "new-report";
      task.reviewArtifactId = "new-review";
      task.prSummaryArtifactId = "new-summary";
      task.checkoutBaseline = {
        head: "new",
        fingerprint: "new",
        inheritedChangedPaths: ["new-a", "new-b"],
      };
      run.dispatches.push({
        ...old,
        id: "new-dispatch",
        sessionId: "new-worker",
        state: "running",
        result: undefined,
      });
      (window as any).ccwb1.host.setMonoViewId(null);
    }, state);
    await page.getByRole("button", { name: "Work", exact: true }).click();
    const report = page.getByRole("region", { name: "Task report" });
    await expect(report).toContainText("OLD DISPATCH REPORT");
    await expect(report).toContainText("Previous dispatch");
    await expect(report).not.toContainText("NEW DISPATCH REPORT");
    const brief = page.getByRole("region", { name: "Task brief" });
    await expect(brief).toContainText("1 inherited changes");
    await expect(brief).toContainText(
      "Brief and artifacts for this previous dispatch were not saved.",
    );
    await expect(brief).not.toContainText("NEW DISPATCH BRIEF");
    await expect(
      page.locator("[data-session-drop='task-session'] [data-org-artifact]"),
    ).toHaveCount(0);
    await page.screenshot({ path: `${evidence}/historical-${state}.png` });
  });

test("replacement composer stays clear of Work with long follow-up and retains focus", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const records: { target?: Element; disconnected: boolean }[] = [];
    (window as any).composerObservers = records;
    const NativeObserver = ResizeObserver;
    window.ResizeObserver = class extends NativeObserver {
      record = { target: undefined as Element | undefined, disconnected: false };
      observe(target: Element, options?: ResizeObserverOptions) {
        this.record.target = target;
        records.push(this.record);
        super.observe(target, options);
      }
      disconnect() {
        this.record.disconnected = true;
        super.disconnect();
      }
    };
  });
  await task(page);
  await page.evaluate(() => {
    const h = (window as any).ccwb1.host,
      worker = h.sessionsRef.current.find((s: any) => s.id === "task-session");
    worker.busy = false;
    worker.blocks.push({
      id: "saved-draft",
      role: "user",
      text: "Saved review draft",
      draft: true,
    });
    h.setMonoViewId(null);
  });
  expect(await page.evaluate(() => (window as any).composerObservers.some((r: any) => r.disconnected && r.target?.matches("[data-session-composer]") && !r.target.isConnected))).toBe(true);
  await expect(
    page.locator("[data-session-drop='task-session'] [data-session-composer]"),
  ).toHaveCount(0);
  await page.evaluate(() => {
    const h = (window as any).ccwb1.host,
      worker = h.sessionsRef.current.find((s: any) => s.id === "task-session");
    worker.blocks = worker.blocks.filter((b: any) => !b.draft);
    h.setMonoViewId(null);
  });
  await page
    .locator("[data-session-composer] textarea:visible")
    .first()
    .fill(
      Array(20)
        .fill("A long follow-up after reviewing the saved draft")
        .join("\n"),
    );
  await page.getByRole("button", { name: "Work", exact: true }).click();
  const drawer = page.locator(
    "[data-session-drop='task-session'] [data-member-work]",
  );
  const dock = page.locator(
    "[data-session-drop='task-session'] [data-session-composer]",
  );
  const a = (await drawer.boundingBox())!,
    b = (await dock.boundingBox())!;
  writeFileSync(
    `${evidence}/recreated-composer-geometry.json`,
    JSON.stringify({ drawer: a, composer: b }, null, 2),
  );
  expect(a.y + a.height).toBeLessThanOrEqual(b.y);
  await expect(
    page.getByRole("button", { name: "Close work", exact: true }),
  ).toBeFocused();
  await page.screenshot({ path: `${evidence}/recreated-composer.png` });
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Work", exact: true }),
  ).toBeFocused();
  await page
    .locator("[data-session-composer] textarea:visible")
    .first()
    .focus();
  await expect(
    page.locator("[data-session-composer] textarea:visible").first(),
  ).toBeFocused();
});
