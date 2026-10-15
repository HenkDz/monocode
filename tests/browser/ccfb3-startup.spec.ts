import { expect, test } from "@playwright/test";
import { join } from "node:path";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "platform", { value: "Win32" }),
  );
});
const glassCalls = (page: import("@playwright/test").Page) =>
  page.evaluate(() =>
    (
      window as unknown as {
        ccfb3Calls: { command: string; args: { enabled?: boolean } }[];
      }
    ).ccfb3Calls.filter(
      (call) =>
        call.command === "set_window_glass_enabled" && call.args.enabled,
    ),
  );
const screenshot = (name: string, path: string) =>
  process.env.CCFB3_EVIDENCE ? join(process.env.CCFB3_EVIDENCE, name) : path;

for (const theme of ["dark", "light"]) {
  test(`startup healthy ${theme} preserves preferences and records ordered paint/glass`, async ({
    page,
  }, info) => {
    await page.addInitScript(
      (theme) => localStorage.setItem("monocode.colorScheme", theme),
      theme,
    );
    await page.goto("/");
    await expect(page.locator("#boot-splash")).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "Synthetic workspace ready" }),
    ).toBeVisible();
    expect(
      await page.evaluate(() =>
        document.documentElement.classList.contains("boot-opaque"),
      ),
    ).toBe(false);
    const marks = await page.evaluate(() =>
      performance
        .getEntriesByType("mark")
        .map((entry) => ({ name: entry.name, time: entry.startTime })),
    );
    const names = marks.map((mark) => mark.name);
    expect(names.indexOf("monocode:content-renderer-paint")).toBeGreaterThan(
      names.indexOf("monocode:content-committed"),
    );
    expect(names.indexOf("monocode:glass-activation")).toBeGreaterThan(
      names.indexOf("monocode:content-renderer-paint"),
    );
    expect(names.indexOf("monocode:splash-removed")).toBeGreaterThan(
      names.indexOf("monocode:glass-activation"),
    );
    await info.attach("renderer-ordering.json", {
      body: JSON.stringify({
        marks,
        paint: await page.evaluate(() =>
          performance.getEntriesByType("paint").map((entry) => entry.toJSON()),
        ),
      }),
      contentType: "application/json",
    });
    expect(
      await page.evaluate(() => localStorage.getItem("monocode.colorScheme")),
    ).toBe(theme);
    if (theme === "dark")
      await expect.poll(async () => (await glassCalls(page)).length).toBe(1);
    else expect(await glassCalls(page)).toHaveLength(0);
    await page.getByRole("button", { name: "Check workspace" }).click();
    await expect(
      page.getByRole("button", { name: "Workspace responds" }),
    ).toBeVisible();
    await page.screenshot({
      path: screenshot(
        `startup-healthy-${theme}.png`,
        info.outputPath("healthy.png"),
      ),
    });
  });
}

test("startup boot rejection exposes keyboard Retry and reloads once into healthy UI", async ({
  page,
}, info) => {
  await page.goto("/?boot=reject");
  await expect(page.getByRole("alert")).toContainText("could not start");
  const retry = page.getByRole("button", { name: "Retry", exact: true });
  await expect(retry).toBeVisible();
  expect(await glassCalls(page)).toHaveLength(0);
  await expect(
    page.getByRole("button", { name: "Continue without transparency" }),
  ).toBeHidden();
  await expect(
    page.getByRole("button", { name: "Minimize window", exact: true }),
  ).toHaveCount(1);
  await page.screenshot({
    path: screenshot("startup-rejection.png", info.outputPath("rejection.png")),
  });
  await retry.focus();
  await Promise.all([page.waitForEvent("load"), page.keyboard.press("Enter")]);
  await expect(page.locator("#boot-splash")).toHaveCount(0);
  expect(
    await page.evaluate(() => sessionStorage.getItem("ccfb3-attempts")),
  ).toBe("2");
  await expect(
    page.getByRole("heading", { name: "Synthetic workspace ready" }),
  ).toBeVisible();
});

test("startup slow renderer signal retains opaque surface then restores healthy glass", async ({
  page,
}) => {
  await page.goto("/?boot=slow");
  await expect(page.locator("#boot-splash")).toHaveClass("boot-splash-out");
  expect(await glassCalls(page)).toHaveLength(0);
  await expect(page.locator("html")).toHaveClass(/boot-opaque/);
  await expect(page.locator("#boot-splash")).toHaveCount(0);
  await expect.poll(async () => (await glassCalls(page)).length).toBe(1);
});

test("startup never-painted watchdog keeps Retry/window controls and offers usable opaque continuation", async ({
  page,
}, info) => {
  await page.goto("/?boot=never");
  await expect(page.getByRole("alert")).toContainText("longer than expected", {
    timeout: 15_000,
  });
  expect(await glassCalls(page)).toHaveLength(0);
  await expect(page.locator("html")).toHaveClass(/boot-opaque/);
  await expect(page.locator("#boot-splash")).toHaveCSS("opacity", "1");
  await expect(
    page.getByRole("button", { name: "Minimize window", exact: true }),
  ).toHaveCount(1);
  await page.screenshot({
    path: screenshot("startup-watchdog.png", info.outputPath("watchdog.png")),
  });
  await page
    .getByRole("button", { name: "Continue without transparency" })
    .click();
  await expect(page.locator("#boot-splash")).toHaveCount(0);
  await page.getByRole("button", { name: "Check workspace" }).click();
  await expect(
    page.getByRole("button", { name: "Workspace responds" }),
  ).toBeVisible();
  expect(await glassCalls(page)).toHaveLength(0);
  await expect(page.locator("html")).toHaveClass(/boot-opaque/);
});

test("startup hung boot watchdog cannot continue into missing UI", async ({
  page,
}) => {
  await page.goto("/?boot=hung");
  await expect(
    page.getByRole("button", { name: "Retry", exact: true }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(
    page.getByRole("button", { name: "Continue without transparency" }),
  ).toBeHidden();
  expect(await glassCalls(page)).toHaveLength(0);
});

test("startup unsupported timing preserves healthy appearance after a bounded paint opportunity", async ({
  page,
}) => {
  await page.goto("/?boot=unsupported");
  await expect(page.locator("#boot-splash")).toHaveCount(0);
  await expect(page.locator("html")).not.toHaveClass(/boot-opaque/);
  await expect.poll(async () => (await glassCalls(page)).length).toBe(1);
  expect(
    await page.evaluate(
      () =>
        performance.getEntriesByName("monocode:content-paint-opportunity")
          .length,
    ),
  ).toBe(1);
  await page.getByRole("button", { name: "Check workspace" }).click();
  await expect(
    page.getByRole("button", { name: "Workspace responds" }),
  ).toBeVisible();
});
