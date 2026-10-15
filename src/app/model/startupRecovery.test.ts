// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  startStartupRecovery,
  STARTUP_PAINT_ID,
  STARTUP_TIMEOUT_MS,
} from "./startupRecovery";

let callbacks: PerformanceObserverCallback[];
let observers: { disconnect: ReturnType<typeof vi.fn> }[];
let boot: ReturnType<typeof startStartupRecovery>;
let glass: ReturnType<typeof vi.fn>;
let frame: FrameRequestCallback;
beforeEach(() => {
  vi.useFakeTimers();
  callbacks = [];
  observers = [];
  vi.stubGlobal(
    "PerformanceObserver",
    class {
      static supportedEntryTypes = ["element"];
      disconnect = vi.fn();
      observe = vi.fn();
      constructor(callback: PerformanceObserverCallback) {
        callbacks.push(callback);
        observers.push(this);
      }
    },
  );
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn((callback: FrameRequestCallback) => {
      frame = callback;
      return 1;
    }),
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  Object.defineProperty(document, "visibilityState", {
    value: "visible",
    configurable: true,
  });
  document.documentElement.className = "";
  const html = readFileSync("index.html", "utf8");
  document.body.innerHTML = html.slice(
    html.indexOf("<body>") + 6,
    html.indexOf('<script type="module"'),
  );
  document.getElementById("root")!.innerHTML =
    `<main>Workspace</main><span id="${STARTUP_PAINT_ID}">MonoCode</span>`;
  glass = vi.fn();
  boot = startStartupRecovery(glass);
});
afterEach(() => {
  boot?.dispose();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
function paint(index = callbacks.length - 1, overrides = {}) {
  callbacks[index](
    {
      getEntries: () => [
        {
          identifier: STARTUP_PAINT_ID,
          element: document.getElementById(STARTUP_PAINT_ID),
          renderTime: 20,
          ...overrides,
        },
      ],
    } as unknown as PerformanceObserverEntryList,
    {} as PerformanceObserver,
  );
}
function reveal() {
  frame(0);
  vi.advanceTimersByTime(1);
}
const splash = () => document.getElementById("boot-splash");
const continueButton = () =>
  document.querySelector<HTMLButtonElement>("[data-boot-continue]")!;

it("keeps glass off through commit and rAF/task; enables only for the content paint signal", () => {
  boot.contentMounted();
  expect(glass).not.toHaveBeenCalled();
  reveal();
  expect(splash()?.classList.contains("boot-splash-out")).toBe(true);
  expect(document.documentElement.classList.contains("boot-opaque")).toBe(true);
  expect(glass).not.toHaveBeenCalled();
  paint();
  expect(glass).toHaveBeenCalledTimes(1);
  expect(splash()).toBeNull();
  expect(document.documentElement.classList.contains("boot-opaque")).toBe(
    false,
  );
  vi.advanceTimersByTime(STARTUP_TIMEOUT_MS);
  expect(splash()).toBeNull();
  expect(vi.getTimerCount()).toBe(0);
});

it.each([{ identifier: "splash-logo" }, { renderTime: 0 }, { element: null }])(
  "rejects unrelated or unpainted entries %j",
  (entry) => {
    boot.contentMounted();
    reveal();
    paint(0, entry);
    expect(glass).not.toHaveBeenCalled();
    expect(splash()).not.toBeNull();
  },
);

it("shows a visible recoverable rejection without exposing the underlying UI", () => {
  boot.fail();
  expect(splash()?.dataset.state).toBe("error");
  expect(splash()?.hasAttribute("aria-hidden")).toBe(false);
  expect(
    document.querySelector<HTMLButtonElement>("[data-boot-retry]")?.hidden,
  ).toBe(false);
  expect(continueButton().hidden).toBe(true);
  expect(document.getElementById("root")?.hasAttribute("inert")).toBe(true);
  expect(document.getElementById("root")?.getAttribute("aria-hidden")).toBe("true");
  boot.contentMounted();
  expect(glass).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it("bounds a never-painted frame and ignores its late callback until explicit opaque continuation", () => {
  boot.contentMounted();
  reveal();
  vi.advanceTimersByTime(STARTUP_TIMEOUT_MS);
  expect(splash()?.dataset.state).toBe("timeout");
  expect(splash()?.classList.contains("boot-splash-out")).toBe(false);
  expect(continueButton().hidden).toBe(false);
  paint();
  expect(glass).not.toHaveBeenCalled();
  expect(splash()).not.toBeNull();
  continueButton().click();
  expect(splash()).toBeNull();
  expect(document.documentElement.classList.contains("boot-opaque")).toBe(true);
  expect(document.getElementById("root")?.hasAttribute("inert")).toBe(false);
  expect(document.getElementById("root")?.hasAttribute("aria-hidden")).toBe(false);
});

it("keeps Retry available for hung boot and permits opaque continuation only after late mount", () => {
  vi.advanceTimersByTime(STARTUP_TIMEOUT_MS);
  expect(continueButton().hidden).toBe(true);
  const unmount = boot.contentMounted();
  expect(continueButton().hidden).toBe(false);
  unmount();
  expect(continueButton().hidden).toBe(true);
  expect(glass).not.toHaveBeenCalled();
});

it("cancels StrictMode's first setup and ignores stale callbacks and stale cleanup", () => {
  const oldCleanup = boot.contentMounted();
  oldCleanup();
  boot.contentMounted();
  oldCleanup();
  paint(0);
  expect(glass).not.toHaveBeenCalled();
  expect(observers[0].disconnect).toHaveBeenCalled();
  reveal();
  paint(1);
  expect(glass).toHaveBeenCalledTimes(1);
});

it("disposes watchdog, pending reveal, and observer without enabling glass", () => {
  boot.contentMounted();
  boot.dispose();
  frame(0);
  paint();
  vi.advanceTimersByTime(STARTUP_TIMEOUT_MS);
  expect(splash()?.dataset.state).toBe("loading");
  expect(glass).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it("uses opaque UI when Element Timing is unavailable", () => {
  vi.stubGlobal("PerformanceObserver", undefined);
  boot.contentMounted();
  reveal();
  expect(splash()).toBeNull();
  expect(glass).not.toHaveBeenCalled();
  expect(document.documentElement.classList.contains("boot-opaque")).toBe(true);
});

it("does not enable glass for a hidden document", () => {
  Object.defineProperty(document, "visibilityState", {
    value: "hidden",
    configurable: true,
  });
  boot.contentMounted();
  reveal();
  paint();
  expect(glass).not.toHaveBeenCalled();
  vi.advanceTimersByTime(STARTUP_TIMEOUT_MS);
  expect(splash()?.dataset.state).toBe("timeout");
});
