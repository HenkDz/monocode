// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it } from "vitest";
import {
  loadLastModelChoice,
  resetHarnessModelOverlays,
  saveLastModelChoice,
  savePickerProviderVisible,
  setHarnessModels,
} from "../../sessions/model/models";
import { initialQuickChoice, resolveQuickModel } from "./quickComposer";

beforeEach(() => {
  localStorage.clear();
  resetHarnessModelOverlays();
});
afterEach(() => resetHarnessModelOverlays());

it("uses Codex 5.6 Sol instead of the last quick-composer model", () => {
  localStorage.setItem("monocode.quickComposerHarness", "cursor");
  localStorage.setItem("monocode.quickComposerModel", "cursor:composer-2.5");
  saveLastModelChoice("codex", "codex:gpt-5.6-luna");
  expect(initialQuickChoice()).toEqual({
    harness: "codex",
    model: "codex:gpt-5.6-sol",
  });
});

it("retains the stable default when opening another quick session", () => {
  saveLastModelChoice("cursor", "cursor:composer-2.5");
  expect(initialQuickChoice().harness).toBe("codex");
  saveLastModelChoice("codex", "codex:gpt-5.6-luna");
  expect(initialQuickChoice()).toEqual({
    harness: "codex",
    model: "codex:gpt-5.6-sol",
  });
});

it("preserves a live-only model until its provider catalog arrives", () => {
  saveLastModelChoice("codex", "codex:gpt-5.6-luna");
  const choice = initialQuickChoice();
  expect(resolveQuickModel(choice)).toBeNull();
  setHarnessModels("codex", [
    { id: "codex:other", name: "Another model", harness: "codex" },
    { id: "codex:gpt-5.6-sol", name: "GPT-5.6-Sol", harness: "codex" },
  ]);
  expect(resolveQuickModel(choice)?.id).toBe("codex:gpt-5.6-sol");
  expect(initialQuickChoice()).toEqual(choice);
});

it("does not silently switch the stable default when Codex is hidden", () => {
  saveLastModelChoice("codex", "codex:gpt-5.6-luna");
  savePickerProviderVisible("codex", false);
  expect(initialQuickChoice()).toEqual({
    harness: "codex",
    model: "codex:gpt-5.6-sol",
  });
  // Falling back must not overwrite the user's configured default.
  expect(loadLastModelChoice()).toEqual({
    harness: "codex",
    model: "codex:gpt-5.6-luna",
  });
  savePickerProviderVisible("codex", true);
  expect(initialQuickChoice()).toEqual({
    harness: "codex",
    model: "codex:gpt-5.6-sol",
  });
});
