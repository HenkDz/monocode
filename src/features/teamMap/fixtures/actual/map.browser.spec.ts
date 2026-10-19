import { expect, test } from "@playwright/test";
const fixture = "/src/features/teamMap/fixtures/actual/index.html";
const frames = "../cc-program/ccvision/v3-actual-wiring/frames";
const question = "Choose the API contract";
const optionName = "Reuse the interface Recommended";

test.beforeEach(async ({ page }) => {
  await page.route("**/*", route => new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort());
});

test("actual App hydration hides counts until ready and exposes load failure/retry", async ({ page }) => {
  await page.goto(`${fixture}?load=hold`);
  await expect(page.getByRole("status")).toHaveText("Loading decisions…");
  await expect(page.locator(".command-map-vitals")).toContainText("— need you");
  await expect(page.locator(".decision-card")).toHaveCount(0);
  await page.evaluate(() => window.actualMapFixture.release());
  await expect(page.getByRole("article", { name: question })).toBeVisible();
  await page.goto(`${fixture}?load=fail`);
  await expect(page.getByRole("alert")).toContainText("Couldn't load earlier decisions");
  await expect(page.locator(".command-map-vitals")).toContainText("— need you");
  await page.evaluate(() => window.actualMapFixture.recover());
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.getByRole("article", { name: question })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("actual App answer forwards native gesture and recorded chat, refuses synthetic/refused sends", async ({ page }) => {
  await page.goto(fixture);
  const card = page.getByRole("article", { name: question });
  const option = card.getByRole("button", { name: optionName });
  await option.dispatchEvent("click");
  await expect(card.getByRole("alert")).toContainText("Couldn't reach Atlas");
  expect(await page.evaluate(() => window.actualMapFixture.sends)).toEqual([]);
  await page.evaluate(() => window.actualMapFixture.refuse(true));
  await option.click();
  await expect(card.getByRole("alert")).toContainText("Couldn't reach Atlas");
  await expect(option).toBeEnabled();
  await page.evaluate(() => window.actualMapFixture.refuse(false));
  await option.dblclick();
  expect(await page.evaluate(() => window.actualMapFixture.sends)).toEqual([{ sessionId: "worker-chat", text: 'Decision on your question "Choose the API contract": go with "Reuse the interface".', attachments: [] }]);
  await expect(page.locator(".decision-card[data-sent] button").first()).toBeDisabled();
});

test("actual App full actions preserve accepted state across map drawer remount after log failure", async ({ page }) => {
  await page.goto(`${fixture}?failSave`);
  const card = page.getByRole("article", { name: question });
  await card.getByRole("button", { name: optionName }).click();
  await expect(card.getByRole("status")).toContainText("Couldn't update the log");
  await page.getByRole("article", { name: "Send the project update?" }).getByRole("button", { name: "Open project" }).click();
  const drawerCard = page.getByRole("dialog").getByRole("article", { name: question });
  await expect(drawerCard.getByRole("button", { name: optionName })).toBeDisabled();
  await expect(drawerCard.getByRole("status")).toHaveText("Answer sent");
  expect(await page.evaluate(() => window.actualMapFixture.sends.length)).toBe(1);
});

test("Boss form executes existing App Grand callback, real session setup and stable uncertain retry IDs", async ({ page }) => {
  await page.goto(`${fixture}?uncertainGoal`);
  const field = page.getByRole("textbox", { name: "Tell the Boss what you want" });
  await field.fill("Fix the map API");
  await field.press("Enter");
  await expect(page.getByRole("alert")).toContainText("Fixture uncertain acceptance");
  await expect(field).toHaveValue("Fix the map API");
  await field.press("Enter");
  await expect(field).toHaveValue("");
  const result = await page.evaluate(() => ({ goals: window.actualMapFixture.goals, setup: window.actualMapFixture.sessionSetup, sends: window.actualMapFixture.sends }));
  expect(result.goals).toHaveLength(2);
  expect(result.goals[1]).toEqual(result.goals[0]);
  expect(result.goals[0].submission).toMatchObject({ ownerId: "boss", choice: { mode: "goal", override: "grand" } });
  expect(result.goals[0].submission.requestId).toBeTruthy();
  expect(result.goals[0].submission.userMessageId).toBeTruthy();
  expect(result.setup).toEqual(["boss", "boss"]);
  expect(result.sends).toEqual([]);
});

for (const [width, theme] of [[1600, "dark"], [390, "light"]] as const) {
  test(`actual App project/autonomy/delegation/current roster and focus ${width} ${theme}`, async ({ page }) => {
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    await page.setViewportSize({ width, height: 950 });
    await page.goto(`${fixture}?theme=${theme}`);
    await expect(page.locator(".command-map-project .command-map-badge")).toHaveText("2");
    await expect(page.getByRole("button", { name: "Close team map" })).toBeFocused();
    await page.screenshot({ path: `${frames}/map-${width}-${theme}.png` });
    await page.getByRole("article", { name: question }).getByRole("button", { name: "Open project" }).click();
    const drawer = page.getByRole("dialog");
    await expect(drawer.getByRole("heading", { name: "map", exact: true })).toBeVisible();
    await expect(drawer.getByRole("button", { name: "Close project" })).toBeFocused();
    const everything = drawer.getByRole("button", { name: "Everything", exact: true });
    await everything.dispatchEvent("click");
    await expect(drawer.getByRole("alert")).toContainText("Couldn't save this setting");
    await everything.focus(); await page.keyboard.press("Enter");
    await expect(everything).toHaveAttribute("aria-pressed", "true");
    await expect(drawer.getByRole("article", { name: "Send the project update?" }).getByRole("button", { name: "Let the Boss decide" })).toHaveCount(0);
    await page.evaluate(() => window.actualMapFixture.addAsk());
    await expect(drawer.getByRole("article", { name: "A new live ask?" })).toBeVisible();
    await drawer.getByRole("heading", { name: "This project decides" }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${frames}/drawer-${width}-${theme}.png` });
    expect(await drawer.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await drawer.getByRole("article", { name: question }).getByRole("button", { name: "Let the Boss decide" }).click();
    await expect.poll(() => page.evaluate(() => window.actualMapFixture.sends.length)).toBe(1);
    expect(await page.evaluate(() => window.actualMapFixture.sends[0].sessionId)).not.toBe("worker-chat");
    await page.evaluate(() => window.actualMapFixture.reply());
    await drawer.getByRole("button", { name: "Decision log", exact: true }).click();
    await expect(drawer.locator(".decision-log")).toContainText("Reuse the interface");
    await page.keyboard.press("Escape"); await expect(drawer).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Open map project", exact: true })).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.evaluate(() => window.actualMapFixture.archive());
    await expect(page.locator(".command-map-project")).toHaveCount(0);
    await page.getByRole("button", { name: "Open chat with Boss" }).click();
    expect(await page.evaluate(() => window.actualMapFixture.opened)).toEqual(["boss"]);
    await expect(page.locator(".command-map")).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}

test("App clock refreshes team-today count at local midnight", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-10-19T23:59:50") });
  await page.goto(fixture);
  await page.getByRole("article", { name: question }).getByRole("button", { name: "Let the Boss decide" }).click();
  await page.evaluate(() => window.actualMapFixture.reply());
  const count = page.locator(".command-map-vitals span").filter({ hasText: "decided by team today" });
  await expect(count).toHaveText("1 decided by team today");
  await page.clock.fastForward(20_000);
  await expect(count).toHaveText("0 decided by team today");
});
