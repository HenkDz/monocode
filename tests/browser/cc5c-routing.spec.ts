import { expect, test } from "@playwright/test";

for (const surface of ["embedded", "floating"]) {
  for (const theme of ["dark", "light"]) {
    test(`${surface} goal route, conflict, override and submission in ${theme}`, async ({
      page,
    }, testInfo) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.setViewportSize({
        width: surface === "floating" ? 360 : 1000,
        height: 640,
      });
      await page.goto(
        `/tests/browser/cc5c-routing.html?surface=${surface}&theme=${theme}`,
      );
      await page.getByRole("button", { name: "New goal", exact: true }).click();
      await expect(page.getByRole("status")).toContainText(
        "Send to DZDistro Manager",
      );
      await expect(page.getByRole("status")).toContainText(
        "Exact project name",
      );
      await expect(
        page.getByRole("button", { name: "Send", exact: true }),
      ).toBeInViewport();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(surface === "floating" ? 360 : 1000);
      await page.screenshot({
        path: testInfo.outputPath(`${surface}-${theme}-auto.png`),
      });
      const composer = page.getByRole("textbox", {
        name: "Message Grand Orchestrator", exact: true,
      });
      const conflicts = [
        "Fix DZDistro and MonoCode.",
        "Fix DZDistro. Update MonoCode",
        "Fix DZDistro... and MonoCode",
      ];
      for (const text of conflicts) {
        await composer.fill(text);
        await expect(page.getByRole("status")).toContainText("Send to Grand Orch");
        await expect(page.getByRole("status")).toContainText("More than one project mentioned");
      }
      const pathGoal = "Fix DZDistro and C:/fixtures/work/../other/src/index.ts";
      await composer.fill(pathGoal);
      await expect(page.getByRole("status")).toContainText("Send to Grand Orch");
      await expect(page.getByRole("status")).toContainText("Contains file paths");
      await page
        .getByRole("button", { name: "Goal route: Auto route", exact: true })
        .click();
      await page
        .getByRole("option", { name: "Grand Orch", exact: true })
        .click();
      await expect(page.getByRole("status")).toContainText(
        "Send to Grand Orch",
      );
      await page
        .getByRole("button", { name: "Goal route: Grand Orch", exact: true })
        .click();
      await page
        .getByRole("option", { name: "DZDistro Manager", exact: true })
        .click();
      for (const text of conflicts) {
        await composer.fill(text);
        await expect(page.getByRole("status")).toContainText("Send to Grand Orch");
        await expect(page.getByRole("status")).toContainText("More than one project mentioned");
      }
      await expect(
        page.getByRole("button", { name: "Goal route: DZDistro Manager", exact: true }),
      ).toBeVisible();
      await page.screenshot({
        path: testInfo.outputPath(`${surface}-${theme}-conflict.png`),
      });
      await composer.fill(pathGoal);
      await expect(page.getByRole("status")).toContainText(
        "Contains file paths: routed to DZDistro because you selected it",
      );
      await page.screenshot({
        path: testInfo.outputPath(`${surface}-${theme}-override.png`),
      });
      await page.getByRole("button", { name: "Send", exact: true }).click();
      await expect(page.locator("[data-submission]")).toContainText(
        '"managerMonoId":"fixture-dzdistro-manager"',
      );
      await expect(page.locator("[data-submission]")).toContainText(
        '"override":"manager"',
      );
      await expect(page.locator("[data-submission]")).toContainText(
        '"reason":"Contains file paths: routed to DZDistro because you selected it"',
      );
      await expect(
        page.getByRole("textbox", {
          name: "Message Grand Orchestrator",
          exact: true,
        }),
      ).toHaveValue("");
      expect(errors).toEqual([]);
    });
  }
}
