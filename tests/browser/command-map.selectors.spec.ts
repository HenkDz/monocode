import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/*", route => new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort());
});

test("durable question survives a failed worker in the map tooltip and drawer", async ({ page }) => {
  await page.goto("/tests/browser/command-map.html?selector=question");
  const project = page.getByRole("button", { name: "Open browser-link-4 project", exact: true });
  await expect(project.locator('.command-map-team i').first()).toHaveAttribute("title", /Choose the API contract/);
  await project.click();
  const task = page.getByRole("dialog").locator(".command-map-task").first();
  await expect(task).toContainText("Choose the API contract");
  await expect(task).not.toContainText("Worker failed");
});

test("conflicting owner and project runs cannot inflate map or drawer progress", async ({ page }) => {
  await page.goto("/tests/browser/command-map.html?selector=progress");
  const project = page.getByRole("button", { name: "Open browser-link-4 project", exact: true });
  await expect(project.getByRole("progressbar")).toHaveAttribute("value", "0");
  await expect(project.getByRole("progressbar")).toHaveAttribute("max", "1");
  await project.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("progressbar")).toHaveAttribute("value", "0");
  await expect(dialog.getByRole("progressbar")).toHaveAttribute("max", "1");
  await expect(dialog).toContainText("0 of 1 tasks accepted · 0%");
});
