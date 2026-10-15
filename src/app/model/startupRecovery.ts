const PAINT_ID = "monocode-startup-content";
export const STARTUP_TIMEOUT_MS = 10_000;

/** Element Timing reports renderer paint, not Windows compositor presentation. */
export function startStartupRecovery(
  activateGlass: () => void,
  showControls: () => () => void = () => () => {},
) {
  const splash = document.getElementById("boot-splash")!;
  const message = splash.querySelector<HTMLElement>("[data-boot-message]")!;
  const retry = splash.querySelector<HTMLButtonElement>("[data-boot-retry]")!;
  const continueOpaque = splash.querySelector<HTMLButtonElement>(
    "[data-boot-continue]",
  )!;
  const root = document.documentElement;
  root.classList.add("boot-opaque");
  let stopped = false;
  let mounted = false;
  let generation = 0;
  let mountGeneration = 0;
  let frame = 0;
  let task = 0;
  let observer: PerformanceObserver | undefined;
  let hideControls: (() => void) | undefined;
  const mark = (name: string) => performance.mark(`monocode:${name}`);
  const cleanupPaint = () => {
    generation++;
    cancelAnimationFrame(frame);
    window.clearTimeout(task);
    observer?.disconnect();
    observer = undefined;
  };
  const finish = (glass: boolean) => {
    if (stopped) return;
    stopped = true;
    window.clearTimeout(watchdog);
    cleanupPaint();
    hideControls?.();
    hideControls = undefined;
    retry.onclick = null;
    continueOpaque.onclick = null;
    document.getElementById("root")?.removeAttribute("inert");
    document.getElementById("root")?.removeAttribute("aria-hidden");
    mark(glass ? "glass-activation" : "opaque-ready");
    if (glass) {
      activateGlass();
      root.classList.remove("boot-opaque");
    }
    splash.remove();
    document.getElementById(PAINT_ID)?.setAttribute("hidden", "");
    mark("splash-removed");
    mark("ui-ready");
    performance.measure("monocode:navigation-to-ui", {
      start: 0,
      end: "monocode:ui-ready",
    });
    window.removeEventListener("pagehide", dispose);
  };
  const fail = (reason: "error" | "timeout") => {
    if (stopped) return;
    cleanupPaint();
    window.clearTimeout(watchdog);
    splash.dataset.state = reason;
    splash.classList.remove("boot-splash-out");
    document.getElementById("root")?.setAttribute("inert", "");
    document.getElementById("root")?.setAttribute("aria-hidden", "true");
    hideControls ??= showControls();
    splash.removeAttribute("aria-hidden");
    message.textContent =
      reason === "error"
        ? "MonoCode could not start. Retry to reload this window."
        : "Startup is taking longer than expected. Retry, or continue without transparency if the workspace is ready.";
    retry.hidden = false;
    continueOpaque.hidden = !mounted || reason === "error";
    mark(`boot-${reason}`);
  };
  const watchdog = window.setTimeout(() => fail("timeout"), STARTUP_TIMEOUT_MS);
  // A user-requested reload resets cached restore/import failures without overlapping attempts.
  retry.onclick = () => {
    retry.disabled = true;
    window.location.reload();
  };
  continueOpaque.onclick = () => finish(false);
  function dispose() {
    stopped = true;
    window.clearTimeout(watchdog);
    cleanupPaint();
    hideControls?.();
    hideControls = undefined;
    retry.onclick = null;
    continueOpaque.onclick = null;
    window.removeEventListener("pagehide", dispose);
  }
  window.addEventListener("pagehide", dispose);

  return {
    fail: () => fail("error"),
    dispose,
    contentMounted() {
      if (stopped) return () => {};
      cleanupPaint();
      const mount = ++mountGeneration;
      const unmount = () => {
        if (mount !== mountGeneration) return;
        mounted = false;
        continueOpaque.hidden = true;
        cleanupPaint();
      };
      mounted = true;
      mark("content-committed");
      if (splash.dataset.state === "timeout") {
        continueOpaque.hidden = false;
        return unmount;
      }
      if (splash.dataset.state !== "loading") return unmount;
      const current = ++generation;
      const marker = document.getElementById(PAINT_ID);
      if (
        typeof PerformanceObserver !== "undefined" &&
        PerformanceObserver.supportedEntryTypes?.includes("element")
      ) {
        observer = new PerformanceObserver((list) => {
          if (
            stopped ||
            current !== generation ||
            splash.dataset.state !== "loading"
          )
            return;
          const painted = list.getEntries().some((entry) => {
            const element = entry as PerformanceEntry & {
              identifier: string;
              element: Element;
              renderTime: number;
            };
            return (
              element.identifier === PAINT_ID &&
              element.element === marker &&
              element.renderTime > 0
            );
          });
          if (painted && document.visibilityState === "visible") {
            mark("content-renderer-paint");
            finish(true);
          }
        });
        observer.observe({ type: "element", buffered: true });
      }
      // Reveal committed content on an opaque surface before asking for its paint signal.
      frame = requestAnimationFrame(() => {
        task = window.setTimeout(() => {
          if (stopped || current !== generation) return;
          splash.classList.add("boot-splash-out");
          if (marker) marker.style.visibility = "visible";
          mark("splash-reveal-opaque");
          // Unsupported engines retain a usable opaque workspace, without waiting forever.
          if (!observer) finish(false);
        }, 0);
      });
      return unmount;
    },
  };
}

export const STARTUP_PAINT_ID = PAINT_ID;
