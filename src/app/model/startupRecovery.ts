const PAINT_ID = "monocode-startup-content";
export const STARTUP_TIMEOUT_MS = 10_000;

/** Element Timing reports renderer paint, not Windows compositor presentation. */
export function startStartupRecovery(
  activateGlass: () => void,
  showControls: () => () => void = () => () => {},
  confirmMountedReload: () => Promise<boolean> = async () => false,
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
  let contentCommitted = false;
  let generation = 0;
  let mountGeneration = 0;
  let frame = 0;
  let task = 0;
  let observer: PerformanceObserver | undefined;
  let hideControls: (() => void) | undefined;
  let recoveryActive = false;
  let reloading = false;
  let previousFocus: HTMLElement | null = null;
  const excluded = new Map<
    Element,
    { inert: string | null; hidden: string | null }
  >();
  const excludeSiblings = () => {
    for (const element of document.body.children) {
      if (element === splash || excluded.has(element)) continue;
      excluded.set(element, {
        inert: element.getAttribute("inert"),
        hidden: element.getAttribute("aria-hidden"),
      });
      element.setAttribute("inert", "");
      element.setAttribute("aria-hidden", "true");
    }
  };
  const portals = new MutationObserver(excludeSiblings);
  const restoreSurfaces = () => {
    recoveryActive = false;
    portals.disconnect();
    for (const [element, attributes] of excluded) {
      for (const [name, value] of [
        ["inert", attributes.inert],
        ["aria-hidden", attributes.hidden],
      ] as const) {
        if (value === null) element.removeAttribute(name);
        else element.setAttribute(name, value);
      }
    }
    excluded.clear();
  };
  const recoveryButtons = () =>
    [...splash.querySelectorAll<HTMLButtonElement>("button")].filter(
      (button) => !button.disabled && !button.closest("[hidden]"),
    );
  const focusRecovery = () =>
    (continueOpaque.hidden ? retry : continueOpaque).focus();
  // Installed before App's effects so portal traps and global shortcuts cannot consume recovery keys.
  const onRecoveryKey = (event: KeyboardEvent) => {
    if (!recoveryActive) return;
    event.stopImmediatePropagation();
    if (event.type === "keyup") return;
    if (event.key === "Tab") {
      const buttons = recoveryButtons();
      const index = buttons.indexOf(
        document.activeElement as HTMLButtonElement,
      );
      event.preventDefault();
      const next =
        index < 0
          ? event.shiftKey
            ? buttons.length - 1
            : 0
          : (index + (event.shiftKey ? -1 : 1) + buttons.length) %
            buttons.length;
      buttons[next]?.focus();
    } else if (
      event.key === "Escape" ||
      event.key === "F5" ||
      ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "r")
    ) {
      event.preventDefault();
    }
  };
  const onRecoveryFocus = (event: FocusEvent) => {
    if (!recoveryActive) return;
    if (!(event.target instanceof Node) || !splash.contains(event.target))
      focusRecovery();
    event.stopImmediatePropagation();
  };
  window.addEventListener("keydown", onRecoveryKey, true);
  window.addEventListener("keyup", onRecoveryKey, true);
  window.addEventListener("focusin", onRecoveryFocus, true);
  const removeRecoveryListeners = () => {
    window.removeEventListener("keydown", onRecoveryKey, true);
    window.removeEventListener("keyup", onRecoveryKey, true);
    window.removeEventListener("focusin", onRecoveryFocus, true);
  };
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
    restoreSurfaces();
    removeRecoveryListeners();
    hideControls?.();
    hideControls = undefined;
    retry.onclick = null;
    continueOpaque.onclick = null;
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
    if (previousFocus?.isConnected) previousFocus.focus();
  };
  const fail = (reason: "error" | "timeout") => {
    if (stopped) return;
    cleanupPaint();
    window.clearTimeout(watchdog);
    splash.dataset.state = reason;
    splash.classList.remove("boot-splash-out");
    if (!recoveryActive) {
      previousFocus =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      recoveryActive = true;
      excludeSiblings();
      portals.observe(document.body, { childList: true });
    }
    hideControls ??= showControls();
    splash.removeAttribute("aria-hidden");
    splash.setAttribute("role", "dialog");
    splash.setAttribute("aria-modal", "true");
    splash.setAttribute("aria-label", "Startup recovery");
    message.textContent =
      reason === "error"
        ? "MonoCode could not start. Retry to reload this window."
        : "Startup is taking longer than expected. Retry, or continue without transparency if the workspace is ready.";
    retry.hidden = false;
    continueOpaque.hidden = !mounted || reason === "error";
    focusRecovery();
    mark(`boot-${reason}`);
  };
  const watchdog = window.setTimeout(() => fail("timeout"), STARTUP_TIMEOUT_MS);
  // A user-requested reload resets cached restore/import failures without overlapping attempts.
  retry.onclick = async () => {
    if (retry.disabled || stopped || reloading) return;
    retry.disabled = true;
    const current = generation;
    try {
      // Content was interactive before timeout; conservatively protect any unsaved edits.
      if (contentCommitted && !(await confirmMountedReload())) return;
      if (!stopped && current === generation) {
        reloading = true;
        window.location.reload();
      }
    } catch {
      reloading = false;
      // A failed confirmation must retain user work.
    } finally {
      if (!stopped && !reloading) retry.disabled = false;
    }
  };
  continueOpaque.onclick = () => finish(false);
  function dispose() {
    stopped = true;
    window.clearTimeout(watchdog);
    cleanupPaint();
    restoreSurfaces();
    removeRecoveryListeners();
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
      contentCommitted = true;
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
          if (!observer) {
            // Compatibility path: a layout check after a paint opportunity is not compositor proof.
            const checkLayout = () => {
              frame = requestAnimationFrame(() => {
                task = window.setTimeout(() => {
                  if (stopped || current !== generation) return;
                  const content = [
                    ...(document.getElementById("root")?.children ?? []),
                  ].some((element) => {
                    const rect = element.getBoundingClientRect();
                    return (
                      element.id !== PAINT_ID &&
                      rect.width > 0 &&
                      rect.height > 0
                    );
                  });
                  if (content && document.visibilityState === "visible") {
                    mark("content-paint-opportunity");
                    finish(true);
                  } else checkLayout();
                }, 100);
              });
            };
            checkLayout();
          }
        }, 0);
      });
      return unmount;
    },
  };
}

export const STARTUP_PAINT_ID = PAINT_ID;
