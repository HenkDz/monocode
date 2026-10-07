import { useState, useSyncExternalStore } from "react";
import {
  addTeamMember,
  findMono,
  listMonos,
  monoLook,
  monosSnapshot,
  removeMono,
  subscribeMonos,
  updateMono,
  type Mono,
} from "../model/mono";
import { PixelMascot } from "../../projects/ui/PixelMascot";
import { PageHeader, Property } from "./monoPanelParts";
import { ModelPicker } from "../../sessions/ui/ModelPicker";
import { MemoryPage, SoulPage } from "./MonoFilePages";
import { MonoSettingsPage } from "./MonoSettingsPage";
import { useMonoFiles } from "./MonoDetails";
import { orchestrator } from "../../orchestration/model/orchestration";
import { openCardSession } from "../model/monoCards";
import { memberTasks } from "../model/monoNavigation";

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
      for (const { run, task } of tasks)
        await orchestrator.cancelTask(run.leadId, task.id);
      removeMono(member.id);
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
                    ? member.sessionId && openCardSession(member.sessionId)
                    : select(member.id)
                }
              >
                <span className="block truncate">{look.name}</span>
                <span className="block truncate text-xs text-content/50">
                  {member.specialty ?? "Manager"} ·{" "}
                  {member.workerProfile?.model ?? fallback.model}
                </span>
              </button>
              {owner?.role === "manager" && (
                <button
                  type="button"
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
                const member = addTeamMember(monoId, name, specialty);
                updateMono(member.id, (value) => ({
                  ...value,
                  workerProfile: value.workerProfile ?? fallback,
                }));
                setName("");
                setSpecialty("");
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
}: {
  member: Mono;
  fallback: NonNullable<Mono["workerProfile"]>;
  onBack(): void;
  onProfileChange?: (profile: NonNullable<Mono["workerProfile"]>) => void;
}) {
  const [page, setPage] = useState("details");
  const runs = useSyncExternalStore(orchestrator.subscribe, orchestrator.snapshot, orchestrator.snapshot);
  const tasks = memberTasks(runs, member.id).slice(0, 8);
  const files = useMonoFiles(member.id, "idle");
  const look = monoLook(member);
  const profile = member.workerProfile ?? fallback;
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
        <Property label="Specialty">
          <input
            aria-label="Member specialty"
            value={member.specialty ?? ""}
            maxLength={80}
            onChange={(event) => {
              if (event.target.value.trim())
                updateMono(member.id, (value) => ({
                  ...value,
                  specialty: event.target.value,
                }));
            }}
            className="min-w-0 rounded bg-transparent text-xs"
          />
        </Property>
        <Property label="Model">
          <ModelPicker
            harness={profile.harness}
            model={profile.model}
            values={profile.modelSettings ?? {}}
            project={member.projects[0]}
            side="bottom"
            variant="plain"
            onChange={(harness, model) => {
              onProfileChange?.({ harness, model });
              updateMono(member.id, (value) => ({
                ...value,
                workerProfile: { harness, model },
              }));
            }}
            onSettingsChange={(modelSettings) => {
              onProfileChange?.({ ...profile, modelSettings });
              updateMono(member.id, (value) => ({
                ...value,
                workerProfile: { ...profile, modelSettings },
              }));
            }}
          />
        </Property>
      </dl>
      <section className="border-t border-stroke px-4 py-3" aria-label="Member tasks">
        <h3 className="mb-2 text-xs text-content/60">Recent tasks</h3>
        {tasks.length ? tasks.map(task => (
          <button key={task.id} type="button" onClick={() => openCardSession(task.sessionId)}
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-content/5 focus-visible:outline-accent">
            <span className="min-w-0 flex-1 truncate">{task.title}</span><span className="text-content/50">{task.status}</span>
          </button>
        )) : <p className="text-xs text-content/50">No tasks yet. Your Manager assigns work here.</p>}
      </section>
    </MonoSettingsPage>
  );
}
