import { webcrypto } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const policy = vi.hoisted(() => ({
  executable: "C:/Users/Command Center Developer/AppData/Local/Programs/MonoCode Desktop/MonoCode Command Center/monocode.exe",
  tempDir: "C:/Users/Command Center Developer/AppData/Roaming/com.monocode.desktop/session-private/command-center/00000000-0000-4000-8000-000000000000/00000000-0000-4000-8000-000000000001",
  actions: ["rules"],
}));
vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => true,
  invoke: vi.fn(async command => command === "app_cli_approval_policy" ? policy : undefined),
}));
import { monoLook } from "../../../features/monos/model/mono";
import { monoContext, planAgentContext, planOrgContext, recordAgentContext, recordOrgContext } from "../../../features/monos/model/monoFiles";
import { orgTurnContext } from "../../../features/monos/model/monoOrg";
import { assembleMonoPrompt, monoAppContext, monoAuthorityCore } from "../../../features/monos/model/monoPrompt";
import { monoPromptFixture } from "../../../features/monos/model/monoPrompt.fixture";
import { registerHarness, resetHarnessIdlePark, sendHarnessTurn } from "./registry";

beforeEach(() => {
  const stored = new Map<string, string>();
  vi.stubGlobal("crypto", webcrypto);
  vi.stubGlobal("localStorage", { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => stored.set(key, value) });
});
afterEach(() => { resetHarnessIdlePark(); vi.unstubAllGlobals(); });

it("budgets full-registry steady app text with long Windows CLI and private-input paths", async () => {
  const f = monoPromptFixture();
  const request = "Continue the authorized task and report only new findings.";
  const rows: { role: string; regionAppChars: number; registrySuffixChars: number; registryAppChars: number; providerInputChars: number }[] = [];
  let transmitted = "";
  registerHarness({ id: "codex", live: true, async sendTurn(input) {
    transmitted = await input.prepareText!("retained-provider");
    input.onAccepted?.();
  }, async steerTurn() {}, async cancelTurn() {}, respondApproval() {}, async stopSession() {}, async forgetSession() {}, bindSession() {} });

  for (const mono of [f.grand, f.manager, f.member]) {
    const sessionId = `registry-budget-${mono.id}`;
    const chart = orgTurnContext(f.roster, mono.id)!;
    let assembled = "", record = () => {};
    const prepare = async (provider?: string) => {
      const org = await planOrgContext(sessionId, provider, "codex:sol", chart);
      const agent = planAgentContext(sessionId, provider, f.files);
      const context = [monoAuthorityCore(mono), ...(org.text ? [org.text] : [])];
      if (agent.soul || agent.memory) context.push(monoContext(monoLook(mono), f.files, agent, mono.role));
      if (agent.soul) context.push(monoAppContext(`"${policy.executable}" app`, true));
      assembled = assembleMonoPrompt(request, context, true, false);
      record = () => { recordOrgContext(sessionId, provider, org); recordAgentContext(sessionId, provider, f.files, { provider, plan: agent }); };
      return assembled;
    };
    for (const turn of ["first", "steady"] as const) {
      const fallback = await prepare();
      const prepareText = vi.fn(prepare);
      await sendHarnessTurn({ harness: "codex", sessionId, cwd: "C:/Synthetic/command-center", model: "codex:sol", runtimeMode: "supervised", orgMono: true, monoSession: true, text: fallback, prepareText, onAccepted: () => record(), onEvent() {} });
      expect(prepareText).toHaveBeenCalledExactlyOnceWith("retained-provider");
      expect(transmitted.startsWith(assembled)).toBe(true);
      expect(transmitted.match(/<mono_authority>/g)).toHaveLength(1);
      expect(transmitted.match(/<monocode_cli_input>/g)).toHaveLength(1);
      expect(transmitted).toContain(policy.executable);
      expect(transmitted).toContain(policy.tempDir);
      if (turn === "first") { expect(transmitted).toContain("<org_chart>"); continue; }
      for (const tag of ["<org_chart>", "<soul>", "<memory>", "<monocode_app>"]) expect(transmitted).not.toContain(tag);
      const regionAppChars = assembled.length - request.length;
      const registrySuffixChars = transmitted.length - assembled.length;
      const registryAppChars = transmitted.length - request.length;
      expect(regionAppChars).toBeLessThanOrEqual(1_000);
      expect(registrySuffixChars).toBeGreaterThan(0);
      expect(registryAppChars).toBe(regionAppChars + registrySuffixChars);
      expect(registryAppChars).toBeLessThanOrEqual(1_700);
      expect(transmitted.length).toBeLessThanOrEqual(1_700 + request.length);
      rows.push({ role: mono.role!, regionAppChars, registrySuffixChars, registryAppChars, providerInputChars: transmitted.length });
    }
  }
  mkdirSync("target/cc1-verification", { recursive: true });
  writeFileSync("target/cc1-verification/registry-steady.json", `${JSON.stringify({ scope: "full registry prepared input; app counts exclude the user request", requestChars: request.length, policy, executablePathChars: policy.executable.length, privateInputPathChars: policy.tempDir.length, regionAppBudget: 1_000, registryAppBudget: 1_700, rows }, null, 2)}\n`);
  expect(rows).toHaveLength(3);
});
