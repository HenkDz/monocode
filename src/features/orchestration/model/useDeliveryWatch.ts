import { useEffect } from "react";
import { gitBranches, gitPrStatus } from "../../../platform/tauri/fs";
import { fetchGithubPrChecks, summarizePrChecks } from "../../inbox/model/githubPrChecks";
import { parseGithubWorkItemUrl } from "../../sessions/model/sessionWorkItem";
import { orchestrator } from "./orchestration";
import type { OrchestrationRun } from "./orchestrationState";

/** Watches retained PRs even when the Manager's Activity tab is closed. */
export function useDeliveryWatch(runs: readonly OrchestrationRun[]) {
  const targets = JSON.stringify(runs.filter(run => run.projectManager).flatMap(run =>
    run.tasks.flatMap(task => task.workspace && (task.prUrl || task.status === "completed" && !task.readOnly && !task.reviewOf)
      ? [{ leadId: run.leadId, taskId: task.id, cwd: task.workspace.checkoutCwd, url: task.prUrl }] : [])));
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      for (const target of JSON.parse(targets) as { leadId: string; taskId: string; cwd: string; url?: string }[]) {
        if (stopped) return;
        try {
          if (!target.url) {
            const [pr, branches] = await Promise.all([gitPrStatus(target.cwd), gitBranches(target.cwd)]);
            if (stopped || !pr || branches.detached || !branches.current) continue;
            if (!await orchestrator.discoverDeliveryPr(target.leadId, target.taskId, pr, branches.current)) continue;
            target.url = pr.url;
          }
          const link = parseGithubWorkItemUrl(target.url);
          if (!link || stopped) continue;
          const [pr, checks] = await Promise.all([gitPrStatus(target.cwd), fetchGithubPrChecks(target.cwd, link.repo, link.number)]);
          if (stopped || pr?.url !== target.url || pr.state !== "open" || checks.state === "merged" || checks.state === "closed") continue;
          const overall = summarizePrChecks({ loading: false, error: null, checks: checks.checks });
          const ci = overall.kind === "pass" || overall.kind === "fail" || overall.kind === "pending" ? overall.kind : "unknown";
          if (pr.headOid && pr.headOid !== checks.headOid) continue;
          await orchestrator.maintainDelivery(target.leadId, target.taskId, { head: checks.headOid, ci, conflicts: pr.mergeable === "CONFLICTING", mergeable: pr.mergeable === "MERGEABLE" });
        } catch { /* Retain evidence on transient GitHub/network failures. */ }
      }
      if (!stopped) timer = setTimeout(() => void refresh(), 30_000);
    };
    void refresh();
    return () => { stopped = true; clearTimeout(timer); };
  }, [targets]);
}
