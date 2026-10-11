import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const transport = vi.hoisted(() => ({
  stdout: undefined as ((line: string) => void) | undefined,
  sse: undefined as ((data: string) => void) | undefined,
  requests: [] as Array<{ url: string; method: string; body?: string }>,
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), isTauri: () => false }));
vi.mock("../../core/child", () => ({
  closeHarnessSse: async () => {}, execChild: async () => "opencode 1.14.19",
  freeHarnessPort: async () => 4096, killChild: async () => {}, openHarnessSse: async () => {},
  resolveOpenCodeBinary: async () => ({ path: "/synthetic/opencode" }),
  spawnChild: async () => { transport.stdout?.("opencode server listening on http://127.0.0.1:4096"); },
  unwatchChild: () => {},
  watchChild: (_id: string, stdout: (line: string) => void) => { transport.stdout = stdout; },
  watchSse: (_id: string, event: (data: string) => void) => { transport.sse = event; },
  harnessHttp: async (input: { url: string; method: string; body?: string }) => {
    transport.requests.push(input);
    const path = new URL(input.url).pathname;
    if (input.method === "GET" && path === "/session/old") return { status: 404, body: JSON.stringify({ message: "session deleted" }) };
    if (input.method === "POST" && path === "/session") return { status: 200, body: JSON.stringify({ id: "fresh", directory: "/synthetic" }) };
    if (input.method === "GET" && path.endsWith("/message")) return { status: 200, body: "[]" };
    return { status: 204, body: "" };
  },
}));

beforeEach(() => {
  vi.resetModules();
  const stored = new Map<string, string>();
  vi.stubGlobal("crypto", webcrypto);
  vi.stubGlobal("localStorage", { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => stored.set(key, value) });
  transport.stdout = undefined; transport.sse = undefined; transport.requests = [];
});
afterEach(() => vi.unstubAllGlobals());

// CC1R's actual adapter/registry reproduction, asserting the corrected first fresh turn.
it("rebuilds omitted org, soul and memory before OpenCode submits its 404 replacement", async () => {
  const context = await import("../../../../features/monos/model/monoFiles");
  const registry = await import("../../core/registry");
  const provider = await import("./opencode");
  const id = "deleted-provider-repro";
  const model = "opencode:openrouter/anthropic/claude-sonnet-4.6";
  const files = { soulHash: "synthetic-soul", memoryHash: "synthetic-memory" };
  const chart = "<org_chart>The user alone merges; destructive work requires the user.</org_chart>";
  const message = "Continue authorized work";
  context.recordAgentContext(id, "old", files);
  context.recordOrgContext(id, "old", await context.planOrgContext(id, "old", model, chart));
  expect((await context.planOrgContext(id, "old", model, chart)).text).toBeUndefined();
  expect(context.planAgentContext(id, "old", files)).toEqual({ soul: false, memory: false });
  provider.bindOpenCodeSession(id, "old", "/synthetic");
  registry.registerHarness({ id: "opencode", live: true, sendTurn: provider.sendOpenCodeTurn, steerTurn: async () => {}, cancelTurn: async () => {}, respondApproval() {}, stopSession: provider.stopOpenCodeSession, forgetSession: async () => {}, bindSession() {} });
  let acceptContext: (() => void) | undefined;
  let accepted = false;
  const send = () => registry.sendHarnessTurn({ harness: "opencode", sessionId: id, cwd: "/synthetic", model, runtimeMode: "supervised", text: message,
    async prepareText(confirmed) {
      expect(confirmed).toBe("fresh");
      const orgPlan = await context.planOrgContext(id, confirmed, model, chart);
      const agentPlan = context.planAgentContext(id, confirmed, files);
      acceptContext = () => {
        context.recordAgentContext(id, confirmed, files, { plan: agentPlan, provider: confirmed });
        context.recordOrgContext(id, confirmed, orgPlan);
      };
      return [orgPlan.text, agentPlan.soul ? "Configured soul" : undefined, agentPlan.memory ? "Current memory" : undefined, message].filter(Boolean).join("\n\n");
    },
    onEvent() {}, onAccepted() { acceptContext?.(); accepted = true; },
  });
  try {
    const first = send();
    await vi.waitFor(() => expect(accepted).toBe(true));
    const prompt = transport.requests.find(input => input.url.includes("/session/fresh/prompt_async"));
    expect(JSON.parse(prompt!.body!).parts).toEqual([{ type: "text", text: `${chart}\n\nConfigured soul\n\nCurrent memory\n\n${message}` }]);
    transport.sse?.(JSON.stringify({ type: "session.status", properties: { sessionID: "fresh", status: { type: "idle" } } }));
    await first;
    expect((await context.planOrgContext(id, "fresh", model, chart)).text).toBeUndefined();
    expect(context.planAgentContext(id, "fresh", files)).toEqual({ soul: false, memory: false });
    accepted = false;
    const second = send();
    await vi.waitFor(() => expect(accepted).toBe(true));
    const nextPrompt = transport.requests.filter(input => input.url.includes("/session/fresh/prompt_async")).at(-1);
    expect(JSON.parse(nextPrompt!.body!).parts).toEqual([{ type: "text", text: message }]);
    transport.sse?.(JSON.stringify({ type: "session.status", properties: { sessionID: "fresh", status: { type: "idle" } } }));
    await second;
  } finally {
    await provider.stopOpenCodeSession(id);
    registry.resetHarnessIdlePark();
  }
});
