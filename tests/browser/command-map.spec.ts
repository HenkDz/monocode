import { expect, test } from "@playwright/test";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
const frames = "../cc-program/ccvision/v3-independent/frames";

test("approved prototype map and drawer reference", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.goto(pathToFileURL(resolve("../cc-program/vision/index.html")).href);
  await expect(page.locator(".boss")).toBeVisible();
  await page.screenshot({ path: `${frames}/prototype-map.png` });
  await page.locator(".proj").first().click();
  await expect(page.locator(".drawer.open")).toBeVisible();
  await page.screenshot({ path: `${frames}/prototype-drawer.png` });
});

for (const [width, theme] of [[1600, "dark"], [1600, "light"], [860, "dark"], [390, "light"]] as const) {
  test(`independent map ${width} ${theme} focus, overflow and route`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/*", route => new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort());
    await page.setViewportSize({ width, height: 950 });
    await page.goto(`/tests/browser/command-map.html?theme=${theme}`);
    const projects = page.locator(".command-map-project");
    await expect(projects).toHaveCount(4);
    await expect(page.getByRole("textbox", { name: "Tell the Boss what you want" })).toBeDisabled();
    await expect(page.locator(".command-map-links path[data-working=true]")).toHaveCount(4);
    expect(await page.locator(".command-map-links path").first().evaluate(element => getComputedStyle(element).animationName)).toBe("command-map-line");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `${frames}/map-${width}-${theme}.png` });
    if (width === 1600 && theme === "dark") {
      const pulse = page.locator(".command-map-links path").first();
      const low = await pulse.evaluate(element => {
        const animation = element.getAnimations()[0]; animation.pause(); animation.currentTime = 0;
        return getComputedStyle(element).strokeOpacity;
      });
      await page.screenshot({ path: `${frames}/pulse-low.png` });
      const high = await pulse.evaluate(element => { element.getAnimations()[0].currentTime = 1400; return getComputedStyle(element).strokeOpacity; });
      expect(Number(high)).toBeGreaterThan(Number(low));
      await page.screenshot({ path: `${frames}/pulse-high.png` });
      await pulse.evaluate(element => element.getAnimations()[0].play());
    }
    const first = projects.first();
    await first.focus();
    await page.keyboard.press("ArrowRight");
    await expect(projects.nth(1)).toBeFocused();
    await first.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "browser-link-4", exact: true })).toBeVisible();
    const close = page.getByRole("button", { name: "Close project", exact: true });
    await expect(close).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(page.getByRole("button", { name: "Message browser-link-4 Manager" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(close).toBeFocused();
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await expect(dialog.locator(".command-map-goal")).toBeVisible();
    await page.screenshot({ path: `${frames}/drawer-${width}-${theme}.png` });
    await dialog.getByRole("button", { name: /Show work/ }).first().click();
    await expect(dialog.getByText("Saved synthetic work evidence")).toBeVisible();
    await page.screenshot({ path: `${frames}/drawer-work-${width}-${theme}.png` });
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(first).toBeFocused();
    await first.click();
    await page.getByRole("button", { name: "Message browser-link-4 Manager" }).click();
    expect(await page.evaluate(() => (window as unknown as { commandMapFixture: { events: string[] } }).commandMapFixture.events)).toEqual(["close", "open:manager-0"]);
    expect(errors).toEqual([]);
  });
}

test("whole-line pulse is static under reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/tests/browser/command-map.html");
  await expect(page.locator('.command-map[data-reduced-motion="true"]')).toBeVisible();
  expect(await page.locator(".command-map-links path").first().evaluate(element => getComputedStyle(element).animationName)).toBe("none");
  expect(await page.locator("animateMotion").count()).toBe(0);
  await page.screenshot({ path: `${frames}/reduced-motion.png` });
});
