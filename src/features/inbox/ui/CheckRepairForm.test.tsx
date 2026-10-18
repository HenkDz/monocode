// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CheckRepairForm } from "./CheckRepairForm";

beforeEach(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
afterEach(() => vi.unstubAllGlobals());

it("offers the real Manager with its mascot and reports target errors inside the picker", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const start = vi.fn(async () => {
    throw Error("Manager could not accept this goal");
  });
  const close = vi.fn();
  await act(async () =>
    root.render(
      createElement(CheckRepairForm, {
        anchor: host,
        cwd: "/app",
        repo: "a/app",
        headOid: "abc",
        checks: [
          {
            name: "Tests",
            workflow: "CI",
            state: "fail",
            url: null,
            startedAt: null,
            completedAt: null,
          },
        ],
        repair: {
          number: 4,
          sessions: [{ id: "chat", title: "Ordinary chat" }],
          manager: {
            id: "manager",
            name: "App Manager",
            mascot: "cat",
            color: "#abc",
            role: "manager",
          },
          onStart: start,
        },
        onClose: close,
      }),
    ),
  );
  const choice = document.querySelector<HTMLButtonElement>(
    '[role="option"][aria-label="App Manager"]',
  )!;
  expect(choice.querySelector("svg")).not.toBeNull();
  expect(choice.textContent).toContain("Manager");
  await act(async () => choice.click());
  await act(async () =>
    [...document.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "Start fix")!
      .click(),
  );
  expect(start).toHaveBeenCalledWith(
    expect.objectContaining({ text: expect.stringContaining("PR #4") }),
    undefined,
    "manager",
  );
  expect(document.querySelector('[role="alert"]')?.textContent).toContain(
    "Manager could not accept this goal",
  );
  expect(close).not.toHaveBeenCalled();
  act(() => root.unmount());
  host.remove();
});
