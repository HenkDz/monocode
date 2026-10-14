// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { loadUsageFailoverPolicy, saveUsageFailoverPolicy, subscribeUsageFailoverPolicy, USAGE_FAILOVER_SETTINGS_KEY } from "./usageFailoverSettings";

beforeEach(() => vi.stubGlobal("localStorage", new Storage()));
afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); vi.unstubAllGlobals(); });
it("defaults each provider OFF and persists its independent explicit order", () => {
  expect(loadUsageFailoverPolicy("claude")).toEqual({ enabled: false, rankedAccountIds: [] });
  expect(saveUsageFailoverPolicy("claude", { enabled: true, rankedAccountIds: ["work", "default"] })).toBe(true);
  expect(loadUsageFailoverPolicy("claude")).toEqual({ enabled: true, rankedAccountIds: ["work", "default"] });
  expect(loadUsageFailoverPolicy("codex").enabled).toBe(false);
  expect(saveUsageFailoverPolicy("codex", { enabled: false, rankedAccountIds: ["backup"] })).toBe(true);
  expect(loadUsageFailoverPolicy("claude").enabled).toBe(true);
});
it.each(["{broken", "[]", '{"claude":{"enabled":"yes","rankedAccountIds":[]}}', '{"unknown":{"enabled":true,"rankedAccountIds":[]}}'])("fails closed and preserves opaque settings %s", raw => {
  localStorage.setItem(USAGE_FAILOVER_SETTINGS_KEY, raw);
  expect(loadUsageFailoverPolicy("claude").enabled).toBe(false);
  expect(saveUsageFailoverPolicy("claude", { enabled: true, rankedAccountIds: [] })).toBe(false);
  expect(localStorage.getItem(USAGE_FAILOVER_SETTINGS_KEY)).toBe(raw);
});
it("rejects malformed/duplicate ranks and exposes save failures", () => {
  expect(saveUsageFailoverPolicy("claude", { enabled: true, rankedAccountIds: ["work", "work"] })).toBe(false);
  expect(saveUsageFailoverPolicy("claude", { enabled: true, rankedAccountIds: ["../foreign"] })).toBe(false);
  saveUsageFailoverPolicy("claude", { enabled: false, rankedAccountIds: ["work"] });
  vi.spyOn(localStorage, "setItem").mockImplementation(() => { throw Error("full"); });
  expect(saveUsageFailoverPolicy("claude", { enabled: true, rankedAccountIds: ["work"] })).toBe(false);
  expect(loadUsageFailoverPolicy("claude").enabled).toBe(false);
});
it("announces same-window and external settings updates and cleans up", () => {
  const listener = vi.fn(); const unsubscribe = subscribeUsageFailoverPolicy(listener);
  saveUsageFailoverPolicy("claude", { enabled: true, rankedAccountIds: [] });
  window.dispatchEvent(new StorageEvent("storage", { key: USAGE_FAILOVER_SETTINGS_KEY }));
  expect(listener).toHaveBeenCalledTimes(2);
  unsubscribe(); window.dispatchEvent(new StorageEvent("storage", { key: USAGE_FAILOVER_SETTINGS_KEY }));
  expect(listener).toHaveBeenCalledTimes(2);
});
