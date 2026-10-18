// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { SessionRightPanel } from "./SessionRightPanel";
import { newSession } from "../model/session";

vi.mock("../../pullRequests/ui/PullRequestsList", () => ({
  PullRequestsList: ({ scope }: { scope: unknown }) => createElement("div", { "data-scope": JSON.stringify(scope) }),
}));
vi.mock("../../monos/ui/MonoActivityPanel", () => ({ MonoActivityContent: () => createElement("div", null, "Session activity") }));

it("starts with session/worktree PRs and switches the shared Details/Activity tabs", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div"), root = createRoot(container);
  const session = { ...newSession("codex", "/app"), id: "chat", worktreeCwd: "/app-worker" };
  const close = vi.fn();
  try {
    await act(async () => root.render(<SessionRightPanel session={session} onClose={close} />));
    expect(JSON.parse(container.querySelector("[data-scope]")!.getAttribute("data-scope")!)).toEqual({ sessionId: "chat" });
    const tab = (name: string) => [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(button => button.textContent === name)!;
    await act(async () => tab("Details").click());
    expect(container.textContent).toContain("/app-worker");
    await act(async () => tab("Activity").click());
    expect(container.textContent).toContain("Session activity");
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Hide activity"]')!.click());
    expect(close).toHaveBeenCalledOnce();
  } finally { await act(async () => root.unmount()); vi.unstubAllGlobals(); }
});
