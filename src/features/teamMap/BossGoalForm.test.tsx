// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BossGoalForm, type BossGoalRoute } from "./BossGoalForm";

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const submit = vi.fn<BossGoalRoute["submit"]>();
const context = { ownerId: "boss", projects: [{ id: "app", path: "/app", name: "App", available: true, managerMonoId: "manager" }] };
const render = (available = true) => act(async () => root.render(<BossGoalForm route={available ? { context, submit } : undefined} />));
const field = () => host.querySelector("textarea")!;
const setText = (text: string) => act(async () => {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field(), text);
  field().dispatchEvent(new Event("input", { bubbles: true }));
});
const send = () => act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  submit.mockReset();
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it("submits the exact source through the existing Grand goal route even with direct project routing enabled", async () => {
  vi.stubEnv("VITE_MONO_DIRECT_PROJECT_ROUTING", "true");
  submit.mockResolvedValue(true);
  await render(); await setText("  Build App\nKeep exact source  "); await send();
  expect(submit).toHaveBeenCalledOnce();
  const [source, request] = submit.mock.calls[0];
  expect(source).toBe("  Build App\nKeep exact source  ");
  expect(request).toMatchObject({ ownerId: "boss", choice: { mode: "goal", override: "grand" } });
  expect(request.projectId).toBeUndefined(); expect(request.managerMonoId).toBeUndefined();
  expect(field().value).toBe("");
});

it("retains uncertain request identity and full draft for safe retry", async () => {
  submit.mockRejectedValueOnce(Error("Delivery outcome unknown")).mockResolvedValueOnce(true);
  await render(); await setText("Exact request"); await send();
  expect(field().value).toBe("Exact request");
  expect(host.querySelector('[role="alert"]')?.textContent).toBe("Delivery outcome unknown");
  await send();
  expect(submit.mock.calls[1][1]).toEqual(submit.mock.calls[0][1]);
});

it("keeps rejected drafts and prevents duplicate pending submission", async () => {
  let finish!: (accepted: boolean) => void;
  submit.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  await render(); await setText("Ship goal"); await send(); await send();
  expect(submit).toHaveBeenCalledOnce(); expect(field().disabled).toBe(true);
  await act(async () => finish(false));
  expect(field().value).toBe("Ship goal");
  expect(host.textContent).toContain("Request was not accepted");
});

it("does not submit while unavailable, blank, or Enter is composing", async () => {
  await render(false); expect(field().disabled).toBe(true);
  await render(); await setText("   "); await send(); expect(submit).not.toHaveBeenCalled();
  await setText("Goal");
  await act(async () => field().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true, cancelable: true })));
  expect(submit).not.toHaveBeenCalled();
});
