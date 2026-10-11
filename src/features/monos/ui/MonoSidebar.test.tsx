// @vitest-environment happy-dom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { MonoSidebar, MonoSidebarHeader } from "./MonoSidebar";

it.each([
  [390, 340, 360],
  [280, 256, 256],
  [1400, 340, 560],
])(
  "keeps Details and readers usable within a %ipx viewport",
  async (viewport, details, artifact) => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const descriptor = Object.getOwnPropertyDescriptor(window, "innerWidth");
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: viewport,
    });
    const host = document.createElement("div"),
      root = createRoot(host);
    try {
      for (const [kind, width] of [
        ["details", details],
        ["artifact", artifact],
      ] as const) {
        await act(async () =>
          root.render(
            <MonoSidebar key={kind} open kind={kind} label={kind} color="#abc">
              Reader
            </MonoSidebar>,
          ),
        );
        expect(host.querySelector("aside")?.style.width).toBe(`${width}px`);
      }
    } finally {
      await act(async () => root.unmount());
      if (descriptor) Object.defineProperty(window, "innerWidth", descriptor);
      else Reflect.deleteProperty(window, "innerWidth");
      vi.unstubAllGlobals();
    }
  },
);

it("resizes from the keyboard through the same remembered width and bounds", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const descriptor = Object.getOwnPropertyDescriptor(window, "innerWidth");
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1400 });
  const host = document.createElement("div"), root = createRoot(host);
  document.body.append(host);
  try {
    await act(async () => root.render(<MonoSidebar open kind="details" label="Details" color="#abc">Details</MonoSidebar>));
    const separator = host.querySelector<HTMLElement>('[role="separator"]')!;
    const press = (key: string, shiftKey = false) => act(async () => separator.dispatchEvent(new KeyboardEvent("keydown", { key, shiftKey, bubbles: true })));
    separator.focus();
    expect(separator.tabIndex).toBe(0);
    await press("Home");
    expect(separator.getAttribute("aria-valuenow")).toBe("340");
    await press("ArrowLeft");
    expect(host.querySelector("aside")?.style.width).toBe("350px");
    await press("ArrowLeft", true);
    expect(host.querySelector("aside")?.style.width).toBe("390px");
    await press("ArrowRight");
    expect(host.querySelector("aside")?.style.width).toBe("380px");
    await press("End");
    await press("ArrowLeft");
    expect(separator.getAttribute("aria-valuenow")).toBe("440");
    expect(separator.getAttribute("aria-valuemax")).toBe("440");
    await press("Enter");
    expect(separator.getAttribute("aria-valuenow")).toBe("340");
    expect(document.activeElement).toBe(separator);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    if (descriptor) Object.defineProperty(window, "innerWidth", descriptor);
    vi.unstubAllGlobals();
  }
});

it("returns focus to the opener when closed and keeps focus elsewhere when it moved outside", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div"), root = createRoot(host);
  document.body.append(host);
  function Panel() {
    const [open, setOpen] = useState(false);
    return <><button onClick={() => setOpen(true)}>Open panel</button><button>Elsewhere</button><MonoSidebar open={open} kind="details" label="Details" color="#abc"><MonoSidebarHeader title="Details" onClose={() => setOpen(false)} /></MonoSidebar></>;
  }
  try {
    await act(async () => root.render(<Panel />));
    const opener = host.querySelector<HTMLButtonElement>("button")!;
    const other = host.querySelectorAll<HTMLButtonElement>("button")[1];
    opener.focus();
    await act(async () => opener.click());
    const close = host.querySelector<HTMLButtonElement>('[aria-label="Hide details"]')!;
    close.focus();
    await act(async () => close.click());
    expect(document.activeElement).toBe(opener);
    expect(host.querySelector<HTMLElement>('[role="separator"]')!.tabIndex).toBe(-1);
    await act(async () => opener.click());
    other.focus();
    await act(async () => close.click());
    expect(document.activeElement).toBe(other);
  } finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); }
});

it("restores an explicitly supplied trigger when an open panel is unmounted", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div"), root = createRoot(host);
  const trigger = document.createElement("button");
  document.body.append(trigger, host);
  try {
    await act(async () => root.render(<MonoSidebar open kind="prs" label="PRs" color="#abc" returnFocus={trigger}><button>Inside panel</button></MonoSidebar>));
    host.querySelector<HTMLButtonElement>("button")!.focus();
    await act(async () => root.render(null));
    expect(document.activeElement).toBe(trigger);
  } finally { await act(async () => root.unmount()); host.remove(); trigger.remove(); vi.unstubAllGlobals(); }
});
