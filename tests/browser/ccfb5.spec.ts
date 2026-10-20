import { expect, test, type Locator } from "@playwright/test";

const evidence = "../cc-program/ccfeedback5/captures";
const baseline = process.env.CCFB5_BASELINE === "1";
async function hitTarget(button: Locator) {
  expect(await button.evaluate(el => {
    const bounds = el.getBoundingClientRect();
    const hit = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    return !!hit && el.contains(hit);
  })).toBe(true);
}
for (const [width, theme] of (baseline ? [[1440, "dark"], [390, "light"]] : [[1440, "dark"], [1440, "light"], [390, "dark"], [390, "light"]]) as [number, string][]) {
  test(`C5 sidebar caller ${width} ${theme}`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.setViewportSize({ width, height: 800 });
    await page.goto(`/tests/browser/ccfb5.html?theme=${theme}`);
    await expect(page.getByRole("button", { name: "Overview", exact: true })).toBeVisible();
    await page.screenshot({ path: `${evidence}/${baseline ? "before" : "after"}-shell-${width}-${theme}.png` });
    if (!baseline) {
      for (const count of [0, 1, 12, 100]) {
        await page.goto(`/tests/browser/ccfb5.html?theme=${theme}&count=${count}`);
        const nav = page.getByRole("navigation", { name: "Views" });
        const decision = nav.getByRole("button", { name: "Decisions", exact: true });
        const map = nav.getByRole("button", { name: "Command map", exact: true });
        const badge = decision.locator("span[aria-hidden]");
        await expect(badge).toHaveCount(count > 0 ? 1 : 0);
        if (count > 0) await expect(badge).toHaveText(count > 99 ? "99+" : `${count}`);
        const icon = await decision.locator("svg").boundingBox();
        const peerIcon = await map.locator("svg").boundingBox();
        expect(icon!.x).toBe(peerIcon!.x);
        expect((await decision.locator("span").first().boundingBox())!.x).toBe((await map.locator("span").first().boundingBox())!.x);
        if (count > 0) {
          const row = (await decision.boundingBox())!, bounds = (await badge.boundingBox())!;
          expect(row.x + row.width - bounds.x - bounds.width).toBe(8);
          const label = (await decision.locator("span").first().boundingBox())!;
          expect(label.x + label.width).toBeLessThanOrEqual(bounds.x);
        }
        await decision.click(); await map.click();
        expect(await page.evaluate(() => (window as any).ccfb5.events)).toEqual(["decisions", "map:org"]);
      }
    }
    expect(errors).toEqual([]);
  });
  if (!baseline) test(`C5 header caller ${width} ${theme}`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.setViewportSize({ width, height: 800 });
      for (const mono of ["boss", "alpha", "member"]) {
        await page.goto(`/tests/browser/ccfb5.html?theme=${theme}&mono=${mono}`);
        const pane = page.getByRole("main", { name: "Mono pane" });
        const map = pane.getByRole("button", { name: "Open Command map", exact: true });
        const overview = pane.getByRole("button", { name: "Overview", exact: true });
        const settings = pane.getByRole("button", { name: / settings$/ });
        await expect(map).toHaveCount(mono === "member" ? 0 : 1);
        const buttons = mono === "member" ? [overview, settings] : [map, overview, settings];
        const title = (await pane.getByRole("heading").boundingBox())!;
        const rects = [];
        for (const button of buttons) {
          await button.hover(); await hitTarget(button);
          const before = (await button.boundingBox())!;
          await button.focus(); await hitTarget(button);
          expect(await button.boundingBox()).toEqual(before);
          expect(before.y + before.height).toBeLessThanOrEqual(title.y);
          rects.push(before);
        }
        for (let i = 1; i < rects.length; i++) expect(rects[i - 1].x + rects[i - 1].width).toBeLessThanOrEqual(rects[i].x);
        await buttons[0].focus();
        await page.keyboard.press("Enter");
        if (mono !== "member") { await page.keyboard.press("Tab"); await expect(overview).toBeFocused(); await page.keyboard.press("Space"); }
        await page.keyboard.press("Tab"); await expect(settings).toBeFocused(); await page.keyboard.press("Enter");
        expect(await page.evaluate(() => (window as any).ccfb5.events)).toEqual(mono === "member" ? ["overview", "settings"] : [`map:${mono === "boss" ? "org" : mono}`, "overview", "settings"]);
        if (mono === "boss") await page.screenshot({ path: `${evidence}/after-header-focus-${width}-${theme}.png` });
      }
    expect(errors).toEqual([]);
  });
  test(`C5 ordering selector ${width} ${theme}`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.setViewportSize({ width, height: 800 });
    await page.goto(`/tests/browser/ccfb5.html?surface=map&theme=${theme}`);
    await expect(page.getByRole("button", { name: "Move project right" })).toBeVisible();
    await page.screenshot({ path: `${evidence}/${baseline ? "before" : "after"}-map-${width}-${theme}.png` });
    if (!baseline) {
      const selector = page.getByRole("button", { name: "Project to reorder: alpha", exact: true });
      const left = page.getByRole("button", { name: "Move project left" });
      const right = page.getByRole("button", { name: "Move project right" });
      expect((await page.getByRole("combobox", { name: "Project", exact: true }).boundingBox())!.width).toBeGreaterThanOrEqual(width > 680 ? 90 : 112);
      for (const peer of [left, right, page.getByRole("button", { name: "Orbit", exact: true }), page.getByRole("button", { name: "Arrange", exact: true })]) {
        const selected = (await selector.boundingBox())!, bounds = (await peer.boundingBox())!;
        expect(Math.abs(selected.y - bounds.y)).toBeLessThanOrEqual(1);
        expect(Math.abs(selected.height - bounds.height)).toBeLessThanOrEqual(1);
      }
      const managers = page.locator('.team-map-node[data-role="manager"]');
      const order = () => managers.evaluateAll(nodes => nodes.map(node => node.getAttribute("data-id")));
      expect(await order()).toEqual(["alpha", "beta", "gamma"]);
      await selector.focus(); await page.keyboard.press("ArrowDown");
      const menu = page.getByRole("dialog", { name: "Project to reorder options" });
      await expect(menu).toBeVisible();
      await page.screenshot({ path: `${evidence}/after-menu-${width}-${theme}.png` });
      await page.keyboard.press("End"); await page.keyboard.press("Enter");
      const selected = page.getByRole("button", { name: "Project to reorder: gamma", exact: true });
      await expect(selected).toBeFocused();
      expect(await order()).toEqual(["alpha", "beta", "gamma"]);
      await expect(left).toBeEnabled(); await expect(right).toBeDisabled();
      await selected.click(); await page.keyboard.press("Escape");
      await expect(menu).toHaveCount(0); await expect(selected).toBeFocused();
      expect(await page.evaluate(() => (window as any).ccfb5.events)).toEqual([]);
      await left.click();
      expect(await order()).toEqual(["alpha", "gamma", "beta"]);
      expect(await page.evaluate(() => JSON.parse(localStorage.getItem("monocode:team-map-orbit")!).order)).toEqual(["alpha", "gamma", "beta"]);
      await page.getByRole("button", { name: "Arrange", exact: true }).click();
      expect(await order()).toEqual(["alpha", "gamma", "beta"]);
      // The existing narrow layout hides the hint containing Undo; restore with the visible arrow there.
      if (width > 680) await page.getByRole("button", { name: "Undo reorder" }).click();
      else { await expect(page.getByRole("button", { name: "Undo reorder" })).toBeHidden(); await right.click(); }
      expect(await order()).toEqual(["alpha", "beta", "gamma"]);
      await selected.click(); await menu.getByRole("option", { name: "beta", exact: true }).click();
      await expect(page.getByRole("button", { name: "Project to reorder: beta", exact: true })).toBeFocused();
      await right.click(); expect(await order()).toEqual(["alpha", "gamma", "beta"]);
      await page.getByRole("combobox", { name: "Project", exact: true }).selectOption("C:/synthetic/alpha");
      expect(await order()).toEqual(["alpha"]);
      await page.getByRole("combobox", { name: "Project", exact: true }).selectOption("");
      expect(await order()).toEqual(["alpha", "gamma", "beta"]);
      await page.reload(); expect(await order()).toEqual(["alpha", "gamma", "beta"]);
    }
    expect(errors).toEqual([]);
  });
}
