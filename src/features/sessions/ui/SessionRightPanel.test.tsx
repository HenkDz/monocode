// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { SessionRightPanel, shouldShowContextPanel } from "./SessionRightPanel";
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

it.each([
  [{ content: false }, false],
  [{ content: true }, true],
  [{ content: false, explicitOpen: true }, true],
  [{ content: false, pinned: true }, true],
  [{ content: true, dismissed: true }, false],
  [{ content: false, dismissed: true, explicitOpen: true }, true],
  [{ content: false, dismissed: true, pinned: true }, true],
])("shows contextual panels only for content or user intent: %o", (state, visible) => {
  expect(shouldShowContextPanel(state)).toBe(visible);
});

it("pins explicitly and records tab interaction without resetting the selected tab", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div"), root = createRoot(container);
  const session = newSession("codex", "/app");
  const onPinnedChange = vi.fn(), onInteract = vi.fn();
  try {
    await act(async () => root.render(<SessionRightPanel session={session} onClose={() => {}} onPinnedChange={onPinnedChange} onInteract={onInteract} />));
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Pin session panel"]')!.click());
    expect(onPinnedChange).toHaveBeenCalledWith(true);
    const details = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(button => button.textContent === "Details")!;
    await act(async () => details.click());
    expect(onInteract).toHaveBeenCalled();
    await act(async () => root.render(<SessionRightPanel session={session} onClose={() => {}} pinned onPinnedChange={onPinnedChange} onInteract={onInteract} />));
    expect(details.getAttribute("aria-selected")).toBe("true");
    const pin = container.querySelector<HTMLButtonElement>('[aria-label="Unpin session panel"]')!;
    expect(pin.getAttribute("aria-pressed")).toBe("true");
    await act(async () => pin.click());
    expect(onPinnedChange).toHaveBeenLastCalledWith(false);
  } finally { await act(async () => root.unmount()); vi.unstubAllGlobals(); }
});
