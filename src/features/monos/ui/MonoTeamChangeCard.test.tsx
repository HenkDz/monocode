// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { MonoTeamChangeCard } from "./MonoTeamChangeCard";
import { MonoFieldLock } from "./MonoFieldLock";
import { findMono, saveMonoTeamRoster, type Mono } from "../model/mono";
import { lockMonoField } from "../model/monoTeam";

vi.mock("../model/monoTeamRuntime", () => ({ monoTeamHost: vi.fn(async () => { throw Error("Model unavailable"); }) }));

it("shows hires, opens member Details, keeps failed Undo visible, and unlocks user edits", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const member: Mono = { id: "member", name: "Docs", specialty: "Documentation", mascot: "cat", color: "#abc", projects: ["/repo"], role: "member", reportsTo: "manager", workerProfile: { harness: "codex", model: "codex:test" } };
  saveMonoTeamRoster([{ id: "manager", name: "Manager", role: "manager", projects: ["/repo"], mascot: "cat", color: "#abc", teamChanges: [{ id: "hire", requestId: "req", fingerprint: "x", action: "team.hire", memberId: member.id, memberName: "Docs", summary: "Hired Docs", state: "applied", at: 1, after: member, files: { soul: { before: "", after: "Verify documentation links" } } }] }, member]);
  lockMonoField(member.id, "soul");
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const opened = vi.fn();
  window.addEventListener("monocode:open-team", opened);
  try {
    await act(async () => root.render(createElement("div", null, createElement(MonoTeamChangeCard, { managerId: "manager", changeId: "hire" }), createElement(MonoFieldLock, { monoId: "member", field: "soul" }))));
    expect(container.textContent).toContain("Team hired");
    expect(container.textContent).toContain("Verify documentation links");
    const button = (label: string) => [...container.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === label)!;
    await act(async () => button("Edit").click());
    expect(opened.mock.calls[0][0].detail).toEqual({ monoId: "member" });
    await act(async () => button("Undo").click());
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Model unavailable");
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Unlock soul"]')!.click());
    expect(findMono("member")?.userLockedFields).toEqual([]);
    expect(container.textContent).not.toContain("Set by you");
  } finally {
    act(() => root.unmount()); container.remove(); window.removeEventListener("monocode:open-team", opened); localStorage.clear(); vi.unstubAllGlobals();
  }
});
