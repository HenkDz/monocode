// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AgentTranscript } from "./AgentTranscript";
import { ProviderAuthNotice } from "./ProviderAuthNotice";
import { ProjectManagerReview, ProjectManagerStatus } from "../../orchestration/ui/ProjectManagerReview";
import { managerAttention } from "../../orchestration/model/projectManager";
import { newSession } from "../model/session";
import type { OrchestrationRun } from "../../orchestration/model/orchestrationState";
import { sessionAuthDiagnostics } from "../model/sessionAuthDiagnostics";

const login = vi.hoisted(() => vi.fn());
const copy = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("../../../integrations/harness/core/auth", async original => ({ ...await original<object>(), loginHarness: login }));
vi.mock("../../../platform/tauri/clipboard", () => ({ copyText: copy }));
vi.mock("@tauri-apps/api/core", async original => ({ ...await original<object>(), invoke: vi.fn(async () => null) }));
const raw = "HTTP 401 Unauthorized\r\nMissing bearer token\r\ncf-ray: synthetic\r\nrequest: opaque";
let host: HTMLDivElement, root: ReturnType<typeof createRoot>;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  login.mockReset(); copy.mockClear();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

it("renders one connected sign-in card for repeated transcript and Manager failures; never continues or submits", async () => {
  const session = { ...newSession("codex", "/fixture"), id: "project-manager-fixture", providerAccountId: "work", blocks: [
    { id: "goal", role: "user" as const, text: "Review" },
    ...[1,2].map(id => ({ id: `error-${id}`, role: "system" as const, notice: "error" as const, text: raw })),
  ] };
  const run = { leadId: "lead", ownerSessionId: session.id, cwd: session.cwd, projectManager: true, status: "paused", error: raw, tasks: [] } as unknown as OrchestrationRun;
  const before = JSON.stringify({ session, run });
  let complete!: () => void;
  login.mockImplementation(() => new Promise<void>(resolve => { complete = resolve; }));
  await act(async () => root.render(<>
    <AgentTranscript blocks={session.blocks} harness="codex" />
    <ProjectManagerStatus run={run} /><ProjectManagerReview run={run} noticesOnly />
    <ProviderAuthNotice harness={session.harness} accountId={session.providerAccountId} diagnostics={sessionAuthDiagnostics(session.blocks, [run])!} />
  </>));
  expect(host.querySelectorAll("[data-provider-auth]")).toHaveLength(1);
  expect(host.textContent).not.toMatch(/401|cf-ray|Missing bearer|Manager needs your decision|Continue|Provider sign-in required/);
  expect(managerAttention([session], [run], new Set(), new Map())[0].question).toBe("Sign in to Codex");
  const signIn = [...host.querySelectorAll("button")].find(button => button.textContent === "Sign in to Codex")!;
  expect(login).not.toHaveBeenCalled();
  await act(async () => signIn.click());
  expect(login).toHaveBeenCalledExactlyOnceWith("codex", "work");
  expect(signIn.disabled).toBe(true);
  await act(async () => complete());
  expect(host.textContent).toContain("Your request is still stopped");
  await act(async () => [...host.querySelectorAll("button")].find(button => button.textContent === "Copy diagnostics")!.click());
  expect(copy).toHaveBeenCalledExactlyOnceWith(`${raw}\n\n${raw}`);
  expect(JSON.stringify({ session, run })).toBe(before);
});
it("refuses a busy sign-in and keeps failure details only in diagnostics", async () => {
  const render = (disabled: boolean) => act(async () => root.render(<ProviderAuthNotice harness="claude" diagnostics={raw} disabled={disabled} />));
  await render(true);
  const signIn = [...host.querySelectorAll("button")].find(button => button.textContent === "Sign in to Claude Code")!;
  await act(async () => signIn.click()); expect(login).not.toHaveBeenCalled();
  await render(false);
  login.mockRejectedValue(new Error("401 cf-ray: sign-in-failure"));
  await act(async () => signIn.click());
  expect(host.textContent).toContain("Sign-in could not finish");
  expect(host.textContent).not.toMatch(/401|cf-ray|Codex/);
  expect(signIn.disabled).toBe(false);
  await act(async () => [...host.querySelectorAll("button")].find(button => button.textContent === "Copy diagnostics")!.click());
  expect(copy).toHaveBeenLastCalledWith(`${raw}\n\nError: 401 cf-ray: sign-in-failure`);
});
it("retains real Manager decisions and provider-specific guidance for multi-provider harnesses", async () => {
  const run = { leadId: "lead", status: "paused", error: "Approval required for integration", tasks: [] } as unknown as OrchestrationRun;
  await act(async () => root.render(<><ProjectManagerReview run={run} noticesOnly /><ProviderAuthNotice harness="pi" diagnostics={raw} /></>));
  expect(host.textContent).toContain("Manager needs your decision");
  expect([...host.querySelectorAll("button")].some(button => button.textContent === "Continue")).toBe(true);
  expect(host.textContent).toContain("provider controls");
  expect(host.textContent).not.toContain("Codex");
});
