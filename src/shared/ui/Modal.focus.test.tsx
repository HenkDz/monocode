// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { Modal } from "./Modal";

it("keeps keyboard focus in the dialog, closes with Escape, and returns focus to Open", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const trigger = document.createElement("button"),
    host = document.createElement("div"),
    close = vi.fn();
  trigger.textContent = "Open";
  document.body.append(trigger, host);
  trigger.focus();
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        <Modal title="Work" onClose={close}>
          <button autoFocus>Show work</button>
        </Modal>,
      ),
    );
    const controls = document.querySelectorAll<HTMLButtonElement>(
      '[role="dialog"] button',
    );
    expect(document.activeElement).toBe(controls[0]);
    controls[1].focus();
    act(() =>
      controls[1].dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Tab",
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    expect(document.activeElement).toBe(controls[0]);
    act(() =>
      controls[0].dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Tab",
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    expect(document.activeElement).toBe(controls[1]);
    act(() =>
      controls[1].dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    expect(close).toHaveBeenCalledOnce();
    await act(async () => root.render(null));
    expect(document.activeElement).toBe(trigger);
  } finally {
    await act(async () => root.unmount());
    trigger.remove();
    host.remove();
    vi.unstubAllGlobals();
  }
});

it("lets the topmost dialog and its popovers own Escape", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div"),
    parentClose = vi.fn(),
    childClose = vi.fn();
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        <>
          <Modal title="Parent" onClose={parentClose}>
            Parent work
          </Modal>
          <Modal title="Child" onClose={childClose}>
            <div data-dialog-popover>
              <button>Model</button>
            </div>
          </Modal>
        </>,
      ),
    );
    const model = [...document.querySelectorAll("button")].find(
      (button) => button.textContent === "Model",
    )!;
    act(() =>
      model.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    expect(parentClose).not.toHaveBeenCalled();
    expect(childClose).not.toHaveBeenCalled();
    const close = document.querySelectorAll<HTMLButtonElement>(
      '[aria-label="Close"]',
    )[1];
    act(() =>
      close.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    expect(parentClose).not.toHaveBeenCalled();
    expect(childClose).toHaveBeenCalledOnce();
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
