// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { MonoSidebar } from "./MonoSidebar";

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
