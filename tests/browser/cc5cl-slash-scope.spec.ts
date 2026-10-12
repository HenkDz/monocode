import { expect, test } from "@playwright/test";

for (const surface of ["embedded", "floating"])
  for (const theme of ["dark", "light"])
    for (const narrow of [false, true])
      test(`actual ${surface} slash scope in ${theme}, ${narrow ? "narrow" : "wide"}`, async ({ page }, testInfo) => {
        const errors: string[] = [];
        page.on("pageerror", error => errors.push(error.message));
        const width = narrow ? 360 : surface === "floating" ? 640 : 1000;
        await page.setViewportSize({ width, height: 720 });
        await page.goto(`/tests/browser/cc5cl-slash-scope.html?surface=${surface}&theme=${theme}`);
        const composer = page.getByRole("textbox", { name: "Message Grand Orchestrator", exact: true });
        const status = page.locator("[data-mono-goal-route] [role=status]");
        const send = page.getByRole("button", { name: "Send", exact: true });
        const texts = ["Fix Atlas and all projects/repos", "Apply Atlas changes across all workspaces/codebases",
          "Apply fixes to all projects/repositories, including Atlas", "Fix Atlas and every codebase/workspace"];
        const receipt = async () => JSON.parse((await page.locator("[data-receipt]").textContent())!);
        let grand = 0;
        for (const explicit of [false, true])
          for (const text of texts) {
            await page.getByRole("button", { name: "New goal", exact: true }).click();
            await composer.fill(text);
            if (explicit) {
              await page.getByRole("button", { name: "Goal route: Auto route", exact: true }).click();
              await page.getByRole("option", { name: "Atlas Manager", exact: true }).click();
            }
            await expect(status).toContainText("Send to Grand Orch");
            await expect(status).toContainText(explicit ? "Comparison or cross-project goal" : "Contains file paths");
            await expect(status).toBeInViewport();
            await expect(send).toBeInViewport();
            expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
            if (text === texts[0]) await page.screenshot({ path: testInfo.outputPath(`${surface}-${theme}-${narrow ? "narrow" : "wide"}-scope-${explicit ? "explicit" : "auto"}.png`) });
            await send.click();
            await expect(composer).toHaveValue("");
            const row = await receipt();
            expect(row.accepted).toBe(true);
            expect(row.text).toBe(text);
            expect(row.submission.projectId).toBeUndefined();
            expect(row.submission.managerMonoId).toBeUndefined();
            expect(row.submission.requestId).toMatch(/^[A-Za-z0-9_-]{1,128}$/);
            expect(row.submission.userMessageId).toMatch(/^[A-Za-z0-9_-]{1,128}$/);
            expect(row.counts).toEqual({ grand: ++grand, resolve: 0, origin: 0, ledger: 0, deliver: 0 });
            expect(row.goals).toEqual([]);
          }
        await page.getByRole("button", { name: "New goal", exact: true }).click();
        await page.getByRole("button", { name: "Goal route: Auto route", exact: true }).click();
        await page.getByRole("option", { name: "Atlas Manager", exact: true }).click();
        await composer.fill("Fix Atlas ./projects/repos");
        await expect(status).toContainText("Send to Atlas Manager");
        await expect(status).toContainText("Contains file paths: routed to Atlas because you selected it");
        await expect(status).toBeInViewport();
        await expect(send).toBeInViewport();
        await page.screenshot({ path: testInfo.outputPath(`${surface}-${theme}-${narrow ? "narrow" : "wide"}-real-path.png`) });
        await send.click();
        await expect(composer).toHaveValue("");
        const row = await receipt();
        expect(row.counts).toEqual({ grand: 8, resolve: 1, origin: 1, ledger: 2, deliver: 1 });
        expect(row.goals).toHaveLength(1);
        expect(row.goals[0]).toMatchObject({ requestId: row.submission.requestId, userMessageId: row.submission.userMessageId,
          projectId: "atlas", route: { managerMonoId: "atlas-manager", override: "manager" } });
        expect(errors).toEqual([]);
      });
