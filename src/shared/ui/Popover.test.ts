// @vitest-environment happy-dom
import { act, createElement, createRef, Fragment } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { Modal } from "./Modal";
import { Popover } from "./Popover";
import { LAYER } from "../lib/layers";

it("autofocuses after hidden measurement and preserves option focus when repositioned", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  const nativeFocus = HTMLElement.prototype.focus;
  const focus = vi
    .spyOn(HTMLElement.prototype, "focus")
    .mockImplementation(function (this: HTMLElement, options?: FocusOptions) {
      // Browsers ignore focus on the hidden first measurement pass; happy-dom does not.
      for (
        let element: HTMLElement | null = this;
        element;
        element = element.parentElement
      ) {
        if (element.style.visibility === "hidden") return;
      }
      nativeFocus.call(this, options);
    });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const anchor = createRef<HTMLButtonElement>();
  const trigger = createElement("button", { ref: anchor }, "Open menu");
  try {
    await act(async () => root.render(trigger));
    let left = 20;
    anchor.current!.getBoundingClientRect = () =>
      ({
        left,
        right: left + 30,
        top: 100,
        bottom: 130,
        width: 30,
        height: 30,
      }) as DOMRect;
    focus.mockClear();
    await act(async () =>
      root.render(
        createElement(
          Fragment,
          null,
          trigger,
          createElement(
            Popover,
            {
              anchor,
              autoFocus: true,
              role: "listbox",
              tabIndex: -1,
              "aria-label": "Measured menu",
            },
            createElement("button", { role: "option" }, "First option"),
          ),
        ),
      ),
    );
    const menu = document.querySelector<HTMLElement>(
      '[role="listbox"][aria-label="Measured menu"]',
    )!;
    expect(menu.parentElement?.style.visibility).not.toBe("hidden");
    expect(document.activeElement).toBe(menu);
    expect(focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
    const option = menu.querySelector<HTMLButtonElement>(
      'button[role="option"]',
    )!;
    act(() => option.focus());
    const before = menu.parentElement!.style.left;
    focus.mockClear();
    left = 120;
    await act(async () => window.dispatchEvent(new Event("resize")));
    expect(menu.parentElement!.style.left).not.toBe(before);
    expect(document.activeElement).toBe(option);
    expect(focus).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    container.remove();
    focus.mockRestore();
    vi.unstubAllGlobals();
  }
});

it("keeps modal menus and their flyouts above the dialog and isolates Escape", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const trigger = createRef<HTMLButtonElement>();
  const submenuTrigger = createRef<HTMLButtonElement>();
  const onClose = vi.fn();
  const onDismiss = vi.fn();
  const dialog = createElement(
    Modal,
    { title: "Test dialog", onClose },
    createElement("button", { ref: trigger }, "Open"),
  );
  const menu = () =>
    createElement(
      Popover,
      { anchor: trigger, onDismiss, "aria-label": "Menu" },
      createElement("button", { ref: submenuTrigger }, "Submenu"),
    );
  try {
    await act(async () => root.render(dialog));
    await act(async () =>
      root.render(createElement(Fragment, null, dialog, menu())),
    );
    const first = document.querySelector<HTMLElement>('[aria-label="Menu"]')!;
    expect(first.hasAttribute("data-dialog-popover")).toBe(true);
    expect(first.parentElement?.style.zIndex).toBe(String(LAYER.dialogPopover));
    await act(async () =>
      root.render(
        createElement(
          Fragment,
          null,
          dialog,
          menu(),
          createElement(
            Popover,
            {
              anchor: submenuTrigger,
              layer: LAYER.submenu,
              "aria-label": "Flyout",
            },
            "Options",
          ),
        ),
      ),
    );
    const flyout = document.querySelector<HTMLElement>(
      '[aria-label="Flyout"]',
    )!;
    expect(flyout.hasAttribute("data-dialog-popover")).toBe(true);
    expect(flyout.parentElement?.style.zIndex).toBe(
      String(LAYER.dialogPopover),
    );
    await act(async () =>
      first.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    expect(onClose).not.toHaveBeenCalled();
    expect(onDismiss).toHaveBeenCalledWith("escape");
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
