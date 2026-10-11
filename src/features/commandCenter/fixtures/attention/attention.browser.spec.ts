import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type {} from "./main";

const evidence = process.env.CC7D_EVIDENCE_DIR ?? "C:/Users/nooro/AppData/Local/Temp/monocode-cc/cc7d/evidence";
const row = (page: Page, source: string) => page.locator(`article[data-attention-source="${source}"]`);
const managerApproval = (page: Page) => page.getByRole("article", { name: "Allow the release verification command", exact: true });
const filter = (page: Page, name: string) => page.getByRole("navigation", { name: "Attention filters" }).getByRole("button", { name: new RegExp(`^${name} ·`) }).click();
const events = (page: Page) => page.evaluate(() => window.attentionFixture.events);

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Attention", exact: true })).toBeVisible();
});

for (const variant of [{ width: 1440, presentation: "page" }, { width: 390, presentation: "panel" }]) {
  test(`sandbox setup uses real inline controls at ${variant.width}px`, async ({ page }) => {
    await page.setViewportSize({ width: variant.width, height: 1000 });
    await page.goto(`/?presentation=${variant.presentation}`);
    const setupCommand = "$env:CODEX_HOME = 'C:/synthetic/mono'; codex sandbox -c 'windows.sandbox=\"elevated\"' -P :workspace -- powershell.exe -NoProfile -Command 'Write-Output \"Codex sandbox setup complete\"'";
    await page.evaluate(command => window.attentionFixture.showSandboxBlocker("The recorded sandbox machine account is disabled", command), setupCommand);
    await filter(page, "Blockers");
    const blocker = page.getByRole("article", { name: "Codex sandbox needs setup", exact: true });
    await expect(blocker).toBeVisible();
    await expect(blocker).toContainText("The recorded sandbox machine account is disabled");
    await expect(blocker.locator('[aria-label="Sandbox setup command"]')).toHaveText(setupCommand);
    await expect(blocker.locator("details, summary, [data-attention-details]")).toHaveCount(0);
    expect(await events(page)).toEqual([]);
    await blocker.getByRole("button", { name: "Switch this account to unelevated", exact: true }).click();
    await expect(blocker.getByRole("alert").first()).toContainText("file is busy");
    await blocker.getByRole("button", { name: "Use full access for this Mono", exact: true }).click();
    expect(await events(page)).toEqual([
      { action: "repair", sessionId: "storage", payload: "use_unelevated_sandbox" },
      { action: "repair", sessionId: "storage", payload: "use_mono_full_access" },
    ]);
    const directory = join(evidence, "screenshots"); mkdirSync(directory, { recursive: true });
    await page.screenshot({ path: join(directory, `sandbox-blocker-${variant.width}.png`), fullPage: true });
  });
}

test("deduplicates shared-account storage and renders approval ownership", async ({ page }) => {
  await expect(row(page, "storage")).toHaveCount(1);
  await expect(row(page, "storage")).toContainText("Affects 2 conversations");
  await filter(page, "Approvals");
  await expect(managerApproval(page).getByRole("button", { name: "Allow once", exact: true })).toBeVisible();
  const worker = page.getByRole("article", { name: "Worker permission stays with the lead", exact: true });
  await expect(worker).toContainText("Routed through lead");
  await expect(worker.getByRole("button", { name: "Allow once" })).toHaveCount(0);
  await expect(worker.getByRole("button", { name: "Deny" })).toHaveCount(0);
  await worker.getByRole("button", { name: "Open lead", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Conversation: manager" })).toBeVisible();
  expect(await events(page)).toEqual([{ action: "inspect", sessionId: "worker", target: "manager" }]);
});

test("real QuestionForm sends a selected structured answer and records resolved history", async ({ page }) => {
  await filter(page, "Decisions");
  await row(page, "question").getByRole("button", { name: "Full suite" }).click();
  await row(page, "question").getByRole("button", { name: "Continue", exact: true }).click();
  await expect.poll(() => events(page)).toEqual([{ action: "question", sessionId: "decision", requestId: 81, payload: { kind: "answered", answers: { scope: ["full"] } } }]);
  await filter(page, "History");
  await expect(row(page, "question")).toHaveAttribute("data-attention-status", "resolved");
  await expect(row(page, "question").getByRole("button", { name: "Continue", exact: true })).toHaveCount(0);
});

test("real QuestionForm preserves a custom answer", async ({ page }) => {
  await filter(page, "Decisions");
  await row(page, "question").getByRole("button", { name: "Other", exact: true }).click();
  await row(page, "question").getByPlaceholder("Type your answer").fill("Run recovery checks, then review the release diff.");
  await row(page, "question").getByRole("button", { name: "Continue", exact: true }).click();
  await expect.poll(() => events(page)).toEqual([{ action: "question", sessionId: "decision", requestId: 81,
    payload: { kind: "answered", answers: { scope: ["__custom__"] }, custom: { scope: "Run recovery checks, then review the release diff." } } }]);
});

test("pending approval disables duplicate pointer submissions and settles only at the source", async ({ page }) => {
  await filter(page, "Approvals");
  const request = managerApproval(page);
  await request.getByRole("button", { name: "Allow once", exact: true }).click();
  await expect(request).toHaveAttribute("aria-busy", "true");
  await expect(request.getByRole("button", { name: "Allow once", exact: true })).toBeDisabled();
  await expect(request.getByRole("button", { name: "Deny", exact: true })).toBeDisabled();
  await request.getByRole("button", { name: "Allow once", exact: true }).evaluate(button => (button as HTMLButtonElement).click());
  expect((await events(page)).filter(event => event.action === "approval")).toHaveLength(1);
  await page.evaluate(() => window.attentionFixture.settleApproval());
  await filter(page, "History");
  await expect(managerApproval(page)).toHaveAttribute("data-attention-status", "resolved");
  await expect(managerApproval(page).getByRole("button", { name: "Allow once" })).toHaveCount(0);
});

test("failed storage repair and failed delivery retry remain open with errors", async ({ page }) => {
  await filter(page, "Blockers");
  await row(page, "storage").getByRole("button", { name: "Use account version" }).click();
  await expect(row(page, "storage")).toContainText("Synthetic repair failed: file is busy");
  await expect(row(page, "storage")).toHaveAttribute("data-attention-status", "open");
  await expect(row(page, "storage").getByRole("button", { name: "Use account version" })).toBeEnabled();
  await filter(page, "Failures");
  await row(page, "delivery").getByRole("button", { name: "Retry delivery" }).click();
  await expect(row(page, "delivery").getByRole("alert")).toContainText("Synthetic delivery retry failed");
  await expect(row(page, "delivery")).toHaveAttribute("data-attention-status", "open");
  await expect(row(page, "delivery")).toContainText("Deliver the saved review evidence");
  expect((await events(page)).map(event => event.action)).toEqual(["repair", "retry-delivery"]);
});

test("task failure retains its attempt and sends retry review to the lead", async ({ page }) => {
  await filter(page, "Failures");
  const task = row(page, "task");
  await expect(task).toContainText("Attempt dispatch-failed-task");
  await expect(task).toContainText("working copy and failed attempt are preserved");
  await task.getByRole("button", { name: "Review retry with lead" }).click();
  await expect(page.getByRole("heading", { name: "Conversation: manager" })).toBeVisible();
  expect(await events(page)).toEqual([{ action: "inspect", sessionId: "failed-worker", target: "manager" }]);
});

test("usage recovery uses the existing callback and waits for source acknowledgement", async ({ page }) => {
  await filter(page, "Blockers");
  const usage = row(page, "usage");
  await usage.getByRole("button", { name: "Resume", exact: true }).click();
  expect(await events(page)).toEqual([{ action: "resume", sessionId: "usage" }]);
  await expect(usage).toHaveAttribute("data-attention-status", "open");
  await expect(usage.getByRole("button", { name: "Resume", exact: true })).toBeDisabled();
  await expect(usage).toContainText("awaiting source acknowledgement");
});

test("request identity is rechecked at click time and replaced requests have no actions", async ({ page }) => {
  await filter(page, "Approvals");
  await page.evaluate(() => window.attentionFixture.changeSourceWithoutRender());
  await managerApproval(page).getByRole("button", { name: "Allow once", exact: true }).click();
  await expect(managerApproval(page).getByRole("alert")).toContainText("This request changed or is no longer available");
  expect(await events(page)).toEqual([]);
  await page.evaluate(() => window.attentionFixture.replaceApproval());
  await expect(page.getByRole("article", { name: "Replacement permission request" })).toBeVisible();
  await filter(page, "History");
  await expect(managerApproval(page)).toHaveAttribute("data-attention-status", "replaced");
  await expect(managerApproval(page).getByRole("button")).toHaveCount(0);
});

test("Escape closes only the visible queue and narrow text reflows", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 1000 });
  await filter(page, "Failures");
  const widths = await page.locator(".aq-scroll").evaluate(element => ({ client: element.clientWidth, scroll: element.scrollWidth }));
  expect(widths.scroll).toBeLessThanOrEqual(widths.client + 1);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("heading", { name: "Attention closed" })).toBeVisible();
  await expect(page.getByTestId("close-count")).toHaveText("1");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("close-count")).toHaveText("1");
  await page.getByRole("button", { name: "Reopen Attention" }).click();
  await expect(page.getByRole("heading", { name: "Attention", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Failures ·/ })).toHaveAttribute("aria-pressed", "true");
});

test("200 percent zoom preserves question controls and horizontal reflow", async ({ page }) => {
  await page.setViewportSize({ width: 780, height: 1600 });
  await page.evaluate(() => { document.body.style.zoom = "2"; });
  await filter(page, "Decisions");
  const widths = await page.locator(".aq-scroll").evaluate(element => ({ client: element.clientWidth, scroll: element.scrollWidth }));
  expect(widths.scroll).toBeLessThanOrEqual(widths.client + 1);
  await row(page, "question").getByRole("button", { name: "Full suite" }).click();
  await expect(row(page, "question").getByRole("button", { name: "Continue", exact: true })).toBeEnabled();
});

for (const theme of ["dark", "light"]) {
  test(`panel reflow and keyboard storage evidence without accordions ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 1000 });
    await page.goto(`/?theme=${theme}&presentation=panel`);
    await expect(page.getByRole("heading", { name: "Attention", exact: true, level: 2 })).toBeVisible();
    const headingBounds = await page.getByRole("heading", { name: "Attention", exact: true, level: 2 }).boundingBox();
    const closeBounds = await page.locator(".aq-toolbar").getByRole("button", { name: "Close", exact: true }).boundingBox();
    expect(headingBounds).not.toBeNull(); expect(closeBounds).not.toBeNull();
    expect(closeBounds!.x).toBeGreaterThan(headingBounds!.x + headingBounds!.width);
    expect(Math.abs((headingBounds!.y + headingBounds!.height / 2) - (closeBounds!.y + closeBounds!.height / 2))).toBeLessThan(4);
    await expect(page.getByText("Command center", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Back to conversation" })).toHaveCount(0);
    await expect(page.locator("details, summary")).toHaveCount(0);
    const widths = await page.locator(".aq-scroll").evaluate(element => ({ client: element.clientWidth, scroll: element.scrollWidth }));
    expect(widths.scroll).toBeLessThanOrEqual(widths.client + 1);
    const directory = join(evidence, "screenshots"); mkdirSync(directory, { recursive: true });
    await page.screenshot({ path: join(directory, `panel-${theme}-390.png`), fullPage: true });
    await filter(page, "Blockers");
    const trigger = row(page, "storage").getByRole("button", { name: "Evidence", exact: true });
    await trigger.focus(); await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Storage evidence" });
    await expect(dialog).toBeVisible(); await expect(dialog).toBeFocused();
    await expect(dialog).toContainText("C:/synthetic/mono/AGENTS.md");
    await expect(page.locator("details, summary")).toHaveCount(0);
    const bounds = await dialog.boundingBox();
    expect(bounds).not.toBeNull(); expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
    await page.screenshot({ path: join(directory, `storage-evidence-${theme}-390.png`), fullPage: true });
    await page.keyboard.press("Tab");
    await expect(dialog.getByRole("button", { name: "Close evidence" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0); await expect(trigger).toBeFocused();
    await expect(page.getByRole("heading", { name: "Attention", exact: true, level: 2 })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("heading", { name: "Attention closed" })).toBeVisible();
    await expect(page.getByTestId("close-count")).toHaveText("1");
  });
}

for (const variant of [{ name: "dark-1440", theme: "dark", width: 1440 }, { name: "light-1440", theme: "light", width: 1440 }, { name: "dark-390", theme: "dark", width: 390 }, { name: "light-390", theme: "light", width: 390 }]) {
  test(`capture actual queue states ${variant.name}`, async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", error => pageErrors.push(error.message));
    await page.setViewportSize({ width: variant.width, height: 1000 });
    await page.goto(`/?theme=${variant.theme}`);
    await expect(page.locator("details, summary")).toHaveCount(0);
    const capture = async (state: string) => {
      const directory = join(evidence, "screenshots"); mkdirSync(directory, { recursive: true });
      await page.screenshot({ path: join(directory, `${state}-${variant.name}.png`), fullPage: true });
    };
    await filter(page, "Approvals"); await capture("approval");
    await filter(page, "Decisions"); await capture("decision");
    await filter(page, "Blockers"); await capture("blocker");
    await filter(page, "Failures"); await capture("failure");
    await filter(page, "Approvals"); await managerApproval(page).getByRole("button", { name: "Allow once", exact: true }).click();
    await expect(managerApproval(page)).toHaveAttribute("aria-busy", "true"); await capture("pending");
    await filter(page, "Failures"); await row(page, "delivery").getByRole("button", { name: "Retry delivery" }).click();
    await expect(row(page, "delivery").getByRole("alert")).toContainText("Synthetic delivery retry failed");
    await row(page, "delivery").getByRole("alert").scrollIntoViewIfNeeded(); await capture("error");
    expect(pageErrors).toEqual([]);
  });
}
