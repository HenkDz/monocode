// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TitleBar, type Tab } from "./TitleBar";

vi.mock("./WindowControls", () => ({ WindowControls: () => null }));

let container: HTMLDivElement;
let root: Root;

function tab(id: string, overrides: Partial<Tab> = {}): Tab {
  return {
    id,
    project: "project",
    title: id,
    more: [],
    sessionCount: 1,
    harnesses: ["codex"],
    busyHarnesses: [],
    doneHarnesses: [],
    files: [],
    ...overrides,
  };
}

function render(
  tabs: Tab[],
  extra: Partial<Parameters<typeof TitleBar>[0]> = {},
) {
  act(() =>
    root.render(
      createElement(TitleBar, {
        tabs,
        activeId: "active",
        cwd: "/project",
        onToggleSidebar: vi.fn(),
        onSelect: vi.fn(),
        onClose: vi.fn(),
        onCloseMany: vi.fn(),
        onReorder: vi.fn(),
        ...extra,
      }),
    ),
  );
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("title tab response status", () => {
  it("shows a teal completion check until the response is seen", () => {
    render([tab("done", { doneHarnesses: ["codex"] }), tab("active")]);

    const doneTab = container.querySelector('[data-title-tab-id="done"]')!;
    expect(
      doneTab.querySelector('[data-harness-status="done"]'),
    ).not.toBeNull();
    expect(
      doneTab.querySelector("svg")?.classList.contains("text-teal-400"),
    ).toBe(true);
    expect(
      doneTab.querySelector("button")?.getAttribute("aria-label"),
    ).toContain("Response complete");

    render([tab("done"), tab("active")]);
    expect(
      container.querySelector(
        '[data-title-tab-id="done"] [data-harness-status="idle"]',
      ),
    ).not.toBeNull();
  });

  it("keeps the loading indicator ahead of completion for the same provider", () => {
    render([
      tab("working", {
        busyHarnesses: ["codex"],
        doneHarnesses: ["codex"],
      }),
      tab("active"),
    ]);

    expect(
      container.querySelector(
        '[data-title-tab-id="working"] [data-harness-status="busy"]',
      ),
    ).not.toBeNull();
  });
});

it("sizes tabs to content and lets only the trailing region grow", () => {
  render([tab("active"), tab("other")], { onNew: vi.fn() });
  const strip = container.querySelector("[data-title-tab-strip]")!;
  expect(strip.parentElement!.classList.contains("flex-[0_1_auto]")).toBe(true);
  expect(strip.parentElement!.classList.contains("flex-1")).toBe(false);
  expect(strip.parentElement!.classList.contains("overflow-hidden")).toBe(true);
  const plus = container.querySelector('[aria-label^="New session"]')!;
  expect(plus.parentElement!.classList.contains("shrink-0")).toBe(true);
  expect(
    plus.parentElement!.nextElementSibling!.classList.contains("flex-1"),
  ).toBe(true);
});

it("opens Details from the mascot/name independently of the panel toggle", () => {
  const onShowMonoDetails = vi.fn();
  const onToggleMonoPanel = vi.fn();
  const mono = {
    look: { name: "Captain", mascot: "cat", color: "#6ba", projects: [] },
    state: { status: "idle" as const, activity: "Idle" },
  };
  render([], {
    mono,
    onShowMonoDetails,
    onToggleMonoPanel,
    monoPanelOpen: true,
  });
  const name = container.querySelector<HTMLButtonElement>(
    '[aria-label="Open details for Captain"]',
  )!;
  expect(name.tagName).toBe("BUTTON");
  expect(name.textContent).toContain("Captain");
  expect(name.className).toContain("hover:bg-content/6");
  act(() => name.click());
  act(() => name.click());
  expect(onShowMonoDetails).toHaveBeenCalledTimes(2);
  expect(onToggleMonoPanel).not.toHaveBeenCalled();
  expect(
    container.querySelector('[aria-label="Hide Mono panel"]'),
  ).not.toBeNull();
});

it.each(["working", "idle"] as const)(
  "shows a live panel indicator only while working and closed: %s",
  (status) => {
    const mono = {
      look: { name: "Captain", mascot: "cat", color: "#6ba", projects: [] },
      state: { status, activity: status },
    };
    const onToggleMonoPanel = vi.fn();
    render([], { mono, onToggleMonoPanel });
    expect(!!container.querySelector("[data-mono-activity-indicator]")).toBe(
      status === "working",
    );
    act(() =>
      container
        .querySelector<HTMLButtonElement>('[aria-label="Show Mono panel"]')!
        .click(),
    );
    expect(onToggleMonoPanel).toHaveBeenCalledOnce();
    render([], { mono, onToggleMonoPanel, monoPanelOpen: true });
    expect(
      container.querySelector("[data-mono-activity-indicator]"),
    ).toBeNull();
  },
);

it.each([true, false])(
  "offers a separate session sidebar toggle when the project rail is %s",
  (projectRailOpen) => {
    const onToggleSidebar = vi.fn();
    const onToggleSessionSidebar = vi.fn();
    act(() =>
      root.render(
        createElement(TitleBar, {
          tabs: [tab("active")],
          activeId: "active",
          cwd: "/project",
          projectRailOpen,
          sessionSidebarOpen: false,
          onToggleSidebar,
          onToggleSessionSidebar,
          onSelect: vi.fn(),
          onClose: vi.fn(),
          onCloseMany: vi.fn(),
          onReorder: vi.fn(),
        }),
      ),
    );

    const toggle = container.querySelector<HTMLButtonElement>(
      'button[aria-label^="Toggle Session Sidebar"]',
    );
    expect(toggle).not.toBeNull();
    act(() => toggle?.click());
    expect(onToggleSessionSidebar).toHaveBeenCalledOnce();
    expect(onToggleSidebar).not.toHaveBeenCalled();
  },
);
