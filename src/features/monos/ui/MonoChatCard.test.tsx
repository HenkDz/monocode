// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { MonoChatCard } from "./MonoChatCard";
import { monoManagerGoals, type MonoManagerGoal } from "../model/monoManagerGoals";
import type { Mono } from "../model/mono";
vi.mock("../../source-control/hooks/usePrStatus", () => ({ usePrStatusCache: () => new Map() }));
vi.mock("../../orchestration/ui/ProjectManagerReview", () => ({ ReadyCard: () => null }));

it("shows delegated goals only for an Orchestrator with visible delegated goals", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const hydrate = vi.spyOn(monoManagerGoals, "hydrate").mockResolvedValue({ version: 1, goals: [], receipts: {} });
  const goals = vi.spyOn(monoManagerGoals, "goals").mockReturnValue([]);
  const mono: Mono = { id: "owner", role: "orchestrator", projects: ["/repo"], mascot: "cat", color: "#abc" };
  const host = document.createElement("div"), root = createRoot(host);
  const render = async (role: Mono["role"]) => {
    localStorage.setItem("monocode:mono-roster", JSON.stringify([{ ...mono, role }]));
    await act(async () => root.render(<MonoChatCard monoId="owner" blockId="card" card={{ type: "dispatch" }} />));
  };
  try {
    await render("orchestrator"); expect(host.textContent).toBe("");
    goals.mockReturnValue([{ id: "goal", title: "Ship a fix", projectId: "/repo", managerId: "manager", state: "running" }] as MonoManagerGoal[]);
    await render("manager"); expect(host.textContent).toBe("");
    await render("orchestrator"); expect(host.textContent).toContain("Delegated to Managers"); expect(host.textContent).toContain("Ship a fix");
  } finally { await act(async () => root.unmount()); localStorage.clear(); hydrate.mockRestore(); goals.mockRestore(); vi.unstubAllGlobals(); }
});
