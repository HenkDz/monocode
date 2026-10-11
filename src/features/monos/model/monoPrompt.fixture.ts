import type { Mono } from "./mono";
import type { MonoFiles } from "./monoFiles";
import type { Block } from "../../sessions/model/session";
import type { OrchestrationTask } from "../../orchestration/model/orchestrationState";

function sized(text: string, chars: number): string {
  return text.repeat(Math.ceil(chars / text.length)).slice(0, chars);
}

/** Synthetic three-project org; no agent files or provider sessions are read. */
export function monoPromptFixture() {
  const projects = ["/projects/storefront", "/projects/platform", "/projects/mobile"];
  const grand: Mono = { id: "grand", role: "orchestrator", name: "Grand Orchestrator", mascot: "cat", color: "#789", projects };
  const roster: Mono[] = [grand];
  for (const [index, project] of projects.entries()) {
    const managerId = `manager-${index}`;
    roster.push({ id: managerId, role: "manager", name: `${project.split("/").pop()} Manager`, reportsTo: grand.id, mascot: "cat", color: "#789", projects: [project] });
    for (const specialty of ["Backend", "Frontend", "Verification", "Reviewer"]) {
      roster.push({ id: `${managerId}-${specialty.toLowerCase()}`, role: "member", name: `${specialty} ${index + 1}`, specialty, reportsTo: managerId, reviewer: specialty === "Reviewer", mascot: "cat", color: "#789", projects: [project] });
    }
  }
  const soul = sized("Work only on the assigned project. Keep the Manager informed. Verify changed behavior and report concrete evidence. ", 500);
  const memory = (chars: number) => Array.from({ length: chars / 100 }, (_, index) => sized(`- 2026-10-${String(index % 11 + 1).padStart(2, "0")} · Project fact ${index}: preserve tenant boundaries and run focused verification. `, 99)).join("\n") + "\n";
  const files: MonoFiles = { id: "synthetic", dir: "/synthetic/monos/fixture", soul, soulHash: "fixture-soul", memory: memory(3_200), memoryHash: "fixture-memory", memoryPath: "/synthetic/monos/fixture/MEMORY.md", topics: ["architecture", "verification"] };
  const saturatedFiles = { ...files, memory: memory(24_000), memoryHash: "fixture-memory-saturated" };
  const manager = roster.find(mono => mono.id === "manager-0")!;
  const member = roster.find(mono => mono.id === "manager-0-backend")!;
  const reviewer = roster.find(mono => mono.id === "manager-0-reviewer")!;
  const task: OrchestrationTask = {
    id: "implementation", sessionId: "worker-session", memberId: member.id, title: "Fix project result formatting", harness: "codex", model: "gpt-6.1-sol",
    prompt: "Fix result formatting within src/format.ts and verify the changed behavior. Preserve user authorization and report the checks.",
    files: ["src/format.ts"], scopes: ["/projects/storefront/src/format.ts"], dependsOn: [], status: "completed", accepted: false,
    result: sized("Implementation evidence: changed src/format.ts, passed focused tests, retained checkout and original user scope. ", 8_000), delivered: true,
    workspace: { id: "worker-checkout", projectCwd: projects[0], checkoutCwd: "/projects/storefront-worktrees/implementation", kind: "worktree", branch: "mc/implementation" },
    lastDispatchId: "implementation-dispatch", reportArtifactId: "implementation-report",
  };
  const reviewTask: OrchestrationTask = { ...task, id: "review", sessionId: "review-session", memberId: reviewer.id, title: "Review: Fix project result formatting", prompt: "Review the exact implementation dispatch independently. Read its diff and test evidence; save a verdict artifact.", readOnly: true, reviewOf: { taskId: task.id, dispatchId: task.lastDispatchId! }, result: "", reportArtifactId: undefined };
  const blocks: Block[] = Array.from({ length: 6 }, (_, index) => [
    { id: `user-${index}`, role: "user" as const, startedAt: Date.UTC(2026, 9, 10, 10, index), text: sized(`Authorized project request ${index}: keep the existing limits and investigate the selected task. `, 2_100) },
    { id: `reply-${index}`, role: "assistant" as const, text: sized(`Task evidence ${index}: current findings, checked files, verification and remaining next steps. `, 3_100) },
  ]).flat();
  return { roster, grand, manager, member, reviewer, files, saturatedFiles, task, reviewTask, blocks };
}
