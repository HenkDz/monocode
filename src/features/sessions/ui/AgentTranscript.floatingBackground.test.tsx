// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { FloatingMonoChat } from "../../monos/ui/FloatingMonoChat";
import { newSession } from "../model/session";
import { applyHarnessEvent } from "../../../integrations/harness/core/apply";
import type { FloatingMonoView } from "../../monos/model/floatingMono";

const native = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ hide: vi.fn() }) }));
vi.mock("@tauri-apps/api/webviewWindow", () => ({ getCurrentWebviewWindow: () => ({ listen: native.listen }) }));
vi.mock("../hooks/useFileDrop", () => ({ useFileDrop: () => false }));
vi.mock("../../settings/model/sounds", () => ({ playCue: vi.fn() }));

it("shows and clears reducer background waits through the actual FloatingMonoChat consumer", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, "animate").mockImplementation(
    () => ({ cancel: vi.fn() }) as unknown as Animation,
  );
  const mono = { id: "floating-wait", name: "Captain", mascot: "cat" as const, color: "#aaf", sessionId: "floating-wait-chat", status: "working" as const };
  const session = applyHarnessEvent({ ...newSession("claude", "/synthetic"), id: mono.sessionId, busy: true, blocks: [{ id: "u", role: "user", text: "Review" }, { id: "note", role: "assistant", text: "Prior progress", streaming: true }] }, { type: "background.updated", tasks: ["Review"] });
  const view: FloatingMonoView = { monos: [mono], monoId: mono.id, error: null, session };
  let receive!: (event: { payload: FloatingMonoView }) => void;
  native.invoke.mockImplementation(async command => command === "mono_chat_state" ? view : undefined);
  native.listen.mockImplementation(async (_event, handler) => { receive = handler; return () => {}; });
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(FloatingMonoChat, { onShown: () => {} })));
    const action = container.querySelector('.compact-current-action')!;
    expect(action.textContent).toBe("Waiting for background task…");
    expect(action.getAttribute('title')).toBe("Review");
    expect(container.querySelector('[data-transcript-turn-work] > button')?.getAttribute('aria-expanded')).toBe('false');
    await act(async () => receive({ payload: { ...view, session: applyHarnessEvent(session, { type: "background.updated", tasks: [] }) } }));
    expect(container.querySelector('.compact-current-action')?.textContent).toBe("Prior progress");
  } finally {
    act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  }
});
