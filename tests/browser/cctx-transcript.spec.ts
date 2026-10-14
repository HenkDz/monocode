import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { join } from "node:path";
import { writeFile } from "node:fs/promises";

function transcript(page: Page) {
  return page.getByRole("region", { name: "Atlas transcript", exact: true });
}

async function frame(page: Page, testInfo: TestInfo, name: string) {
  await page.screenshot({
    path: process.env.CCTX_EVIDENCE_DIR
      ? join(
          process.env.CCTX_EVIDENCE_DIR,
          `${name}-${testInfo.project.name}.png`,
        )
      : testInfo.outputPath(`${name}.png`),
  });
}

async function measure(page: Page) {
  return transcript(page).evaluate((region) => ({
    elements: region.querySelectorAll("*").length,
    workRows: region.querySelectorAll("[data-transcript-turn-work]").length,
    toolGroups: region.querySelectorAll("[data-compact-tool-group]").length,
    toolRows: region.querySelectorAll("[data-compact-tool-call]").length,
    scrollHeight:
      region.querySelector(".agent-transcript")?.scrollHeight ??
      region.scrollHeight,
  }));
}

for (const theme of ["dark", "light"]) {
  for (const width of [1440, 430]) {
    test(`Atlas 50 calls: ${theme}, ${width}px, keyboard and DOM comparison`, async ({
      page,
    }, testInfo) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(
        `/tests/browser/cctx-transcript.html?theme=${theme}&surface=workbench&baseline=1`,
      );
      const legacyRows = transcript(page).locator(
        '[data-mono-activity-block^="atlas-tool-"]',
      );
      await expect(legacyRows).toHaveCount(50);
      const baseline = {
        ...(await measure(page)),
        toolRows: await legacyRows.count(),
      };
      await frame(page, testInfo, `atlas-${theme}-${width}-before`);
      await page.goto(
        `/tests/browser/cctx-transcript.html?theme=${theme}&surface=workbench`,
      );
      const region = transcript(page);
      const toggle = region.getByRole("button", {
        name: "Show the work",
        exact: true,
      });
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
      await expect(region).toContainText("Worked for 1m 51s");
      await expect(region.locator("[data-transcript-turn-work]")).toContainText(
        "10 files edited",
      );
      await expect(region.locator("[data-transcript-turn-work]")).toContainText(
        "1 failed command",
      );
      await expect(
        region.getByRole("heading", {
          name: "Browser destination catalog is ready",
        }),
      ).toBeVisible();
      await expect(region.locator("[data-compact-tool-call]")).toHaveCount(0);
      await expect(region).not.toContainText(
        "I found the dialog lifecycle boundary",
      );
      await expect(region).not.toContainText("Raw diagnostic reasoning");
      await expect(region).not.toContainText("error[E0425]");
      await expect(region.locator("details")).toHaveCount(0);
      const collapsed = await measure(page);
      await frame(page, testInfo, `atlas-${theme}-${width}-collapsed`);

      await toggle.focus();
      await page.keyboard.press("Enter");
      const openToggle = region.getByRole("button", {
        name: "Hide the work",
        exact: true,
      });
      await expect(openToggle).toHaveAttribute("aria-expanded", "true");
      await expect(openToggle).toBeFocused();
      await expect(region).toContainText(
        "Handling dialog updates and closures",
      );
      await expect(region).toContainText(
        "Managing browser destination catalog asynchronously",
      );
      await expect(
        region.getByText("Handling dialog updates and closures", {
          exact: true,
        }),
      ).toHaveCount(1);
      await expect(
        region.getByText(
          "Managing browser destination catalog asynchronously",
          { exact: true },
        ),
      ).toHaveCount(1);
      await expect(region).toContainText(
        "I found the dialog lifecycle boundary",
      );
      await expect(region).not.toContainText("Raw diagnostic reasoning");
      const workExpanded = await measure(page);
      await frame(page, testInfo, `atlas-${theme}-${width}-expanded`);

      const groups = region.locator(
        '[data-compact-tool-group] > button[aria-expanded="false"]',
      );
      while (await groups.count()) await groups.first().click();
      await expect(region.locator("[data-compact-tool-call]")).toHaveCount(50);
      await expect(region).toContainText("cargo check --features browser");
      const allGroupsExpanded = await measure(page);
      expect(collapsed.workRows).toBe(1);
      expect(allGroupsExpanded.toolRows).toBe(50);
      expect(allGroupsExpanded.elements).toBeGreaterThan(collapsed.elements);
      if (process.env.CCTX_EVIDENCE_DIR) await writeFile(
        join(process.env.CCTX_EVIDENCE_DIR, `atlas-${theme}-${width}-metrics.json`),
        JSON.stringify({ inputToolCalls: 50, baselineRendererCommit: "126cbbe4703519e9169a79703b7e2969858c9c18", baselineUsesCurrentSharedDependencies: true, baseline, collapsed, workExpanded, allGroupsExpanded }, null, 2),
      );
      await testInfo.attach("50-call-dom-comparison.json", {
        body: JSON.stringify(
          {
            inputToolCalls: 50,
            baselineRendererCommit: "126cbbe4703519e9169a79703b7e2969858c9c18",
            baselineUsesCurrentSharedDependencies: true,
            baseline,
            collapsed,
            workExpanded,
            allGroupsExpanded,
          },
          null,
          2,
        ),
        contentType: "application/json",
      });

      await openToggle.focus();
      await page.keyboard.press("Space");
      await expect(toggle).toBeFocused();
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
      await expect(region.locator("[data-compact-tool-call]")).toHaveCount(0);
      await page.reload();
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
      expect(errors).toEqual([]);
    });
  }
}

for (const [surface, harness] of [
  ["task", "codex"],
  ["workbench", "claude"],
  ["member", "opencode"],
  ["floating", "pi"],
  ["manager", "cursor"],
]) {
  test(`${surface} surface and ${harness} use the same default fold`, async ({
    page,
  }) => {
    await page.goto(
      `/tests/browser/cctx-transcript.html?surface=${surface}&harness=${harness}`,
    );
    const region = transcript(page);
    await expect(
      region.getByRole("button", { name: "Show the work", exact: true }),
    ).toHaveAttribute("aria-expanded", "false");
    await expect(
      region.getByRole("heading", {
        name: "Browser destination catalog is ready",
      }),
    ).toBeVisible();
    await expect(region.locator("[data-compact-tool-call]")).toHaveCount(0);
  });
}

test("running work keeps one action and preserves open choice and focus on completion", async ({
  page,
}, testInfo) => {
  await page.goto(
    "/tests/browser/cctx-transcript.html?scenario=running&surface=member",
  );
  const region = transcript(page);
  const toggle = region.getByRole("button", {
    name: "Show the work",
    exact: true,
  });
  await expect(region).toContainText("Working for");
  await expect(region).toContainText("cargo test browser_destination --lib");
  await expect(region.locator("[data-compact-tool-call]")).toHaveCount(0);
  await expect(region).not.toContainText(
    "I found the dialog lifecycle boundary",
  );
  await expect(
    region.getByRole("heading", {
      name: "Browser destination catalog is ready",
    }),
  ).toHaveCount(0);
  await frame(page, testInfo, "atlas-running-collapsed");
  await toggle.focus();
  await page.keyboard.press("Enter");
  const openToggle = region.getByRole("button", {
    name: "Hide the work",
    exact: true,
  });
  await expect(openToggle).toBeFocused();
  await page
    .getByRole("button", { name: "Complete synthetic turn" })
    .evaluate((button) => (button as HTMLButtonElement).click());
  await expect(region).toContainText("Worked for 1m 51s");
  await expect(openToggle).toHaveAttribute("aria-expanded", "true");
  await expect(openToggle).toBeFocused();
  await expect(
    region.getByRole("heading", {
      name: "Browser destination catalog is ready",
    }),
  ).toBeVisible();
});

test("each turn keeps its own expansion choice", async ({ page }) => {
  await page.goto("/tests/browser/cctx-transcript.html?scenario=two-turns");
  const region = transcript(page);
  const first = region.locator(
    '[data-transcript-turn-work="atlas-request"] > button',
  );
  const second = region.locator(
    '[data-transcript-turn-work="follow-up-request"] > button',
  );
  await expect(first).toHaveAttribute("aria-expanded", "false");
  await expect(second).toHaveAttribute("aria-expanded", "false");
  await first.click();
  await expect(first).toHaveAttribute("aria-expanded", "true");
  await expect(second).toHaveAttribute("aria-expanded", "false");
  await second.click();
  await first.click();
  await expect(first).toHaveAttribute("aria-expanded", "false");
  await expect(second).toHaveAttribute("aria-expanded", "true");
});

for (const decision of ["Allow", "Deny"]) {
  test(`pending approval stays verbatim outside work and ${decision} retains callback`, async ({
    page,
  }, testInfo) => {
    await page.goto(
      "/tests/browser/cctx-transcript.html?scenario=approval&surface=workbench",
    );
    const region = transcript(page);
    const command = region.getByLabel("Command awaiting approval", {
      exact: true,
    });
    await expect(command).toBeVisible();
    expect(await command.textContent()).toBe(
      "cargo check --features browser --manifest-path src-tauri/Cargo.toml\nWrite-Output '$(UNTRUSTED_TEXT); & do-not-execute'",
    );
    await expect(
      region.getByRole("button", { name: "Show the work", exact: true }),
    ).toHaveAttribute("aria-expanded", "false");
    await expect(
      region.getByRole("button", { name: "Allow", exact: true }),
    ).toBeVisible();
    await expect(
      region.getByRole("button", { name: "Deny", exact: true }),
    ).toBeVisible();
    if (decision === "Allow")
      await frame(page, testInfo, "atlas-approval-verbatim");
    await region.getByRole("button", { name: decision, exact: true }).click();
    await expect(page.getByLabel("Fixture callback")).toHaveText(
      decision.toLowerCase(),
    );
  });
}

test("question stays outside folded work and returns the actual form reply", async ({
  page,
}, testInfo) => {
  await page.goto(
    "/tests/browser/cctx-transcript.html?scenario=question&surface=manager",
  );
  const region = transcript(page);
  await expect(
    region.getByRole("button", { name: "Show the work", exact: true }),
  ).toHaveAttribute("aria-expanded", "false");
  await expect(region.locator("[data-question-form]")).toBeVisible();
  await expect(region).toContainText(
    "Which browser destination source should I use?",
  );
  await frame(page, testInfo, "atlas-question");
  await region.getByRole("button", { name: /System browsers/ }).click();
  await region.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByLabel("Fixture callback")).toContainText(
    '"source":["system"]',
  );
});

test("turn-ending failure stays outside the fold in place of a final answer", async ({
  page,
}, testInfo) => {
  await page.goto("/tests/browser/cctx-transcript.html?scenario=failure");
  const region = transcript(page);
  await expect(
    region.getByRole("button", { name: "Show the work", exact: true }),
  ).toHaveAttribute("aria-expanded", "false");
  await expect(region).toContainText("Provider connection interrupted");
  await expect(region.locator('[data-transcript-error] [role="alert"]')).toHaveCount(1);
  await expect(
    region.getByRole("heading", {
      name: "Browser destination catalog is ready",
    }),
  ).toHaveCount(0);
  await expect(region.locator("[data-compact-tool-call]")).toHaveCount(0);
  await frame(page, testInfo, "atlas-terminal-failure");
});
