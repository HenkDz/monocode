import { useState, useSyncExternalStore } from "react";
import {
  findMono,
  listMonos,
  monoLook,
  monoDefaultRuntimeMode,
  monosSnapshot,
  subscribeMonos,
  updateMono,
  type Mono,
} from "../model/mono";
import { PixelMascot } from "../../projects/ui/PixelMascot";
import { PageHeader, Property } from "./monoPanelParts";
import { ModelPicker, ModelSettingRows } from "../../sessions/ui/ModelPicker";
import { RUNTIME_MODE_LABEL, type RuntimeMode } from "../../sessions/model/session";
import { AccessPicker } from "../../sessions/ui/AccessPicker";
import { usePrStatusCache } from "../../source-control/hooks/usePrStatus";
import { managerTaskLifecycle, taskPrStatus } from "../../orchestration/model/projectManager";
import { MemoryPage, SoulPage } from "./MonoFilePages";
import { MonoSettingsPage } from "./MonoSettingsPage";
import { useMonoFiles } from "./MonoDetails";
import { orchestrator } from "../../orchestration/model/orchestration";
import { cardSessionsSnapshot, openCardSession, subscribeCardSessions } from "../model/monoCards";
import { memberTasks } from "../model/monoNavigation";
import { assertTeamRetire, handleMonoTeam, lockMonoField } from "../model/monoTeam";
import { monoTeamHost } from "../model/monoTeamRuntime";
import { MonoFieldLock } from "./MonoFieldLock";
import { teamReviewerWarning } from "../model/monoOrg";

export function MonoTeamPage({
  monoId,
  fallback,
  onBack,
}: {
  monoId: string;
  fallback: NonNullable<Mono["workerProfile"]>;
  onBack(): void;
}) {
  useSyncExternalStore(subscribeMonos, monosSnapshot);
  const [selected, select] = useState<string>();
  const [name, setName] = useState("");
  const [specialty, setSpecialty] = useState("");
  const [error, setError] = useState<string>();
  const owner = findMono(monoId);
  const member = selected && findMono(selected);
  if (member)
    return (
      <MemberDetails
        member={member}
        fallback={fallback}
        onBack={() => select(undefined)}
      />
    );
  const members = listMonos().filter((mono) => mono.reportsTo === monoId);
  const remove = async (member: Mono) => {
    const tasks = orchestrator
      .snapshot()
      .flatMap((run) =>
        run.ownerMonoId === monoId
          ? run.tasks
              .filter(
                (task) =>
                  task.memberId === member.id &&
                  ["running", "queued", "blocked", "interrupted"].includes(
                    task.status,
                  ),
              )
              .map((task) => ({ run, task }))
          : [],
      );
    if (
      !window.confirm(
        `Remove ${monoLook(member).name}?${tasks.length ? ` Cancel ${tasks.length} unfinished tasks through the Manager; retain their worktrees and history.` : " Its memory stays on disk."}`,
      )
    )
      return;
    try {
      await handleMonoTeam(monoId, crypto.randomUUID(), "team.retire", { memberId: member.id, reason: "Retired by you in Team" }, await monoTeamHost(monoId));
    } catch (error) {
      setError(String(error));
    }
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-mono-team>
      <PageHeader
        title={owner?.role === "orchestrator" ? "Managers" : "Team"}
        onBack={onBack}
      />
      <div className="overflow-y-auto p-3">
        {owner?.role === "manager" && teamReviewerWarning(listMonos(), monoId) && <p role="status" className="mb-2 text-xs text-amber-700 dark:text-amber-400">{teamReviewerWarning(listMonos(), monoId)}</p>}
        {members.map((member) => {
          const look = monoLook(member);
          return (
            <div
              key={member.id}
              className="flex items-center gap-2 rounded-lg py-2"
            >
              <PixelMascot
                name={look.mascot}
                color={look.color}
                still
                className="size-7"
              />
              <button
                type="button"
                className="min-w-0 flex-1 rounded text-left text-sm focus-visible:outline-accent"
                onClick={() =>
                  owner?.role === "orchestrator"
                    ? window.dispatchEvent(new CustomEvent("monocode:open-team", { detail: { monoId: member.id } }))
                    : select(member.id)
                }
              >
                <span className="block truncate" title={look.name}>{look.name}</span>
                <span className="block truncate text-xs text-content/50" title={`${member.specialty ?? "Manager"} · ${member.workerProfile?.model ?? fallback.model}`}>
                  {member.specialty ?? "Manager"} ·{" "}
                  {member.workerProfile?.model ?? fallback.model}
                </span>
              </button>
              {owner?.role === "manager" && (
                <button
                  type="button"
                  aria-label={`Remove ${look.name}`}
                  className="rounded px-2 py-1 text-xs text-content/50 hover:text-red-400"
                  onClick={() => void remove(member)}
                >
                  Remove
                </button>
              )}
            </div>
          );
        })}
        {owner?.role === "manager" && (
          <form
            className="mt-4 space-y-2 border-t border-stroke pt-3"
            onSubmit={(event) => {
              event.preventDefault();
              try {
                void monoTeamHost(monoId, true).then(host => handleMonoTeam(monoId, crypto.randomUUID(), "team.hire", {
                  name, specialty, soul: `# ${name}\n\nWork as the ${specialty} for this project. Follow the Manager's task scope, verify your work and report evidence.`,
                  ...(specialty.trim().toLowerCase() === "reviewer" ? {} : fallback),
                }, host)).then(() => { setName(""); setSpecialty(""); setError(undefined); }).catch(error => setError(String(error)));
              } catch (error) {
                setError(String(error));
              }
            }}
          >
            <input
              aria-label="Member name"
              placeholder="Member name"
              value={name}
              maxLength={80}
              onChange={(event) => setName(event.target.value)}
              className="w-full rounded border border-stroke bg-transparent p-2 text-sm"
            />
            <input
              aria-label="Specialty"
              placeholder="Specialty"
              value={specialty}
              maxLength={80}
              onChange={(event) => setSpecialty(event.target.value)}
              className="w-full rounded border border-stroke bg-transparent p-2 text-sm"
            />
            <button
              type="submit"
              className="rounded bg-content/10 px-3 py-2 text-xs"
            >
              Add member
            </button>
          </form>
        )}
        {error && (
          <p role="alert" className="mt-2 text-xs text-red-400">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

export function MemberDetails({
  member,
  fallback,
  onBack,
  onProfileChange,
  runtimeMode,
  onRuntimeModeChange,
}: {
  member: Mono;
  fallback: NonNullable<Mono["workerProfile"]>;
  onBack(): void;
  onProfileChange?: (profile: NonNullable<Mono["workerProfile"]>) => void;
  runtimeMode?: RuntimeMode;
  onRuntimeModeChange?: (mode: RuntimeMode) => void;
}) {
  const [page, setPage] = useState("details");
  const [error, setError] = useState<string>();
  const runs = useSyncExternalStore(orchestrator.subscribe, orchestrator.snapshot, orchestrator.snapshot);
  const tasks = memberTasks(runs, member.id).slice(0, 8);
  const statuses = usePrStatusCache();
  const files = useMonoFiles(member.id, "idle");
  const look = monoLook(member);
  const profile = member.workerProfile ?? fallback;
  const sessions = useSyncExternalStore(subscribeCardSessions, cardSessionsSnapshot);
  const session = member.sessionId ? sessions.get(member.sessionId) : undefined;
  const permissionMode = runtimeMode ?? session?.runtimeMode ?? (member.sessionId ? undefined : monoDefaultRuntimeMode(member));
  if (page === "soul")
    return (
      <SoulPage
        monoId={member.id}
        agent={look}
        files={files}
        onBack={() => setPage("details")}
      />
    );
  if (page === "memory")
    return (
      <MemoryPage
        monoId={member.id}
        files={files}
        onBack={() => setPage("details")}
      />
    );
  return (
    <MonoSettingsPage
      monoId={member.id}
      agent={look}
      onBack={onBack}
      onOpen={setPage}
    >
      <dl className="px-4 py-3">
        <Property label="Model">
          <ModelPicker
            harness={profile.harness} model={profile.model} values={profile.modelSettings ?? {}}
            project={member.projects[0]} side="bottom" variant="plain" hideSettings
            onChange={(harness, model) => {
              onProfileChange?.({ harness, model });
              updateMono(member.id, value => ({ ...value, workerProfile: { harness, model } }));
              lockMonoField(member.id, "harness"); lockMonoField(member.id, "model");
            }}
            onSettingsChange={(modelSettings) => {
              onProfileChange?.({ ...profile, modelSettings });
              updateMono(member.id, value => ({ ...value, workerProfile: { ...profile, modelSettings } }));
              lockMonoField(member.id, "modelSettings");
            }}
          />
          <MonoFieldLock monoId={member.id} field="harness" />
          <MonoFieldLock monoId={member.id} field="model" />
          <MonoFieldLock monoId={member.id} field="modelSettings" />
        </Property>
        <ModelSettingRows harness={profile.harness} model={profile.model} values={profile.modelSettings ?? {}} side="bottom"
          onSettingsChange={modelSettings => {
            onProfileChange?.({ ...profile, modelSettings });
            updateMono(member.id, value => ({ ...value, workerProfile: { ...profile, modelSettings } }));
            lockMonoField(member.id, "modelSettings");
          }} row={({ label, control }) => <Property label={label}>{control}</Property>} />
        <Property label="Permissions">{onRuntimeModeChange && permissionMode ? <AccessPicker value={permissionMode} onChange={onRuntimeModeChange} side="bottom" variant="plain" /> : <span className="text-xs" title="Open this teammate's chat to view or change permissions">{permissionMode ? RUNTIME_MODE_LABEL[permissionMode] : "Open chat to view"}</span>}</Property>
        <Property label="Specialty">
          <input
            aria-label="Member specialty"
            value={member.specialty ?? ""}
            title={member.specialty ?? ""}
            maxLength={80}
            onChange={(event) => {
              try { if (event.target.value.trim()) {
                if (member.specialty?.toLowerCase() === "reviewer" && event.target.value.trim().toLowerCase() !== "reviewer" && !member.reviewer)
                  assertTeamRetire(listMonos(), member.reportsTo!, member.id);
                updateMono(member.id, (value) => ({
                  ...value,
                  specialty: event.target.value,
                }));
                lockMonoField(member.id, "specialty");
                setError(undefined);
              } } catch (error) { setError(String(error)); }
            }}
            className="min-w-0 flex-1 truncate rounded bg-transparent text-xs"
          />
          <MonoFieldLock monoId={member.id} field="specialty" />
        </Property>
      </dl>
      {error && <p role="alert" className="px-4 text-xs text-red-500">{error}</p>}
      <section className="border-t border-stroke px-4 py-3" aria-label="Member tasks">
        <h3 className="mb-2 text-xs text-content/60">Recent tasks</h3>
        {tasks.length ? tasks.map(task => (
          <button key={task.id} type="button" onClick={() => openCardSession(task.sessionId)}
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-content/5 focus-visible:outline-accent">
            <span className="min-w-0 flex-1 truncate" title={task.title}>{task.title}</span><span className="shrink-0 text-content/50">{managerTaskLifecycle(task, taskPrStatus(task, statuses), sessions.get(task.sessionId)?.needsInput)[0]}</span>
          </button>
        )) : <p className="text-xs text-content/50">No tasks yet. Your Manager assigns work here.</p>}
      </section>
    </MonoSettingsPage>
  );
}
