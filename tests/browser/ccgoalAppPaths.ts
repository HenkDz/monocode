import { readFileSync } from "node:fs";
import ts from "typescript";

/** Execute the current App callbacks with synthetic boundaries, without mounting the native app. */
export function ccgoalAppPaths() {
  return {
    name: "ccgoal-app-paths",
    resolveId: (id: string) => id === "virtual:ccgoal-app" ? "\0ccgoal-app" : undefined,
    load(id: string) {
      if (id !== "\0ccgoal-app") return;
      const app = readFileSync(new URL("../../src/app/App.tsx", import.meta.url), "utf8");
      const preparation = app.indexOf("              await orchestrator.hydrate(id);", app.indexOf("const ownerSessionId = mono.sessionId ?? sessionId;"));
      const preparationEnd = app.indexOf("              prepared.push({ id, turnId });", preparation);
      const delegation = app.indexOf('          if (payload.input.origin != null)');
      const delegationEnd = app.indexOf('\n        }\n        if (payload.namespace !== "app")', delegation);
      if (preparation < 0 || preparationEnd < preparation || delegation < 0 || delegationEnd < delegation)
        throw Error("Current App callback boundaries were not found");
      return ts.transpileModule(`
        export async function prepareManagerTurn(host, id, options) {
          const { orchestrator, probeHarnessAvailability, HARNESSES, isHarnessAvailable } = host;
          let turnId;
          ${app.slice(preparation, preparationEnd)}
          return turnId;
        }
        export async function delegateManagerRequest(host, payload) {
          const { sessionsRef, monoGoalOrigins, turnGen, monoForSession, findMono, habitRunMono,
            monoEngineId, sameProjectPath, listMonos, resolveTeamMember, resolveMonoRoleEffort,
            resolveModel, monoLook, managerGoalHost, orchestrator, monoManagerGoals,
            managerDelegateGoal, upsertSession, managerRecoveryRequest, appendManagerRecovery,
            managerRequestBinding, managerRequestBindingCurrent } = host;
          ${app.slice(delegation, delegationEnd)}
        }
      `, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
    },
  };
}
