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
let reload: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.useFakeTimers();
  reload = vi.spyOn(window.location, "reload").mockImplementation(() => {});
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
  vi.restoreAllMocks();
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
  expect(document.getElementById("root")?.getAttribute("aria-hidden")).toBe(
    "true",
  );
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
  expect(document.getElementById("root")?.hasAttribute("aria-hidden")).toBe(
    false,
  );
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

it("initializes healthy appearance after a bounded paint opportunity when Element Timing is unavailable", () => {
  vi.stubGlobal("PerformanceObserver", undefined);
  vi.spyOn(
    document.querySelector("main")!,
    "getBoundingClientRect",
  ).mockReturnValue({ width: 400, height: 300 } as DOMRect);
  boot.contentMounted();
  reveal();
  expect(glass).not.toHaveBeenCalled();
  frame(0);
  vi.advanceTimersByTime(101);
  expect(splash()).toBeNull();
  expect(glass).toHaveBeenCalledTimes(1);
  expect(document.documentElement.classList.contains("boot-opaque")).toBe(
    false,
  );
});

it("unsupported timing still reaches opaque watchdog if content has no layout", () => {
  vi.stubGlobal("PerformanceObserver", undefined);
  boot.contentMounted();
  reveal();
  frame(0);
  vi.advanceTimersByTime(STARTUP_TIMEOUT_MS);
  expect(splash()?.dataset.state).toBe("timeout");
  expect(glass).not.toHaveBeenCalled();
});

it("confirms mounted Retry and retains edits when confirmation is cancelled or fails", async () => {
  boot.dispose();
  const confirm = vi.fn().mockResolvedValue(false);
  boot = startStartupRecovery(glass, undefined, confirm);
  boot.contentMounted();
  reveal();
  vi.advanceTimersByTime(STARTUP_TIMEOUT_MS);
  const retry = document.querySelector<HTMLButtonElement>("[data-boot-retry]")!;
  retry.click();
  await Promise.resolve();
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(reload).not.toHaveBeenCalled();
  expect(retry.disabled).toBe(false);
  confirm.mockRejectedValue(new Error("dialog failed"));
  retry.click();
  await Promise.resolve();
  expect(reload).not.toHaveBeenCalled();
  expect(retry.disabled).toBe(false);
});

it("reloads once only after mounted confirmation, with duplicate clicks disabled", async () => {
  boot.dispose();
  let accept!: (yes: boolean) => void;
  const confirm = vi.fn(
    () =>
      new Promise<boolean>((resolve) => {
        accept = resolve;
      }),
  );
  boot = startStartupRecovery(glass, undefined, confirm);
  boot.contentMounted();
  reveal();
  vi.advanceTimersByTime(STARTUP_TIMEOUT_MS);
  const retry = document.querySelector<HTMLButtonElement>("[data-boot-retry]")!;
  retry.click();
  retry.click();
  expect(confirm).toHaveBeenCalledTimes(1);
  accept(true);
  await Promise.resolve();
  expect(reload).toHaveBeenCalledTimes(1);
  expect(retry.disabled).toBe(true);
  boot.dispose();
});

it.each(["unmount", "dispose"])(
  "does not reload after a pending confirmation loses its mounted generation via %s",
  async (action) => {
    boot.dispose();
    let accept!: (yes: boolean) => void;
    boot = startStartupRecovery(
      glass,
      undefined,
      () =>
        new Promise<boolean>((resolve) => {
          accept = resolve;
        }),
    );
    const unmount = boot.contentMounted();
    reveal();
    vi.advanceTimersByTime(STARTUP_TIMEOUT_MS);
    document.querySelector<HTMLButtonElement>("[data-boot-retry]")!.click();
    if (action === "unmount") unmount();
    else boot.dispose();
    accept(true);
    await Promise.resolve();
    expect(reload).not.toHaveBeenCalled();
  },
);

it("excludes newly appended body portals during recovery and restores them on disposal", async () => {
  boot.fail();
  const portal = document.createElement("div");
  document.body.append(portal);
  await vi.waitFor(() =>
    expect(portal.getAttribute("aria-hidden")).toBe("true"),
  );
  expect(portal.hasAttribute("inert")).toBe(true);
  boot.dispose();
  expect(portal.hasAttribute("aria-hidden")).toBe(false);
  expect(portal.hasAttribute("inert")).toBe(false);
});

it("pre-mount rejection Retry reloads once without a confirmation", () => {
  boot.fail();
  const retry = document.querySelector<HTMLButtonElement>("[data-boot-retry]")!;
  retry.click();
  retry.click();
  expect(reload).toHaveBeenCalledTimes(1);
});

it("keeps Retry guarded after previously committed content unmounts", async () => {
  boot.dispose();
  const confirm = vi.fn().mockResolvedValue(false);
  boot = startStartupRecovery(glass, undefined, confirm);
  const unmount = boot.contentMounted();
  unmount();
  boot.fail();
  document.querySelector<HTMLButtonElement>("[data-boot-retry]")!.click();
  await Promise.resolve();
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(reload).not.toHaveBeenCalled();
});

it("restores pre-existing body portal attributes and focus on safe continuation", () => {
  const portal = document.createElement("div");
  portal.setAttribute("aria-hidden", "false");
  portal.innerHTML = '<input aria-label="portal input" value="unsaved" />';
  document.body.append(portal);
  const input = portal.querySelector("input")!;
  input.focus();
  boot.contentMounted();
  reveal();
  vi.advanceTimersByTime(STARTUP_TIMEOUT_MS);
  expect(portal.hasAttribute("inert")).toBe(true);
  expect(portal.getAttribute("aria-hidden")).toBe("true");
  expect(document.activeElement).toBe(continueButton());
  continueButton().click();
  expect(portal.hasAttribute("inert")).toBe(false);
  expect(portal.getAttribute("aria-hidden")).toBe("false");
  expect(document.activeElement).toBe(input);
  expect(input.value).toBe("unsaved");
});

it("disposal restores body siblings and releases the recovery key interceptor", () => {
  const portal = document.createElement("div");
  portal.setAttribute("inert", "");
  document.body.append(portal);
  boot.fail();
  boot.dispose();
  expect(portal.hasAttribute("inert")).toBe(true);
  expect(portal.hasAttribute("aria-hidden")).toBe(false);
  const handler = vi.fn();
  window.addEventListener("keydown", handler, true);
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab" }));
  expect(handler).toHaveBeenCalledTimes(1);
  window.removeEventListener("keydown", handler, true);
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
