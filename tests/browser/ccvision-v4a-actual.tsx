import React, { useState, useRef, useCallback, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { mockIPC } from "@tauri-apps/api/mocks";
// @ts-expect-error supplied by this fixture's Vite source-selection plugin
import ActualIntegrationHost from "virtual:actual-integration-app";
import { listMonos, findMono, subscribeMonos, monosSnapshot, type Mono } from "../../src/features/monos/model/mono";
import { monoManagerGoals } from "../../src/features/monos/model/monoManagerGoals";
import { recordCrewMessage, crewMessages } from "../../src/features/monos/model/monoCrewEvents";
import { decisionAsk } from "../../src/features/monos/model/monoDecisions";
import { sendDecisionFromClick } from "../../src/features/monos/model/monoDecisionUi";
import { capabilityDecisionPayload, capabilityDecisionReason, type InstallCapabilityRequest } from "../../src/features/integrations/model/integrationCapabilities";
import { INTEGRATIONS_SCOPE, projectSkillRequest } from "../../src/features/integrations/model/projectIntegrations";
import { ProjectIntegrations } from "../../src/features/integrations/ui/ProjectIntegrations";
import { IntegrationRequestCard } from "../../src/features/integrations/ui/IntegrationRequestCard";
import { IntegrationsNav } from "../../src/features/integrations/ui/IntegrationsNav";
import { Decisions, DECISIONS_SCOPE } from "../../src/features/commandCenter/ui/Decisions";
import { selectDecisionView } from "../../src/features/commandCenter/model/decisionView";
import { useTeamMap } from "../../src/features/teamMap/navigation";
import { newSession, type Session } from "../../src/features/sessions/model/session";
import { sameProjectPath } from "../../src/features/projects/model/recents";
import { pathKey } from "../../src/shared/lib/paths";
import "../../src/styles/index.css";

const query = new URLSearchParams(location.search), project = "C:/synthetic/browser-link-4";
document.documentElement.classList.toggle("theme-light", query.get("theme") === "light");
document.body.style.margin = "0";
const fixture = { calls: [] as { command: string; args: Record<string, unknown> }[], sends: [] as { id: string; text: string }[],
  pending: false, fingerprint: "a".repeat(64), logFails: false, finish: () => {}, logs: () => crewMessages(), project };
Object.assign(window, { actualV4a: fixture });
const originalSet = Storage.prototype.setItem;
Storage.prototype.setItem = function(key: string, value: string) {
  if (fixture.logFails && key === "monocode:crew-messages") throw Error("Synthetic activity log failure");
  return originalSet.call(this, key, value);
};
const roster: Mono[] = [
  { id: "boss", role: "orchestrator", projects: [], sessionId: "boss-chat", mascot: "owl", color: "#abc", specialty: "Boss" },
  { id: "manager", name: "Manager", role: "manager", reportsTo: "boss", projects: [project], sessionId: "manager-chat", mascot: "fox", color: "#abc", specialty: "Manage project" },
  { id: "worker", name: "Atlas", role: "member", reportsTo: "manager", projects: [project], sessionId: "worker-chat", mascot: "cat", color: "#abc", specialty: "Read project", skillsPolicy: { mode: "custom", enabled: query.has("selected") ? ["fixture-id"] : [] } },
];
localStorage.setItem("monocode:mono-roster", JSON.stringify(roster));
localStorage.removeItem("monocode:crew-messages");
const sessions = [{ ...newSession("codex", project), id: "worker-chat" }];
const request: InstallCapabilityRequest = { version: 1, type: "capability-request", kind: "install", service: "skill", name: "fixture", source: "C:/synthetic/source/fixture", reason: "Inspect this local package to read the project", tools: ["project.skill.install"], scopes: ["project:synthetic"], deadline: Date.now() + 60_000 };
const payload = capabilityDecisionPayload(request);
const ask = decisionAsk({ id: "worker-chat:install", managerId: "manager", senderId: "worker", recipientId: "manager", topic: "skill", kind: "question", requiresReply: true, text: JSON.stringify(payload), at: Date.now() }, "worker-chat", project, roster, "high-impact-only")!;
const protectedAsk = { ...ask, id: "protected", question: "Send a project update?", operation: "message-people" as const, context: "An ordinary protected question", options: [{ id: "review", label: "Review update" }, { id: "later", label: "Not now" }] };
const legacyAsk = { ...ask, id: "legacy", question: "Install legacy prose?", context: "Please install a skill from an unspecified folder" };
const rows = query.has("empty") ? [] : [ask, ...(query.has("duplicate") ? [{ ...ask, id: "duplicate" }] : []), protectedAsk, legacyAsk];
let saved = JSON.stringify({ version: 1, goals: [], receipts: {}, decisions: rows });
const installed = new Map<string, string>();
mockIPC(async (command, args) => {
  fixture.calls.push({ command, args: args as Record<string, unknown> });
  if (command === "control_load") return saved;
  if (command === "control_save") { saved = (args as { state: string }).state; return; }
  if (command === "git_github_status") return { installed: true, authenticated: true, connected: true };
  if (command === "list_skills") return [...installed.keys()].map(name => ({ name, description: "Synthetic installed package", path: `${project}/.agents/skills/${name}/SKILL.md`, scope: "project", source: "agents" }));
  if (command === "codex_mono_skills_catalog") return { skills: [...installed.keys()].map(name => ({ id: "fixture-id", name, description: "Fixture", source: "agents", path: `${project}/.agents/skills/${name}/SKILL.md` })), roleDefaults: { worker: [] }, plugins: [] };
  if (command === "inspect_project_skill") return { name: args?.name, declaredName: args?.name, description: "Synthetic inspected package", project: args?.project, projectIdentity: "windows:1:2", source: args?.source, fingerprint: fixture.fingerprint, files: [{ path: "SKILL.md", bytes: 12 }], totalBytes: 12 };
  if (command === "install_project_skill") {
    if (args?.expectedFingerprint !== fixture.fingerprint) throw Error("Project or skill source changed; inspect it again before approving");
    if (installed.has(String(args?.name))) throw Error("This skill already exists");
    if (fixture.pending) await new Promise<void>(resolve => { fixture.finish = resolve; });
    installed.set(String(args?.name), fixture.fingerprint); return {};
  }
  if (command === "archive_project_skill") {
    if (args?.expectedFingerprint !== fixture.fingerprint) throw Error("Skill changed; inspect current bytes before removing");
    installed.delete(String(args?.name)); return `${project}/.agents/skill-archive/fixture-synthetic`;
  }
  throw Error(`Unexpected native boundary: ${command}`);
});
await monoManagerGoals.hydrate("manager");
const noop = () => {};
function Fixture() {
  const teamMap = useTeamMap();
  const [currentSessions, setSessions] = useState<Session[]>(sessions);
  const sessionsRef = useRef(currentSessions); sessionsRef.current = currentSessions;
  const submitSessionRef = useRef(async (id: string, text: string) => { fixture.sends.push({ id, text }); return true; });
  const ports = { React, useState, useRef, useCallback, useSyncExternalStore, subscribeMonos, monosSnapshot, monoManagerGoals, listMonos, findMono, teamMap,
    sendDecisionFromClick, ensureOpenSession: async (id: string) => sessionsRef.current.find(session => session.id === id), ensureMonoSession: async () => undefined,
    homeDir: async () => "C:/synthetic/home", saveMonoPermissions: noop, newDefaultSession: newSession, sessionsRef, setSessions, submitSessionRef,
    sameProjectPath, remoteProjectFor: () => undefined, orchestrator: { snapshot: () => [] }, recordCrewMessage, projectSkillRequest, capabilityDecisionReason,
    IntegrationRequestCard, ProjectIntegrations, pathKey, sidebarCwd: project, sessions: currentSessions, orchestrationRuns: [],
    workspaceNavigation: { cancel: noop }, setFilePickerOpen: noop, setSettingsOpen: noop, setSearchViewOpen: noop, setInboxViewOpen: noop,
    setNotesViewOpen: noop, setAutomationsViewOpen: noop, monosEnabled: true, INTEGRATIONS_SCOPE, DECISIONS_SCOPE, Decisions, selectDecisionView, IntegrationsNav };
  return <div className="actual-v4a"><ActualIntegrationHost {...ports} /></div>;
}
const style = document.createElement("style"); style.textContent = ".actual-v4a{height:100vh;display:flex;color:var(--color-content);background:var(--color-background-base)}.actual-v4a>nav{flex:0 0 150px;padding:12px 4px;border-right:1px solid #8884}.actual-v4a>main{min-width:0;display:flex;flex:1;flex-direction:column;overflow:auto}@media(max-width:600px){.actual-v4a>nav{flex-basis:88px}.actual-v4a>nav button{font-size:11px;max-width:80px;margin:4px 0;padding:4px}}"; document.head.append(style);
createRoot(document.getElementById("root")!).render(<Fixture />);
