// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { useProjectFolderDrop } from "./useProjectFolderDrop";

const native = vi.hoisted(() => ({
  get: vi.fn(),
  listen: vi.fn(async (_listener: (event: unknown) => void) => () => {}),
}));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => {
    native.get();
    return { onDragDropEvent: native.listen };
  },
}));
vi.mock("../../../shared/lib/dragPoint", () => ({
  dragPointToClient: (x: number, y: number) => ({ x, y }),
}));

it("routes dropped sidebar folders through the project add flow, not composer drops", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  const root = createRoot(container);
  const open = vi.fn();
  const rail = document.createElement("nav");
  rail.setAttribute("aria-label", "Projects");
  const hit = vi.spyOn(document, "elementFromPoint").mockReturnValue(rail);
  function Harness() {
    useProjectFolderDrop(open);
    return null;
  }
  await act(async () => root.render(createElement(Harness)));
  const listener = native.listen.mock.calls[0][0];
  const event = {
    payload: { type: "drop", position: { x: 10, y: 10 }, paths: ["/trees/v4"] },
  };
  listener(event);
  expect(open).toHaveBeenCalledWith(["/trees/v4"]);
  open.mockClear();
  hit.mockReturnValue(document.createElement("main"));
  listener(event);
  expect(open).not.toHaveBeenCalled();
  act(() => root.unmount());
  hit.mockRestore();
  vi.unstubAllGlobals();
});
it("does not crash a browser preview when native webview access throws", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  native.get.mockImplementationOnce(() => {
    throw new Error("No native window");
  });
  native.listen.mockClear();
  const root = createRoot(document.createElement("div"));
  function Harness() {
    useProjectFolderDrop(vi.fn());
    return null;
  }
  await act(async () => root.render(createElement(Harness)));
  expect(native.listen).not.toHaveBeenCalled();
  act(() => root.unmount());
  vi.unstubAllGlobals();
});
