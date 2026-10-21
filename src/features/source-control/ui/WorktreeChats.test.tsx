// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { WorktreeChats } from "./WorktreeChats";
import { newSession } from "../../sessions/model/session";
const trees = [{ path: "C:/linked-main", isMain: true, branch: "main", sessionIds: [] }, { path: "C:/worker", isMain: false, branch: "feature", sessionIds: [] }];
const runs: never[] = [];
vi.mock("../hooks/useProjectWorktrees", () => ({ useProjectWorktrees: () => ({ data: { worktrees: trees } }) }));
vi.mock("../hooks/usePrStatus", () => ({ usePrStatus: () => ({ pr: null }) }));
vi.mock("../../orchestration/model/orchestration", () => ({ orchestrator: { subscribe: () => () => {}, snapshot: () => runs } }));
it("shows removed chats under main with a custom settled fold and hidden-worktree approval dot", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  const hidden = { ...newSession("codex", "C:/project"), id: "hidden", worktreeCwd: "C:/worker", blocks: [{ id: "approval", role: "tool" as const, text: "", approval: { requestId: 1 } }] };
  const summary = { id: "removed", cwd: "C:/project", worktreeCwd: "C:/gone", title: "Earlier chat", harness: "codex" as const, model: "", runtimeMode: "supervised" as const, createdAt: 1, updatedAt: 2 };
  try {
    await act(async () => root.render(<WorktreeChats project="C:/project" selectedPath="C:/linked-main" sessions={[hidden as never]} history={[summary]} openSessions={[{ ...summary, id: "hidden", worktreeCwd: "C:/worker" }]} unseen={new Set()} onSelect={() => {}} onChat={() => {}} onNew={() => {}} onCreate={() => {}} />));
    expect(host.querySelector('[aria-label="Needs your attention"]')).not.toBeNull();
    const fold = [...host.querySelectorAll("button")].find(button => button.textContent?.includes("Settled"))!;
    expect(fold.getAttribute("aria-expanded")).toBe("false");
    await act(async () => fold.click());
    expect(host.textContent).toContain("Earlier chat"); expect(host.textContent).toContain("worktree removed");
    expect(host.querySelector("details")).toBeNull();
  } finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); }
});
