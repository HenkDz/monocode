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
      const delivery = app.indexOf('    deliver: async (goal, message, receiptId, cancel, validate, authority) => {', app.indexOf('  managerGoalHost.current = {'));
      const deliveryEnd = app.indexOf('\n  };', delivery);
      if (preparation < 0 || preparationEnd < preparation || delegation < 0 || delegationEnd < delegation || delivery < 0 || deliveryEnd < delivery)
        throw Error("Current App callback boundaries were not found");
      return ts.transpileModule(`
        export async function prepareManagerTurn(host, id, options) {
          const { orchestrator, probeHarnessAvailability, HARNESSES, isHarnessAvailable, assertManagerDelivery, sessionsRef, monoForSession, monoManagerGoals } = host;
          const sessionId = options.monoSource?.request?.sessionId ?? sessionsRef.current[0].id;
          const validateManagerDelivery = () => assertManagerDelivery(options.monoSource, options.appRequestId,
            sessionsRef.current.find(session => session.id === sessionId), monoForSession(sessionId), monoManagerGoals);
          validateManagerDelivery();
          let turnId;
          ${app.slice(preparation, preparationEnd)}
          return turnId;
        }
        export async function delegateManagerRequest(host, payload) {
          const { sessionsRef, monoGoalOrigins, turnGen, monoForSession, findMono, habitRunMono,
            monoEngineId, sameProjectPath, listMonos, resolveTeamMember, resolveMonoRoleEffort,
            resolveModel, monoLook, managerGoalHost, orchestrator, monoManagerGoals,
            managerDelegateGoal, upsertSession, managerRecoveryRequest, appendManagerRecovery,
            managerRequestBinding, managerRequestBindingCurrent, assertManagerDelivery } = host;
          ${app.slice(delegation, delegationEnd)}
        }
        export async function deliverManagerGoal(host, ...args) {
          const { sessionsRef, findMono, assertManagerContinuation, assertManagerDelivery, monoManagerGoals, managerGoalHost,
            orchestrator, dedicatedMono, ensureProjectManager, ensureMonoSession, monoEngineId, homeDir,
            ensureOpenSession, saveMonoPermissions, newDefaultSession, sessionDefaults, setSessions,
            monoLook, upsertSession, pathKey, listMonos, projectKey, remoteProjectFor, adoptManagerMono, assertDirectReport } = host;
          return await {${app.slice(delivery, deliveryEnd)}}.deliver(...args);
        }
      `, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
    },
  };
}
