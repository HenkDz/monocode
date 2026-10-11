// Isolated screenshots of actual components and the selected CC7S reference.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const run = promisify(execFile);
const root = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const source = resolve(root, "docs/cc7u");
const evidence =
  process.env.CC7U_BROWSER_EVIDENCE ||
  "C:/Users/nooro/AppData/Local/Temp/monocode-cc/cc7u/evidence/browser";
const scratch = await mkdtemp(resolve(tmpdir(), "monocode-cc7u-capture-"));
const home = resolve(scratch, "home");
const launch = resolve(scratch, "launch");
const output = resolve(scratch, "build");
const env = {
  ...process.env,
  NODE_OPTIONS: "--no-experimental-webstorage",
  HOME: home,
  USERPROFILE: home,
  APPDATA: home,
  LOCALAPPDATA: home,
  MONOCODE_APP_IDENTIFIER: "com.monocode.cc7u.fixture",
};
for (const key of Object.keys(env))
  if (key === "CODEX_HOME" || key.startsWith("ORCA_")) delete env[key];
await mkdir(home);
await mkdir(launch);
await mkdir(resolve(source, "screenshots"), { recursive: true });
await mkdir(evidence, { recursive: true });
const originalCwd = process.cwd();
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const receipt = {
  startedAt: new Date().toISOString(),
  node: process.version,
  frontendOnly: true,
  isolation: {
    launch,
    home,
    appIdentifier: env.MONOCODE_APP_IDENTIFIER,
    codexHomeUnset: !env.CODEX_HOME,
    orcaVariables: Object.keys(env).filter((key) => key.startsWith("ORCA_")),
  },
  checks: [],
  layouts: [],
  screenshots: [],
  sourceHashes: {},
  cleanup: {},
};
const check = (name, passed, detail) =>
  receipt.checks.push({
    name,
    passed: Boolean(passed),
    ...(detail === undefined ? {} : { detail }),
  });
const sourceFiles = (
  await run("git", [
    "-C",
    root,
    "ls-files",
    "--cached",
    "--others",
    "--exclude-standard",
    "--",
    "src",
    "tests/browser",
  ])
).stdout
  .trim()
  .split(/\r?\n/);
for (const name of [
  ...sourceFiles,
  "docs/cc7s/workbench.html",
  "docs/cc7s/member-view.css",
  "docs/cc7s/member-view.js",
  "docs/cc7m/mission-control.css",
])
  receipt.sourceHashes[name] = hash(await readFile(resolve(root, name)));
const server = createServer(async (request, response) => {
  const pathname = decodeURIComponent(
    new URL(request.url, "http://localhost").pathname,
  );
  if (pathname === "/favicon.ico") {
    response.writeHead(204).end();
    return;
  }
  const base =
    pathname.startsWith("/docs/cc7s/") || pathname.startsWith("/docs/cc7m/")
      ? root
      : output;
  const path = resolve(base, `.${pathname}`);
  if (!path.startsWith(base + "/") && !path.startsWith(base + "\\")) {
    response.writeHead(403).end();
    return;
  }
  try {
    response
      .writeHead(200, {
        "Content-Type":
          {
            ".html": "text/html",
            ".css": "text/css",
            ".js": "application/javascript",
            ".svg": "image/svg+xml",
            ".png": "image/png",
            ".woff2": "font/woff2",
          }[extname(path)] ?? "application/octet-stream",
        "Cache-Control": "no-store",
      })
      .end(await readFile(path));
  } catch {
    response.writeHead(404).end();
  }
});
let browser;
let fatal;
async function screenshot(page, name) {
  const bytes = await page.screenshot({
    path: resolve(source, "screenshots", `${name}.png`),
  });
  receipt.screenshots.push({
    file: `${name}.png`,
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
    sha256: hash(bytes),
  });
  return bytes;
}
async function layout(page, key) {
  const dimensions = await page.evaluate(() => {
    const box = (selector) => {
      const element = document.querySelector(selector);
      return element?.getBoundingClientRect().toJSON();
    };
    return {
      width: document.documentElement.scrollWidth,
      viewport: innerWidth,
      height: innerHeight,
      header: box("[data-workbench-header]"),
      work: box("[data-member-work]"),
      conversation: box("[data-workbench-conversation]"),
      composer: box("[data-session-composer]"),
      disclosures: document.querySelectorAll(
        "[data-member-workbench] details, [data-member-workbench] summary",
      ).length,
    };
  });
  receipt.layouts.push({ key, ...dimensions });
  check(
    `${key}: no horizontal overflow`,
    dimensions.width <= dimensions.viewport,
  );
  check(
    `${key}: composer reachable`,
    dimensions.composer && dimensions.composer.bottom <= dimensions.height + 1,
  );
  check(
    `${key}: separate Work and conversation`,
    dimensions.work &&
      dimensions.conversation &&
      dimensions.work.right <= dimensions.conversation.x + 1,
  );
  check(`${key}: no assignment disclosures`, dimensions.disclosures === 0);
}
try {
  process.chdir(launch);
  const build = await run(
    process.execPath,
    [
      resolve(root, "node_modules/vite/bin/vite.js"),
      "build",
      "--config",
      resolve(root, "tests/browser/vite.config.ts"),
      "--outDir",
      output,
    ],
    { cwd: launch, env, maxBuffer: 10 * 1024 * 1024 },
  );
  await writeFile(
    resolve(evidence, "fixture-build.log"),
    build.stdout + build.stderr,
  );
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ env });
  const context = await browser.newContext({ reducedMotion: "reduce" });
  for (const width of [1440, 1100])
    for (const theme of ["dark", "light"])
      for (const scenario of [
        "failed",
        "waiting",
        "working",
        "zero",
        "long-history",
      ]) {
        const page = await context.newPage();
        const errors = [];
        const external = [];
        page.on("pageerror", (error) => errors.push(error.message));
        page.on("request", (request) => {
          if (!request.url().startsWith(origin)) external.push(request.url());
        });
        await page.setViewportSize({ width, height: 1000 });
        await page.goto(
          `${origin}/tests/browser/cc7u-workbench.html?scenario=${scenario}&theme=${theme}`,
        );
        await page
          .locator("[data-workbench-header]")
          .waitFor({ timeout: 90_000 });
        if (scenario !== "zero") {
          const transcript = page.getByRole("tabpanel", {
            name: "Conversation",
            exact: true,
          });
          const narration = transcript.getByText(
            "I’ll check the window lifecycle, then follow the activation route into the selected browser. I’ll keep source evidence and live acceptance separate.",
            { exact: true },
          );
          await narration.waitFor({ timeout: 90_000 });
          check(
            `${width}-${theme}-${scenario}: preliminary prose visible`,
            await narration.isVisible(),
          );
          check(
            `${width}-${theme}-${scenario}: Read files visible`,
            await transcript
              .getByLabel("Tool call: Read window lifecycle and routing", {
                exact: true,
              })
              .isVisible(),
          );
          check(
            `${width}-${theme}-${scenario}: Run checks visible`,
            await transcript
              .getByLabel("Tool call: Run focused routing checks", {
                exact: true,
              })
              .isVisible(),
          );
          check(
            `${width}-${theme}-${scenario}: no expandable transcript groups`,
            (await transcript
              .locator("button[aria-expanded], details, summary")
              .count()) === 0,
          );
        }
        if (scenario === "long-history")
          await page
            .locator("[data-member-work]")
            .getByRole("tab", { name: "All", exact: true })
            .click();
        await page.waitForTimeout(350);
        const key = `workbench-${width}-${theme}-${scenario}`;
        await layout(page, key);
        check(
          `${key}: clean local component render`,
          errors.length === 0 && external.length === 0,
          { errors, external },
        );
        const implementation = await screenshot(page, `${key}-implementation`);
        const reference = await context.newPage();
        await reference.setViewportSize({ width, height: 1000 });
        await reference.goto(
          `${origin}/docs/cc7s/workbench.html?theme=${theme}&member=${["waiting", "working"].includes(scenario) ? "native" : "reviewer"}&state=${scenario === "zero" ? "zero" : "live"}`,
        );
        await reference.locator(".member-header").waitFor();
        if (scenario === "long-history") {
          await reference
            .locator("[data-action=tasks][data-value=All]")
            .click();
          await reference.locator("[data-action=earlier]").click();
        }
        const mockup = await screenshot(reference, `${key}-mockup`);
        const pair = await context.newPage();
        await pair.setViewportSize({ width: width * 2, height: 1034 });
        await pair.setContent(
          `<html><head><style>*{box-sizing:border-box}body{margin:0;background:${theme === "light" ? "#fafafa" : "#151515"};color:${theme === "light" ? "#222" : "#eee"};font:12px system-ui}.pair{display:grid;grid-template-columns:1fr 1fr}.label{height:34px;padding:8px 16px;border-bottom:1px solid #8884}img{display:block;width:100%}</style></head><body><div class="pair"><div><div class="label">CC7S selected Workbench mockup${scenario === "working" ? " · Native waiting reference (no working mockup exists)" : ""}</div><img src="data:image/png;base64,${mockup.toString("base64")}"></div><div><div class="label">CC7U actual components · ${scenario} · ${width}px · ${theme}</div><img src="data:image/png;base64,${implementation.toString("base64")}"></div></div></body></html>`,
        );
        await screenshot(pair, `${key}-comparison`);
        await pair.close();
        await reference.close();
        await page.close();
      }
  const session = await context.newPage();
  await session.setViewportSize({ width: 1440, height: 1000 });
  await session.goto(
    `${origin}/tests/browser/cc7u-workbench.html?kind=session&scenario=failed`,
  );
  await session.locator("[data-workbench-header]").waitFor({ timeout: 90_000 });
  await screenshot(session, "workbench-1440-dark-member-session");
  await session.close();
  for (const [name, digest] of Object.entries(receipt.sourceHashes))
    check(
      `${name}: source stable during capture`,
      hash(await readFile(resolve(root, name))) === digest,
    );
} catch (error) {
  fatal = error;
  receipt.fatal = error.stack;
} finally {
  if (browser) {
    await browser.close();
    receipt.cleanup.browserClosed = true;
  }
  if (server.listening) await new Promise((done) => server.close(done));
  receipt.cleanup.serverClosed = !server.listening;
  process.chdir(originalCwd);
  assert.ok(
    resolve(scratch).startsWith(resolve(tmpdir(), "monocode-cc7u-capture-")),
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
    layouts: receipt.layouts.length,
    screenshots: receipt.screenshots.length,
  };
  await writeFile(
    resolve(evidence, "verification.json"),
    JSON.stringify(receipt, null, 2) + "\n",
  );
  await writeFile(
    resolve(
      evidence,
      `verification-${receipt.startedAt.replaceAll(":", "-")}.json`,
    ),
    JSON.stringify(receipt, null, 2) + "\n",
  );
  await writeFile(
    resolve(source, "screenshots/index.md"),
    "# CC7U Workbench screenshots\n\nActual components with synthetic sessions, alongside the selected CC7S mockup. Chromium, 1440/1100 by 1000, dark/light. Working compares with the closest Native waiting reference because CC7S has no working specimen. These use the merged CC7T transcript and activity renderers.\n\n| Screenshot | Size | SHA-256 |\n| --- | --- | --- |\n" +
      receipt.screenshots
        .map(
          (item) =>
            `| [${item.file}](${item.file}) | ${item.width} × ${item.height} | \`${item.sha256}\` |`,
        )
        .join("\n") +
      "\n",
  );
  console.log(
    JSON.stringify({
      ...receipt.totals,
      cleanup: receipt.cleanup,
      fatal: receipt.fatal,
      failures: receipt.checks
        .filter((value) => !value.passed)
        .map((value) => value.name),
    }),
  );
}
if (fatal) throw fatal;
assert.equal(receipt.totals.failed, 0, "Workbench capture checks failed");
