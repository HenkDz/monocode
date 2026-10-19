// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Integrations } from "./Integrations";
import { IntegrationRequestCard, type IntegrationRequestView } from "./IntegrationRequestCard";
import { isIntegrationUserEvent } from "../model/localToolBroker";

let container: HTMLDivElement, root: Root;
const request = (): IntegrationRequestView => ({ id: "request", name: "Project read", requester: "Manager", project: "Synthetic project", mono: "Atlas", goal: "Read project text",
  provider: "local MCP", available: true, status: "pending", request: { version: 1, type: "capability-request", kind: "access", service: "local-mcp", reason: "<script>untrusted reason</script>", tools: ["local-mcp.project.read"], scopes: ["file:readme.txt"], deadline: 5000 } });
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
const button = (text: string) => [...container.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === text)!;

it("renders honest empty states, broker limits and no invented totals", async () => {
  await act(async () => root.render(<Integrations connected={[]} requests={[]} onRequest={vi.fn()} onRevoke={vi.fn()} />));
  expect(container.textContent).toContain("No approved local integrations");
  expect(container.textContent).toContain("Selected results may be sent to the AI provider");
  expect(container.textContent).toContain("follow their permission mode");
  expect(container.textContent).toContain("not a machine sandbox");
  expect(container.textContent).not.toContain("data never leaves");
});
it("shows exact tools on an accessible custom fold without executing", async () => {
  const onAction = vi.fn();
  await act(async () => root.render(<IntegrationRequestCard item={request()} onAction={onAction} />));
  expect(container.querySelector("script")).toBeNull();
  expect(container.querySelector("details")).toBeNull();
  expect(button("See tools").getAttribute("aria-expanded")).toBe("false");
  await act(async () => button("See tools").click());
  expect(button("Hide tools").getAttribute("aria-expanded")).toBe("true");
  expect(container.textContent).toContain("local-mcp.project.read"); expect(onAction).not.toHaveBeenCalled();
});
it("never offers a governed gh connection from existing CLI availability", async () => {
  const item = request(); item.provider = "gh CLI"; item.request = { ...item.request, service: "github", tools: ["github.pr.read"] };
  const onAction = vi.fn();
  await act(async () => root.render(<IntegrationRequestCard item={item} onAction={onAction} />));
  expect(button("Review").disabled).toBe(true);
  expect(container.textContent).toContain("account not pinned");
  await act(async () => button("Review").click()); expect(onAction).not.toHaveBeenCalled();
});
it("keeps unavailable installs safe and allows Not now", async () => {
  const item = request(); item.available = false; item.provider = "skill"; item.request = { ...item.request, kind: "install", service: "skill", source: "C:/synthetic/local" };
  const onAction = vi.fn(async () => {});
  await act(async () => root.render(<IntegrationRequestCard item={item} onAction={onAction} />));
  expect(button("Install").disabled).toBe(true); expect(container.textContent).toContain("Install not available yet");
  await act(async () => button("Install").click()); expect(onAction).not.toHaveBeenCalled();
  await act(async () => button("Not now").click()); expect(onAction).toHaveBeenCalledWith(expect.any(Event), item, "later");
});
it("passes the original native event and exact view to the host without granting user authority itself", async () => {
  const item = request(), onAction = vi.fn(async () => {});
  await act(async () => root.render(<IntegrationRequestCard item={item} onAction={onAction} />));
  const event = new MouseEvent("click", { bubbles: true });
  await act(async () => button("Connect").dispatchEvent(event));
  expect(onAction).toHaveBeenCalledWith(event, item, "execute");
  expect(isIntegrationUserEvent(event, item.id)).toBe(false);
});
it("requires inspection before install and shows its exact files, bytes and fingerprint", async () => {
  const item = request(); item.provider = "skill"; item.request = { ...item.request, kind: "install", service: "skill", source: "C:/synthetic/skill" };
  const onAction = vi.fn(async () => {});
  await act(async () => root.render(<IntegrationRequestCard item={item} onAction={onAction} />));
  expect(button("Install").disabled).toBe(true);
  item.inspection = { name: "fixture", project: "C:/synthetic/project", projectIdentity: "windows:1:2", source: "C:/synthetic/skill", fingerprint: "a".repeat(64), totalBytes: 12,
    files: [{ path: "SKILL.md", bytes: 8 }, { path: "scripts/helper.ps1", bytes: 4 }] };
  await act(async () => root.render(<IntegrationRequestCard item={item} onAction={onAction} />));
  expect(button("Install").disabled).toBe(false);
  await act(async () => button("See files & tools").click());
  expect(container.textContent).toContain("scripts/helper.ps1"); expect(container.textContent).toContain("12 bytes"); expect(container.textContent).toContain("a".repeat(64));
  expect(onAction).not.toHaveBeenCalled();
});
it("retains failures visibly and does not invent a completion", async () => {
  await act(async () => root.render(<IntegrationRequestCard item={request()} onAction={async () => { throw Error("receipt uncertain"); }} />));
  await act(async () => button("Connect").click());
  expect(container.querySelector('[role="alert"]')?.textContent).toBe("receipt uncertain");
  expect(container.textContent).not.toContain("Completed");
});
it("distinguishes unavailable counts from actual zero and propagates revoke failure", async () => {
  const revoke = vi.fn(async () => { throw Error("revoke save failed"); });
  await act(async () => root.render(<Integrations connected={[
    { id: "one", name: "GitHub", provider: "gh CLI", scope: "project", monos: ["Manager"], available: true },
    { id: "two", name: "Local read", provider: "local MCP", scope: "one file", monos: [], available: true, callCount: 0 },
  ]} requests={[]} onRequest={vi.fn()} onRevoke={revoke} />));
  expect(container.textContent).toContain("Call count unavailable"); expect(container.textContent).toContain("0 calls");
  expect(container.textContent).toContain("Existing local CLI access · account not pinned");
  expect([...container.querySelectorAll("button")].filter(item => item.textContent === "Revoke")).toHaveLength(1);
  await act(async () => button("Revoke").click());
  expect(container.querySelector('[role="alert"]')?.textContent).toBe("revoke save failed");
});
