// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { ManagerRequestNotice } from "./ManagerRequestNotice";
import { monoManagerGoals, type ManagerProject } from "../model/monoManagerGoals";
import { appendManagerRecovery, managerRequestBinding, resumeManagerRequest } from "../model/managerAuthorizedWork";
import { newSession } from "../../sessions/model/session";
import { selectAttention } from "../../commandCenter/model/attention";
import type { Mono } from "../model/mono";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }));

it("durable Cancel disables transcript and resolves Attention after reload, without reviving the pending notice", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const manager: Mono = { id: "cancel-ui-manager", sessionId: "cancel-ui-chat", role: "manager", projects: ["/synthetic/project"], mascot: "cat", color: "blue" };
  const project = { id: manager.projects[0], folder: manager.projects[0], managerId: "cancel-ui-engine", managerMonoId: manager.id, managerExists: true } as ManagerProject;
  const original = { id: "cancel-ui-user", role: "user" as const, text: "Build this bounded request" };
  const source = { ...newSession("codex", "/synthetic/home"), codexStorageHome: "/synthetic/private", id: manager.sessionId!, blocks: [original] };
  const recovery = { monoId: manager.id, sessionId: source.id, managerId: project.managerId, projectId: project.id,
    userMessageId: original.id, binding: managerRequestBinding(source), state: "pending" as const };
  let session = appendManagerRecovery(source, recovery);
  const deliver = vi.fn(async () => {}), goals = { projects: async () => [project], mayDelegate: () => false, deliver, status: async () => ({}), ready: async () => [] };
  const goal = await monoManagerGoals.anchorManagerRequest(manager, project, original);
  const host = document.createElement("div"), root = createRoot(host);
  document.body.append(host);
  try {
    await act(async () => root.render(<ManagerRequestNotice request={recovery} />));
    expect(host.querySelector("button")!.disabled).toBe(false);
    await act(async () => { await monoManagerGoals.handle(manager.id, { kind: "user", messageId: "cancel-click" }, "cancel-click", "goals.cancel", { goalId: goal.id }, goals); });
    expect(host.querySelector("button")!.disabled).toBe(true); expect(host.textContent).toContain("Request cancelled");
    session = JSON.parse(JSON.stringify(session));
    await act(async () => root.render(<ManagerRequestNotice request={session.blocks.slice(-1)[0].managerRequestRecovery!} />));
    expect(host.querySelector("button")!.disabled).toBe(true);
    expect(selectAttention({ sessions: [session], roster: [manager], runs: [], goals: monoManagerGoals.goals() }).find(item => item.source === "manager-request")!.status).toBe("resolved");
    await expect(resumeManagerRequest(recovery, { session: () => session, manager: () => manager, project: async () => project,
      ledger: monoManagerGoals, goals, save: async change => { session = change(session); } })).rejects.toThrow();
    expect(deliver).toHaveBeenCalledOnce();
  } finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); }
});
