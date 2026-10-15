import { act } from "react";
import { expect } from "vitest";

export function openTranscriptWork(container: ParentNode) {
  const folds = container.querySelectorAll<HTMLButtonElement>('[data-transcript-turn-work] > button');
  expect(folds.length).toBeGreaterThan(0);
  for (const selector of ['[data-transcript-turn-work] > button', '[data-compact-tool-group] > button']) {
    for (const button of container.querySelectorAll<HTMLButtonElement>(selector)) {
      if (button.getAttribute('aria-expanded') === 'false') act(() => button.click());
    }
  }
}

export function openSubagentOutput(container: ParentNode) {
  const reader = container.querySelector<HTMLButtonElement>('[data-flat-subagent] button[aria-haspopup="dialog"]');
  expect(reader).not.toBeNull();
  act(() => reader!.click());
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
  expect(dialog).not.toBeNull();
  return dialog!;
}
