// @vitest-environment happy-dom
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MonoDetails } from "./MonoDetails";
import { MonoActivityContent } from "./MonoActivityPanel";
import { TitleBar } from "../../../app/shell/TitleBar";
import type { MonoPanelTab } from "./monoPanelParts";
import { resetHarnessModelOverlays, setHarnessModels } from "../../sessions/model/models";

vi.mock("../model/monoFiles", async (original) => ({
  ...(await original<object>()),
  loadMonoFiles: vi.fn(async () => ({
    soul: "Sample soul",
    memory: "",
    topics: [],
  })),
}));
vi.mock("./MonoHabits", async (original) => ({
  ...(await original<object>()),
  useHabits: () => [],
}));
vi.mock("../../pullRequests/ui/PullRequestsList", () => ({
  PullRequestsList: ({ scope }: { scope: unknown }) => createElement("div", { "data-pr-scope": JSON.stringify(scope) }, "Scoped pull requests"),
}));

let root: Root;
let container: HTMLDivElement;
const agent = { name: "Captain", mascot: "cat", color: "#6ba", projects: [] };
const noop = () => {};

it("shows and edits the agent's permission mode in Details", async () => {
  setHarnessModels("codex", [{
    id: "codex:gpt-5.4", harness: "codex", name: "GPT-5.4",
    settings: [
      { id: "reasoningEffort", label: "Reasoning", kind: "select", value: "high", options: [{ value: "high", label: "High" }] },
      { id: "serviceTier", label: "Service Tier", kind: "select", value: "default", options: [{ value: "default", label: "Standard" }] },
    ],
  }]);
  const onRuntimeModeChange = vi.fn();
  await act(async () => root.render(createElement(MonoDetails, {
    open: true, monoId: "permissions", cwd: "/repo", agent,
    state: { status: "idle" }, harness: "codex", model: "codex:gpt-5.4", modelSettings: {},
    onModelChange: noop, onModelSettingsChange: noop, onClose: noop,
    runtimeMode: "full-access", onRuntimeModeChange,
  })));
  const picker = container.querySelector<HTMLButtonElement>('button[aria-label="Full access"]')!;
  expect(picker).not.toBeNull();
  const settings = picker.closest("dl")!;
  expect([...settings.querySelectorAll("dt")].map(row => row.textContent)).toEqual([
    "Model", "Reasoning", "Service Tier", "Permissions", "Projects",
  ]);
  expect(container.querySelector('[data-mono-settings]')!.contains(settings)).toBe(true);
  expect(container.querySelectorAll('[data-access-picker-trigger]')).toHaveLength(1);
  await act(async () => picker.click());
  const option = [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')].find(button => button.textContent?.includes("Supervised"))!;
  await act(async () => option.click());
  expect(onRuntimeModeChange).toHaveBeenCalledWith("supervised");
});

it("keeps member settings inside Details and opens org tools as a subpage", async () => {
  setHarnessModels("codex", [{ id: "codex:gpt-5.4", harness: "codex", name: "GPT-5.4", settings: [
    { id: "reasoningEffort", label: "Reasoning", kind: "select", value: "high", options: [{ value: "high", label: "High" }] },
    { id: "serviceTier", label: "Service Tier", kind: "select", value: "default", options: [{ value: "default", label: "Standard" }] },
  ] }]);
  localStorage.setItem("monocode:mono-roster", JSON.stringify([
    { id: "m", role: "manager", projects: ["/repo"], mascot: "cat", color: "#6ba" },
    { id: "member", role: "member", reportsTo: "m", specialty: "Backend", projects: ["/repo"], mascot: "cat", color: "#6ba" },
  ]));
  const props = { open: true, monoId: "member", cwd: "/repo", agent, state: { status: "idle" as const }, harness: "codex" as const, model: "codex:gpt-5.4", modelSettings: {}, runtimeMode: "full-access" as const, onRuntimeModeChange: noop, onModelChange: noop, onModelSettingsChange: noop, onClose: noop };
  try {
    await act(async () => root.render(createElement(MonoDetails, { ...props, runtimeMode: "full-access", onRuntimeModeChange: noop })));
    expect(container.querySelector('[aria-label="Member specialty"]')).not.toBeNull();
    expect(container.textContent).toContain("Recent tasks");
    const permissions = container.querySelector('[data-access-picker-trigger]')!;
    const memberSettings = container.querySelector('[data-mono-settings]')!;
    expect(memberSettings.contains(permissions)).toBe(true);
    expect([...permissions.closest("dl")!.querySelectorAll("dt")].map(row => row.textContent)).toEqual(["Model", "Reasoning", "Service Tier", "Permissions", "Specialty"]);
    const specialty = container.querySelector<HTMLInputElement>('[aria-label="Member specialty"]')!;
    expect(specialty.title).toBe("Backend");
    expect(specialty.classList.contains("truncate")).toBe(true);
    await act(async () => root.render(createElement(MonoDetails, { ...props, monoId: "m", tab: "activity", teamActivity: createElement("div", null, "Live team"), activity: { blocks: [], live: false } })));
    expect(container.textContent).toContain("Live team");
    expect(container.querySelector("details")).toBeNull();
    expect(container.querySelector("[data-mono-work]")).toBeNull();
    const showWork = [...container.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Show work")!;
    await act(async () => showWork.click());
    expect(container.querySelector("[data-mono-work]")).not.toBeNull();
    await act(async () => container.querySelector<HTMLButtonElement>('[data-mono-work] [aria-label="Back"]')!.click());
    expect(container.querySelector('[data-mono-work]')!.closest('[inert]')).not.toBeNull();
    await act(async () => root.render(createElement(MonoDetails, { ...props, monoId: "m", tab: "activity", teamActivity: createElement("div", null, "Live team"), toolActivityOpen: true, activity: { blocks: [], live: false } })));
    expect(container.querySelector('[data-mono-work]')!.closest('[inert]')).toBeNull();
  } finally { localStorage.removeItem("monocode:mono-roster"); }
});

it("opens Soul, Memory, Habits and Team as pages with a back action", async () => {
  localStorage.setItem("monocode:mono-roster", JSON.stringify([
    { id: "manager", role: "manager", projects: ["/repo"], mascot: "cat", color: "#6ba" },
  ]));
  try {
    await act(async () => root.render(createElement(MonoDetails, {
      open: true, monoId: "manager", cwd: "/repo", agent, state: { status: "idle" },
      harness: "codex", model: "codex:gpt-5.4", modelSettings: {}, runtimeMode: "full-access",
      onRuntimeModeChange: noop, onModelChange: noop, onModelSettingsChange: noop, onClose: noop,
    })));
    const navigation = container.querySelector("nav")!;
    expect([...navigation.querySelectorAll("button")].map(button => button.getAttribute("aria-label"))).toEqual(["Soul", "Memory", "Habits", "Team"]);
    expect(container.querySelector("details")).toBeNull();
    for (const page of ["soul", "memory", "habits", "team"]) {
      await act(async () => navigation.querySelector<HTMLButtonElement>(`[aria-label="${page[0].toUpperCase() + page.slice(1)}"]`)!.click());
      const opened = container.querySelector(`[data-mono-${page}]`)!;
      expect(opened).not.toBeNull();
      expect(navigation.closest("[inert]")).not.toBeNull();
      await act(async () => opened.querySelector<HTMLButtonElement>('[aria-label="Back"]')!.click());
      expect(navigation.closest("[inert]")).toBeNull();
    }
  } finally { localStorage.removeItem("monocode:mono-roster"); }
});

it("opens full command output in one reader without inline error disclosures", async () => {
  await act(async () => root.render(createElement(MonoActivityContent, {
    blocks: [
      { id: "failed", role: "tool", text: "npm run dev", tool: { kind: "shell", status: "failed", detail: "Error: listen EPERM\n    at Server.setupListenHandle", preview: { kind: "shell", output: "Error: listen EPERM\n    at Server.setupListenHandle" } } },
      { id: "success", role: "tool", text: "git status", tool: { kind: "shell", status: "completed", detail: "git status --short", preview: { kind: "shell", output: "On branch main\nWorking tree clean" } } },
    ], live: false,
  })));
  expect(container.textContent).not.toContain("Server.setupListenHandle");
  await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
  const reader = document.querySelector('[role="dialog"]')!;
  expect(reader.textContent).toContain("Server.setupListenHandle");
  expect(reader.querySelector('[data-mono-activity-block="failed"] pre')?.textContent).toBe("Error: listen EPERM\n    at Server.setupListenHandle");
  expect(reader.textContent).toContain("On branch main");
  expect(reader.querySelector('[data-mono-activity-block="success"] pre')?.textContent).toBe("git status --short\n\nOn branch main\nWorking tree clean");
  expect(reader.querySelector('[aria-expanded]')).toBeNull();
  expect(container.querySelectorAll("button")).toHaveLength(1);
});

it("keeps pending approvals actionable before opening the work reader", async () => {
  const onApproval = vi.fn();
  await act(async () => root.render(createElement(MonoActivityContent, {
    blocks: [{ id: "pending", role: "tool", text: "npm run dev", tool: { kind: "shell", status: "pending" }, approval: { requestId: 42 } }],
    live: true, onApproval,
  })));
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  const allow = [...container.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Allow")!;
  expect(allow).not.toBeNull();
  await act(async () => allow.click());
  expect(onApproval).toHaveBeenCalledWith(42, "allow");
});
beforeEach(() => {
  const stored = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
    removeItem: (key: string) => stored.delete(key),
  });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  resetHarnessModelOverlays();
  container.remove();
  vi.unstubAllGlobals();
});

function Panel({ live = true }: { live?: boolean }) {
  const [open, setOpen] = useState(true);
  const [tab, setTab] = useState<MonoPanelTab>("details");
  return (
    <>
      <TitleBar
        tabs={[]}
        activeId=""
        cwd="/repo"
        mono={{
          look: agent,
          state: { status: live ? "working" : "idle", activity: "" },
        }}
        onToggleSidebar={noop}
        onSelect={noop}
        onClose={noop}
        onCloseMany={noop}
        onReorder={noop}
        monoPanelOpen={open}
        onToggleMonoPanel={() => setOpen((value) => !value)}
        onShowMonoDetails={() => {
          setTab("details");
          setOpen(true);
        }}
        hideWindowControls
      />
      <MonoDetails
        open={open}
        tab={tab}
        onTabChange={setTab}
        monoId="sample"
        cwd="/repo"
        agent={agent}
        state={{ status: live ? "working" : "idle", activity: "" }}
        harness="codex"
        model="codex:gpt-5.4"
        modelSettings={{}}
        runtimeMode="auto"
        onRuntimeModeChange={noop}
        onModelChange={noop}
        onModelSettingsChange={noop}
        onClose={() => setOpen(false)}
        activity={{
          live,
          blocks: [
            { id: "turn", role: "user", text: "Inspect" },
            {
              id: "call",
              role: "tool",
              text: "git status",
              tool: {
                kind: "shell",
                status: live ? "in_progress" : "completed",
              },
            },
          ],
        }}
      />
    </>
  );
}
async function render(live = true) {
  await act(async () => root.render(createElement(Panel, { live })));
}
const tabButton = (name: string) =>
  [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
    (button) => button.textContent === name,
  )!;

it("switches Details and Activity in one sidebar and reopens the last-used tab", async () => {
  await render();
  expect(container.querySelectorAll("aside")).toHaveLength(1);
  expect(tabButton("Details").getAttribute("aria-selected")).toBe("true");
  act(() => tabButton("Activity").click());
  expect(container.textContent).toContain("Working");
  expect(container.querySelector('[data-mono-activity-block="call"]')).toBeNull();
  act(() => [...container.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Show work")!.click());
  expect(
    document.querySelector('[role="dialog"] [data-mono-activity-block="call"]'),
  ).not.toBeNull();
  act(() =>
    container
      .querySelector<HTMLButtonElement>('[aria-label="Hide activity"]')!
      .click(),
  );
  expect(container.querySelector("aside")!.getAttribute("data-open")).toBe(
    "false",
  );
  act(() =>
    container
      .querySelector<HTMLButtonElement>('[aria-label="Show Mono panel"]')!
      .click(),
  );
  expect(container.querySelector("aside")!.getAttribute("data-open")).toBe(
    "true",
  );
  expect(tabButton("Activity").getAttribute("aria-selected")).toBe("true");
  act(() =>
    container
      .querySelector<HTMLButtonElement>(
        '[aria-label="Open details for Captain"]',
      )!
      .click(),
  );
  expect(tabButton("Details").getAttribute("aria-selected")).toBe("true");
  expect(container.querySelector("aside")!.getAttribute("data-open")).toBe(
    "true",
  );
});

it("keeps the last activity readable after the turn ends and supports keyboard tabs", async () => {
  await render();
  act(() =>
    tabButton("Details").dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
    ),
  );
  expect(document.activeElement).toBe(tabButton("Activity"));
  await render(false);
  expect(tabButton("Activity").getAttribute("aria-selected")).toBe("true");
  expect(container.textContent).toContain("Finished");
  act(() => [...container.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Show work")!.click());
  expect(
    document.querySelector('[role="dialog"] [data-mono-activity-block="call"]'),
  ).not.toBeNull();
  expect(
    container
      .querySelector('[role="tabpanel"]')!
      .getAttribute("aria-labelledby"),
  ).toBe(tabButton("Activity").id);
});

it("scopes the PR tab to Manager, Orchestrator, member and session and navigates three tabs", async () => {
  localStorage.setItem("monocode:mono-roster", JSON.stringify([
    { id: "manager", role: "manager", projects: ["/app"], managerProject: "/app", mascot: "cat", color: "#6ba" },
    { id: "org", role: "orchestrator", projects: ["/app", "/other"], mascot: "cat", color: "#6ba" },
    { id: "empty-org", role: "orchestrator", projects: [], mascot: "cat", color: "#6ba" },
    { id: "child-manager", role: "manager", reportsTo: "empty-org", projects: ["/child"], managerProject: "/child", mascot: "cat", color: "#6ba" },
    { id: "other-org-manager", role: "manager", reportsTo: "org", projects: ["/other"], mascot: "cat", color: "#6ba" },
    { id: "member", role: "member", reportsTo: "manager", projects: ["/app"], mascot: "cat", color: "#6ba" },
  ]));
  for (const [monoId, scope] of [
    ["manager", { project: "/app" }],
    ["org", { projects: ["/app", "/other"] }],
    ["empty-org", { projects: ["/child"] }],
    ["member", { monoId: "member" }],
    ["sample", { sessionId: "chat" }],
  ] as const) {
    await act(async () => root.render(createElement(MonoDetails, {
      open: true, monoId, sessionId: "chat", cwd: "/repo", agent, state: { status: "idle" },
      harness: "codex", model: "codex:gpt-5.4", modelSettings: {}, runtimeMode: "auto",
      onRuntimeModeChange: noop, onModelChange: noop, onModelSettingsChange: noop, onClose: noop,
      tab: "prs", onTabChange: noop,
    })));
    expect(JSON.parse(container.querySelector("[data-pr-scope]")!.getAttribute("data-pr-scope")!)).toEqual(scope);
    expect(tabButton("PRs").getAttribute("aria-selected")).toBe("true");
    expect(container.querySelector("[data-mono-prs]")).not.toBeNull();
  }
  await render();
  act(() => tabButton("Details").dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true })));
  expect(document.activeElement).toBe(tabButton("PRs"));
  act(() => tabButton("PRs").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
  expect(document.activeElement).toBe(tabButton("Details"));
  act(() => tabButton("Details").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })));
  expect(document.activeElement).toBe(tabButton("PRs"));
});
