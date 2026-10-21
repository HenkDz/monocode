import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
const evidence = process.env.CCWB1_EVIDENCE ?? "test-results/ccwb1";
mkdirSync(evidence, { recursive: true });
test.setTimeout(120_000);
const events = (page: any) => page.evaluate(() => (window as any).ccwb1.events);
const navigate = async (page: any, query = "") => {
  await page.goto(`/tests/browser/ccwb1-workbench.html?${query}`);
  await expect(page.locator("[data-workbench-header]:visible")).toBeVisible();
};
const task = async (page: any) => {
  await page
    .locator("[data-workbench-header]:visible")
    .getByRole("button", { name: "View live", exact: true })
    .click();
  await expect(page.locator("[data-view]")).toContainText("task-session");
};
for (const width of [1440, 640])
  for (const theme of ["dark", "light"]) {
    test(`connected Home/task navigation, controls and capture ${width} ${theme}`, async ({
      page,
    }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route("**/*", (route) =>
        new URL(route.request().url()).hostname === "127.0.0.1"
          ? route.continue()
          : route.abort(),
      );
      await page.setViewportSize({ width, height: 1050 });
      await navigate(page, `theme=${theme}`);
      const header = page.locator("[data-workbench-header]:visible");
      await expect(header).toContainText("Home chat");
      await expect(header).toContainText("Current task");
      await expect(header).toContainText("Usage");
      await expect(
        page.getByRole("button", { name: "Stop", exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("group", { name: "Message delivery" }),
      ).toHaveCount(0);
      const homeComposer = page.getByRole("textbox", {
        name: "Message Iris",
        exact: true,
      });
      await homeComposer.fill("Home stays home");
      await page.getByRole("button", { name: "Send", exact: true }).click();
      expect(await events(page)).toContainEqual(
        expect.objectContaining({
          action: "submit",
          id: "iris-home",
          text: "Home stays home",
        }),
      );
      await expect(homeComposer).toHaveValue("Home stays home");
      await page.screenshot({ path: `${evidence}/home-${width}-${theme}.png` });
      if (width === 640)
        await page.getByRole("button", { name: "Work", exact: true }).click();
      const open = page.locator("[data-task-open]");
      await open.focus();
      await page.keyboard.press("Enter");
      await expect(page.locator("[data-view]")).toContainText("task-session");
      await expect(page.locator('[role="dialog"]')).toHaveCount(0);
      await expect(header).toContainText("Design profile management");
      await expect(header).toContainText("Iris · Tasks & history");
      await expect(
        page.getByText(
          "I will check the profile list and switching behavior, then map the controls to the existing settings flow.",
          { exact: true },
        ),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Stop", exact: true }),
      ).toHaveCount(1);
      await page
        .getByRole("button", { name: "Open worktree", exact: true })
        .click();
      await expect
        .poll(
          async () =>
            (await events(page)).filter(
              (event: any) => event.action === "open-folder",
            ).length,
        )
        .toBe(1);
      expect(await events(page)).toContainEqual({
        action: "open-folder",
        args: { path: "C:/synthetic/BrowserLink/gpui-v4" },
      });
      await expect(page.locator("[data-view]")).toContainText("task-session");
      const mode = page.getByRole("group", { name: "Message delivery" });
      await mode.getByRole("button", { name: "Queue", exact: true }).focus();
      await page.keyboard.press("ArrowRight");
      await expect(
        mode.getByRole("button", { name: "Steer", exact: true }),
      ).toBeFocused();
      await expect(page.locator(".cc7u-delivery:visible")).toHaveText(
        "Steers the running turn",
      );
      const input = page
        .locator("[data-session-composer] textarea")
        .filter({ visible: true })
        .first();
      await input.fill("Check the new evidence");
      await page.getByRole("button", { name: "Send", exact: true }).click();
      expect(await events(page)).toContainEqual(
        expect.objectContaining({
          action: "submit",
          id: "task-session",
          behavior: "steer",
          options: expect.objectContaining({ followUpBehavior: "steer" }),
        }),
      );
      await mode.getByRole("button", { name: "Queue", exact: true }).click();
      await expect(page.locator(".cc7u-delivery:visible")).toHaveText(
        "Message will follow the current turn",
      );
      await page.getByRole("button", { name: "Send", exact: true }).click();
      expect(await events(page)).toContainEqual(
        expect.objectContaining({
          action: "submit",
          id: "task-session",
          behavior: "queue",
          options: expect.objectContaining({ followUpBehavior: "queue" }),
        }),
      );
      await expect(input).toHaveValue("Check the new evidence");
      if (width === 640)
        await page.getByRole("button", { name: "Work", exact: true }).click();
      const brief = page.getByRole("region", { name: "Task brief" });
      await expect(brief).toContainText("Read-only");
      await expect(brief).toContainText("9 inherited changes");
      const expand = brief.locator("button[aria-expanded]");
      await expect(expand).toContainText("Show work");
      await expand.focus();
      await page.keyboard.press("Enter");
      await expect(expand).toHaveAttribute("aria-expanded", "true");
      await expect(brief.locator("details, summary")).toHaveCount(0);
      await page.keyboard.press("Enter");
      await expect(expand).toHaveAttribute("aria-expanded", "false");
      if (width === 640) {
        const drawer = page.locator(
          '[data-session-drop="task-session"] [data-member-work]',
        );
        const composer = page.locator(
          '[data-session-drop="task-session"] [data-session-composer]',
        );
        const box = await drawer.boundingBox(),
          dock = await composer.boundingBox();
        expect(box!.y + box!.height).toBeLessThanOrEqual(dock!.y);
        await expand.click();
        expect(
          await drawer.evaluate(
            (element: HTMLElement) =>
              element.scrollHeight > element.clientHeight,
          ),
        ).toBe(true);
        await drawer.evaluate((element: HTMLElement) => {
          element.scrollTop = element.scrollHeight;
        });
        await expect(
          page.getByRole("button", { name: "Close work", exact: true }),
        ).toBeInViewport();
        await expect(
          page.locator(
            '[data-session-drop="task-session"] [data-org-artifact="profile-report"]',
          ),
        ).toBeInViewport();
        await page
          .getByRole("button", { name: "Close work", exact: true })
          .focus();
        await page.keyboard.press("Escape");
        await expect(drawer).not.toBeVisible();
        await expect(
          page.getByRole("button", { name: "Work", exact: true }),
        ).toBeFocused();
        expect(
          (await events(page)).filter((event: any) => event.action === "stop"),
        ).toHaveLength(0);
        await page.getByRole("button", { name: "Work", exact: true }).click();
        await drawer.evaluate((element: HTMLElement) => {
          element.scrollTop = 0;
        });
        await brief.locator("button[aria-expanded]").click();
      }
      await page.screenshot({ path: `${evidence}/task-${width}-${theme}.png` });
      if (width === 640)
        await page
          .getByRole("button", { name: "Close work", exact: true })
          .click();
      await page.getByRole("button", { name: "Back", exact: true }).click();
      await expect(page.locator("[data-view]")).toContainText("iris-home");
      await expect(homeComposer).toHaveValue("Home stays home");
      await page.getByRole("button", { name: "Back", exact: true }).click();
      await expect(page.locator("[data-view]")).toContainText("other-session");
      await page.getByRole("button", { name: "Forward", exact: true }).click();
      await expect(page.locator("[data-view]")).toContainText("iris-home");
      await page.getByRole("button", { name: "Forward", exact: true }).click();
      await expect(page.locator("[data-view]")).toContainText("task-session");
      await page
        .getByRole("button", { name: "Iris · Tasks & history", exact: true })
        .click();
      await expect(page.locator("[data-view]")).toContainText("iris-home");
      await task(page);
      await page.getByRole("button", { name: "Stop", exact: true }).click();
      expect(await events(page)).toContainEqual({
        action: "stop",
        id: "task-session",
      });
      expect(errors).toEqual([]);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    });
  }
test("folder absence/removal and late loss fail closed; read-only task can reveal", async ({
  page,
}) => {
  for (const checkout of ["absent", "removed"]) {
    await navigate(page, `checkout=${checkout}`);
    await task(page);
    await expect(
      page.getByRole("button", { name: "Open worktree", exact: true }),
    ).toHaveCount(0);
  }
  await page.setViewportSize({ width: 640, height: 1050 });
  await navigate(page);
  await task(page);
  await expect(
    page.locator(
      '[data-session-drop="task-session"] [aria-label="Composer target"]',
    ),
  ).toBeVisible();
  await expect(
    page.locator(
      '[data-session-drop="task-session"] [aria-label="Composer target"]',
    ),
  ).toHaveText("Iris · Task");
  await expect(
    page.getByRole("button", { name: "Open worktree", exact: true }),
  ).toBeVisible();
  await page.evaluate(() => (window as any).ccwb1.removeFolder());
  await page
    .getByRole("button", { name: "Open worktree", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("Checkout missing");
  await expect(page.getByRole("alert")).toBeInViewport();
  expect(
    (await events(page)).filter((event: any) => event.action === "open-folder"),
  ).toHaveLength(0);
});

test("a delayed folder check cannot reveal a task folder after its pane becomes hidden", async ({
  page,
}) => {
  await navigate(page);
  await task(page);
  await expect(
    page.getByRole("button", { name: "Open worktree", exact: true }),
  ).toBeVisible();
  await page.evaluate(() => (window as any).ccwb1.deferFolderCheck());
  await page
    .getByRole("button", { name: "Open worktree", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Iris · Tasks & history", exact: true })
    .click();
  await expect(page.locator("[data-view]")).toContainText("iris-home");
  await expect(page.locator('[data-session-drop="task-session"]')).toHaveCount(
    1,
  );
  await expect(
    page.locator('[data-session-drop="task-session"]'),
  ).not.toBeVisible();
  await page.evaluate(() => (window as any).ccwb1.finishFolderCheck());
  expect(
    (await events(page)).filter((event: any) => event.action === "open-folder"),
  ).toHaveLength(0);
});
test("queued/idle/unsupported/approval/storage controls retain their targets and guards", async ({
  page,
}) => {
  await navigate(page, "state=none");
  await expect(
    page.getByText("No conversation yet. Send a message to get started.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "View live", exact: true }),
  ).toHaveCount(0);
  await navigate(page, "state=queued");
  await expect(
    page.getByText("Iris is queued for", { exact: true }),
  ).toBeVisible();
  await task(page);
  await expect(
    page.locator(
      '[data-session-drop="task-session"] [aria-label="Composer target"]',
    ),
  ).toHaveText("Iris · Task");
  await expect(
    page.locator('[data-session-drop="task-session"] .cc7u-composer'),
  ).toBeVisible();
  await expect(
    page.getByRole("group", { name: "Message delivery" }),
  ).toHaveCount(0);
  for (const query of ["supports=no", "state=approval", "state=blocked"]) {
    await navigate(page, query);
    await task(page);
    await expect(
      page.getByRole("group", { name: "Message delivery" }),
    ).toHaveCount(0);
    if (query === "state=blocked")
      await expect(
        page.getByRole("status", { name: "Conversation couldn’t start" }),
      ).toHaveCount(1);
    if (query === "state=approval")
      await expect(
        page.getByLabel("Command awaiting approval", { exact: true }),
      ).toHaveText("printf 'verbatim approval'");
  }
  await navigate(page);
  await page.evaluate(() => (window as any).ccwb1.ownBusy());
  await expect(
    page.getByRole("button", { name: "Stop", exact: true }),
  ).toHaveCount(1);
  const mode = page.getByRole("group", { name: "Message delivery" });
  await expect(mode).toBeVisible();
  await page
    .getByRole("textbox", { name: "Message Iris", exact: true })
    .fill("Queue home follow-up");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  expect(await events(page)).toContainEqual(
    expect.objectContaining({
      action: "submit",
      id: "iris-home",
      behavior: "queue",
    }),
  );
});
