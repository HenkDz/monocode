import { expect, test } from "@playwright/test";

test.setTimeout(120_000);

for (const width of [1440, 1100]) {
  for (const theme of ["dark", "light"]) {
    for (const scenario of [
      "failed",
      "waiting",
      "working",
      "zero",
      "long-history",
    ]) {
      test(`${scenario} Workbench at ${width}px ${theme}`, async ({
        page,
      }, testInfo) => {
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.setViewportSize({ width, height: 1000 });
        await page.goto(
          `/tests/browser/cc7u-workbench.html?scenario=${scenario}&theme=${theme}`,
          { waitUntil: "commit" },
        );
        const header = page.locator("[data-workbench-header]");
        await expect(header).toBeVisible({ timeout: 90_000 });
        const work = page.locator("[data-member-work]");
        const conversation = page.locator("[data-workbench-conversation]");
        const composer = page.getByRole("textbox", {
          name: `Message ${["working", "waiting"].includes(scenario) ? "Native Core" : "Reviewer"}`,
          exact: true,
        });
        await expect(work).toBeVisible();
        await expect(conversation).toBeVisible();
        await expect(composer).toHaveValue("Keep my draft");
        await expect(composer).toBeInViewport();
        await expect(header.locator("[data-workbench-metrics]")).toHaveCount(1);
        await expect(header).not.toContainText("cached");
        if (scenario !== "zero") {
          const transcript = page.getByRole("tabpanel", {
            name: "Conversation",
            exact: true,
          });
          await expect(
            transcript.getByText(
              "I’ll check the window lifecycle, then follow the activation route into the selected browser. I’ll keep source evidence and live acceptance separate.",
              { exact: true },
            ),
          ).toBeVisible();
          await expect(
            transcript.getByLabel(
              "Tool call: Read window lifecycle and routing",
              { exact: true },
            ),
          ).toBeVisible();
          await expect(
            transcript.getByLabel("Tool call: Run focused routing checks", {
              exact: true,
            }),
          ).toBeVisible();
          await expect(
            transcript.locator("button[aria-expanded], details, summary"),
          ).toHaveCount(0);
        }
        if (scenario === "failed") {
          await expect(
            work.getByRole("status", { name: "Conversation couldn’t start" }),
          ).toBeVisible();
          await expect(work).toContainText("not started");
          await expect(header).toContainText("storage");
        } else if (scenario === "waiting")
          await expect(header).toContainText("Reviewer");
        else if (scenario === "working")
          await expect(header).toContainText("Running tool");
        else if (scenario === "zero")
          await expect(work).toContainText("No assignments yet");
        if (scenario === "long-history") {
          await work.getByRole("tab", { name: "History", exact: true }).click();
          await expect(work.locator("[data-member-task]")).toHaveCount(5);
          const firstPage = await work
            .locator("[data-member-task]")
            .first()
            .getAttribute("data-member-task");
          await work
            .getByRole("button", { name: "Next assignments", exact: true })
            .click();
          await expect(
            work.getByRole("navigation", { name: "Assignment pages" }),
          ).toContainText("2 / 6");
          expect(
            await work
              .locator("[data-member-task]")
              .first()
              .getAttribute("data-member-task"),
          ).not.toBe(firstPage);
          await work
            .getByRole("button", { name: "Previous assignments", exact: true })
            .click();
          await expect(
            work.locator("[data-member-task]").first(),
          ).toHaveAttribute("data-member-task", firstPage!);
          await work.getByRole("tab", { name: "All", exact: true }).click();
          await expect(work.locator("[data-member-task]")).toHaveCount(5);
          await work.getByRole("tab", { name: "Current", exact: true }).click();
          await expect(work.locator("[data-member-task]")).toHaveCount(1);
        }
        await expect(
          page.locator(
            "[data-member-workbench] details, [data-member-workbench] summary",
          ),
        ).toHaveCount(0);
        const dimensions = await page.evaluate(() => {
          const box = (selector: string) =>
            document.querySelector(selector)!.getBoundingClientRect().toJSON();
          return {
            width: document.documentElement.scrollWidth,
            viewport: innerWidth,
            work: box("[data-member-work]"),
            conversation: box("[data-workbench-conversation]"),
            composer: box("[data-session-composer]"),
          };
        });
        expect(dimensions.width).toBeLessThanOrEqual(width);
        expect(dimensions.work.right).toBeLessThanOrEqual(
          dimensions.conversation.x,
        );
        expect(dimensions.composer.bottom).toBeLessThanOrEqual(1000);
        expect(errors).toEqual([]);
        await page.screenshot({
          path: testInfo.outputPath(`${scenario}-${width}-${theme}.png`),
        });
      });
    }
  }
}

test("header actions and tab keyboard navigation preserve the composer draft", async ({
  page,
}) => {
  await page.goto("/tests/browser/cc7u-workbench.html?scenario=working", {
    waitUntil: "commit",
  });
  const header = page.locator("[data-workbench-header]");
  await expect(header).toBeVisible({ timeout: 90_000 });
  const composer = page.getByRole("textbox", {
    name: "Message Native Core",
    exact: true,
  });
  await expect(header.getByRole("button", { name: "Message", exact: true })).toHaveCount(0);
  await composer.focus();
  await expect(composer).toBeFocused();
  await composer.fill("Keep the focused review boundary.");
  const effort = page.locator(
    '[data-session-composer] button[data-model-control][title$=": High"]',
  );
  await expect(effort).toBeVisible();
  await effort.click();
  await page.getByRole("menu").getByText("Medium", { exact: true }).click();
  await expect(
    page.locator(
      '[data-session-composer] button[data-model-control][title$=": Medium"]',
    ),
  ).toBeVisible();
  await page
    .locator("[data-workbench-conversation]")
    .getByRole("img", { name: /^69% context used,/ })
    .hover();
  await expect(
    page.getByText("69% context used", { exact: true }),
  ).toBeVisible();
  await header.hover();
  const tabs = page.getByRole("tablist", { name: "Member view" });
  await tabs.getByRole("tab", { name: "Conversation", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    tabs.getByRole("tab", { name: "Activity", exact: true }),
  ).toBeFocused();
  await expect(
    page.getByRole("tabpanel", { name: "Activity", exact: true }),
  ).toBeVisible();
  await expect(composer).toHaveValue("Keep the focused review boundary.");
  await page.keyboard.press("Home");
  await expect(
    tabs.getByRole("tab", { name: "Conversation", exact: true }),
  ).toBeFocused();
  await header.getByRole("button", { name: "Details", exact: true }).click();
  await expect(
    page
      .getByRole("dialog", { name: "Session details", exact: true })
      .getByRole("textbox", { name: "Name", exact: true }),
  ).toHaveValue("Native Core");
  await page.keyboard.press("Escape");
  await expect(composer).toHaveValue("Keep the focused review boundary.");
  await page.getByRole("group", { name: "Message delivery" }).getByRole("button", { name: "Steer", exact: true }).click();
  await expect(composer).toHaveValue("Keep the focused review boundary.");
});

test("assignment keyboard segments and direct details retain exact task identity", async ({
  page,
}) => {
  await page.goto("/tests/browser/cc7u-workbench.html?scenario=long-history", {
    waitUntil: "commit",
  });
  const work = page.locator("[data-member-work]");
  await expect(work).toBeVisible({ timeout: 90_000 });
  const filter = work.getByRole("tablist", { name: "Assignment filter" });
  await filter.getByRole("tab", { name: "Current", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    filter.getByRole("tab", { name: "History", exact: true }),
  ).toBeFocused();
  await expect(
    filter.getByRole("tab", { name: "History", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  const card = work.locator("[data-member-task]").first();
  const title = await card.locator("strong").first().innerText();
  await card.getByRole("button", { name: "Open", exact: true }).click();
  const id = await card.getAttribute("data-member-task");
  expect(title).toBeTruthy();
  expect(await page.evaluate(() => (window as any).workbenchFixture.events)).toContainEqual({ action: "open-session", text: `worker-${id}` });
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await filter.getByRole("tab", { name: "History", exact: true }).focus();
  await page.keyboard.press("End");
  await expect(
    filter.getByRole("tab", { name: "All", exact: true }),
  ).toBeFocused();
});

test("member-owned saved session uses the Workbench and retains session title", async ({
  page,
}) => {
  await page.goto(
    "/tests/browser/cc7u-workbench.html?kind=session&scenario=failed",
    { waitUntil: "commit" },
  );
  await expect(page.locator("[data-member-workbench]")).toBeVisible({
    timeout: 90_000,
  });
  await expect(page.locator("[data-workbench-header]")).toContainText(
    "Review native window restoration, foreground focus and browser activation",
  );
  await expect(page.locator("[data-workbench-header]")).toContainText(
    "Back to Reviewer home",
  );
  await expect(page.locator("[data-member-work]")).toContainText(
    "Brief",
  );
});

test("narrow Work toggle keeps the composer reachable and retains history selection", async ({
  page,
}) => {
  await page.setViewportSize({ width: 600, height: 800 });
  await page.goto(
    "/tests/browser/cc7u-workbench.html?scenario=long-history&theme=light",
    { waitUntil: "commit" },
  );
  await expect(page.locator("[data-workbench-header]")).toBeVisible({
    timeout: 90_000,
  });
  const composer = page.getByRole("textbox", {
    name: "Message Reviewer",
    exact: true,
  });
  await expect(composer).toBeInViewport();
  const toggle = page.getByRole("button", {
    name: /^Work(?: · Needs attention)?$/,
  });
  await toggle.click();
  const work = page.locator("[data-member-work]");
  await expect(work).toBeVisible();
  await work.getByRole("tab", { name: "History", exact: true }).click();
  await page.getByRole("button", { name: "Close work", exact: true }).click();
  await expect(composer).toBeInViewport();
  await toggle.click();
  await expect(
    work.getByRole("tab", { name: "History", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(600);
});

test("flat sidebar pages preserve selected, unread, attention and dirty task rows", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1100, height: 1000 });
  await page.goto(
    "/tests/browser/cc7u-workbench.html?scenario=long-history&theme=light&sidebar=app",
    { waitUntil: "commit" },
  );
  const sidebar = page.getByRole("complementary", {
    name: "Workspace navigation",
  });
  const rows = sidebar.locator("[data-task-worktree]");
  await expect(rows.first()).toBeVisible({ timeout: 90_000 });
  const selected = sidebar.locator(
    '[data-worktree="C:/synthetic/BrowserLink/current"]',
  );
  const attention = sidebar.locator(
    '[data-worktree="C:/synthetic/BrowserLink/history-3"]',
  );
  const unreadDirty = sidebar.locator(
    '[data-worktree="C:/synthetic/BrowserLink/history-4"]',
  );
  const protectedRows = [selected, attention, unreadDirty];
  for (const row of protectedRows) await expect(row).toBeVisible();
  await expect(unreadDirty.locator("[data-worktree-unread]")).toHaveText(
    "New reply",
  );
  await expect(unreadDirty.locator("[data-worktree-dirty]")).toHaveText(
    "Changes",
  );
  await expect(
    rows.locator(
      'button[aria-label^="Expand sessions"], button[aria-label^="Collapse sessions"]',
    ),
  ).toHaveCount(0);
  for (const button of await rows
    .locator('button[aria-label^="Open worktree"]')
    .all())
    expect(await button.getAttribute("aria-expanded")).toBeNull();
  const filter = sidebar.getByRole("group", { name: "Worktree filter" });
  await filter.getByRole("button", { name: "All", exact: true }).click();
  await sidebar
    .getByRole("button", { name: "Next worktree page", exact: true })
    .click();
  for (const row of protectedRows) await expect(row).toBeVisible();
  const rowButton = selected.locator("button[data-sidebar-row]").first();
  await expect(rowButton).toHaveAttribute(
    "title",
    /Review native window restoration, foreground focus and browser activation/,
  );
  await rowButton.focus();
  await page.keyboard.press("ArrowDown");
  expect(
    await rowButton.evaluate((element) => element === document.activeElement),
  ).toBe(false);
  await rowButton.click();
  expect(
    await page.evaluate(() =>
      (
        window as unknown as {
          workbenchFixture: { events: { action: string; text?: string }[] };
        }
      ).workbenchFixture.events.some(
        (event) =>
          event.action === "open-session" &&
          event.text === "member-conversation",
      ),
    ),
  ).toBe(true);
  await unreadDirty.hover();
  const dimensions = await unreadDirty.evaluate((element) => {
    const row = element.getBoundingClientRect();
    const fields = [
      ...element.querySelectorAll(
        "[data-worktree-member], [data-worktree-metadata], [data-worktree-dirty], [data-worktree-unread]",
      ),
    ].map((field) => ({
      box: field.getBoundingClientRect().toJSON(),
      client: field.clientWidth,
      scroll: field.scrollWidth,
    }));
    return { row: row.toJSON(), fields };
  });
  for (const field of dimensions.fields) {
    expect(field.box.right).toBeLessThanOrEqual(dimensions.row.right + 1);
    expect(field.scroll).toBeLessThanOrEqual(field.client + 1);
  }
  await page.reload({ waitUntil: "commit" });
  await expect(
    sidebar
      .getByRole("group", { name: "Worktree filter" })
      .getByRole("button", { name: "All", exact: true }),
  ).toHaveAttribute("aria-pressed", "true", { timeout: 90_000 });
  const grand = sidebar.locator("[data-mono-rail-state]");
  expect(
    await grand.evaluate(
      (element) => element.scrollWidth <= element.clientWidth + 1,
    ),
  ).toBe(true);
});

for (const kind of ["member", "session"]) {
  test(`flat ${kind} Conversation opens exact saved tool output by pointer and keyboard`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1100, height: 1000 });
    await page.goto(
      `/tests/browser/cc7u-workbench.html?scenario=failed&kind=${kind}`,
      { waitUntil: "commit" },
    );
    const transcript = page.getByRole("tabpanel", {
      name: "Conversation",
      exact: true,
    });
    await expect(transcript).toBeVisible({ timeout: 90_000 });
    await expect(transcript).toContainText(
      "I’ll check the window lifecycle, then follow the activation route into the selected browser.",
    );
    const read = transcript
      .getByLabel("Tool call: Read window lifecycle and routing", {
        exact: true,
      })
      .locator("..")
      .getByRole("button", { name: "View full output", exact: true });
    const checks = transcript
      .getByLabel("Tool call: Run focused routing checks", { exact: true })
      .locator("..")
      .getByRole("button", { name: "View full output", exact: true });
    await expect(read).toBeVisible();
    await read.click();
    await expect(
      page.getByRole("dialog", {
        name: "Read window lifecycle and routing",
        exact: true,
      }),
    ).toContainText(
      "3 files read. Window lifecycle, foreground routing, acceptance brief.",
    );
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(read).toBeFocused();
    await expect(checks).toBeVisible();
    await checks.focus();
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("dialog", {
        name: "Run focused routing checks",
        exact: true,
      }),
    ).toContainText("24 passed · 0 failed. Saved synthetic output.");
    await page.keyboard.press("Escape");
    await expect(checks).toBeFocused();
    await expect(
      transcript.locator("button[aria-expanded], details, summary"),
    ).toHaveCount(0);
    const composer = page
      .locator("[data-session-composer]")
      .getByRole("textbox");
    await expect(composer).toHaveValue("Keep my draft");
    await page.getByRole("tab", { name: "Activity", exact: true }).click();
    await page.getByRole("tab", { name: "Conversation", exact: true }).click();
    await expect(composer).toHaveValue("Keep my draft");
    expect(
      await page.evaluate(() =>
        (
          window as unknown as {
            workbenchFixture: { events: { action: string }[] };
          }
        ).workbenchFixture.events.filter((event) => event.action === "submit"),
      ),
    ).toEqual([]);
  });
}

for (const [label, decision] of [
  ["Allow", "allow"],
  ["Deny", "deny"],
] as const) {
  test(`flat Conversation ${label} preserves the exact pending command and request identity`, async ({
    page,
  }) => {
    await page.goto(
      "/tests/browser/cc7u-workbench.html?scenario=working&approval=yes",
      { waitUntil: "commit" },
    );
    const transcript = page.getByRole("tabpanel", {
      name: "Conversation",
      exact: true,
    });
    await expect(transcript).toBeVisible({ timeout: 90_000 });
    await expect(
      transcript.getByLabel("Command awaiting approval", { exact: true }),
    ).toHaveText(
      "printf '%s\\n' '<monocode_context>keep the exact command</monocode_context>'",
    );
    await expect(
      page.getByRole("group", { name: "Message delivery" }),
    ).toHaveCount(0);
    const button = transcript.getByRole("button", { name: label, exact: true });
    if (decision === "allow") await button.click();
    else {
      await button.focus();
      await page.keyboard.press("Enter");
    }
    expect(
      await page.evaluate(() =>
        (
          window as unknown as {
            workbenchFixture: {
              events: { action: string; text?: string; options?: unknown }[];
            };
          }
        ).workbenchFixture.events.filter(
          (event) => event.action === "approval",
        ),
      ),
    ).toEqual([
      {
        action: "approval",
        text: "member-conversation",
        options: { requestId: 7001, decision },
      },
    ]);
    expect(
      await page.evaluate(() =>
        (
          window as unknown as {
            workbenchFixture: { events: { action: string }[] };
          }
        ).workbenchFixture.events.filter((event) => event.action === "submit"),
      ),
    ).toEqual([]);
  });
}

for (const activation of ["pointer", "keyboard"]) {
  test(`flat delegated Conversation reader supports nested output and Escape focus by ${activation}`, async ({
    page,
  }) => {
    await page.goto(
      "/tests/browser/cc7u-workbench.html?scenario=failed&child=yes",
      { waitUntil: "commit" },
    );
    const transcript = page.getByRole("tabpanel", {
      name: "Conversation",
      exact: true,
    });
    await expect(transcript).toBeVisible({ timeout: 90_000 });
    const opener = transcript
      .locator("[data-flat-subagent]")
      .getByRole("button", { name: "View full output", exact: true });
    if (activation === "pointer") await opener.click();
    else {
      await opener.focus();
      await page.keyboard.press("Enter");
    }
    const reader = page.getByRole("dialog", {
      name: "Routing review",
      exact: true,
    });
    await expect(reader).toContainText(
      "Delegated review report: retained routing paths checked.",
    );
    await expect(reader).toContainText(
      "The retained routing paths match the saved review boundary.",
    );
    await expect(
      reader.locator("button[aria-expanded], details, summary"),
    ).toHaveCount(0);
    const nested = reader
      .getByLabel("Tool call: Inspect routing", { exact: true })
      .locator("..")
      .getByRole("button", { name: "View full output", exact: true });
    await nested.focus();
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("dialog", { name: "Inspect routing", exact: true }),
    ).toContainText("Child routing check: 7 assertions passed.");
    await page.keyboard.press("Escape");
    await expect(reader).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(1);
    await expect(nested).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(opener).toBeFocused();
    expect(
      await page.evaluate(() =>
        (
          window as unknown as {
            workbenchFixture: { events: { action: string }[] };
          }
        ).workbenchFixture.events.filter((event) => event.action === "submit"),
      ),
    ).toEqual([]);
  });
}

test("flat saved session Conversation renders its queue once and routes queue actions to that session", async ({
  page,
}) => {
  await page.goto(
    "/tests/browser/cc7u-workbench.html?scenario=working&kind=session&queue=yes",
    { waitUntil: "commit" },
  );
  await expect(page.locator("[data-workbench-header]")).toBeVisible({
    timeout: 90_000,
  });
  const queue = page.locator("[data-message-queue]");
  await expect(queue).toHaveCount(1);
  await expect(page.locator("[data-message-queue-card]")).toHaveCount(1);
  await expect(
    page.getByText("Review the saved changes when storage is repaired.", {
      exact: true,
    }),
  ).toHaveCount(1);
  await expect(
    queue.getByRole("button", { name: "Steer", exact: true }),
  ).toHaveCount(1);
  await expect(
    queue.getByRole("button", { name: "Edit queued message", exact: true }),
  ).toHaveCount(1);
  await expect(
    queue.getByRole("button", { name: "Remove queued message", exact: true }),
  ).toHaveCount(1);
  await queue.getByRole("button", { name: "Steer", exact: true }).click();
  await queue
    .getByRole("button", { name: "Edit queued message", exact: true })
    .click();
  await queue
    .getByRole("textbox", { name: "Edit queued message", exact: true })
    .fill("Keep the selected worker's queue boundary.");
  await queue
    .getByRole("button", { name: "Save queued message", exact: true })
    .click();
  await expect(
    page.getByText("Keep the selected worker's queue boundary.", {
      exact: true,
    }),
  ).toHaveCount(1);
  await queue
    .getByRole("button", { name: "Remove queued message", exact: true })
    .click();
  await expect(page.locator("[data-message-queue]")).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      (
        window as unknown as {
          workbenchFixture: {
            events: { action: string; text?: string; options?: unknown }[];
          };
        }
      ).workbenchFixture.events.filter((event) =>
        event.action.endsWith("-queue"),
      ),
    ),
  ).toEqual([
    {
      action: "steer-queue",
      text: "queued-review",
      options: { sessionId: "review-worker" },
    },
    {
      action: "edit-queue",
      text: "queued-review",
      options: {
        sessionId: "review-worker",
        text: "Keep the selected worker's queue boundary.",
      },
    },
    {
      action: "remove-queue",
      text: "queued-review",
      options: { sessionId: "review-worker" },
    },
  ]);
  await expect(
    page.locator("[data-session-composer]").getByRole("textbox"),
  ).toHaveValue("Keep my draft");
  expect(
    await page.evaluate(() =>
      (
        window as unknown as {
          workbenchFixture: { events: { action: string }[] };
        }
      ).workbenchFixture.events.filter((event) => event.action === "submit"),
    ),
  ).toEqual([]);
});

test("flat historical session Conversation keeps its saved dispatch and queue after a task retry", async ({
  page,
}) => {
  await page.goto(
    "/tests/browser/cc7u-workbench.html?scenario=failed&kind=historical-session",
    { waitUntil: "commit" },
  );
  await expect(page.locator("[data-member-workbench]")).toBeVisible({
    timeout: 90_000,
  });
  const header = page.locator("[data-workbench-header]");
  await expect(header).toContainText("Review native window restoration, foreground focus and browser activation");
  await expect(header).not.toContainText("Latest worker failure");
  await expect(header).not.toContainText("Blocked");
  await header
    .getByRole("button", { name: "Open worktree", exact: true })
    .click();
  expect(
    await page.evaluate(() =>
      (
        window as unknown as {
          workbenchFixture: { events: { action: string; text?: string }[] };
        }
      ).workbenchFixture.events.filter(
        (event) => event.action === "ipc:reveal_path",
      ),
    ),
  ).toEqual([{ action: "ipc:reveal_path", text: JSON.stringify({path: "C:/synthetic/BrowserLink/old-attempt"}) }]);
  await expect(page.locator("[data-message-queue]")).toHaveCount(1);
  await expect(
    page.getByText("Review the saved changes when storage is repaired.", {
      exact: true,
    }),
  ).toHaveCount(1);
  await header.getByRole("button", { name: "Details", exact: true }).click();
  const details = page.getByRole("dialog", {
    name: "Session details",
    exact: true,
  });
  await expect(details).toContainText("C:/synthetic/BrowserLink/old-attempt");
  await expect(details).not.toContainText(
    "C:/synthetic/BrowserLink/new-attempt",
  );
  await page.keyboard.press("Escape");
  await expect(
    header.getByRole("button", { name: "Details", exact: true }),
  ).toBeFocused();
});


for (const width of [1440, 1100]) {
  for (const theme of ["dark", "light"]) {
    for (const scenario of ["failed", "long-history"]) {
      test(`pending queue keeps the request readable through scrolling and returns to latest at ${width}px ${theme} ${scenario}`, async ({
        page,
      }) => {
        await page.setViewportSize({ width, height: 1000 });
        await page.goto(
          `/tests/browser/cc7u-workbench.html?scenario=${scenario}&theme=${theme}`,
          { waitUntil: "commit" },
        );
        await expect(page.locator("[data-workbench-header]")).toBeVisible({
          timeout: 90_000,
        });
        const transcript = page.getByRole("tabpanel", {
          name: "Conversation",
          exact: true,
        });
        const request = transcript.locator('[data-chat-message="turn"]');
        await expect(request).toContainText(
          "Check restore and foreground focus. Keep the review tied to the saved change, and show me what still needs a real Windows check.",
        );
        const reader = transcript.locator(".agent-transcript");
        const latest = await reader.evaluate((element) => element.scrollTop);
        const viewport = await reader.boundingBox();
        await page.mouse.move(viewport!.x + viewport!.width / 2, viewport!.y + viewport!.height / 2);
        await page.mouse.wheel(0, -100);
        await expect(request).toBeInViewport({ ratio: 1 });
        const geometry = await request.evaluate((element) => {
          const box = element.getBoundingClientRect();
          const viewport = element.closest(".agent-transcript")!.getBoundingClientRect();
          const hit = document.elementFromPoint(box.left + 8, box.top + 8);
          return {
            requestTop: box.top,
            requestBottom: box.bottom,
            viewportTop: viewport.top,
            viewportBottom: viewport.bottom,
            requestOwnsPointer: element.contains(hit),
          };
        });
        expect(geometry.requestTop).toBeGreaterThanOrEqual(geometry.viewportTop);
        expect(geometry.requestBottom).toBeLessThanOrEqual(geometry.viewportBottom);
        expect(geometry.requestOwnsPointer).toBe(true);
        await page.getByRole("button", { name: "Jump to latest", exact: true }).click();
        await expect.poll(() => reader.evaluate((element) => element.scrollTop)).toBeCloseTo(latest, 0);
        await expect(page.getByRole("textbox", { name: "Message Reviewer", exact: true })).toHaveValue("Keep my draft");
        await page.mouse.move(viewport!.x + viewport!.width / 2, viewport!.y + viewport!.height / 2);
        await page.mouse.wheel(0, -100);
        await expect(request).toBeInViewport({ ratio: 1 });
        const queue = page.getByRole("region", { name: "Message queue", exact: true });
        await expect(queue).toHaveCount(1);
        await expect(transcript.locator("[data-message-queue]")).toHaveCount(0);
        const scroll = await reader.evaluate((element) => element.scrollTop);
        await queue.getByRole("button", { name: "Edit queued message", exact: true }).click();
        await queue.getByRole("textbox", { name: "Edit queued message", exact: true }).fill("Retain the original request and queue boundary.");
        await queue.getByRole("button", { name: "Save queued message", exact: true }).click();
        await expect(queue).toContainText("Retain the original request and queue boundary.");
        await expect(request).toBeInViewport({ ratio: 1 });
        expect(await reader.evaluate((element) => element.scrollTop)).toBeCloseTo(scroll, 0);
        await queue.getByRole("button", { name: "Remove queued message", exact: true }).click();
        await expect(page.locator("[data-message-queue]")).toHaveCount(0);
        await expect(request).toBeInViewport({ ratio: 1 });
        expect(await reader.evaluate((element) => element.scrollTop)).toBeCloseTo(scroll, 0);
        expect(
          await page.evaluate(() =>
            (window as unknown as {
              workbenchFixture: { events: { action: string; text?: string; options?: unknown }[] };
            }).workbenchFixture.events.filter((event) =>
              ["edit-queue", "remove-queue", "submit"].includes(event.action),
            ),
          ),
        ).toEqual([
          {
            action: "edit-queue",
            text: "queued-review",
            options: { sessionId: "member-conversation", text: "Retain the original request and queue boundary." },
          },
          {
            action: "remove-queue",
            text: "queued-review",
            options: { sessionId: "member-conversation" },
          },
        ]);
        await expect(page.getByRole("textbox", { name: "Message Reviewer", exact: true })).toHaveValue("Keep my draft");
        if (scenario === "long-history") {
          const box = await reader.boundingBox();
          await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
          await page.mouse.wheel(0, -100);
          await expect.poll(() => reader.evaluate((element) => element.scrollTop)).toBeLessThan(scroll);
          await expect(request).toBeInViewport({ ratio: 1 });
        }
      });
    }
  }
}
