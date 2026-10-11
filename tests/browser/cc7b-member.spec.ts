import { expect, test } from "@playwright/test";

test.setTimeout(120_000);

for (const theme of ["dark", "light"]) {
  for (const scenario of [
    "empty",
    "long-log",
    "blocked",
    "empty-pr",
    "loaded-pr",
  ]) {
    test(`${scenario} member layout in ${theme}`, async ({
      page,
    }, testInfo) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto(
        `/tests/browser/cc7b-member.html?scenario=${scenario}&theme=${theme}`,
        { waitUntil: "commit" },
      );
      await expect(
        page.getByRole("heading", { name: "Reviewer", exact: true }).first(),
      ).toBeVisible({ timeout: 90_000 });
      const log = page.getByRole("region", { name: "Member work log" });
      await expect(log).toBeVisible();
      await expect(
        log.getByRole("heading", { name: "Current assignment", exact: true }),
      ).toBeVisible();
      await expect(
        log.getByRole("heading", { name: "Queue (1)", exact: true }),
      ).toBeVisible();
      const composer = page.getByRole("textbox", {
        name: "Message Reviewer",
        exact: true,
      });
      await expect(composer).toHaveValue("Keep my draft");
      await expect(composer).toBeInViewport();
      if (scenario === "blocked") {
        const notice = page.getByRole("status", {
          name: "Codex storage needs repair",
        });
        await expect(notice).toBeInViewport();
        await expect(page.getByText("Message will queue until storage is repaired.", { exact: true })).toHaveCount(1);
        await expect(page.getByText("Message will queue until storage is repaired.", { exact: true })).toBeInViewport();
        await expect(page.locator('header [data-agent-state="blocked"] .agent-state-cue')).toHaveCount(1);
        await expect(
          page
            .getByRole("region", { name: "Message queue" })
            .getByRole("button", { name: "Edit queued message" }),
        ).toHaveCount(2);
        await expect(
          page
            .getByRole("region", { name: "Message queue" })
            .getByRole("button", { name: "Edit queued message" })
            .first(),
        ).toBeInViewport();
        await expect(
          page.getByText("No conversation turn running", { exact: true }),
        ).toBeVisible();
        expect((await notice.boundingBox())!.y).toBeLessThan(
          (await log.boundingBox())!.y,
        );
      }
      if (scenario === "long-log") {
        await log
          .getByRole("button", { name: "History (28)", exact: true })
          .click();
        await expect(log.locator("[data-member-task]")).toHaveCount(30);
        const scroller = log.locator(".overflow-y-auto");
        expect(
          await scroller.evaluate(
            (element) => element.scrollHeight - element.clientHeight,
          ),
        ).toBeGreaterThan(400);
        const box = (await scroller.boundingBox())!;
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        const before = await scroller.evaluate((element) => element.scrollTop);
        await page.mouse.wheel(0, 400);
        await expect
          .poll(() => scroller.evaluate((element) => element.scrollTop))
          .toBeGreaterThan(before + 100);
        await expect(composer).toHaveValue("Keep my draft");
      }
      if (scenario === "empty-pr")
        await expect(page.locator("aside")).toContainText(
          "No related pull requests yet",
        );
      if (scenario === "loaded-pr")
        await expect(
          page.locator("aside").getByRole("button", { name: /PR #74:/ }),
        ).toBeVisible();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(1280);
      expect(
        await page.evaluate(() => document.scrollingElement!.scrollTop),
      ).toBe(0);
      expect(errors).toEqual([]);
      if (scenario === "blocked") {
        const queue = page.getByRole("region", { name: "Message queue" });
        await queue
          .getByRole("button", { name: "Edit queued message" })
          .first()
          .scrollIntoViewIfNeeded();
        await expect(
          queue.getByRole("button", { name: "Edit queued message" }).first(),
        ).toBeInViewport();
        await expect(
          page.getByRole("status", { name: "Codex storage needs repair" }),
        ).toBeInViewport();
      }
      await page.screenshot({
        path: testInfo.outputPath(`${scenario}-${theme}.png`),
      });
    });
  }
}

for (const scenario of ["blocked", "long-log"]) {
  test(`${scenario} member stays usable at narrow width`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 360, height: 640 });
    await page.goto(
      `/tests/browser/cc7b-member.html?scenario=${scenario}&theme=light`,
      { waitUntil: "commit" },
    );
    await expect(
      page.getByRole("tab", { name: "Conversation", exact: true }),
    ).toBeVisible({ timeout: 90_000 });
    await expect(
      page.getByRole("textbox", { name: "Message Reviewer", exact: true }),
    ).toBeInViewport();
    if (scenario === "blocked")
      await expect(
        page.getByRole("status", { name: "Codex storage needs repair" }),
      ).toBeInViewport();
    if (scenario === "blocked") {
      const queue = page.getByRole("region", { name: "Message queue" });
      await queue
        .getByRole("button", { name: "Edit queued message" })
        .first()
        .scrollIntoViewIfNeeded();
      await expect(
        queue.getByRole("button", { name: "Edit queued message" }).first(),
      ).toBeInViewport();
      await expect(
        page.getByRole("status", { name: "Codex storage needs repair" }),
      ).toBeInViewport();
    }
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(360);
    expect(
      await page.evaluate(() => document.scrollingElement!.scrollTop),
    ).toBe(0);
    await page.screenshot({
      path: testInfo.outputPath(`${scenario}-light-narrow.png`),
    });
  });
}

test("member tabs preserve draft and Activity scrolls independently", async ({
  page,
}) => {
  await page.goto("/tests/browser/cc7b-member.html?scenario=long-log", {
    waitUntil: "commit",
  });
  const conversation = page.getByRole("tab", {
    name: "Conversation",
    exact: true,
  });
  await expect(conversation).toBeVisible({ timeout: 90_000 });
  await conversation.focus();
  await page.keyboard.press("ArrowRight");
  const activity = page.getByRole("tab", { name: "Activity", exact: true });
  await expect(activity).toBeFocused();
  await expect(activity).toHaveAttribute("aria-selected", "true");
  const scroller = page
    .getByRole("tabpanel", { name: "Activity", exact: true })
    .locator(".overflow-y-auto")
    .first();
  await expect
    .poll(() =>
      scroller.evaluate(
        (element) => element.scrollHeight - element.clientHeight,
      ),
    )
    .toBeGreaterThan(400);
  const box = (await scroller.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 400);
  await expect
    .poll(() => scroller.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(200);
  expect(await page.evaluate(() => document.scrollingElement!.scrollTop)).toBe(
    0,
  );
  await activity.focus();
  await page.keyboard.press("Home");
  await expect(conversation).toBeFocused();
  await expect(conversation).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByRole("textbox", { name: "Message Reviewer", exact: true }),
  ).toHaveValue("Keep my draft");
});

test("blocked queued messages can be edited and removed while the composer draft remains", async ({
  page,
}) => {
  await page.goto("/tests/browser/cc7b-member.html?scenario=blocked", {
    waitUntil: "commit",
  });
  const queue = page.getByRole("region", { name: "Message queue" });
  await expect(queue).toBeVisible({ timeout: 90_000 });
  await queue
    .getByRole("button", { name: "Edit queued message" })
    .first()
    .click();
  await queue
    .getByRole("textbox", { name: "Edit queued message" })
    .fill("Preserve this edited queued message.");
  await queue.getByRole("button", { name: "Save queued message" }).click();
  await expect(queue).toContainText("Preserve this edited queued message.");
  await queue
    .getByRole("button", { name: "Remove queued message" })
    .last()
    .click();
  await expect(
    queue.getByRole("button", { name: "Edit queued message" }),
  ).toHaveCount(1);
  await expect(
    page.getByRole("textbox", { name: "Message Reviewer", exact: true }),
  ).toHaveValue("Keep my draft");
  await expect(
    page.getByRole("status", { name: "Codex storage needs repair" }),
  ).toBeInViewport();
});

test("empty session PR context stays closed until explicitly opened and restores opener focus", async ({
  page,
}) => {
  await page.goto(
    "/tests/browser/cc7b-member.html?scenario=empty-pr&kind=session",
    { waitUntil: "commit" },
  );
  const opener = page.getByRole("button", {
    name: "Show session PRs",
    exact: true,
  });
  await expect(opener).toBeVisible({ timeout: 90_000 });
  await expect(page.locator("aside")).toHaveCount(0);
  await opener.focus();
  await opener.press("Enter");
  await expect(page.locator("aside")).toContainText(
    "No related pull requests yet",
  );
  const close = page.getByRole("button", { name: "Hide prs", exact: true });
  await close.focus();
  await close.press("Enter");
  await expect(page.locator("aside")).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test("loaded session PR context opens, supports filter reset, and resizes by keyboard", async ({
  page,
}) => {
  await page.goto(
    "/tests/browser/cc7b-member.html?scenario=loaded-pr&kind=session",
    { waitUntil: "commit" },
  );
  const panel = page.locator("aside");
  await expect(panel.getByRole("button", { name: /PR #74:/ })).toBeVisible({
    timeout: 90_000,
  });
  await panel
    .getByRole("textbox", { name: "Search pull requests" })
    .fill("no matching fixture");
  await expect(panel).toContainText("No pull requests match these filters");
  await panel
    .getByRole("button", { name: "Reset filters", exact: true })
    .click();
  await expect(panel.getByRole("button", { name: /PR #74:/ })).toBeVisible();
  const separator = panel.getByRole("separator", { name: "Resize Mono prs" });
  const before = Number(await separator.getAttribute("aria-valuenow"));
  await separator.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(separator).toHaveAttribute("aria-valuenow", String(before + 10));
  await page.keyboard.press("Home");
  await expect(separator).toHaveAttribute("aria-valuenow", "340");
  await page.keyboard.press("End");
  await expect(separator).toHaveAttribute("aria-valuenow", "400");
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(1000);
});

for (const scenario of ["loading", "error", "saved-pr"]) {
  test(`${scenario} PR context explains its state`, async ({ page }) => {
    await page.goto(
      `/tests/browser/cc7b-member.html?kind=panel&scenario=${scenario}`,
      { waitUntil: "commit" },
    );
    const panel = page.locator("aside");
    await expect(panel).toBeVisible({ timeout: 90_000 });
    if (scenario === "loading") {
      await expect(panel).toContainText("Loading related pull requests");
      await expect(
        panel.getByText("No related pull requests yet", { exact: true }),
      ).toHaveCount(0);
    } else if (scenario === "error") {
      await expect(panel.getByRole("alert")).toContainText(
        "Could not load related pull requests",
      );
      await panel
        .getByRole("button", { name: "Retry pull requests", exact: true })
        .click();
      await expect(panel.getByRole("alert")).toHaveCount(0);
      await expect(panel).toContainText("No related pull requests yet");
    } else {
      await expect(panel).toContainText("Latest PR status is unavailable");
      await expect(
        panel.getByRole("button", { name: /PR #74:/ }),
      ).toContainText("Status unavailable");
    }
  });
}

test("pin preserves the session panel when its related PR disappears", async ({
  page,
}) => {
  await page.goto(
    "/tests/browser/cc7b-member.html?scenario=loaded-pr&kind=session",
    { waitUntil: "commit" },
  );
  const pin = page.getByRole("button", {
    name: "Pin session panel",
    exact: true,
  });
  await expect(pin).toBeVisible({ timeout: 90_000 });
  await pin.click();
  await expect(
    page.getByRole("button", { name: "Unpin session panel", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.evaluate(() =>
    (window as unknown as { dropPrContext: () => void }).dropPrContext(),
  );
  await expect(page.locator("aside")).toBeVisible();
  await expect(page.locator("aside")).toContainText(
    "No related pull requests yet",
  );
});
