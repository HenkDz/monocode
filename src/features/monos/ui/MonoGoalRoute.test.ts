// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MonoGoalRoute } from "./MonoGoalRoute";

const context = {
  ownerId: "grand",
  projects: [
    {
      id: "dzdistro",
      name: "DZDistro",
      path: "C:/projects/dzdistro",
      managerMonoId: "manager",
      available: true,
    },
  ],
};
let container: HTMLDivElement;
let root: Root;
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
function render(extra: Partial<Parameters<typeof MonoGoalRoute>[0]> = {}) {
  act(() =>
    root.render(
      createElement(MonoGoalRoute, {
        context,
        text: "Fix DZDistro checkout",
        attachmentCount: 0,
        choice: { mode: "goal", override: "auto" },
        onChange: () => {},
        ...extra,
      }),
    ),
  );
}
function mode(label: string) {
  return [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent === label,
  )!;
}

it("keeps chat explicit and shows the selected Manager and exact-match reason in goal mode", () => {
  const onChange = vi.fn();
  render({ choice: { mode: "chat", override: "auto" }, onChange });
  expect(mode("Chat").getAttribute("aria-pressed")).toBe("true");
  expect(container.querySelector('[role="status"]')).toBeNull();
  act(() => mode("New goal").click());
  expect(onChange).toHaveBeenCalledWith({ mode: "goal", override: "auto" });
  render();
  expect(container.querySelector('[role="status"]')?.textContent).toContain(
    "Send to DZDistro Manager",
  );
  expect(container.querySelector('[role="status"]')?.textContent).toContain(
    "Exact project name",
  );
});

it("hides project selection and prediction when direct routing is not opted in", () => {
  vi.stubEnv("VITE_MONO_DIRECT_PROJECT_ROUTING", "false");
  render({ choice: { mode: "goal", override: "manager", projectId: "dzdistro" } });
  expect(container.querySelector('[aria-label="Goal route: Auto route"]')).toBeNull();
  expect(container.querySelector('[role="status"]')).toBeNull();
  expect(container.textContent).not.toContain("DZDistro Manager");
});

it("previews the same trimmed goal text that Send submits", () => {
  render({ text: `Fix DZDistro checkout${" ".repeat(8000)}` });
  expect(container.querySelector('[role="status"]')?.textContent).toContain(
    "Send to DZDistro Manager",
  );
});

it.each(["auto", "manager"] as const)("checks raw special whitespace before trimming (%s)", override => {
  render({ text: "\ufeffFix DZDistro checkout\u00a0", choice: { mode: "goal", override, projectId: "dzdistro" } });
  expect(container.querySelector('[role="status"]')?.textContent).toContain("Send to Grand Orch");
  expect(container.querySelector('[role="status"]')?.textContent).toContain(
    "Contains non-English or special characters, so Grand Orch will route it.",
  );
});

it("offers Grand and explicit project overrides through the existing picker", async () => {
  const onChange = vi.fn();
  render({ onChange });
  const open = () =>
    container
      .querySelector<HTMLButtonElement>(
        '[aria-label="Goal route: Auto route"]',
      )!
      .click();
  await act(async () => open());
  const pick = (label: string) =>
    [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')]
      .find((button) => button.textContent?.trim() === label)!
      .click();
  await act(async () => pick("Grand Orch"));
  expect(onChange).toHaveBeenLastCalledWith({
    mode: "goal",
    override: "grand",
  });
  await act(async () => open());
  await act(async () => pick("DZDistro Manager"));
  expect(onChange).toHaveBeenLastCalledWith({
    mode: "goal",
    override: "manager",
    projectId: "dzdistro",
  });
});

it.each([
  { attachmentCount: 1, reason: "Attachments" },
  { text: "No registered name here", reason: "Choose a project" },
  { text: "x".repeat(8001), reason: "8,000" },
  {
    context: {
      ...context,
      projects: [{ ...context.projects[0], available: false }],
    },
    reason: "no available local Manager",
  },
])("shows the fallback route before Send: $reason", ({ reason, ...extra }) => {
  render(extra);
  expect(container.querySelector('[role="status"]')?.textContent).toContain(
    "Send to Grand Orch",
  );
  expect(container.querySelector('[role="status"]')?.textContent).toContain(
    reason,
  );
});

it.each(["auto", "manager"] as const)("shows the scope-noun fallback before Send (%s)", override => {
  render({ text: "No registered project here", choice: { mode: "goal", override, projectId: "dzdistro" } });
  expect(container.querySelector('[role="status"]')?.textContent).toContain("Send to Grand Orch");
  expect(container.querySelector('[role="status"]')?.textContent).toContain("Comparison or cross-project goal");
});

it("disables mode and route choices while delivery is pending", async () => {
  const onChange = vi.fn();
  render({ disabled: true, onChange });
  for (const button of container.querySelectorAll<HTMLButtonElement>(
    "button",
  )) {
    expect(button.disabled).toBe(true);
    await act(async () => button.click());
  }
  expect(onChange).not.toHaveBeenCalled();
  expect(
    document.querySelector('[aria-label="Goal route options"]'),
  ).toBeNull();
});
