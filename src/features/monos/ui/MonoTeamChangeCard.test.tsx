// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { MonoTeamChangeCard } from "./MonoTeamChangeCard";
import { MonoFieldLock } from "./MonoFieldLock";
import { findMono, saveMonoTeamRoster, type Mono } from "../model/mono";
import { lockMonoField, undoMonoTeamChanges } from "../model/monoTeam";
import { monoTeamHost } from "../model/monoTeamRuntime";
vi.mock("../model/monoTeam", async original => ({ ...(await original<typeof import("../model/monoTeam")>()), undoMonoTeamChanges: vi.fn() }));

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

it("renders one normal-font card with member rows, plain first sentences, model warning and whole-action Undo", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const members = ["Native Core", "Reviewer"].map((name, i): Mono => ({ id: `group-member-${i}`, name, specialty: i ? "Review" : "Native", reviewer: !!i, mascot: "cat", color: "#abc", projects: ["/repo"], role: "member", reportsTo: "group-manager", workerProfile: { harness: "codex", model: "gpt-6" } }));
  const changes = members.map((member, i) => ({ id: `group-hire-${i}`, requestId: `req-${i}`, fingerprint: "x", action: "team.hire", memberId: member.id, memberName: member.name!, summary: `Hired ${member.name}`, state: "applied" as const, at: 1, after: member, files: { soul: { before: "", after: `# ${member.name}\nOwn assigned work. More detailed instructions.` } } }));
  saveMonoTeamRoster([{ id: "group-manager", role: "manager", projects: ["/repo"], mascot: "cat", color: "#abc", teamChanges: changes }, ...members]);
  vi.mocked(monoTeamHost).mockResolvedValueOnce({ availableProfiles: [], postChange: vi.fn(), cancelMemberTasks: vi.fn() });
  const host = document.createElement("div"), root = createRoot(host);
  try {
    await act(async () => root.render(<MonoTeamChangeCard managerId="group-manager" changeId="group-hire-0" changeIds={changes.map(change => change.id)} />));
    expect(host.querySelectorAll('section[aria-label="Team hired"]')).toHaveLength(1);
    expect(host.querySelector("section")?.className).toContain("font-sans");
    expect(host.querySelectorAll("[data-team-member]")).toHaveLength(2);
    expect([...host.querySelectorAll("button")].filter(button => button.textContent === "Edit")).toHaveLength(2);
    expect(host.textContent).not.toContain("# Native Core");
    expect(host.querySelector("[data-team-member] p")?.textContent).toBe("Own assigned work.");
    expect(host.querySelectorAll("details")).toHaveLength(2);
    expect(host.textContent).toContain("Reviewer uses the same model as implementers");
    await act(async () => [...host.querySelectorAll("button")].find(button => button.textContent === "Undo")!.click());
    expect(undoMonoTeamChanges).toHaveBeenCalledWith("group-manager", ["group-hire-0", "group-hire-1"], expect.any(Object));
    const updates = changes.map(change => ({ ...change, action: "team.update" }));
    const memory = { ...updates[0], id: "group-memory", action: "team.memory.add", summary: "Memory updated" };
    saveMonoTeamRoster([{ id: "group-manager", role: "manager", projects: ["/repo"], mascot: "cat", color: "#abc", teamChanges: [...updates, memory] }, ...members]);
    await act(async () => root.render(<MonoTeamChangeCard managerId="group-manager" changeId="group-hire-0" changeIds={[...updates.map(change => change.id), memory.id]} />));
    expect(host.querySelectorAll('section[aria-label="Team updated"]')).toHaveLength(1);
    expect(host.querySelectorAll("[data-team-member]")).toHaveLength(2);
    expect(host.textContent).toContain("Memory updated");
  } finally { await act(async () => root.unmount()); localStorage.clear(); vi.unstubAllGlobals(); }
});
