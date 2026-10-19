import { expect, test } from "@playwright/test";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
const evidence = process.env.CCVISION_FRAMES ?? "test-results/ccvision/frames";
const prototypes = process.env.CCVISION_PROTOTYPES ?? "../cc-program/vision";
test("opens both approved file-only prototypes for comparison", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.goto(pathToFileURL(resolve(prototypes, "index.html")).href);
  await expect(page).toHaveTitle(/Command Map/);
  await page.screenshot({ path: `${evidence}/prototype-map.png` });
  await page.goto(pathToFileURL(resolve(prototypes, "workspace.html")).href);
  await expect(page.locator(".side")).toContainText("Search or ask the Boss");
  await page.screenshot({ path: `${evidence}/prototype-workspace.png` });
});
for (const width of [1440, 860, 390])
  for (const theme of ["dark", "light"]) {
    test(`actual V1 shell and context ${width} ${theme}`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route("**/*", (route) =>
        new URL(route.request().url()).hostname === "127.0.0.1"
          ? route.continue()
          : route.abort(),
      );
      await page.setViewportSize({ width, height: 950 });
      await page.goto(`/tests/browser/ccvision-workspace.html?theme=${theme}`);
      await expect(
        page.getByRole("tabpanel", { name: "Goal & tasks" }),
      ).toContainText("Profile routing");
      await expect(
        page.getByRole("tabpanel", { name: "Goal & tasks" }),
      ).toContainText("Not configured");
      await page.screenshot({ path: `${evidence}/goal-${width}-${theme}.png` });
      if (width < 901)
        await page
          .getByRole("button", { name: "Close project context" })
          .click();
      for (const name of [
        "Command map",
        "Decisions",
        "Inbox",
        "Notes",
        "Automations",
        "Usage",
      ])
        await expect(
          page.getByRole("button", { name, exact: true }),
        ).toBeVisible();
      await expect(page.locator('[data-workspace-mono="Boss"]')).toContainText(
        "all projects",
      );
      await expect(
        page.locator('[data-workspace-mono="Manager"]'),
      ).toBeVisible();
      await expect(page.locator('[data-workspace-mono="Atlas"]')).toContainText(
        "Thinking",
      );
      await page.locator('[data-workspace-mono="Iris"]').click();
      await expect(page.locator(".vision-manager")).toContainText("Iris");
      await page
        .getByRole("button", { name: "Ask the Boss", exact: true })
        .click();
      await expect(page.locator(".vision-manager")).toContainText("Boss");
      await expect(
        page
          .getByRole("button", { name: /Worktree feat\/chooser-dialog/ })
          .locator('[data-agent-state="thinking"]'),
      ).toHaveCount(1);
      await page
        .getByRole("button", { name: /Worktree feat\/chooser-dialog/ })
        .click();
      const panel = page.getByRole("tabpanel", {
        name: "Worktree",
        exact: true,
      });
      await expect(panel).toContainText("Preserve chooser keyboard focus");
      await expect(panel).toContainText("APPROVED");
      await expect(panel).toContainText("2 / 1");
      await expect(
        panel.getByRole("button", { name: "Update from main" }),
      ).toBeDisabled();
      await page.screenshot({
        path: `${evidence}/worktree-${width}-${theme}.png`,
      });
      await panel
        .getByRole("button", { name: "Merge pull request", exact: true })
        .click();
      const confirm = page.getByRole("dialog", {
        name: "Merge this pull request?",
      });
      await expect(confirm).toBeVisible();
      await confirm
        .getByRole("button", { name: "Cancel", exact: true })
        .click();
      expect(
        await page.evaluate(
          () =>
            (
              window as unknown as {
                visionFixture: { events: { action: string }[] };
              }
            ).visionFixture.events.filter((event) =>
              event.action.startsWith("blocked:"),
            ).length,
        ),
      ).toBe(0);
      await page.getByRole("button", { name: "Close project context" }).click();
      await page
        .getByRole("button", { name: /Worktree spike\/profile-catalog/ })
        .click();
      await page
        .getByRole("button", { name: "Create PR", exact: true })
        .click();
      await expect(
        page.getByRole("dialog", { name: "Create pull request" }),
      ).toBeVisible();
      await page
        .getByRole("dialog", { name: "Create pull request" })
        .getByRole("button", { name: "Close", exact: true })
        .click();
      await page.getByRole("button", { name: "Close project context" }).click();
      await page
        .getByRole("tab", { name: "empty-project", exact: true })
        .click();
      await expect(page.locator("[data-workspace-team]")).toHaveCount(1);
      await expect(page.locator("[data-workspace-team]")).toContainText(
        "No Manager assigned",
      );
      await expect(page.locator('[data-workspace-mono="Boss"]')).toBeVisible();
      await page
        .getByRole("button", { name: "Goal & tasks", exact: true })
        .click();
      await page
        .getByRole("tab", { name: "Goal & tasks", exact: true })
        .click();
      await expect(
        page.getByRole("tabpanel", { name: "Goal & tasks" }),
      ).toContainText("No recorded goals");
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      expect(errors).toEqual([]);
    });
  }
