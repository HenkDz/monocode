import { afterEach, describe, expect, it, vi } from "vitest";
import { invoke, isTauri } from "@tauri-apps/api/core";
vi.mock("@tauri-apps/api/core", async (original) => ({
  ...(await original<typeof import("@tauri-apps/api/core")>()),
  invoke: vi.fn(),
  isTauri: vi.fn(() => false),
}));
import {
  resetHarnessModelOverlays,
  setHarnessModels,
} from "../../../features/sessions/model/models";
import type { HarnessId } from "../../../features/sessions/model/session";
import {
  HARNESS_IDLE_PARK_MS,
  bindHarnessSession,
  canCompactHarnessContext,
  canRunHarnessTextPrompt,
  runHarnessTextPrompt,
  canRewindHarnessLastTurn,
  compactHarnessContext,
  isLiveHarness,
  listHarnesses,
  refreshHarnessCatalogs,
  registerHarness,
  resetHarnessIdlePark,
  sendHarnessTurn,
  updateHarnessRuntimeMode,
  TurnAuthorizationError,
  type HarnessAdapter,
} from "./registry";
import type { SendTurnInput, SteerTurnInput } from "./types";
import * as monoModel from "../../../features/monos/model/mono";
import { registerBuiltinHarnesses } from "./register";

function stub(
  id: "cursor" | "codex" | "claude" | "pi",
  extra: Partial<HarnessAdapter> = {},
): HarnessAdapter {
  return {
    id,
    live: true,
    async sendTurn(_input: SendTurnInput) {},
    async steerTurn(_input: SteerTurnInput) {},
    async cancelTurn() {},
    respondApproval() {},
    async stopSession() {},
    async forgetSession() {},
    bindSession() {},
    ...extra,
  };
}

describe("harness registry", () => {
  it("never emits a late approval after a mode change resolves its held native identity check", async () => {
    vi.mocked(isTauri).mockReturnValue(true);
    let finishCheck!: (allowed: boolean) => void, release!: () => void;
    let events!: SendTurnInput["onEvent"];
    const check = new Promise<boolean>(resolve => { finishCheck = resolve; });
    vi.mocked(invoke).mockImplementation(async command => command === "app_cli_approval_policy" ? {
      executable: "C:/preview/current.exe", tempDir: "C:/Temp", actions: ["projects.list"],
    } : command === "app_cli_executable_matches" ? check : undefined);
    const onEvent = vi.fn(), respondApproval = vi.fn();
    registerHarness(stub("codex", {
      respondApproval,
      updateRuntimeMode() { events({ type: "approval.resolved", requestId: 7, decision: "allow" }); },
      async sendTurn(input) {
        events = input.onEvent;
        input.onEvent({ type: "approval.requested", requestId: 7, title: "Read projects", command: ["C:/preview/older-copy.exe", "app", "projects.list"] });
        await new Promise<void>(resolve => { release = resolve; });
      },
    }));
    const turn = sendHarnessTurn({ harness: "codex", sessionId: "mode-race", cwd: "/tmp", model: "test", runtimeMode: "supervised", orgMono: true, text: "Read projects", onEvent });
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("app_cli_executable_matches", { path: "C:/preview/older-copy.exe" }));
    await updateHarnessRuntimeMode("codex", "mode-race", "full-access");
    finishCheck(false);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(onEvent).not.toHaveBeenCalled();
    expect(respondApproval).not.toHaveBeenCalled();
    release();
    await turn;
  });
  it("updates a running turn's policy immediately while its operation queue is blocked", async () => {
    let release!: () => void;
    const updateRuntimeMode = vi.fn();
    registerHarness(stub("codex", { updateRuntimeMode, async sendTurn() { await new Promise<void>(resolve => { release = resolve; }); } }));
    const sending = sendHarnessTurn({ harness: "codex", sessionId: "policy", cwd: "/tmp", model: "test", runtimeMode: "supervised", text: "Work", onEvent: () => {} });
    await vi.waitFor(() => expect(release).toBeDefined());
    await updateHarnessRuntimeMode("codex", "policy", "full-access");
    expect(updateRuntimeMode).toHaveBeenCalledExactlyOnceWith("policy", "full-access");
    release();
    await sending;
  });

  it("refreshes the current executable for every provider turn after a renamed preview restart", async () => {
    vi.mocked(isTauri).mockReturnValue(true);
    let executable = "C:/preview/old.exe";
    vi.mocked(invoke).mockImplementation(async command => command === "app_cli_approval_policy" ? { executable, tempDir: "C:/Temp", actions: ["projects.list"] } : undefined);
    const texts: string[] = [];
    registerHarness(stub("codex", { async sendTurn(input) { texts.push(input.text); } }));
    const input = { harness: "codex" as const, sessionId: "renamed", cwd: "/tmp", model: "test", runtimeMode: "supervised" as const, orgMono: true, text: "Run CLI", onEvent: () => {} };
    await sendHarnessTurn(input);
    executable = "C:/preview/current.exe";
    await sendHarnessTurn(input);
    expect(texts[0]).toContain("current running MonoCode executable is C:/preview/old.exe");
    expect(texts[1]).toContain("current running MonoCode executable is C:/preview/current.exe");
    expect(texts[1]).toContain("overrides executable paths from earlier turns");
    expect(texts[1]).not.toContain("old.exe");
  });
  it.each(["argv", "string"])("auto-approves Codex's live bare-path PowerShell transport (%s)", async shape => {
    vi.mocked(isTauri).mockReturnValue(true);
    const executable = "C:/Users/nooro/orca/workspaces/monocode/team-building/target/r5-acceptance/monocode-r5-cards.exe";
    const pwsh = "C:/Program Files/PowerShell/7/pwsh.exe";
    vi.mocked(invoke).mockImplementation(async command => command === "app_cli_approval_policy" ? {
      executable, tempDir: "C:/Temp", actions: ["projects.list"], trustedPowerShell: [pwsh],
    } : command === "app_cli_powershell_is_trusted" ? true : undefined);
    let settle!: () => void;
    const onEvent = vi.fn(), respondApproval = vi.fn(() => settle());
    registerHarness(stub("codex", { respondApproval, async sendTurn(input) {
      const wait = new Promise<void>(resolve => { settle = resolve; });
      const script = `${executable} app projects.list`;
      input.onEvent({ type: "approval.requested", requestId: 1, title: "Read projects",
        command: shape === "argv" ? [pwsh, "-NoProfile", "-Command", script] : `"${pwsh}" -NoProfile -Command '${script}'` });
      await wait;
    } }));
    await sendHarnessTurn({ harness: "codex", sessionId: "live-bare-path", cwd: "C:/Users/nooro", model: "test",
      runtimeMode: "supervised", orgMono: true, text: "Read projects", onEvent });
    expect(respondApproval).toHaveBeenCalledExactlyOnceWith("live-bare-path", 1, "allow");
    expect(onEvent).not.toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledWith("app_cli_powershell_is_trusted", { path: pwsh, cwd: "C:/Users/nooro" });
  });
  it.each([true, false])("rechecks PowerShell identity and the actual command cwd before approval (trusted: %s)", async trusted => {
    vi.mocked(isTauri).mockReturnValue(true);
    const executable = "C:/preview/app.exe";
    vi.mocked(invoke).mockImplementation(async command => command === "app_cli_approval_policy" ? {
      executable, tempDir: "C:/Temp", actions: ["projects.list"], trustedPowerShell: ["powershell"],
    } : command === "app_cli_powershell_is_trusted" ? trusted : undefined);
    let settle!: () => void;
    const onEvent = vi.fn(() => settle()), respondApproval = vi.fn(() => settle());
    registerHarness(stub("codex", { respondApproval, async sendTurn(input) {
      const wait = new Promise<void>(resolve => { settle = resolve; });
      input.onEvent({ type: "approval.requested", requestId: 9, title: "Read projects", cwd: "C:/other-worktree",
        command: ["powershell", "-NoProfile", "-Command", `& '${executable}' app projects.list`] });
      await wait;
    } }));
    await sendHarnessTurn({ harness: "codex", sessionId: "shell-trust", cwd: "C:/Users/nooro", model: "test",
      runtimeMode: "supervised", orgMono: true, text: "Read projects", onEvent });
    expect(invoke).toHaveBeenCalledWith("app_cli_powershell_is_trusted", { path: "powershell", cwd: "C:/other-worktree" });
    expect(respondApproval).toHaveBeenCalledTimes(trusted ? 1 : 0);
    expect(onEvent).toHaveBeenCalledTimes(trusted ? 0 : 1);
  });
  it("keeps a manual decision available if automatic approval delivery throws", async () => {
    vi.mocked(isTauri).mockReturnValue(true);
    vi.mocked(invoke).mockImplementation(async command => command === "app_cli_approval_policy" ? {
      executable: "C:/preview/app.exe", tempDir: "C:/Temp", actions: ["projects.list"],
    } : undefined);
    let settle!: () => void;
    const onEvent = vi.fn(() => settle());
    registerHarness(stub("codex", {
      respondApproval() { throw new Error("transport closed"); },
      async sendTurn(input) {
        const wait = new Promise<void>(resolve => { settle = resolve; });
        input.onEvent({ type: "approval.requested", requestId: 7, title: "Read projects",
          command: ["C:/preview/app.exe", "app", "projects.list"] });
        await wait;
      },
    }));
    await sendHarnessTurn({ harness: "codex", sessionId: "delivery-failed", cwd: "C:/Users/nooro", model: "test",
      runtimeMode: "supervised", monoSession: true, orgMono: true, text: "Read projects", onEvent });
    expect(onEvent).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ type: "approval.requested", requestId: 7,
      autoApprovalReason: "Automatic approval could not be delivered. Retry the decision manually." }));
  });

  it.each([false, true])("checks temp input's real location before deciding (inside: %s)", async inside => {
    vi.mocked(isTauri).mockReturnValue(true);
    vi.mocked(invoke).mockImplementation(async command => command === "app_cli_approval_policy" ? {
      executable: "C:/preview/app.exe", tempDir: "C:/Temp", actions: ["memory.read"],
    } : command === "app_cli_input_is_temp" ? inside : undefined);
    let settle!: () => void;
    const onEvent = vi.fn(() => settle());
    const respondApproval = vi.fn(() => settle());
    registerHarness(stub("claude", { respondApproval, async sendTurn(input) {
      const wait = new Promise<void>(resolve => { settle = resolve; });
      input.onEvent({ type: "approval.requested", requestId: 3, title: "Read input",
        command: ['C:/preview/app.exe', 'app', 'memory.read', '--input', 'C:/Temp/input.json'] });
      await wait;
    } }));
    await sendHarnessTurn({ harness: "claude", sessionId: "temp-input", cwd: "C:/Users/nooro", model: "test",
      runtimeMode: "supervised", orgMono: true, text: "Read memory", onEvent });
    expect(respondApproval).toHaveBeenCalledTimes(inside ? 1 : 0);
    expect(onEvent).toHaveBeenCalledTimes(inside ? 0 : 1);
  });
  it.each(["claude", "codex", "cursor", "pi"] as const)(
    "%s: supervised org Mono assigns through the app CLI without a visible approval", async harness => {
      vi.mocked(isTauri).mockReturnValue(true);
      const executable = "C:/preview/monocode-org.exe";
      vi.mocked(invoke).mockImplementation(async command => command === "app_cli_approval_policy" ? {
        executable, tempDir: "C:/Temp", actions: ["goals.assign", "projects.list"], trustedRtk: "C:/Trusted/rtk.exe",
      } : undefined);
      const onEvent = vi.fn();
      let accept!: () => void;
      const respondApproval = vi.fn(() => accept());
      registerHarness(stub(harness, {
        respondApproval,
        async sendTurn(input) {
          expect(input.runtimeMode).toBe("supervised");
          // ACP adapters install their resolver after emitting the request.
          input.onEvent({ type: "approval.requested", requestId: 1, title: "Run app CLI",
            command: `${harness === "codex" ? "C:/Trusted/rtk.exe proxy " : ""}"${executable}" app goals.assign --json '{"projectId":"nou","goal":"Test"}'` });
          await new Promise<void>(resolve => { accept = resolve; });
          input.onEvent({ type: "approval.resolved", requestId: 1, decision: "allow" });
        },
      }));
      await sendHarnessTurn({ harness, sessionId: `org-${harness}`, cwd: "C:/Users/nooro",
        model: "test", runtimeMode: "supervised", monoSession: true, orgMono: true,
        text: "Assign a goal", onEvent });
      expect(respondApproval).toHaveBeenCalledExactlyOnceWith(`org-${harness}`, 1, "allow");
      expect(onEvent).not.toHaveBeenCalled();
    },
  );

  it.each([false, true])("retains other approvals (org Mono: %s)", async orgMono => {
    vi.mocked(isTauri).mockReturnValue(true);
    vi.mocked(invoke).mockImplementation(async command => command === "app_cli_approval_policy" ? {
      executable: "C:/preview/app.exe", tempDir: "C:/Temp", actions: ["projects.list"],
    } : undefined);
    const respondApproval = vi.fn();
    const onEvent = vi.fn();
    registerHarness(stub("claude", { respondApproval, async sendTurn(input) {
      for (const command of orgMono ? [undefined, '"C:/preview/app.exe" app projects.list && whoami', "whoami"] : ['"C:/preview/app.exe" app projects.list']) {
        input.onEvent({ type: "approval.requested", requestId: 1, title: '"C:/preview/app.exe" app projects.list', command });
      }
    } }));
    await sendHarnessTurn({ harness: "claude", sessionId: "ordinary", cwd: "C:/Users/nooro", model: "test",
      runtimeMode: "supervised", monoSession: true, orgMono, text: "Hello", onEvent });
    expect(respondApproval).not.toHaveBeenCalled();
    expect(onEvent).toHaveBeenCalledTimes(orgMono ? 3 : 1);
    if (orgMono) expect(onEvent).toHaveBeenNthCalledWith(1, expect.objectContaining({
      autoApprovalReason: "Not an app CLI command; this tool request follows the Mono's permission mode.",
    }));
  });
  afterEach(() => {
    vi.mocked(isTauri).mockReturnValue(false);
    vi.mocked(invoke).mockReset();
    resetHarnessModelOverlays();
    resetHarnessIdlePark();
    vi.useRealTimers();
  });

  it("tracks live adapters", () => {
    registerHarness(stub("cursor"));
    registerHarness(stub("codex"));
    registerHarness(stub("claude"));
    expect(isLiveHarness("cursor")).toBe(true);
    expect(isLiveHarness("codex")).toBe(true);
    expect(isLiveHarness("claude")).toBe(true);
    expect(
      listHarnesses()
        .map((a) => a.id)
        .filter((id) => id === "claude" || id === "codex" || id === "cursor")
        .sort(),
    ).toEqual(["claude", "codex", "cursor"]);
  });

  it.each([false, true])("rejects authorization without provider output (Mono identity: %s)", async (monoSession) => {
    vi.mocked(isTauri).mockReturnValue(true);
    const message =
      "This checkout is controlled by an orchestrator. Stop that run before starting independent work.";
    vi.mocked(invoke).mockRejectedValueOnce(message);
    const sendTurn = vi.fn();
    registerHarness(stub("codex", { sendTurn }));
    const onEvent = vi.fn();
    const sending = sendHarnessTurn({
      harness: "codex",
      sessionId: "rejected",
      cwd: "/home/projects/app",
      model: "codex:gpt-5.4",
      runtimeMode: "supervised",
      text: "Hello",
      monoSession,
      onEvent,
    });
    await expect(sending).rejects.toBeInstanceOf(TurnAuthorizationError);
    await expect(sending).rejects.toThrow(message);
    expect(sendTurn).not.toHaveBeenCalled();
    expect(onEvent).not.toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledExactlyOnceWith("control_authorize_turn", {
      sessionId: "rejected",
      cwd: "/home/projects/app",
      appAccess: false,
      monoSession,
    });
  });

  it.each(["manager", "member", "orchestrator"] as const)("passes team authority only for the owning Manager (%s)", async (role) => {
    vi.mocked(isTauri).mockReturnValue(true);
    vi.mocked(invoke).mockResolvedValue(undefined);
    const owner = vi.spyOn(monoModel, "findMono").mockReturnValue({
      id: "owner", role, mascot: "bear", color: "blue", projects: ["/tmp"],
    });
    registerHarness(stub("codex", { sendTurn: async () => {} }));
    try {
      await sendHarnessTurn({
        harness: "codex", sessionId: "owned", cwd: "/tmp", model: "codex:installed",
        runtimeMode: "supervised", text: "Hello", orgMonoId: "owner", monoSession: true,
        onEvent: () => {},
      });
      expect(invoke).toHaveBeenCalledWith("control_authorize_turn", {
        sessionId: "owned", cwd: "/tmp", appAccess: false, monoSession: true,
        ...(role === "manager" ? { monoManagerId: "owner" } : {}),
      });
    } finally { owner.mockRestore(); }
  });

  it("announces readiness when the provider accepts, while preserving the caller's acceptance callback", async () => {
    let accepted!: () => void;
    let finish!: () => void;
    registerHarness(
      stub("codex", {
        async sendTurn(input) {
          accepted = () => input.onAccepted?.();
          await new Promise<void>((resolve) => {
            finish = resolve;
          });
        },
      }),
    );
    const onEvent = vi.fn();
    const onAccepted = vi.fn();
    const sending = sendHarnessTurn({
      harness: "codex",
      sessionId: "readiness",
      cwd: "/tmp",
      model: "codex:gpt-5.4",
      runtimeMode: "supervised",
      text: "Hello",
      onEvent,
      onAccepted,
    });
    await vi.waitFor(() => expect(accepted).toBeDefined());
    expect(onEvent).not.toHaveBeenCalled();
    accepted();
    expect(onEvent).toHaveBeenCalledExactlyOnceWith({ type: "turn.ready" });
    expect(onAccepted).toHaveBeenCalledOnce();
    finish();
    await sending;
  });

  it("advertises isolated text prompt support by harness", () => {
    registerBuiltinHarnesses();
    const ids: HarnessId[] = [
      "claude",
      "codex",
      "cursor",
      "grok",
      "opencode",
      "pi",
      "omp",
      "fx",
      "hermes",
      "antigravity",
    ];

    expect(
      Object.fromEntries(ids.map((id) => [id, canRunHarnessTextPrompt(id)])),
    ).toEqual({
      claude: true,
      codex: true,
      cursor: true,
      grok: true,
      opencode: true,
      pi: true,
      omp: true,
      fx: false,
      hermes: false,
      antigravity: false,
    });
  });

  it("exposes the native compaction support matrix", () => {
    registerBuiltinHarnesses();
    const ids: HarnessId[] = [
      "claude",
      "codex",
      "cursor",
      "grok",
      "opencode",
      "pi",
      "omp",
      "fx",
      "antigravity",
    ];

    expect(
      Object.fromEntries(ids.map((id) => [id, canCompactHarnessContext(id)])),
    ).toEqual({
      claude: true,
      codex: true,
      cursor: false,
      grok: true,
      opencode: true,
      pi: true,
      omp: true,
      fx: false,
      antigravity: false,
    });
  });
  it("advertises and dispatches compaction only when an adapter supports it", async () => {
    const compactContext = vi.fn(async () => undefined);
    registerHarness(stub("codex", { compactContext }));
    registerHarness(stub("claude"));

    expect(canCompactHarnessContext("codex")).toBe(true);
    expect(canCompactHarnessContext("claude")).toBe(false);

    await compactHarnessContext({
      harness: "codex",
      sessionId: "compact-1",
      cwd: "/tmp",
      model: "codex:gpt-5.4",
      runtimeMode: "supervised",
      onEvent: () => undefined,
    });

    expect(compactContext).toHaveBeenCalledOnce();
    await expect(
      compactHarnessContext({
        harness: "claude",
        sessionId: "compact-2",
        cwd: "/tmp",
        model: "claude:sonnet",
        runtimeMode: "supervised",
        onEvent: () => undefined,
      }),
    ).rejects.toThrow("does not support manual compaction");
  });
  it("cancels an isolated text prompt through the adapter lifecycle", async () => {
    const runTextPrompt = vi.fn(() => new Promise<string>(() => undefined));
    const stopTextPrompt = vi.fn(async () => undefined);
    registerHarness(stub("claude", { runTextPrompt, stopTextPrompt }));
    const controller = new AbortController();
    const request = runHarnessTextPrompt({
      harness: "claude",
      cwd: "/tmp",
      prompt: "read-only question",
      signal: controller.signal,
    });

    controller.abort();

    await expect(request).rejects.toThrow("By-the-way request cancelled");
    expect(runTextPrompt).toHaveBeenCalledOnce();
    expect(stopTextPrompt).not.toHaveBeenCalled();
  });

  it("does not stop the shared text backend while another prompt is active", async () => {
    const runTextPrompt = vi.fn(() => new Promise<string>(() => undefined));
    const stopTextPrompt = vi.fn(async () => undefined);
    registerHarness(stub("claude", { runTextPrompt, stopTextPrompt }));
    const first = new AbortController();
    const second = new AbortController();
    const firstRequest = runHarnessTextPrompt({
      harness: "claude",
      cwd: "/tmp",
      prompt: "first",
      signal: first.signal,
    });
    const secondRequest = runHarnessTextPrompt({
      harness: "claude",
      cwd: "/tmp",
      prompt: "second",
      signal: second.signal,
    });
    first.abort();
    await expect(firstRequest).rejects.toThrow("By-the-way request cancelled");
    expect(stopTextPrompt).not.toHaveBeenCalled();
    second.abort();
    await expect(secondRequest).rejects.toThrow("By-the-way request cancelled");
    expect(stopTextPrompt).not.toHaveBeenCalled();
  });

  it("exposes the edit-last-turn support matrix", () => {
    registerBuiltinHarnesses();
    const ids: HarnessId[] = [
      "claude",
      "codex",
      "cursor",
      "grok",
      "opencode",
      "pi",
      "omp",
      "fx",
    ];

    expect(
      Object.fromEntries(ids.map((id) => [id, canRewindHarnessLastTurn(id)])),
    ).toEqual({
      claude: false,
      codex: true,
      cursor: false,
      grok: false,
      opencode: true,
      pi: true,
      omp: true,
      fx: false,
    });
  });

  it("registers Antigravity as a live fx-tier harness", () => {
    registerBuiltinHarnesses();
    expect(isLiveHarness("antigravity")).toBe(true);
    const adapter = listHarnesses().find(
      (adapter) => adapter.id === "antigravity",
    )!;
    expect(adapter.canSteer).toBe(false);
    expect(adapter.bindSession).toBeTypeOf("function");
    expect(adapter.refreshCatalog).toBeTypeOf("function");
    expect(adapter.generateTitle).toBeUndefined();
    expect(adapter.generateCommitMessage).toBeUndefined();
  });

  it("refreshes only the requested catalogs", async () => {
    const pi = vi.fn(async () => undefined);
    const claude = vi.fn(async () => undefined);
    registerHarness(stub("pi", { refreshCatalog: pi }));
    registerHarness(stub("claude", { refreshCatalog: claude }));

    await refreshHarnessCatalogs(["claude"]);

    expect(claude).toHaveBeenCalledOnce();
    expect(pi).not.toHaveBeenCalled();
  });

  it("does not spawn a catalog probe twice after a live list lands", async () => {
    const pi = vi.fn(async () => {
      setHarnessModels("pi", [
        {
          id: "pi:opus",
          harness: "pi",
          name: "Opus",
          nativeId: "anthropic/opus",
        },
      ]);
    });
    registerHarness(stub("pi", { refreshCatalog: pi }));

    await refreshHarnessCatalogs(["pi"]);
    await refreshHarnessCatalogs(["pi"]);

    expect(pi).toHaveBeenCalledOnce();
  });

  it("skips catalog refresh when no harness is in use", async () => {
    const pi = vi.fn(async () => undefined);
    registerHarness(stub("pi", { refreshCatalog: pi }));
    await refreshHarnessCatalogs([]);
    expect(pi).not.toHaveBeenCalled();
  });

  it("parks a live child a few minutes after the turn settles", async () => {
    vi.useFakeTimers();
    const stopSession = vi.fn(async () => undefined);
    registerHarness(stub("cursor", { stopSession }));

    await sendHarnessTurn({
      harness: "cursor",
      sessionId: "s1",
      cwd: "/tmp",
      model: "cursor:composer-2.5",
      text: "hi",
      runtimeMode: "supervised",
      onEvent: () => undefined,
    });

    expect(stopSession).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(HARNESS_IDLE_PARK_MS - 1);
    expect(stopSession).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(stopSession).toHaveBeenCalledWith("s1");
  });
  it("serializes provider-state operations per session", async () => {
    const order: string[] = [];
    let releaseFirst!: () => void;
    let markFirstStarted!: () => void;
    const firstStarted = new Promise<void>((resolve) => {
      markFirstStarted = resolve;
    });
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const compactContext = vi.fn(async (input: { sessionId: string }) => {
      order.push(`start:${input.sessionId}`);
      if (input.sessionId === "s1") {
        markFirstStarted();
        await firstGate;
      }
      order.push(`end:${input.sessionId}`);
    });
    registerHarness(stub("codex", { compactContext }));

    const compact1 = compactHarnessContext({
      harness: "codex",
      sessionId: "s1",
      cwd: "/tmp",
      model: "codex:gpt-5.4",
      runtimeMode: "supervised",
      onEvent: () => undefined,
    });
    await firstStarted;
    const compact2 = compactHarnessContext({
      harness: "codex",
      sessionId: "s1",
      cwd: "/tmp",
      model: "codex:gpt-5.4",
      runtimeMode: "supervised",
      onEvent: () => undefined,
    });
    const independent = compactHarnessContext({
      harness: "codex",
      sessionId: "s2",
      cwd: "/tmp",
      model: "codex:gpt-5.4",
      runtimeMode: "supervised",
      onEvent: () => undefined,
    });

    await independent;
    expect(order).toEqual(["start:s1", "start:s2", "end:s2"]);
    releaseFirst();
    await Promise.all([compact1, compact2]);
    expect(order).toEqual([
      "start:s1",
      "start:s2",
      "end:s2",
      "end:s1",
      "start:s1",
      "end:s1",
    ]);
  });

  it("binds a restored session and forwards its task panels", () => {
    const bindSession = vi.fn();
    const restoreTaskLists = vi.fn();
    registerHarness(stub("claude", { bindSession, restoreTaskLists }));
    const taskList = {
      key: "claude-tasks",
      items: [{ id: "1", text: "Write tests", status: "pending" as const }],
    };

    bindHarnessSession("claude", "s1", "sess_1", "/repo", "work", [
      { id: "b1", role: "user", text: "go" },
      { id: "b2", role: "tasks", text: "Write tests", taskList },
    ]);
    bindHarnessSession("claude", "s2", "sess_2", "/repo");

    expect(bindSession).toHaveBeenCalledWith("s1", "sess_1", "/repo", "work");
    expect(bindSession).toHaveBeenCalledWith(
      "s2",
      "sess_2",
      "/repo",
      undefined,
    );
    expect(restoreTaskLists).toHaveBeenCalledTimes(1);
    expect(restoreTaskLists).toHaveBeenCalledWith("s1", [taskList]);
  });
});
