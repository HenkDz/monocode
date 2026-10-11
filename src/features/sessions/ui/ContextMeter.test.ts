// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { dropContextWindow } from "../model/contextUsage";
import { ContextMeter } from "./ContextMeter";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("stays hidden until the provider reports usage", async () => {
  await act(async () => root.render(createElement(ContextMeter)));
  expect(container.childElementCount).toBe(0);
});

it.each([-1, NaN, Infinity])(
  "does not display invalid usage as a reading for %s",
  async (used) => {
    await act(async () =>
      root.render(
        createElement(ContextMeter, {
          usage: { used, window: 200_000 },
        }),
      ),
    );
    expect(container.childElementCount).toBe(0);
  },
);

it("keeps actual window usage and labels an unknown refresh threshold", async () => {
  await act(async () =>
    root.render(
      createElement(ContextMeter, {
        usage: { used: 176_000, window: 256_000 },
      }),
    ),
  );
  const ring = container.querySelector("svg");
  expect(ring?.getAttribute("aria-label")).toBe(
    "69% context used, 176K / 256K tokens. Context refresh threshold unknown",
  );
  expect(ring?.getAttribute("aria-label")).not.toContain("Will refresh");
});

it("does not use the refresh threshold as the ring denominator", async () => {
  await act(async () =>
    root.render(
      createElement(ContextMeter, {
        usage: {
          used: 50_000,
          window: 200_000,
          effectiveCompactionThreshold: 100_000,
        },
      }),
    ),
  );
  expect(container.querySelector("svg")?.getAttribute("aria-label")).toBe(
    "25% context used, 50K / 200K tokens. Context refresh threshold: 100K tokens",
  );
});

it("labels a scheduled refresh in context actions and for screen readers", async () => {
  await act(async () =>
    root.render(
      createElement(ContextMeter, {
        usage: { used: 150_000, window: 200_000 },
        rotationScheduled: true,
        onCompact: vi.fn(),
      }),
    ),
  );
  const trigger = container.querySelector("button")!;
  expect(trigger.getAttribute("aria-label")).toContain(
    "Will refresh context before next turn",
  );
  await act(async () => trigger.click());
  expect(document.body.textContent).toContain(
    "Will refresh context before next turn",
  );
  expect(document.body.textContent).toContain(
    "Context refresh threshold unknown",
  );
});

it.each([undefined, 0, -1, NaN, Infinity])(
  "shows an unknown window in words for %s",
  async (window) => {
    await act(async () =>
      root.render(
        createElement(ContextMeter, {
          usage: { used: 30_000, window },
        }),
      ),
    );
    expect(container.textContent).toBe("Context window unknown");
    expect(container.querySelector("svg")).toBeNull();
    expect(
      container.querySelector("span")?.getAttribute("aria-label"),
    ).toContain("30K tokens");
    expect(container.textContent).not.toContain("%");
  },
);

it("drops stale model limits from the meter", async () => {
  await act(async () =>
    root.render(
      createElement(ContextMeter, {
        usage: dropContextWindow({
          used: 30_000,
          window: 200_000,
          effectiveCompactionThreshold: 150_000,
        }),
      }),
    ),
  );
  const label = container.querySelector("span")?.getAttribute("aria-label");
  expect(label).toContain("Context window unknown");
  expect(label).toContain("Context refresh threshold unknown");
  expect(label).not.toContain("150K");
});

it.each([0, -1, NaN, Infinity])(
  "labels an invalid threshold as unknown for %s",
  async (threshold) => {
    await act(async () =>
      root.render(
        createElement(ContextMeter, {
          usage: {
            used: 30_000,
            window: 200_000,
            effectiveCompactionThreshold: threshold,
          },
        }),
      ),
    );
    expect(
      container.querySelector("svg")?.getAttribute("aria-label"),
    ).toContain("Context refresh threshold unknown");
  },
);

it("keeps manual compaction disabled during a current operation", async () => {
  const compact = vi.fn();
  await act(async () =>
    root.render(
      createElement(ContextMeter, {
        usage: { used: 150_000, window: 200_000 },
        rotationScheduled: true,
        compactDisabled: true,
        onCompact: compact,
      }),
    ),
  );
  await act(async () => container.querySelector("button")!.click());
  const action = Array.from(document.querySelectorAll("button")).find(
    (button) => button.textContent === "Compact now",
  )!;
  expect(action.disabled).toBe(true);
  await act(async () => action.click());
  expect(compact).not.toHaveBeenCalled();
});

it("shows a protected-carry deferral and manual compaction without usage telemetry", async () => {
  const reason =
    "Context refresh deferred: constraints too large (8001 chars). Compact manually or trim constraints.";
  const compact = vi.fn();
  await act(async () =>
    root.render(
      createElement(ContextMeter, {
        rotationDeferredReason: reason,
        onCompact: compact,
      }),
    ),
  );
  expect(container.querySelector('[role="status"]')?.textContent).toBe(reason);
  expect(container.querySelector("svg")).toBeNull();
  const trigger = container.querySelector("button")!;
  expect(trigger.getAttribute("aria-label")).toContain("Context usage unknown");
  expect(trigger.getAttribute("aria-label")).toContain(reason);
  expect(trigger.getAttribute("aria-label")).not.toContain("Will refresh");
  await act(async () => trigger.click());
  const action = [
    ...document.querySelectorAll<HTMLButtonElement>("button"),
  ].find((button) => button.textContent === "Compact now")!;
  await act(async () => action.click());
  expect(compact).toHaveBeenCalledOnce();
});
