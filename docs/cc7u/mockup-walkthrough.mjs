import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";

const root = fileURLToPath(new URL("../../", import.meta.url));
const evidence =
  "C:/Users/nooro/AppData/Local/Temp/monocode-cc/cc7u/evidence/browser";
const scratch = await mkdtemp(resolve(tmpdir(), "monocode-cc7u-mockup-"));
const home = resolve(scratch, "home");
const launch = resolve(scratch, "launch");
await mkdir(home);
await mkdir(launch);
const env = {
  ...process.env,
  HOME: home,
  USERPROFILE: home,
  APPDATA: home,
  LOCALAPPDATA: home,
  MONOCODE_APP_IDENTIFIER: "com.monocode.cc7u.fixture",
};
for (const key of Object.keys(env))
  if (key === "CODEX_HOME" || key.startsWith("ORCA_")) delete env[key];
const cwd = process.cwd();
const receipt = {
  startedAt: new Date().toISOString(),
  checks: [],
  cleanup: {},
  isolation: {
    launch,
    home,
    appIdentifier: env.MONOCODE_APP_IDENTIFIER,
    codexHomeUnset: !env.CODEX_HOME,
    orcaVariables: Object.keys(env).filter((key) => key.startsWith("ORCA_")),
  },
};
const check = (name, value) => {
  receipt.checks.push({ name, passed: Boolean(value) });
  assert.ok(value, name);
};
let browser;
try {
  process.chdir(launch);
  browser = await chromium.launch({ env });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(
    pathToFileURL(resolve(root, "docs/cc7s/workbench.html")).href,
  );
  check(
    "failed launch retains its reason",
    (await page.locator(".priority").innerText()).includes("has not started"),
  );
  await page.locator("[data-action=message]").first().click();
  check(
    "Message focuses the composer",
    await page
      .locator("#message-input")
      .evaluate((el) => el === document.activeElement),
  );
  await page.locator("#message-input").fill("Saved fixture draft");
  await page
    .locator("#composer-model")
    .selectOption({ label: "GPT-5.3 Codex" });
  await page
    .locator("#composer-effort")
    .selectOption({ label: "Medium effort" });
  await page.locator("#composer-access").selectOption({ label: "Read only" });
  for (const action of [
    "details",
    "session",
    "task",
    "team-message",
    "tool",
    "worktree",
  ]) {
    await page.locator(`[data-action=${action}]`).first().click();
    check(
      `${action} opens details`,
      await page.locator("#detail-drawer").isVisible(),
    );
    if (action === "worktree") {
      await page.locator("[data-action=preview-open]").first().click();
      check(
        "worktree actions stay synthetic",
        (await page.locator("#toast").innerText()).includes("Preview only"),
      );
    }
    await page.keyboard.press("Escape");
  }
  for (const action of ["recovery", "error-details"]) {
    await page.locator(`[data-action=${action}]`).click();
    await page.locator("[data-action=check-storage]").click();
    check(
      "storage checks never fabricate repair",
      (await page.locator("#recovery-result").innerText()).includes(
        "Recovery has not run",
      ),
    );
    await page.locator("[data-action=compare]").click();
    check(
      "comparison never overwrites copies",
      (await page.locator("#recovery-result").innerText()).includes(
        "No copy is selected or overwritten",
      ),
    );
    await page.locator("[data-action=close]").click();
  }
  await page.locator("[data-action=steer]").click();
  await page.locator("#steer-input").fill("Keep the saved review boundary.");
  await page.locator("#steer-form button").click();
  check(
    "steer is a synthetic action",
    (await page.locator("#toast").innerText()).includes("Nothing sent"),
  );
  await page.locator("#composer button[type=submit]").click();
  check(
    "send is a synthetic action",
    (await page.locator("#toast").innerText()).includes("Nothing sent"),
  );
  await page.locator("[data-action=tasks][data-value=History]").click();
  check(
    "History shows past assignments directly",
    (await page.locator(".task-card").count()) === 2,
  );
  await page.locator("[data-action=tasks][data-value=All]").click();
  check(
    "All shows every assignment directly",
    (await page.locator(".task-card").count()) === 3,
  );
  await page.locator("[data-action=tasks][data-value=Current]").click();
  check(
    "Current shows current assignment directly",
    (await page.locator(".task-card").count()) === 1,
  );
  await page.locator("[data-action=tab][data-value=Activity]").click();
  check(
    "Activity uses the conversation region",
    (await page.locator(".activity-list").count()) === 1,
  );
  await page.locator("[data-action=theme]").click();
  await page.locator("[data-action=tab][data-value=Conversation]").click();
  check(
    "tab and theme preserve draft and settings",
    (await page.locator("#message-input").inputValue()) ===
      "Saved fixture draft" &&
      (await page.locator("#composer-effort").inputValue()) ===
        "Medium effort" &&
      (await page.locator("#composer-access").inputValue()) === "Read only",
  );
  await page.locator("[data-action=worktrees][data-value=All]").click();
  await page
    .getByRole("button", { name: "Next worktree page", exact: true })
    .click();
  check(
    "sidebar pages flat rows",
    (await page.locator(".paging").innerText()).includes("4–6 of 6"),
  );
  await page.locator("[data-action=worktree-row]").first().click();
  check(
    "sidebar row preserves exact working copy",
    (await page.locator("#detail-drawer").innerText()).includes(
      "cc7-sidebar-layout",
    ),
  );
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "Previous worktree page", exact: true })
    .click();
  await page.locator("[data-action=worktrees][data-value=Active]").click();
  await page.locator("#preview-member").selectOption("native");
  check(
    "member drafts stay separate",
    (await page.locator("#message-input").inputValue()) === "",
  );
  check(
    "waiting distinguishes implementation from review",
    (await page.locator(".priority").innerText()).includes(
      "Reviewer’s storage error",
    ),
  );
  await page.locator("[data-action=open-reviewer]").click();
  check(
    "dependency opens Reviewer and restores draft",
    (await page.locator("h1").innerText()).includes("Reviewer") &&
      (await page.locator("#message-input").inputValue()) ===
        "Saved fixture draft",
  );
  await page.locator("[data-action=earlier]").click();
  check(
    "long conversation has one scrolling transcript",
    (await page.locator(".message").count()) === 16 &&
      (await page
        .locator("#transcript")
        .evaluate((el) => el.scrollHeight > el.clientHeight)),
  );
  for (const state of ["zero", "loading", "error"]) {
    await page.locator("#preview-state").selectOption(state);
    check(
      `${state} assignments are explicit`,
      (await page.locator(".work-panel").innerText()).includes(
        state === "zero"
          ? "No assignments yet"
          : state === "loading"
            ? "Loading assignments"
            : "Work couldn’t be loaded",
      ),
    );
    if (state !== "zero")
      check(
        `${state} delivery is disabled`,
        await page.locator("#composer button[type=submit]").isDisabled(),
      );
  }
  await page.locator(".work-panel [data-action=retry]").click();
  check(
    "retry retains draft",
    (await page.locator("#message-input").inputValue()) ===
      "Saved fixture draft",
  );
  await page.locator("#preview-member").selectOption("session");
  check(
    "saved session retains its author",
    (await page.locator(".message-meta strong").allTextContents()).includes(
      "Reviewer",
    ),
  );
  for (const action of ["mission", "team", "available"]) {
    await page.locator(`[data-action=${action}]`).first().click();
    check(
      `${action} navigation stays local`,
      (await page.locator("#toast").innerText()).includes("Preview only"),
    );
  }
  check(
    "mockup has no disclosures",
    (await page.locator("details, summary").count()) === 0,
  );
  check("clean mockup render", errors.length === 0);
} finally {
  if (browser) {
    await browser.close();
    receipt.cleanup.browserClosed = true;
  }
  process.chdir(cwd);
  assert.ok(
    resolve(scratch).startsWith(resolve(tmpdir(), "monocode-cc7u-mockup-")),
  );
  await rm(scratch, {
    recursive: true,
    force: true,
    maxRetries: 4,
    retryDelay: 200,
  });
  receipt.cleanup.scratchRemoved = true;
  receipt.finishedAt = new Date().toISOString();
  receipt.totals = {
    passed: receipt.checks.filter((value) => value.passed).length,
    failed: receipt.checks.filter((value) => !value.passed).length,
  };
  await mkdir(evidence, { recursive: true });
  await writeFile(
    resolve(evidence, "mockup-walkthrough.json"),
    JSON.stringify(receipt, null, 2) + "\n",
  );
  console.log(JSON.stringify({ ...receipt.totals, cleanup: receipt.cleanup }));
}
