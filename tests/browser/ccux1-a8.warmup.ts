import { chromium } from "@playwright/test";

// Compile the fixture's production import graph before the unchanged 30s action budget.
export default async function warmup() {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.route("**/*", route => new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort());
    const started = Date.now();
    await page.goto("http://127.0.0.1:1498/tests/browser/ccux1-a8.html", { timeout: 90000 });
    await page.getByRole("tabpanel", { name: "Worktree", exact: true }).getByRole("button", { name: "Create PR", exact: true }).waitFor();
    console.log(`A8 fixture compilation preparation: ${Date.now() - started}ms; acceptance tests retain 30000ms each`);
  } finally { await browser.close(); }
}
