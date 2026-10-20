import {
  useEffect,
  useId,
  useState,
  useSyncExternalStore,
  type ComponentProps,
  type ReactNode,
} from "react";
import type { HarnessId, RuntimeMode, Session } from "../../sessions/model/session";
import { ModelPicker, ModelSettingRows } from "../../sessions/ui/ModelPicker";
import { getModelSnapshot, modelEffortSetting, subscribeModels, type EffortSource } from "../../sessions/model/models";
import { useModelSource } from "../../sessions/ui/modelSource";
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
import { MonoPreferencesPage } from "./MonoPreferencesPage";
import { MonoSettingsPage } from "./MonoSettingsPage";
import { MonoTeamPage, MemberDetails } from "./MonoTeamPage";
import { findMono, listMonos, monosSnapshot, subscribeMonos, updateMono } from "../model/mono";
import { resetMonoRoleEffort, resolveMonoRoleEffort } from "../model/monoRoleEffort";
import { lockMonoField } from "../model/monoTeam";
import { MonoRoleEffort } from "./MonoRoleEffort";
import { resolveMonoRolePermissions } from "../model/monoRolePermissions";
import { MonoPermissions } from "./MonoPermissions";
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
import { MonoSkillsSettings } from "./MonoSkillsSettings";
import { MonoSidebar, MonoSidebarHeader } from "./MonoSidebar";
import { ArchivedManagerConversation, ArchivedManagerConversations } from "./ArchivedManagerConversations";
import { PullRequestsList } from "../../pullRequests/ui/PullRequestsList";
import type { PullRequestContext } from "../../pullRequests/model/pullRequestView";
import { pickFolders } from "../../../platform/tauri/fs";

/** A page opened directly from Details, or one habit inside its list. */
type Route =
  | { kind: "habits" | "soul" | "memory" | "new-habit" | "team" | "settings" | "settings" }
  | { kind: "habit" | "archive"; id: string };

type Props = {
  embedded?: boolean;
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
  effortSource?: EffortSource;
  runtimeMode: RuntimeMode;
  runtimeModeSource?: Session["runtimeModeSource"];
  windowsSandbox?: Session["windowsSandbox"];
  readOnly?: boolean;
  busy?: boolean;
  onWorkingDirectoryChange?: (cwd: string) => Promise<void>;
  onModelChange: (harness: HarnessId, model: string) => void;
  onModelSettingsChange: (settings: Record<string, string>, effortSource?: EffortSource) => void;
  onRuntimeModeChange: (mode: RuntimeMode, source?: Session["runtimeModeSource"]) => void;
  onWindowsSandboxChange?: (engine: Session["windowsSandbox"]) => void | Promise<void>;
  onClose: () => void;
  onReset?: () => Promise<void>;
  windowControls?: ReactNode;
};

/**
 * The Mono's profile, model, permissions and projects in one panel. Its habits,
 * soul, memory and settings open directly as pages that slide over it.
 */
export function MonoDetails({
  embedded = false,
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
  effortSource: sessionEffortSource,
  runtimeMode,
  runtimeModeSource,
  windowsSandbox,
  readOnly,
  busy,
  onWorkingDirectoryChange,
  onModelChange,
  onModelSettingsChange,
  onRuntimeModeChange,
  onWindowsSandboxChange,
  onClose,
  onReset,
  windowControls,
}: Props) {
  const panelId = useId();
  useSyncExternalStore(subscribeMonos, monosSnapshot);
  useSyncExternalStore(subscribeModels, getModelSnapshot);
  const mono = findMono(monoId);
  const permissions = mono ? resolveMonoRolePermissions(sessionId ? { ...mono, runtimeModeSource } : mono, runtimeMode) : { runtimeMode, runtimeModeSource };
  const currentModel = useModelSource().resolve(harness, model);
  const effortSetting = modelEffortSetting(currentModel);
  const effective = mono ? resolveMonoRoleEffort(sessionId ? { ...mono, effortSource: sessionEffortSource } : mono, currentModel, modelSettings) : { modelSettings, effortSource: undefined };
  const changeSettings = (settings: Record<string, string>, settingId?: string) => {
    const effortSource = settingId === effortSetting?.id && settingId ? "user" : effective.effortSource;
    if (mono) {
      updateMono(mono.id, value => ({ ...value, workerProfile: { harness, model, modelSettings: settings }, effortSource }));
      lockMonoField(mono.id, "modelSettings");
    }
    onModelSettingsChange(settings, effortSource);
  };
  const resetEffort = () => {
    if (!mono) return;
    const reset = resetMonoRoleEffort(mono, currentModel, effective.modelSettings);
    updateMono(mono.id, value => ({ ...value, effortSource: reset.effortSource, userLockedFields: reset.userLockedFields, workerProfile: { harness, model, modelSettings: reset.modelSettings } }));
    onModelSettingsChange(reset.modelSettings, reset.effortSource);
  };
  const effortControl = (control?: ReactNode) => mono ? <MonoRoleEffort mono={mono} model={currentModel} values={effective.modelSettings} source={effective.effortSource} onReset={resetEffort}>{control}</MonoRoleEffort> : control;
  const roster = listMonos();
  const orgIds = orgDescendants(roster, monoId);
  const orgProjects = [...new Set(roster.filter(entry => orgIds.has(entry.id))
    .flatMap(entry => [...entry.projects, ...(entry.managerProject ? [entry.managerProject] : [])]))];
  const worktreeCwd = sessions?.find(session => session.id === sessionId)?.worktreeCwd ?? cwd;
  const files = useMonoFiles(monoId, state.status);
  const habits = useHabits(monoId, state.status);
  const actions = habitActions(monoId);
  const [routes, setRoutes] = useState<Route[]>([]);
  const [showWork, setShowWork] = useState(false);
  const [changingFolder, setChangingFolder] = useState(false);
  const [folderError, setFolderError] = useState<string>();
  const changeFolder = async () => {
    if (!onWorkingDirectoryChange || busy || changingFolder) return;
    setChangingFolder(true);
    setFolderError(undefined);
    try {
      const folders = await pickFolders("Choose working folder");
      if (folders.length > 1) throw new Error("Choose one working folder.");
      if (folders[0]) await onWorkingDirectoryChange(folders[0]);
    } catch (error) { setFolderError(error instanceof Error ? error.message : String(error)); }
    finally { setChangingFolder(false); }
  };
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
    if (route.kind === "settings")
      return [
        {
          key: "settings",
          node: (
            <MonoPreferencesPage
              monoId={monoId}
              agent={agent}
              onBack={back}
              onReset={onReset}
            />
          ),
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

  const content = <>
      {!embedded && <MonoSidebarHeader
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
      </MonoSidebarHeader>}
      <div
        id={panelId}
        role="tabpanel"
        aria-labelledby={!embedded && onTabChange ? `${panelId}-${tab}` : undefined}
        className="flex min-h-0 flex-1 flex-col"
      >
        {tab === "details" && pages.length === 0 && <div className="shrink-0 border-b border-stroke px-4 py-3 text-xs text-content/70" data-mono-next-turn>
          <p>Model and effort changes apply to the next turn.</p>
          <p className="mt-2 flex min-w-0 items-center gap-2"><span className="shrink-0 text-content/50">Working folder</span><span className="min-w-0 flex-1 truncate" title={worktreeCwd} data-mono-worktree>{worktreeCwd}</span>{onWorkingDirectoryChange && <button type="button" aria-label="Change working folder" disabled={busy || changingFolder} onClick={() => void changeFolder()} className="shrink-0 rounded px-1 py-0.5 text-content/70 hover:bg-content/5 focus-visible:outline-accent disabled:opacity-40">Change</button>}</p>
          {folderError && <p role="alert" data-mono-folder-error className="mt-2 text-danger">{folderError}</p>}
        </div>}
        <PanelStack pages={tab === "details" ? pages : tab === "activity" && showWork && teamActivity ? [{
          key: "work",
          node: <div className="flex min-h-0 flex-1 flex-col" data-mono-work>
            <PageHeader title="This agent's work" onBack={() => setShowWork(false)} />
            <MonoActivityContent {...(activity ?? { blocks: [], live: false })} readOutput />
          </div>,
        }] : []}>
          {tab === "prs" ? (
            <PullRequestsList compact sessions={sessions} runs={runs} scopeLabel={`${agent.name} pull requests`} scope={mono?.role === "manager"
              ? { project: mono.managerProject ?? mono.projects[0] ?? cwd }
              : mono?.role === "orchestrator"
                ? { projects: orgProjects }
                : mono?.role === "member"
                  ? { monoId }
                  : sessionId ? { sessionId } : { cwd }} />
          ) : tab === "activity" ? (
            teamActivity ? <div className="min-h-0 flex-1 overflow-y-auto">
              {teamActivity}
              <div className="border-t border-stroke p-3">
                <button type="button" onClick={() => setShowWork(true)} className="rounded-md px-2 py-1.5 text-xs text-content/60 hover:bg-content/5 hover:text-content focus-visible:outline-accent">Show work</button>
              </div>
            </div> : <MonoActivityContent
              key={activity?.blocks[0]?.id ?? "empty"}
              {...(activity ?? { blocks: [], live: false })}
            />
          ) : findMono(monoId)?.role === "member" ? (
            <MemberDetails member={findMono(monoId)!} fallback={{ harness, model, modelSettings }} conversationProfile={{ harness, model, modelSettings }} conversationEffortSource={sessionId ? sessionEffortSource : effective.effortSource} onBack={onClose} providerAccountId={providerAccountId} runtimeMode={permissions.runtimeMode} runtimeModeSource={permissions.runtimeModeSource} windowsSandbox={sessionId ? windowsSandbox : windowsSandbox ?? mono?.windowsSandbox} readOnly={readOnly} busy={busy} onRuntimeModeChange={onRuntimeModeChange} onWindowsSandboxChange={onWindowsSandboxChange} onProfileChange={(profile, effortSource) => { if (profile.harness !== harness || profile.model !== model) onModelChange(profile.harness, profile.model); onModelSettingsChange(profile.modelSettings ?? {}, effortSource); }} />
          ) : (
            <MonoSettingsPage
              monoId={monoId}
              agent={agent}
              onOpen={(page) => push({ kind: page })}
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
                    values={effective.modelSettings}
                    project={cwd}
                    hideSettings
                    side="bottom"
                    variant="plain"
                    onChange={onModelChange}
                    onSettingsChange={changeSettings}
                  />
                </Property>
                <MonoCodexStorageSource harness={harness} providerAccountId={providerAccountId} cwd={cwd} />
                <ModelSettingRows
                  harness={harness}
                  model={model}
                  values={effective.modelSettings}
                  side="bottom"
                  onSettingsChange={changeSettings}
                  row={({ id, label, control }) => (
                    <Property label={label}>{id === effortSetting?.id ? effortControl(control) : control}</Property>
                  )}
                />
                {mono && !effortSetting && <Property label="Effort">{effortControl()}</Property>}
                <MonoPermissions key={monoId} mono={mono} harness={harness} runtimeMode={permissions.runtimeMode} runtimeModeSource={permissions.runtimeModeSource} windowsSandbox={sessionId ? windowsSandbox : windowsSandbox ?? mono?.windowsSandbox} readOnly={readOnly} busy={busy} onRuntimeModeChange={onRuntimeModeChange} onWindowsSandboxChange={onWindowsSandboxChange} />
                <Property label="Projects">
                  {findMono(monoId)?.role === "manager" ? (
                    <span className="text-xs">{agent.projects[0]?.name}</span>
                  ) : (
                    <MonoProjects monoId={monoId} projects={agent.projects} />
                  )}
                </Property>
              </dl>
              <MonoSkillsSettings monoId={monoId} harness={harness} providerAccountId={providerAccountId} cwd={cwd} />
              {findMono(monoId)?.role === "manager" && <ArchivedManagerConversations project={agent.projects[0]?.path ?? cwd} onOpen={id => push({ kind: "archive", id })} />}
            </MonoSettingsPage>
          )}
        </PanelStack>
      </div>
    </>;
  return embedded ? <section data-mono-details data-open={open} aria-label={`${agent.name} details and settings`} className="flex min-h-0 flex-1 flex-col">{content}</section> : (
    <MonoSidebar open={open} kind={tab} label={`${agent.name} ${tab}`} color={agent.color} windowControls={windowControls}>{content}</MonoSidebar>
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
