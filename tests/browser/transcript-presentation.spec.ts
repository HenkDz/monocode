import { expect, test } from "@playwright/test";
import { join } from "node:path";

const markers = [
  "team_sender",
  "monocode_context",
  "org_chart",
  "authority_core",
  "requiresReply:false",
  "This is a teammate question",
  "message for acknowledgements.",
];
const storageError =
  "Private Mono storage is only supported for Codex app-server";

for (const theme of ["dark", "light"]) {
  test(`transcript and member activity show compact receipts in ${theme}`, async ({
    page,
  }, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(
      `/tests/browser/transcript-presentation.html?theme=${theme}`,
    );
    const activity = page.getByRole("region", {
      name: "Reviewer activity",
      exact: true,
    });
    const transcript = page.getByRole("region", {
      name: "Reviewer transcript",
      exact: true,
    });
    const receipt = activity.locator(
      '[data-monocode-tool-call="sessions.read"]',
    );
    await expect(receipt).toContainText(
      "Read Manager conversation · 3 recent exchanges",
    );
    await expect(transcript).toContainText("Native Core");
    await expect(transcript).toContainText("V5 native process reconciliation");
    await expect(transcript).toContainText(
      "Check the retained process identity",
    );
    for (const marker of [...markers, "cc7t-synthetic-read", storageError])
      await expect(page.locator("body")).not.toContainText(marker);
    await expect(
      activity.locator('[data-transcript-error="storage"]'),
    ).toHaveCount(1);
    await expect(activity).toContainText("storage launch mismatch");
    await expect(activity).toContainText(
      "Couldn't start Reviewer: storage launch mismatch",
    );
    await expect(
      activity.getByRole("button", { name: "History (1)", exact: true }),
    ).toHaveCount(0);
    await expect(activity.locator("details")).toHaveCount(0);
    await page.screenshot({
      path: process.env.CC7T_EVIDENCE_DIR
        ? join(
            process.env.CC7T_EVIDENCE_DIR,
            `after-${theme}-${testInfo.project.name}.png`,
          )
        : testInfo.outputPath(`after-${theme}.png`),
    });

    const outputButton = receipt.getByRole("button", {
      name: "View full output",
      exact: true,
    });
    await outputButton.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("cc7t-synthetic-read");
    for (const marker of markers)
      await expect(dialog).not.toContainText(marker);
    await expect(
      dialog.getByRole("button", { name: "Copy output", exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(outputButton).toBeFocused();

    const filters = activity.getByRole("group", { name: "Filter activity" });
    await filters.getByRole("button", { name: "errors", exact: true }).click();
    await expect(
      activity.locator('[data-member-activity="tools"]'),
    ).toHaveCount(0);
    await expect(
      activity.locator('[data-member-activity="errors"]'),
    ).toHaveCount(1);
    const error = activity.locator('[data-transcript-error="storage"]').last();
    await error
      .getByRole("button", { name: "Open details", exact: true })
      .click();
    await expect(dialog).toContainText(storageError);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await error
      .getByRole("button", { name: "Copy diagnostics", exact: true })
      .click();
    await expect(error.getByRole("status")).toContainText("Diagnostics copied");
    await filters
      .getByRole("button", { name: "messages", exact: true })
      .click();
    await expect(
      activity.locator('[data-member-activity="messages"]'),
    ).toHaveCount(2);
    await expect(
      activity.locator('[data-member-activity="errors"]'),
    ).toHaveCount(0);
    await expect(activity).toContainText("Native Core");
    await filters.getByRole("button", { name: "all", exact: true }).click();
    await expect(receipt).toBeVisible();
    expect(errors).toEqual([]);
  });
}

test("generic output stays short and full output opens in a dialog", async ({
  page,
}) => {
  await page.goto(
    "/tests/browser/transcript-presentation.html?generic=1&system-error=1",
  );
  await expect(
    page
      .getByRole("region", { name: "Reviewer transcript", exact: true })
      .locator('[data-transcript-error="storage"]'),
  ).toHaveCount(1);
  const activity = page.getByRole("region", {
    name: "Reviewer activity",
    exact: true,
  });
  const generic = activity
    .locator('[data-member-activity="tools"]')
    .filter({ hasText: "git status --short" });
  await expect(generic).toContainText("M src/fixture-0.ts");
  await expect(generic).toContainText("M src/fixture-2.ts");
  await expect(generic).not.toContainText("M src/fixture-3.ts");
  await generic
    .getByRole("button", { name: "View full output", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("M src/fixture-19.ts");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
