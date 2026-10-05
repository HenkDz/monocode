// @vitest-environment happy-dom
import { act, createElement, createRef, Fragment } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { Modal } from "./Modal";
import { Popover } from "./Popover";
import { LAYER } from "../lib/layers";

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
