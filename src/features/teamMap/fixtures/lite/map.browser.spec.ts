import { expect, test } from "@playwright/test";
const fixture = "/src/features/teamMap/fixtures/lite/index.html";
const frames = "../cc-program/ccvision/v3-lite-adapter/frames";

test("map rail passes native clicks to lite, which rejects synthetic input and sends once", async ({ page }) => {
  await page.goto(fixture);
  const card = page.getByRole("article", { name: "Choose the API contract" });
  const option = card.getByRole("button", { name: "Reuse the interface Recommended" });
  await option.dispatchEvent("click");
  await expect(card.getByRole("alert")).toContainText("Couldn't reach Atlas");
  expect(await page.evaluate(() => window.mapLiteFixture.sends)).toEqual([]);
  await option.click();
  await expect.poll(() => page.evaluate(() => window.mapLiteFixture.sends.length)).toBe(1);
  expect(await page.evaluate(() => window.mapLiteFixture.sends[0])).toEqual({ sessionId: "worker-chat", text: 'Decision on your question "Choose the API contract": go with "Reuse the interface".' });
  expect(await page.evaluate(() => window.mapLiteFixture.gestures)).toEqual([
    { trusted: false, type: "click", action: "reuse" }, { trusted: true, type: "click", action: "reuse" },
  ]);
  await expect(option).toBeDisabled();
});

for (const [width, theme] of [[1600, "dark"], [390, "light"]] as const) {
  test(`actual lite drawer controls, protected ask and history ${width} ${theme}`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/*", route => new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort());
    await page.setViewportSize({ width, height: 950 });
    await page.goto(`${fixture}?theme=${theme}`);
    await expect(page.locator(".command-map-project .command-map-badge")).toHaveText("2");
    await page.screenshot({ path: `${frames}/map-${width}-${theme}.png` });
    await page.getByRole("article", { name: "Choose the API contract" }).getByRole("button", { name: "Open project" }).click();
    const drawer = page.getByRole("dialog");
    await expect(drawer.getByRole("heading", { name: "map", exact: true })).toBeVisible();
    const everything = drawer.getByRole("button", { name: "Everything", exact: true });
    await everything.dispatchEvent("click");
    await expect(drawer.getByRole("alert")).toContainText("Couldn't save this setting");
    expect(await page.evaluate(() => window.mapLiteFixture.autonomy())).toBe("high-impact-only");
    await everything.focus(); await page.keyboard.press("Enter");
    await expect(everything).toHaveAttribute("aria-pressed", "true");
    expect(await page.evaluate(() => window.mapLiteFixture.autonomy())).toBe("everything");
    const protectedCard = drawer.getByRole("article", { name: "Send the project update?" });
    await expect(protectedCard.getByRole("button", { name: "Let the Boss decide" })).toHaveCount(0);
    expect(await drawer.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await drawer.getByRole("heading", { name: "This project decides" }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${frames}/drawer-${width}-${theme}.png` });
    await drawer.getByRole("article", { name: "Choose the API contract" }).getByRole("button", { name: "Let the Boss decide" }).click();
    await expect.poll(() => page.evaluate(() => window.mapLiteFixture.sends.length)).toBe(1);
    expect(await page.evaluate(() => window.mapLiteFixture.sends[0].sessionId)).toBe("boss-chat");
    await page.evaluate(() => window.mapLiteFixture.reply());
    await drawer.getByRole("button", { name: "Decision log", exact: true }).click();
    await expect(drawer.locator(".decision-log")).toBeVisible();
    await expect(drawer.locator(".decision-log")).toContainText("Reuse the interface");
    await page.keyboard.press("Escape");
    await expect(drawer).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  });
}
