// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ManagerWorkbenchNote } from "./ManagerWorkbenchNote";
import { recordCrewMessage, type CrewMessage } from "../model/monoCrewEvents";
import type { Mono } from "../model/mono";

const member: Mono = {
  id: "member",
  role: "member",
  reportsTo: "manager",
  name: "Reviewer",
  mascot: "cat",
  color: "#abc",
  projects: ["C:/synthetic/project"],
};
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  localStorage.clear();
  vi.unstubAllGlobals();
});
function message(
  id: string,
  at: number,
  patch: Partial<CrewMessage> = {},
): CrewMessage {
  return {
    id,
    at,
    managerId: "manager",
    senderId: "manager",
    recipientId: "member",
    topic: "Review hand-off",
    text: id,
    ...patch,
  };
}

it("shows only the newest message from this member's Manager to this member", () => {
  recordCrewMessage(message("older", 100));
  recordCrewMessage(message("newest matching", 300, { text: "<monocode_context>hidden instructions</monocode_context>\nnewest matching" }));
  recordCrewMessage(
    message("newer wrong sender", 500, { senderId: "other-manager" }),
  );
  recordCrewMessage(
    message("newer wrong recipient", 600, { recipientId: "other-member" }),
  );
  act(() => root.render(<ManagerWorkbenchNote member={member} />));
  expect(
    host.querySelector('[aria-label="Latest Manager message"] p')?.textContent,
  ).toBe("newest matching");
  expect(host.textContent).not.toContain("older");
  expect(host.textContent).not.toContain("wrong");
  expect(host.textContent).not.toContain("hidden instructions");
  expect(localStorage.getItem("monocode:crew-messages")).toContain("hidden instructions");
  act(() => recordCrewMessage(message("live matching update", 700)));
  expect(host.querySelector("p")?.textContent).toBe("live matching update");
});

it("opens the saved message in the house drawer and restores opener focus on Escape", () => {
  recordCrewMessage(
    message("saved", 1000, {
      text: "Keep the saved branch.\n<script>unsafe</script>",
    }),
  );
  act(() => root.render(<ManagerWorkbenchNote member={member} />));
  const opener = host.querySelector<HTMLButtonElement>("button")!;
  act(() => {
    opener.focus();
    opener.click();
  });
  const drawer = document.querySelector('[role="dialog"]')!;
  expect(drawer.textContent).toContain("Review hand-off");
  expect(drawer.textContent).toContain(
    "Keep the saved branch.\n<script>unsafe</script>",
  );
  expect(drawer.querySelector("script")).toBeNull();
  expect(drawer.querySelector("time")?.getAttribute("datetime")).toBe(
    new Date(1000).toISOString(),
  );
  act(() =>
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    ),
  );
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(document.activeElement).toBe(opener);
});

it("omits the note when no Manager message belongs to this member", () => {
  recordCrewMessage(
    message("someone else's message", 100, { recipientId: "other-member" }),
  );
  act(() => root.render(<ManagerWorkbenchNote member={member} />));
  expect(host.textContent).toBe("");
  expect(host.querySelector("button")).toBeNull();
});
