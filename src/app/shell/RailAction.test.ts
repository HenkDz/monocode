// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { RailAction } from "./RailAction";
import { Inbox } from "../../shared/ui/icons";
import { renderToStaticMarkup } from "react-dom/server";

it.each([0, 1, 12, 100])("only shows a positive trailing Decisions count: %s", badge => {
  const html = renderToStaticMarkup(createElement(RailAction, { label: "Decisions", icon: Inbox, badge, onClick: () => {} }));
  const doc = new DOMParser().parseFromString(html, "text/html");
  const spans = doc.querySelectorAll("button > span");
  expect(spans.length).toBe(badge === 0 ? 1 : 2);
  expect(spans[spans.length - 1].textContent).toBe(badge === 0 ? "Decisions" : badge > 99 ? "99+" : String(badge));
});

it("opens Inbox context actions from the keyboard without navigating", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const onClick = vi.fn();
  const onOpenContextMenu = vi.fn();
  try {
    act(() =>
      root.render(
        createElement(RailAction, {
          label: "Inbox",
          icon: Inbox,
          onClick,
          onOpenContextMenu,
        }),
      ),
    );
    const button = container.querySelector("button")!;
    act(() =>
      button.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "F10",
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    expect(onOpenContextMenu).toHaveBeenCalled();
    expect(onClick).not.toHaveBeenCalled();
  } finally {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
