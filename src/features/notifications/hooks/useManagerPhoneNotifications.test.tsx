// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { useManagerPhoneNotifications } from "./useManagerPhoneNotifications";
import type { ManagerAttention } from "../../orchestration/model/projectManager";
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => "Delivered"),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
it("sends each decision/ready identity once, excludes replies and never sends private text", async () => {
  const root = createRoot(document.createElement("div"));
  function Probe({ items }: { items: ManagerAttention[] }) {
    useManagerPhoneNotifications(items);
    return null;
  }
  const item: ManagerAttention = {
    key: "manager:task",
    id: "manager",
    project: "/private/repo",
    question: "secret task text",
    kind: "ready",
    notificationId: "dispatch1",
  };
  try {
    await act(async () => root.render(<Probe items={[item]} />));
    await act(async () => root.render(<Probe items={[{ ...item }]} />));
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("ntfy_send", {
      eventId: "manager:task:ready:dispatch1",
      kind: "ready",
    });
    await act(async () =>
      root.render(<Probe items={[{ ...item, kind: "reply" }]} />),
    );
    expect(invoke).toHaveBeenCalledTimes(1);
    await act(async () =>
      root.render(<Probe items={[{ ...item, notificationId: "dispatch2" }]} />),
    );
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(vi.mocked(invoke).mock.calls)).not.toContain(
      "secret",
    );
    expect(JSON.stringify(vi.mocked(invoke).mock.calls)).not.toContain(
      "/private",
    );
  } finally {
    await act(async () => root.unmount());
  }
});
