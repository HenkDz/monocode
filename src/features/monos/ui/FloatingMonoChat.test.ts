// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { newSession } from "../../sessions/model/session";
import { clearComposerDraft } from "../../sessions/model/draftCache";
import { MonoManagerGoals, type ManagerGoalHost } from "../model/monoManagerGoals";
import { submitMonoGoal, type MonoGoalSubmission } from "../model/monoGoalRouting";
import type { FloatingMonoView } from "../model/floatingMono";
import { FloatingMonoChat } from "./FloatingMonoChat";

const native = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
  hide: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ hide: native.hide }),
}));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({ listen: native.listen }),
}));
vi.mock("../../sessions/hooks/useFileDrop", () => ({
  useFileDrop: () => false,
}));
vi.mock("../../sessions/ui/AgentTranscript", () => ({
  AgentTranscript: ({
    blocks,
    onOpenArtifact,
  }: {
    blocks: { text: string }[];
    onOpenArtifact: (id: string) => void;
  }) =>
    createElement(
      "div",
      null,
      blocks.map((b) => b.text).join(" "),
      createElement(
        "button",
        { "data-open-doc": "", onClick: () => onOpenArtifact("doc-1") },
        "Open document",
      ),
    ),
}));
vi.mock("../hooks/useMonoTranscript", () => ({
  useMonoTranscript: (session: { blocks: unknown[] }) => ({
    ...session,
    hasEarlier: false,
    viewingOlderPage: false,
  }),
}));

const monos = [
  {
    id: "first",
    name: "Captain",
    mascot: "crab",
    color: "#aaf",
    sessionId: "chat-a",
  },
  {
    id: "second",
    name: "Scout",
    mascot: "ghost",
    color: "#faa",
    sessionId: "chat-b",
  },
];
function snapshot(index: number): FloatingMonoView {
  return {
    monos,
    monoId: monos[index].id,
    error: null,
    session: {
      ...newSession("codex", "/tmp", "default", "auto"),
      id: monos[index].sessionId,
      blocks: [
        {
          id: "answer",
          role: "assistant",
          text: `${monos[index].name}'s conversation`,
        },
      ],
    },
  };
}
let container: HTMLDivElement;
let root: Root;
let receive: (event: { payload: FloatingMonoView }) => void;
beforeEach(() => {
  vi.stubEnv("VITE_MONO_DIRECT_PROJECT_ROUTING", "true");
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  clearComposerDraft("floating:chat-a");
  clearComposerDraft("floating:chat-b");
  native.invoke
    .mockReset()
    .mockImplementation(async (command) =>
      command === "mono_chat_state" ? snapshot(0) : undefined,
    );
  native.listen.mockReset().mockImplementation(async (_event, handler) => {
    receive = handler;
    return () => {};
  });
  native.hide.mockReset().mockResolvedValue(undefined);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  vi.unstubAllEnvs();
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("renders the owner's shared availability as it starts and finishes elsewhere", async () => {
  const view = snapshot(0);
  native.invoke.mockImplementation(async command => command === "mono_chat_state" ? { ...view, session: { ...view.session, monoLiveState: { status: "working" } } } : undefined);
  await act(async () => root.render(createElement(FloatingMonoChat, { onShown: vi.fn() })));
  expect(container.textContent).toContain("Working");
  await act(async () => receive({ payload: { ...view, session: { ...view.session!, monoLiveState: { status: "idle" } } } }));
  expect(container.textContent).toContain("Idle");
  expect(container.textContent).not.toContain("Working");
});
async function render() {
  await act(async () =>
    root.render(createElement(FloatingMonoChat, { onShown: () => {} })),
  );
}

it("passes the floating new-goal route and stable source IDs to its owner", async () => {
  const view = snapshot(0);
  view.session!.monoGoalRouting = {
    ownerId: "first",
    projects: [{ id: "dzdistro", name: "DZDistro", path: "C:/projects/dzdistro", managerMonoId: "manager", available: true }],
  };
  native.invoke.mockImplementation(async command => command === "mono_chat_state" ? view : undefined);
  await render();
  const input = container.querySelector<HTMLTextAreaElement>('[aria-label="Message Captain"]')!;
  const inputProps = Object.entries(input).find(([key]) => key.startsWith("__reactProps"))![1];
  act(() => inputProps.onChange({ target: { value: "Fix DZDistro checkout" } }));
  act(() => [...container.querySelectorAll<HTMLButtonElement>("button")]
    .find(button => button.textContent === "New goal")!.click());
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Send"]')!.click());
  expect(native.invoke).toHaveBeenCalledWith("mono_chat_action", {
    monoId: "first",
    action: {
      kind: "submit", text: "Fix DZDistro checkout", attachments: [],
      monoGoal: expect.objectContaining({
        projectId: "dzdistro", managerMonoId: "manager", reason: "Exact project name",
        requestId: expect.any(String), userMessageId: expect.any(String),
      }),
    },
  });
  expect(input.value).toBe("");
  expect(container.querySelector('[data-mono-goal-route] [aria-pressed="true"]')?.textContent).toBe("Chat");
});

it("sends a default-off floating goal without a Manager selection or route prediction", async () => {
  vi.stubEnv("VITE_MONO_DIRECT_PROJECT_ROUTING", "false");
  const view = snapshot(0);
  view.session!.monoGoalRouting = {
    ownerId: "first",
    projects: [{ id: "dzdistro", name: "DZDistro", path: "C:/projects/dzdistro", managerMonoId: "manager", available: true }],
  };
  native.invoke.mockImplementation(async command => command === "mono_chat_state" ? view : undefined);
  await render();
  const input = container.querySelector<HTMLTextAreaElement>('[aria-label="Message Captain"]')!;
  const inputProps = Object.entries(input).find(([key]) => key.startsWith("__reactProps"))![1];
  act(() => inputProps.onChange({ target: { value: "Fix DZDistro and every registered project" } }));
  act(() => [...container.querySelectorAll<HTMLButtonElement>("button")]
    .find(button => button.textContent === "New goal")!.click());
  expect(container.querySelector('[data-mono-goal-route] [role="status"]')).toBeNull();
  expect(container.querySelector('[aria-label="Goal route: Auto route"]')).toBeNull();
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Send"]')!.click());
  expect(native.invoke).toHaveBeenCalledWith("mono_chat_action", expect.objectContaining({
    monoId: "first", action: expect.objectContaining({ monoGoal: expect.not.objectContaining({ projectId: expect.anything() }) }),
  }));
});

it("routes a stale explicit floating selection through Grand without Manager writes", async () => {
  const view = snapshot(0);
  view.session!.monoGoalRouting = {
    ownerId: "first",
    projects: [{ id: "dzdistro", name: "DZDistro", path: "C:/projects/dzdistro", managerMonoId: "manager", available: true }],
  };
  const project = { id: "dzdistro", name: "DZDistro", folder: "C:/projects/dzdistro", managerId: "engine",
    managerMonoId: "manager", managerExists: true, running: 0, needsDecision: 0, ready: 0, blocked: [], goals: [] };
  const ledger = new MonoManagerGoals({ load: async () => null, save: async () => {} });
  const goals: ManagerGoalHost = { mayDelegate: () => true, projects: async () => [project], deliver: vi.fn(async () => {}),
    status: async () => ({}), ready: async () => [] };
  const grand = vi.fn(() => true);
  native.invoke.mockImplementation(async (command, options) => {
    if (command === "mono_chat_state") return view;
    const action = (options as { action?: { text: string; attachments: unknown[]; monoGoal?: MonoGoalSubmission } } | undefined)?.action;
    if (command !== "mono_chat_action" || !action?.monoGoal) return undefined;
    return submitMonoGoal({ text: action.text, attachmentCount: action.attachments.length, origin: "user", submission: action.monoGoal }, {
      context: () => ({ ...view.session!.monoGoalRouting!, ownerId: "first" }), resolve: async () => project, ledger, goals,
      persistOrigin: async () => {}, hasOrigin: () => false, persistPending: async () => {}, persistCard: async () => {}, grand,
    });
  });
  await render();
  const input = container.querySelector<HTMLTextAreaElement>('[aria-label="Message Captain"]')!;
  const inputProps = Object.entries(input).find(([key]) => key.startsWith("__reactProps"))![1];
  act(() => inputProps.onChange({ target: { value: "Fix the checkout" } }));
  act(() => [...container.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "New goal")!.click());
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Goal route: Auto route"]')!.click());
  await act(async () => [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')]
    .find(button => button.textContent?.trim() === "DZDistro Manager")!.click());
  vi.stubEnv("VITE_MONO_DIRECT_PROJECT_ROUTING", "false");
  await render();
  act(() => inputProps.onChange({ target: { value: "Fix DZDistro and all C:/projects/repos" } }));
  expect(container.querySelector('[role="status"]')).toBeNull();
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Send"]')!.click());
  expect(grand).toHaveBeenCalledOnce();
  expect(goals.deliver).not.toHaveBeenCalled();
  expect(ledger.goals("first")).toHaveLength(0);
});

it("shows this window's Mono with its status beneath the name", async () => {
  await render();
  expect(container.textContent).toContain("Captain's conversation");
  expect(container.querySelector("select")).toBeNull();
  const name = container.querySelector("header h1")!;
  expect(name.textContent).toBe("Captain");
  expect(name.nextElementSibling?.getAttribute("data-mono-status")).toBe(
    "idle",
  );
  expect(container.querySelectorAll("[data-mono-status]")).toHaveLength(1);
  expect(
    container.querySelector('[aria-label="Message Captain"]'),
  ).not.toBeNull();
});

it("shows an org role and sends permission changes to its owner", async () => {
  const view = snapshot(0);
  native.invoke.mockImplementation(async (command) => command === "mono_chat_state" ? {
    ...view,
    monos: view.monos.map((mono) => ({ ...mono, role: "manager" })),
    session: { ...view.session!, runtimeMode: "full-access" },
  } : undefined);
  await render();
  expect(container.querySelector("header h1")?.textContent).toContain("manager");
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Full access"]')!.click());
  const supervised = [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')]
    .find((option) => option.textContent?.includes("Supervised"))!;
  await act(async () => supervised.click());
  expect(native.invoke).toHaveBeenCalledWith("mono_chat_action", {
    monoId: "first", action: { kind: "runtimeMode", mode: "supervised" },
  });
});

it("lists every Mono beside the chat and switches or adds from there", async () => {
  await render();
  const rail = container.querySelector("[data-floating-mono-rail]")!;
  const current = rail.querySelector('[aria-current="true"]');
  expect(current?.getAttribute("aria-label")).toBe("Captain");
  await act(async () =>
    rail.querySelector<HTMLButtonElement>('[aria-label="Scout"]')!.click(),
  );
  expect(native.invoke).toHaveBeenCalledWith("mono_chat_switch", {
    from: "first",
    to: "second",
  });
  await act(async () =>
    rail.querySelector<HTMLButtonElement>('[aria-label="New mono"]')!.click(),
  );
  expect(native.invoke).toHaveBeenCalledWith("mono_chat_action", {
    monoId: "first",
    action: { kind: "create" },
  });
});

it("switches Monos inside the same frame, loading only the conversation", async () => {
  await render();
  const frame = container.querySelector("[data-floating-mono]");
  const rail = container.querySelector("[data-floating-mono-rail]");
  act(() => receive({ payload: { ...snapshot(1), session: null } }));
  expect(container.querySelector("[data-floating-mono]")).toBe(frame);
  expect(container.querySelector("[data-floating-mono-rail]")).toBe(rail);
  expect(container.querySelector("header h1")?.textContent).toBe("Scout");
  expect(
    container.querySelector("[data-floating-mono-loader]")?.textContent,
  ).toBe("Loading conversation…");
  expect(
    rail?.querySelector('[aria-current="true"]')?.getAttribute("aria-label"),
  ).toBe("Scout");
  act(() => receive({ payload: snapshot(1) }));
  expect(container.textContent).toContain("Scout's conversation");
});

it("keeps one loading screen through initial lookup and roster updates until the conversation arrives", async () => {
  let initial!: (view: FloatingMonoView) => void;
  native.invoke.mockImplementation((command) => {
    if (command === "mono_chat_state")
      return new Promise((resolve) => {
        initial = resolve;
      });
    if (command === "mono_chat_ready") {
      // Native presentation is requested after React commits the loader,
      // without waiting on animation frames in a hidden webview.
      expect(
        container.querySelector("[data-floating-mono-loading]"),
      ).not.toBeNull();
      expect(
        container.querySelector("[data-floating-mono-loader]")?.textContent,
      ).toBe("Loading conversation…");
    }
    return Promise.resolve();
  });
  await render();
  const loader = container.querySelector("[data-floating-mono-loading]");
  expect(loader).not.toBeNull();
  expect(native.invoke).toHaveBeenCalledWith("mono_chat_ready");
  expect(container.querySelector("h1")).toBeNull();
  expect(container.querySelector("textarea")).toBeNull();

  const opening = { ...snapshot(0), session: null };
  await act(async () => initial(opening));
  expect(container.querySelector("[data-floating-mono-loading]")).toBe(loader);
  act(() => receive({ payload: { ...opening, monos: [...monos] } }));
  expect(container.querySelector("[data-floating-mono-loading]")).toBe(loader);
  expect(
    container.querySelector("[data-floating-mono-loader]")?.textContent,
  ).toBe("Loading conversation…");

  act(() => receive({ payload: snapshot(0) }));
  expect(container.querySelector("[data-floating-mono-loading]")).toBeNull();
  expect(container.textContent).toContain("Captain's conversation");
  expect(
    container.querySelector('[aria-label="Message Captain"]'),
  ).not.toBeNull();
});

it("shows the empty chat only after a new conversation has finished opening", async () => {
  const empty = snapshot(0);
  empty.session!.blocks = [];
  native.invoke.mockImplementation(async (command) =>
    command === "mono_chat_state" ? { ...empty, session: null } : undefined,
  );
  await render();
  expect(container.textContent).not.toContain("Say hello");
  expect(container.querySelector("[aria-busy=true]")).not.toBeNull();

  act(() => receive({ payload: empty }));
  expect(container.querySelector("[data-floating-mono-loading]")).toBeNull();
  expect(container.textContent).toContain("Say hello to Captain");
  expect(
    container.querySelector('[aria-label="Message Captain"]'),
  ).not.toBeNull();
});

it("shows an opening failure instead of keeping the loader indefinitely", async () => {
  native.invoke.mockImplementation(async (command) => {
    if (command === "mono_chat_state") throw new Error("Workspace unavailable");
  });
  await render();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "Workspace unavailable",
  );
  expect(container.querySelector('[aria-busy="false"]')).not.toBeNull();
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>('[aria-label="Hide chat"]')!
      .click(),
  );
  expect(native.hide).toHaveBeenCalledOnce();
});

it("keeps the draft when the workspace rejects delivery", async () => {
  await render();
  native.invoke.mockImplementation(async (command) => {
    if (command === "mono_chat_action")
      throw new Error("Workspace unavailable");
  });
  const field = container.querySelector<HTMLTextAreaElement>(
    '[aria-label="Message Captain"]',
  )!;
  const props = Object.entries(field).find(([key]) =>
    key.startsWith("__reactProps"),
  )![1];
  act(() => props.onChange({ target: { value: "Please keep this" } }));
  await act(async () =>
    container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  expect(field.value).toBe("Please keep this");
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "Workspace unavailable",
  );
});

it("ignores a stale initial snapshot after a newer update arrives", async () => {
  let initial!: (view: FloatingMonoView) => void;
  native.invoke.mockImplementation(
    () =>
      new Promise((resolve) => {
        initial = resolve;
      }),
  );
  await render();
  act(() => receive({ payload: snapshot(1) }));
  await act(async () => initial(snapshot(0)));
  expect(container.querySelector("h1")!.textContent).toBe("Scout");
  expect(container.textContent).toContain("Scout's conversation");
});

it("reads a Mono's document in a sheet over the chat and slides it away", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  native.invoke.mockImplementation(async (command) => {
    if (command === "mono_chat_state") return snapshot(0);
    if (command === "artifacts_get")
      return {
        id: "doc-1",
        kind: "document",
        title: "Menu plan",
        body: "Soup first.",
        createdAt: 1,
        updatedAt: 1,
      };
  });
  await render();
  const trigger = container.querySelector<HTMLButtonElement>("[data-open-doc]")!;
  trigger.focus();
  await act(async () =>
    trigger.click(),
  );
  const sheet = container.querySelector('[data-artifact-sheet="doc-1"]');
  expect(sheet?.textContent).toContain("Menu plan");
  expect(sheet?.textContent).toContain("Soup first.");
  const close = sheet!.querySelector<HTMLButtonElement>('[aria-label="Close document"]')!;
  expect(document.activeElement).toBe(close);
  expect(trigger.closest("[inert]")).not.toBeNull();
  expect(container.querySelector("[data-floating-mono-rail]")?.hasAttribute("inert")).toBe(true);
  const controls = sheet!.querySelectorAll<HTMLButtonElement>("button");
  await act(async () => close.dispatchEvent(new KeyboardEvent("keydown", {
    key: "Tab", bubbles: true, cancelable: true,
  })));
  expect(document.activeElement).toBe(controls[0]);
  await act(async () => controls[0].dispatchEvent(new KeyboardEvent("keydown", {
    key: "Tab", shiftKey: true, bubbles: true, cancelable: true,
  })));
  expect(document.activeElement).toBe(close);
  // Reading in place never asks the main window to take over.
  expect(native.invoke).not.toHaveBeenCalledWith(
    "mono_chat_action",
    expect.anything(),
  );
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  });
  expect(container.querySelector("[data-artifact-sheet]")).not.toBeNull();
  act(() => vi.runAllTimers());
  expect(container.querySelector("[data-artifact-sheet]")).toBeNull();
  expect(document.activeElement).toBe(trigger);
  expect(trigger.closest("[inert]")).toBeNull();
  vi.useRealTimers();
});
