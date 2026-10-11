import { expect, test } from "@playwright/test";

test.setTimeout(120_000);
const route = "/tests/browser/mission-control.html";

for (const width of [1440, 900, 800]) for (const theme of ["dark", "light"]) {
  test(`CC7Q rows, identities and visual rhythm at ${width}px ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(`${route}?theme=${theme}&pr=open`);
    const feed = page.getByRole("region", { name: "Recent activity" });
    await expect(feed.locator(".mc-feed-item")).toHaveCount(1);
    await expect(feed).toContainText("Merged PR #1861 · Pricing worker · Completed");
    await expect(page.locator('[data-agent="mono-manager"] .mc-avatar')).toHaveText("MM");
    await expect(page.locator('[data-agent="dz-manager"] .mc-avatar')).toHaveText("DM");
    await expect(page.locator('[data-agent="grand"] .mc-avatar')).toHaveText("GO");
    await expect(page.locator('[data-agent="designer"] .mc-elapsed')).toHaveCount(0);
    await expect(page.getByText("Current turn / attempt time", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Organization vitals" })).toContainText("Not recorded");

    const checkRows = async () => {
      const issues = await page.locator("[data-worktree]").evaluateAll(rows => rows.filter(row => row.getClientRects().length).flatMap(row => {
        const branch = row.querySelector("[data-worktree-label]")!;
        const badge = row.querySelector("[data-worktree-badge]")!;
        const header = branch.closest("button")!.parentElement!;
        const team = row.querySelector("[data-worktree-team]");
        const bounds = row.getBoundingClientRect();
        const labelBounds = branch.getBoundingClientRect();
        const badgeBounds = badge.getBoundingClientRect();
        const headerBounds = header.getBoundingClientRect();
        const errors: string[] = [];
        if (labelBounds.width < 1 || labelBounds.right > headerBounds.right + 1) errors.push("branch outside header");
        if (badge.textContent?.trim() && (badgeBounds.width < 1 || labelBounds.right > badgeBounds.left + 1)) errors.push("branch/badge overlap");
        if (badge.textContent?.trim() && badgeBounds.right > headerBounds.right + 1) errors.push("badge outside header");
        const actions = [...row.querySelectorAll("[data-worktree-actions] button")].filter(button => Number(getComputedStyle(button).opacity) > .9);
        for (const action of actions) {
          const bounds = action.getBoundingClientRect();
          if ([labelBounds, badgeBounds].some(copy => copy.width > 0 && copy.left < bounds.right - 1 && copy.right > bounds.left + 1 && copy.top < bounds.bottom - 1 && copy.bottom > bounds.top + 1)) errors.push("copy overlaps action");
        }
        if (team && team.getBoundingClientRect().top < headerBounds.bottom - 1) errors.push("team overlaps header");
        if (team && [...team.querySelectorAll("button")].some(button => button.getBoundingClientRect().right > bounds.right + 1)) errors.push("chip outside row");
        return errors.map(error => `${row.getAttribute("data-worktree")}: ${error}`);
      }));
      expect(issues).toEqual([]);
    };
    const primary = page.locator('[data-worktree="C:/synthetic/MonoCode"]');
    await expect(primary.locator("[data-worktree-team]")).toBeVisible();
    await checkRows();
    await primary.locator('[aria-label="Open worktree nour"]').hover();
    await expect.poll(() => primary.locator('[aria-label="Actions for nour"]').evaluate(element => Number(getComputedStyle(element).opacity))).toBe(1);
    await expect(primary.locator('[aria-label="Open pull request for nour"]')).toBeVisible();
    await checkRows();
    await primary.locator('[aria-label="Actions for nour"]').focus();
    await checkRows();
    await primary.getByRole("button", { name: "Open Builder's session", exact: true }).click();
    expect(await page.evaluate(() => window.missionFixture.events.at(-1))).toEqual({ action: "session", text: "builder-chat" });
    const chip = primary.getByRole("button", { name: "Open Builder's session", exact: true });
    await chip.click({ button: "right" });
    await expect(page.getByRole("menu")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Mission control", exact: true })).toBeVisible();
    await chip.focus();
    await page.keyboard.press("Shift+F10");
    await expect(page.getByRole("menu")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Mission control", exact: true })).toBeVisible();

    const rhythm = await page.evaluate(() => ({
      vitals: [...document.querySelectorAll(".mc-vitals > div > span")].map(element => element.getBoundingClientRect().top),
      cards: [...document.querySelectorAll(".mc-agent-card")].map(element => element.getBoundingClientRect().height),
      lead: document.querySelector(".mc-org-lead")!.getBoundingClientRect().height,
      command: document.querySelector(".mc-command-bar")!.getBoundingClientRect().height,
    }));
    expect(Math.max(...rhythm.vitals) - Math.min(...rhythm.vitals)).toBeLessThanOrEqual(1);
    expect(Math.min(...rhythm.cards)).toBeGreaterThanOrEqual(144);
    expect(rhythm.lead).toBeGreaterThanOrEqual(64);
    expect(rhythm.command).toBeGreaterThanOrEqual(104);
    await page.locator('[data-goal="mc"]').click();
    await expect(page.locator('.mc-chain [data-role="manager"] .mc-avatar')).toHaveText("MM");
    await page.keyboard.press("Escape");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });
}

for (const [width, theme, zero] of [[1440, "dark", false], [1440, "light", false], [1100, "dark", false], [900, "dark", false], [800, "light", false], [1440, "dark", true]] as const) {
  test(`Cockpit remains useful at ${width}px ${theme}, ${zero ? "zero" : "live"} goals`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${route}?theme=${theme}&goals=${zero ? "zero" : "live"}`);
    await expect(page.getByRole("heading", { name: "Mission control", exact: true })).toBeVisible();
    await expect(page.locator("[data-agent]")).toHaveCount(8);
    await expect(page.getByRole("textbox", { name: "Ask or assign work" })).toBeEnabled();
    await expect(page.getByRole("region", { name: "Organization vitals" })).toContainText("Goals in flight");
    await expect(page.getByRole("region", { name: "Recent activity" })).toContainText("Merged PR #1861");
    await expect(page.locator("[data-goal]")).toHaveCount(zero ? 0 : 2);
    await expect(page.locator(".mission-control details, .mission-control summary")).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    expect(errors).toEqual([]);
  });
}

test("filters and density persist while keyboard opens cards and returns from the goal drawer", async ({ page }) => {
  await page.goto(route);
  await page.locator('.mc-segmented[aria-label="Project filter"]').getByRole("button", { name: "MonoCode", exact: true }).click();
  await expect(page.locator("[data-agent]")).toHaveCount(5);
  await page.getByRole("combobox", { name: "All states", exact: true }).selectOption("Idle");
  await expect(page.locator("[data-agent]")).toHaveCount(2);
  await page.getByRole("button", { name: "Compact", exact: true }).click();
  await page.reload();
  await expect(page.locator(".mission-control")).toHaveAttribute("data-density", "compact");
  await expect(page.locator("[data-agent]")).toHaveCount(2);
  await page.getByRole("combobox", { name: "All states", exact: true }).selectOption("All states");
  await page.getByRole("button", { name: "All projects", exact: true }).click();
  await page.keyboard.press("/");
  const command = page.getByRole("textbox", { name: "Ask or assign work" });
  await expect(command).toBeFocused();
  await command.fill("j/k stays normal while typing");
  await page.keyboard.press("j");
  await expect(command).toHaveValue("j/k stays normal while typingj");
  await page.getByRole("heading", { name: "Mission control", exact: true }).click();
  await page.keyboard.press("j");
  await expect(page.locator("[data-agent=grand]")).toBeFocused();
  await page.keyboard.press("j");
  await expect(page.locator("[data-agent=mono-manager]")).toBeFocused();
  await page.keyboard.press("k");
  await page.keyboard.press("Enter");
  await expect.poll(() => page.evaluate(() => window.missionFixture.events.at(-1))).toEqual({ action: "open", target: { monoId: "grand" } });
  const goal = page.locator('[data-goal="mc"]');
  await goal.click();
  const drawer = page.getByRole("dialog", { name: "Make mission control useful at a glance", exact: true });
  await expect(drawer).toContainText("Delegation chain");
  await expect(drawer).toContainText("Reviewer");
  expect(await drawer.evaluate(element => Math.abs(element.getBoundingClientRect().right - innerWidth))).toBeLessThanOrEqual(1);
  expect(await drawer.evaluate(element => element.getBoundingClientRect().width)).toBeLessThanOrEqual(470);
  await expect(drawer.locator("[data-phase]")).toHaveCount(5);
  await expect(drawer.locator(".mc-ledger")).toHaveCount(0);
  await drawer.getByRole("button", { name: "Compaction", exact: false }).click();
  await expect(drawer.locator(".mc-phase-detail")).toContainText("23s");
  await drawer.getByRole("button", { name: "Ledger", exact: true }).click();
  await expect(drawer.locator("tbody tr")).toHaveCount(4);
  await drawer.getByRole("button", { name: "Next ledger page" }).click();
  await expect(drawer.locator(".mc-paging")).toContainText("2 /");
  await drawer.locator("tbody tr button").first().click();
  await expect(drawer.locator(".mc-event-detail")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(goal).toBeFocused();
});

test("attention stays in Mission control and keeps the source queue intact", async ({ page }) => {
  await page.goto(route);
  const all = page.getByRole("button", { name: "View all", exact: false });
  await all.click();
  const panel = page.getByRole("dialog", { name: "Needs attention", exact: true });
  await expect(panel.locator(".aq-item")).toHaveCount(2);
  const storage = panel.locator('[data-attention-source="storage"]');
  await expect(storage.locator(".aq-time")).toHaveCount(0);
  const controls = await storage.getByRole("button").evaluateAll(buttons => buttons.map(button => ({ top: button.getBoundingClientRect().top, height: button.getBoundingClientRect().height })));
  expect(Math.max(...controls.map(button => button.top)) - Math.min(...controls.map(button => button.top))).toBeLessThanOrEqual(1);
  expect(Math.max(...controls.map(button => button.height)) - Math.min(...controls.map(button => button.height))).toBeLessThanOrEqual(1);
  const evidence = panel.locator('[data-attention-source="storage"]').getByRole("button", { name: "Evidence", exact: true });
  await evidence.click();
  await expect(page.getByRole("dialog", { name: "Storage evidence", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Storage evidence", exact: true })).toHaveCount(0);
  await expect(panel).toBeVisible();
  await expect(evidence).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(all).toBeFocused();
  await all.click();
  await panel.getByRole("button", { name: "Approvals", exact: false }).click();
  await expect(panel.locator(".aq-item")).toHaveCount(1);
  await expect(panel.locator(".aq-item")).toContainText("User-owned request");
  await panel.getByRole("button", { name: "Allow once", exact: true }).click();
  await expect(panel.getByRole("button", { name: "Allow once", exact: true })).toBeDisabled();
  await expect(panel.locator(".aq-item")).toContainText("awaiting source acknowledgement");
  expect(await page.evaluate(() => window.missionFixture.events.filter(event => event.action === "approval").length)).toBe(1);
  await panel.getByRole("button", { name: "History", exact: false }).click();
  await expect(panel).toContainText("No resolved or replaced requests observed yet");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(all).toBeFocused();
  await expect(page.getByRole("complementary", { name: "Organization attention" })).toContainText("Needs attention");
});

test("command uses CC5C route safeguards and accepts each pending submission once", async ({ page }) => {
  await page.goto(`${route}?submit=deferred`);
  const command = page.getByRole("textbox", { name: "Ask or assign work" });
  await command.fill("Improve MonoCode navigation");
  await page.getByRole("button", { name: "New goal", exact: true }).click();
  await expect(page.locator("[data-mono-goal-route]")).toContainText("Send to MonoCode Manager");
  await command.fill("Compare MonoCode and DZDistro");
  await expect(page.locator("[data-mono-goal-route]")).toContainText("Send to Grand Orch");
  await page.getByRole("button", { name: "Goal route: Auto route", exact: true }).click();
  await page.getByRole("option", { name: "DZDistro Manager", exact: true }).click();
  await expect(page.locator("[data-mono-goal-route]")).toContainText("Send to Grand Orch");
  await command.fill("Improve keyboard navigation");
  await expect(page.locator("[data-mono-goal-route]")).toContainText("Send to DZDistro Manager");
  await page.getByRole("button", { name: "Goal route: DZDistro Manager", exact: true }).click();
  await page.getByRole("option", { name: "Auto route", exact: true }).click();
  await command.fill("Improve MonoCode navigation");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await page.locator(".mc-command-bar").evaluate(form => { (form as HTMLFormElement).requestSubmit(); (form as HTMLFormElement).requestSubmit(); });
  expect(await page.evaluate(() => window.missionFixture.events.filter(event => event.action === "submit").length)).toBe(1);
  expect(await page.evaluate(() => window.missionFixture.events.at(-1)?.submission?.managerMonoId)).toBe("mono-manager");
  await page.evaluate(() => window.missionFixture.finishSubmission(true));
  await expect(command).toHaveValue("");
  await expect(page.getByRole("button", { name: "Chat", exact: true })).toHaveAttribute("aria-pressed", "true");
});

test("rejected command preserves the draft and sidebar controls page without hiding dirty work", async ({ page }) => {
  await page.goto(`${route}?submit=reject`);
  const command = page.getByRole("textbox", { name: "Ask or assign work" });
  await command.fill("Keep this draft");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(command).toHaveValue("Keep this draft");
  await expect(page.getByRole("alert")).toContainText("not accepted");
  const sidebar = page.getByRole("region", { name: "MonoCode sidebar", exact: true });
  await expect(sidebar.getByRole("region", { name: "Available members" })).toBeVisible();
  await sidebar.getByRole("region", { name: "Available members" }).getByRole("button", { name: "Open Designer", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.missionFixture.events.at(-1))).toEqual({ action: "open", target: { monoId: "designer" } });
  const filters = sidebar.getByRole("group", { name: "Worktree filter" });
  await filters.getByRole("button", { name: "All", exact: true }).click();
  await expect(sidebar).toContainText("cc7n-dirty");
  await sidebar.getByRole("button", { name: "Next worktree page" }).click();
  await expect(sidebar).toContainText("cc7n-dirty");
  await expect(sidebar).toContainText("2 / 3");
  await page.reload();
  await expect(page.getByRole("region", { name: "MonoCode sidebar", exact: true }).getByRole("group", { name: "Worktree filter" }).getByRole("button", { name: "All", exact: true })).toHaveAttribute("aria-pressed", "true");
});
