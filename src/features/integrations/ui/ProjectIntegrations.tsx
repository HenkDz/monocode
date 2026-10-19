import { useEffect, useState } from "react";
import { pathKey } from "../../../shared/lib/paths";
import type { OwnedDecision } from "../../commandCenter/model/decisionView";
import type { Mono } from "../../monos/model/mono";
import type { MonoManagerGoal } from "../../monos/model/monoManagerGoals";
import type { OrchestrationRun } from "../../orchestration/model/orchestrationState";
import type { Session } from "../../sessions/model/session";
import { remoteProjectFor } from "../../connections/model/remoteProjects";
import { loadProjectIntegrations, projectSkillRequest } from "../model/projectIntegrations";
import type { SkillOperationLog } from "../model/projectSkillActions";
import type { IntegrationRequestAction } from "./IntegrationRequestCard";
import { Integrations, type ConnectedIntegration } from "./Integrations";

export function ProjectIntegrations({ project, decisions, roster, sessions, runs, goals, refresh, onRequest, onLog, onChanged }: {
  project: string; decisions: readonly OwnedDecision[]; roster: readonly Mono[]; sessions: readonly Session[]; runs: readonly OrchestrationRun[];
  goals: readonly MonoManagerGoal[]; refresh: number; onRequest: IntegrationRequestAction; onLog: SkillOperationLog; onChanged(): void;
}) {
  const [state, setState] = useState<{ project: string; rows: ConnectedIntegration[]; loading: boolean; error?: string }>({ project, rows: [], loading: true });
  const [retry, setRetry] = useState(0);
  const requests = decisions.filter(item => pathKey(item.decision.projectId) === pathKey(project)).flatMap(item => {
    const request = projectSkillRequest(item, roster, sessions, runs, goals); return request ? [{ ...request, available: request.available && !remoteProjectFor(project) }] : [];
  });
  const key = JSON.stringify([project, refresh, retry, requests, roster, sessions.map(session => [session.id, session.harness, session.providerAccountId, session.cwd, session.worktreeCwd])]);
  useEffect(() => {
    let current = true;
    setState({ project, rows: [], loading: true });
    const load = remoteProjectFor(project) ? Promise.reject(Error("Local project integrations are unavailable for this remote project."))
      : loadProjectIntegrations(project, requests, sessions, decisions);
    void load.then(rows => { if (current) setState({ project, rows, loading: false }); }, error => {
      if (current) setState({ project, rows: [], loading: false, error: String(error) });
    });
    return () => { current = false; };
  }, [key]);
  const rows = state.project === project ? state.rows : [];
  return <><Integrations connected={rows} requests={requests.map(request => ({ ...request, available: request.available && !state.loading && !state.error,
    installedPath: rows.find(row => row.skillPath && pathKey(row.skillPath) === pathKey(`${project}/.agents/skills/${request.name}/SKILL.md`))?.skillPath,
  }))} loading={state.project !== project || state.loading} error={state.error} onRequest={onRequest} onLog={onLog} onChanged={onChanged} />
    {state.error && <button type="button" className="integration-primary" onClick={() => setRetry(value => value + 1)}>Try again</button>}</>;
}
