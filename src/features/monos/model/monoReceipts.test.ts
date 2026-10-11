import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

let stored: Map<string, string>;
const files = { soulHash: "synthetic-soul", memoryHash: "synthetic-memory" };
const chart = "<org_chart>The user alone merges; destructive work requires the user.</org_chart>";

beforeEach(() => {
  vi.resetModules();
  stored = new Map();
  vi.stubGlobal("crypto", webcrypto);
  vi.stubGlobal("localStorage", { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => stored.set(key, value) });
});
afterEach(() => vi.unstubAllGlobals());

it.each([false, true])("re-hands restored conversations after restart with write refusal=%s", async readOnly => {
  let context = await import("./monoFiles");
  const id = "readable-storage-restart";
  context.recordAgentContext(id, "same-provider", files);
  context.recordOrgContext(id, "same-provider", await context.planOrgContext(id, "same-provider", "codex:sol", chart));
  expect((await context.planOrgContext(id, "same-provider", "codex:sol", chart)).text).toBeUndefined();
  if (readOnly) {
    vi.stubGlobal("localStorage", { getItem: (key: string) => stored.get(key) ?? null, setItem: () => { throw Error("write disabled"); } });
    context.forgetAgentContext(id);
  }
  vi.resetModules();
  context = await import("./monoFiles");
  const org = await context.planOrgContext(id, "same-provider", "codex:sol", chart);
  const agent = context.planAgentContext(id, "same-provider", files);
  expect(org.text).toBe(chart);
  expect(agent).toEqual({ soul: true, memory: true });
  context.recordAgentContext(id, "same-provider", files, { plan: agent, provider: "same-provider" });
  context.recordOrgContext(id, "same-provider", org);
  expect((await context.planOrgContext(id, "same-provider", "codex:sol", chart)).text).toBe(readOnly ? chart : undefined);
  expect(context.planAgentContext(id, "same-provider", files)).toEqual({ soul: readOnly, memory: readOnly });
});

it("never records omitted or partially omitted context against a replacement provider", async () => {
  const context = await import("./monoFiles");
  const id = "replacement";
  context.recordAgentContext(id, "old", files);
  context.recordOrgContext(id, "old", await context.planOrgContext(id, "old", "codex:sol", chart));
  const org = await context.planOrgContext(id, "old", "codex:sol", chart);
  expect(org.text).toBeUndefined();
  for (const plan of [{ soul: false, memory: false }, { soul: false, memory: true }, { soul: true, memory: false }]) {
    context.recordAgentContext(id, "fresh", files, { plan, provider: "old" });
    expect(context.planAgentContext(id, "fresh", files)).toEqual({ soul: true, memory: true });
  }
  context.recordOrgContext(id, "fresh", org);
  expect((await context.planOrgContext(id, "fresh", "codex:sol", chart)).text).toBe(chart);
});
