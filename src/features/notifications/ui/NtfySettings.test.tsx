// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { NtfySettings } from "./NtfySettings";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
it("requires opt-in and saving before test delivery, never reads a stored token into the form", async () => {
  const config = { enabled: false, supported: true, server: "https://ntfy.example", topic: "private", hasToken: true, status: "No phone notifications sent" };
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command === "ntfy_settings") return { ...config };
    if (command === "ntfy_save") { config.enabled = (args as { config: { enabled: boolean } }).config.enabled; return; }
    if (command === "ntfy_send") throw new Error("Delivery rejected (HTTP 401)");
  });
  const host = document.createElement("div"); const root = createRoot(host);
  const button = (text: string) => [...host.querySelectorAll("button")].find(b => b.textContent === text)!;
  try {
    await act(async () => root.render(<NtfySettings />));
    expect(host.querySelector<HTMLInputElement>('input[type="password"]')?.value).toBe("");
    expect(button("Send test").disabled).toBe(true);
    await act(async () => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    expect(button("Send test").disabled).toBe(true);
    await act(async () => button("Save").click());
    expect(invoke).toHaveBeenCalledWith("ntfy_save", { config: { enabled: true, server: config.server, topic: "private", token: "" }, clearToken: false });
    expect(button("Send test").disabled).toBe(false);
    await act(async () => button("Send test").click());
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("HTTP 401");
  } finally { await act(async () => root.unmount()); }
});
