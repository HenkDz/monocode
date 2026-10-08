import {
  useEffect,
  useId,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import type { HarnessId, RuntimeMode } from "../../sessions/model/session";
import { AccessPicker } from "../../sessions/ui/AccessPicker";
import { ModelPicker, ModelSettingRows } from "../../sessions/ui/ModelPicker";
import type { MonoLook, MonoState } from "../model/mono";
import {
  loadMonoFiles,
  subscribeMonoFiles,
  type MonoFiles,
} from "../model/monoFiles";
import { IconButton } from "../../../app/shell/TitleBar";
import { Plus } from "../../../shared/ui/icons";
import { HABITS_MAX } from "../model/monoHabits";
import { memoryLines } from "../model/monoMemory";
import { HabitPage } from "./HabitPage";
import { NewHabitPage } from "./NewHabitPage";
import { MonoProjects } from "./MonoProjects";
import { MonoSettingsPage } from "./MonoSettingsPage";
import { MonoTeamPage, MemberDetails } from "./MonoTeamPage";
import { findMono, listMonos } from "../model/mono";
import { orgDescendants } from "../model/monoTeamActivity";
import { habitActions, HabitsList, useHabits } from "./MonoHabits";
import { MemoryPage, SoulPage } from "./MonoFilePages";
import {
  MonoPanelTabs,
  PageHeader,
  Property,
  type MonoPanelTab,
} from "./monoPanelParts";
import { MonoActivityContent } from "./MonoActivityPanel";
import { PanelStack, type StackPage } from "./PanelStack";
import { MonoCodexStorageSource } from "./MonoCodexStorageSource";
import { MonoSidebar, MonoSidebarHeader } from "./MonoSidebar";
import { ArchivedManagerConversation, ArchivedManagerConversations } from "./ArchivedManagerConversations";
import { PullRequestsList } from "../../pullRequests/ui/PullRequestsList";
import type { PullRequestContext } from "../../pullRequests/model/pullRequestView";

/** A page opened directly from Details, or one habit inside its list. */
type Route =
  | { kind: "habits" | "soul" | "memory" | "new-habit" | "team" }
  | { kind: "habit" | "archive"; id: string };

type Props = {
  sessions?: PullRequestContext["sessions"];
  runs?: PullRequestContext["runs"];
  teamActivity?: ReactNode;
  toolActivityOpen?: boolean;
  tab?: MonoPanelTab;
  onTabChange?: (tab: MonoPanelTab) => void;
  activity?: ComponentProps<typeof MonoActivityContent>;
  teamRequest?: number;
  open: boolean;
  monoId: string;
  sessionId?: string;
  providerAccountId?: string;
  /** Its conversation's folder, which the model picker reads settings from. */
  cwd: string;
  agent: MonoLook;
  state: MonoState;
  harness: HarnessId;
  model: string;
  modelSettings: Record<string, string>;
  runtimeMode: RuntimeMode;
  busy?: boolean;
  onModelChange: (harness: HarnessId, model: string) => void;
  onModelSettingsChange: (settings: Record<string, string>) => void;
  onRuntimeModeChange: (mode: RuntimeMode) => void;
  onClose: () => void;
  onReset?: () => Promise<void>;
  windowControls?: ReactNode;
};

/**
 * The Mono's profile, model, permissions and projects in one panel. Its habits,
 * soul and memory open directly as pages that slide over it.
 */
export function MonoDetails({
  sessions,
  runs,
  teamActivity,
  toolActivityOpen,
  tab = "details",
  onTabChange,
  activity,
  teamRequest,
  open,
  monoId,
  sessionId,
  providerAccountId,
  cwd,
  agent,
  state,
  harness,
  model,
  modelSettings,
  runtimeMode,
  onModelChange,
  onModelSettingsChange,
  onRuntimeModeChange,
  onClose,
  onReset,
  windowControls,
}: Props) {
  const panelId = useId();
  const mono = findMono(monoId);
  const roster = listMonos();
  const orgIds = orgDescendants(roster, monoId);
  const orgProjects = [...new Set(roster.filter(entry => orgIds.has(entry.id))
    .flatMap(entry => [...entry.projects, ...(entry.managerProject ? [entry.managerProject] : [])]))];
  const files = useMonoFiles(monoId, state.status);
  const habits = useHabits(monoId, state.status);
  const actions = habitActions(monoId);
  const [routes, setRoutes] = useState<Route[]>([]);
  const [showWork, setShowWork] = useState(false);
  useEffect(() => {
    setShowWork(Boolean(toolActivityOpen));
  }, [monoId, toolActivityOpen, activity?.blocks[0]?.id]);
  // Another Mono starts at its own front page.
  useEffect(() => setRoutes([]), [monoId]);
  useEffect(() => {
    if (teamRequest) setRoutes([{ kind: "team" }]);
  }, [teamRequest]);
  const push = (route: Route) => setRoutes((current) => [...current, route]);
  const back = () => setRoutes((current) => current.slice(0, -1));

  const pages: StackPage[] = routes.flatMap((route, depth): StackPage[] => {
    if (route.kind === "archive") return [{ key: `archive:${route.id}`, node: <ArchivedManagerConversation id={route.id} onBack={back} /> }];
    if (route.kind === "team")
      return [
        {
          key: "team",
          node: (
            <MonoTeamPage
              monoId={monoId}
              fallback={{ harness, model, modelSettings }}
              onBack={back}
            />
          ),
        },
      ];
    if (route.kind === "habits")
      return [
        {
          key: "habits",
          node: (
            <div className="flex min-h-0 flex-1 flex-col" data-mono-habits>
              <PageHeader title="Habits" onBack={back}>
                <IconButton
                  label={
                    (habits?.length ?? 0) >= HABITS_MAX
                      ? `At most ${HABITS_MAX} habits`
                      : "New habit"
                  }
                  disabled={!habits || habits.length >= HABITS_MAX}
                  onClick={() => push({ kind: "new-habit" })}
                >
                  <Plus className="size-3.5" strokeWidth={1.75} />
                </IconButton>
              </PageHeader>
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-none px-2 py-2">
                <HabitsList
                  habits={habits}
                  actions={actions}
                  onOpen={(id) => push({ kind: "habit", id })}
                />
              </div>
            </div>
          ),
        },
      ];
    if (route.kind === "soul")
      return [
        {
          key: "soul",
          node: (
            <SoulPage
              monoId={monoId}
              agent={agent}
              files={files}
              onBack={back}
            />
          ),
        },
      ];
    if (route.kind === "memory")
      return [
        {
          key: "memory",
          node: <MemoryPage monoId={monoId} files={files} onBack={back} />,
        },
      ];
    if (route.kind === "new-habit")
      return [
        {
          key: "new-habit",
          node: <NewHabitPage monoId={monoId} onBack={back} onCreated={back} />,
        },
      ];
    if (route.kind !== "habit") return [];
    // A habit removed while open closes its page.
    const habit = habits?.find((entry) => entry.id === route.id);
    if (!habit) return [];
    return [
      {
        key: `habit:${route.id}:${depth}`,
        node: (
          <HabitPage
            habit={habit}
            color={agent.color}
            cwd={cwd}
            onBack={back}
            onRunNow={() => actions.runNow(habit.id)}
            onToggle={() => actions.toggle(habit.id)}
            onRemove={() => {
              actions.remove(habit.id);
              back();
            }}
          />
        ),
      },
    ];
  });

  return (
    <MonoSidebar
      open={open}
      kind={tab}
      label={`${agent.name} ${tab}`}
      color={agent.color}
      windowControls={windowControls}
    >
      <MonoSidebarHeader
        title={tab === "details" ? "Details" : tab === "activity" ? "Activity" : "PRs"}
        onClose={onClose}
      >
        {onTabChange ? (
          <MonoPanelTabs
            active={tab}
            onChange={onTabChange}
            panelId={panelId}
          />
        ) : undefined}
      </MonoSidebarHeader>
      <div
        id={panelId}
        role="tabpanel"
        aria-labelledby={onTabChange ? `${panelId}-${tab}` : undefined}
        className="flex min-h-0 flex-1 flex-col"
      >
        <PanelStack pages={tab === "details" ? pages : tab === "activity" && showWork && teamActivity ? [{
          key: "work",
          node: <div className="flex min-h-0 flex-1 flex-col" data-mono-work>
            <PageHeader title="This agent's work" onBack={() => setShowWork(false)} />
            <div className="min-h-0 flex-1 overflow-y-auto">
              <MonoActivityContent {...(activity ?? { blocks: [], live: false })} readOutput />
            </div>
          </div>,
        }] : []}>
          {tab === "prs" ? (
            <PullRequestsList compact sessions={sessions} runs={runs} scope={mono?.role === "manager"
              ? { project: mono.managerProject ?? mono.projects[0] ?? cwd }
              : mono?.role === "orchestrator"
                ? { projects: orgProjects }
                : mono?.role === "member"
                  ? { monoId }
                  : sessionId ? { sessionId } : { cwd }} />
          ) : tab === "activity" ? (
            <div className="min-h-0 flex-1 overflow-y-auto">
            {teamActivity}
            {teamActivity ? <div className="border-t border-stroke p-3">
              <button type="button" onClick={() => setShowWork(true)} className="rounded-md px-2 py-1.5 text-xs text-content/60 hover:bg-content/5 hover:text-content focus-visible:outline-accent">Show work</button>
            </div> : <MonoActivityContent
              key={activity?.blocks[0]?.id ?? "empty"}
              {...(activity ?? { blocks: [], live: false })}
            />}
            </div>
          ) : findMono(monoId)?.role === "member" ? (
            <MemberDetails member={findMono(monoId)!} fallback={{ harness, model, modelSettings }} onBack={onClose} providerAccountId={providerAccountId} runtimeMode={runtimeMode} onRuntimeModeChange={onRuntimeModeChange} onProfileChange={profile => { onModelChange(profile.harness, profile.model); onModelSettingsChange(profile.modelSettings ?? {}); }} />
          ) : (
            <MonoSettingsPage
              monoId={monoId}
              agent={agent}
              onOpen={(page) => push({ kind: page })}
              onReset={onReset}
              counts={{
                habits: habits?.length,
                memory: files ? memoryLines(files.memory).length : undefined,
              }}
            >
              <dl className="flex flex-col gap-0.5 border-t border-stroke px-4 py-3">
                <Property label="Model">
                  <ModelPicker
                    harness={harness}
                    model={model}
                    values={modelSettings}
                    project={cwd}
                    hideSettings
                    side="bottom"
                    variant="plain"
                    onChange={onModelChange}
                    onSettingsChange={onModelSettingsChange}
                  />
                </Property>
                <MonoCodexStorageSource harness={harness} providerAccountId={providerAccountId} cwd={cwd} />
                <ModelSettingRows
                  harness={harness}
                  model={model}
                  values={modelSettings}
                  side="bottom"
                  onSettingsChange={onModelSettingsChange}
                  row={({ label, control }) => (
                    <Property label={label}>{control}</Property>
                  )}
                />
                {runtimeMode && onRuntimeModeChange && (
                  <Property label="Permissions">
                    <AccessPicker
                      value={runtimeMode}
                      onChange={onRuntimeModeChange}
                      side="bottom"
                      variant="plain"
                    />
                  </Property>
                )}
                <Property label="Projects">
                  {findMono(monoId)?.role === "manager" ? (
                    <span className="text-xs">{agent.projects[0]?.name}</span>
                  ) : (
                    <MonoProjects monoId={monoId} projects={agent.projects} />
                  )}
                </Property>
              </dl>
              {findMono(monoId)?.role === "manager" && <ArchivedManagerConversations project={agent.projects[0]?.path ?? cwd} onOpen={id => push({ kind: "archive", id })} />}
            </MonoSettingsPage>
          )}
        </PanelStack>
      </div>
    </MonoSidebar>
  );
}

/** The agent's files, reloaded when it finishes a turn or the app regains focus. */
export function useMonoFiles(
  monoId: string,
  status: MonoState["status"],
): MonoFiles | undefined {
  const [files, setFiles] = useState<MonoFiles>();
  const working = status === "working";
  useEffect(() => {
    let live = true;
    const refresh = () => {
      void loadMonoFiles(monoId)
        .then((next) => {
          if (live) setFiles(next);
        })
        .catch((error) =>
          console.warn("Could not load the Mono's files", error),
        );
    };
    refresh();
    const stop = subscribeMonoFiles(refresh);
    window.addEventListener("focus", refresh);
    return () => {
      live = false;
      stop();
      window.removeEventListener("focus", refresh);
    };
    // A turn ending is when the agent may have written to its memory.
  }, [monoId, working]);
  return files;
}
