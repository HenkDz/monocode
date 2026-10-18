import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { useProjectBranchesState } from "../hooks/useProjectBranches";
import { LAYER } from "../../../shared/lib/layers";
import {
  createWorktree,
  normalizeWorktreeBranch,
  temporaryWorktreeBranchName,
  type Worktree,
  type WorktreeCreationOptions,
} from "../model/worktrees";
import { prettyCwd, projectName } from "../../../shared/lib/paths";
import { Modal } from "../../../shared/ui/Modal";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { GitBranch, Loader } from "../../../shared/ui/icons";
import {
  defaultSessionChoice,
  preferredModelSettings,
  resolveModel,
} from "../../sessions/model/models";
import { ModelControlPills, ModelPicker } from "../../sessions/ui/ModelPicker";
import { Popover } from "../../../shared/ui/Popover";
import { parseGithubWorkItemUrl } from "../../sessions/model/sessionWorkItem";
import type { LinkedWorkItem } from "../../sessions/model/session";
import {
  githubRepo,
  githubWorkItem,
  listGithubWorkItems,
  type GithubWorkItem,
} from "../../inbox/model/githubTasks";

type Source = "smart" | "branch" | "github";

export function CreateWorktreeDialog({
  cwd,
  baseCwd,
  defaultRoot,
  worktrees = [],
  sessionOptions = false,
  onCreated,
  onCancel,
}: {
  cwd: string;
  baseCwd: string;
  defaultRoot?: string;
  worktrees?: readonly Worktree[];
  /** Only surfaces which create a fresh session offer agent/prompt controls. */
  sessionOptions?: boolean;
  onCreated: (
    tree: Worktree,
    options: WorktreeCreationOptions,
  ) => void | Promise<void>;
  onCancel: () => void;
}) {
  const { branches } = useProjectBranchesState(baseCwd, true);
  const [source, setSource] = useState<Source>("smart");
  const [name, setName] = useState("");
  const [override, setOverride] = useState("");
  const [automaticName, setAutomaticName] = useState(
    temporaryWorktreeBranchName,
  );
  const [base, setBase] = useState("HEAD");
  const [choice, setChoice] = useState(() => defaultSessionChoice(cwd));
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [prompt, setPrompt] = useState("");
  const [keepOpen, setKeepOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [lookingUp, setLookingUp] = useState(false);
  const [results, setResults] = useState<GithubWorkItem[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchError, setSearchError] = useState<string>();
  const [activeResult, setActiveResult] = useState(0);
  const resultsId = useId();
  const activeOption = useRef<HTMLButtonElement>(null);
  const [linked, setLinked] = useState<LinkedWorkItem & { title: string }>();
  const [error, setError] = useState<string>();
  const [created, setCreated] = useState<string>();
  const input = useRef<HTMLInputElement>(null);
  const lookupRequest = useRef(0);
  const submitting = useRef(false);
  useEffect(
    () => () => {
      lookupRequest.current++;
    },
    [],
  );
  useEffect(() => {
    if (source === "branch") return;
    const frame = requestAnimationFrame(() => input.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [source, created]);
  const existing = source === "branch";
  const githubInput =
    source === "github" ||
    (!existing &&
      /^(?:https?:\/\/|#|(?:issue|pr)\s*#?\s*\d)/i.test(name.trim()));
  const suggested = linked
    ? `${linked.kind}-${linked.number}-${linked.title}`
    : name.trim();
  const branch = existing
    ? name
    : normalizeWorktreeBranch(override.trim() || suggested || automaticName);
  const conflict =
    branch &&
    (existing
      ? worktrees.some((tree) => tree.branch === branch) ||
        branches?.current === branch
      : branches?.branches.some(
          (item) => !item.remote && item.name === branch,
        ));
  const validation = conflict
    ? existing
      ? "This branch already has a working copy. Choose it in the sidebar instead."
      : "This branch already exists. Choose Existing branch or use another name."
    : !branch
      ? "Enter a name containing letters or numbers."
      : undefined;
  const locked = busy;
  const localBranches = useMemo(
    () =>
      (branches?.branches ?? [])
        .filter((item) => !item.remote)
        .map((item) => ({ value: item.name, label: item.name })),
    [branches],
  );
  const baseOptions = useMemo(
    () => [
      {
        value: "HEAD",
        label: `Current commit${branches?.current ? ` (${branches.current})` : ""}`,
        keywords: "HEAD current commit",
      },
      ...(branches?.branches ?? []).map((item) => {
        const ref = item.remote ? `${item.remote}/${item.name}` : item.name;
        return { value: ref, label: ref };
      }),
    ],
    [branches],
  );
  const changeInput = (value: string) => {
    lookupRequest.current++;
    setLookingUp(false);
    setResults([]);
    setActiveResult(0);
    setSearchError(undefined);
    setSearchOpen(true);
    setLinked(undefined);
    setError(undefined);
    setCreated(undefined);
    setName(value);
  };
  const selectGithubItem = (item: GithubWorkItem) => {
    lookupRequest.current++;
    setName(item.url);
    setLinked({
      kind: item.kind,
      repo: item.repo,
      number: item.number,
      url: item.url,
      title: item.title,
    });
    setSearchOpen(false);
    setLookingUp(false);
    setSearchError(undefined);
  };
  useEffect(() => {
    const request = ++lookupRequest.current;
    if (!githubInput || linked) return;
    setLookingUp(true);
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const text = name.trim();
          let item = parseGithubWorkItemUrl(text);
          const number = /^(?:(issue|pr)\s*)?#?(\d+)$/i.exec(text);
          if (!item && /^https?:\/\//i.test(text))
            throw new Error("Paste a full GitHub issue or PR URL.");
          const repo = item?.repo ?? (await githubRepo(baseCwd));
          if (request !== lookupRequest.current) return;
          if (!repo)
            throw new Error(
              "This project has no GitHub repository. Paste a full GitHub URL.",
            );
          if (!item && number) {
            const value = Number(number[2]);
            if (!Number.isSafeInteger(value) || value < 1)
              throw new Error("Enter a valid issue or PR number.");
            const kind = number[1]?.toLowerCase() === "pr" ? "pr" : "issue";
            item = {
              repo,
              kind,
              number: value,
              url: `https://github.com/${repo}/${kind === "pr" ? "pull" : "issues"}/${value}`,
            };
          }
          if (item) {
            const details = await githubWorkItem(
              baseCwd,
              item.repo,
              item.kind,
              item.number,
            );
            if (request === lookupRequest.current)
              setLinked({ ...item, title: details.title });
          } else {
            const query = {
              assignedToMe: false,
              state: "open" as const,
              search: text,
            };
            const matches = await Promise.allSettled([
              listGithubWorkItems(baseCwd, repo, { ...query, kind: "issue" }),
              listGithubWorkItems(baseCwd, repo, { ...query, kind: "pr" }),
            ]);
            if (request === lookupRequest.current) {
              setResults(
                matches
                  .flatMap((match) =>
                    match.status === "fulfilled" ? match.value : [],
                  )
                  .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
                  .slice(0, 12),
              );
              setSearchError(
                matches
                  .flatMap((match) =>
                    match.status === "rejected" ? [String(match.reason)] : [],
                  )
                  .join("\n") || undefined,
              );
            }
          }
        } catch (err) {
          if (request === lookupRequest.current) setSearchError(String(err));
        } finally {
          if (request === lookupRequest.current) setLookingUp(false);
        }
      })();
    }, 300);
    return () => {
      clearTimeout(timer);
      if (request === lookupRequest.current) lookupRequest.current++;
    };
  }, [baseCwd, githubInput, name, linked]);
  useEffect(() => {
    if (searchOpen) activeOption.current?.scrollIntoView({ block: "nearest" });
  }, [activeResult, searchOpen, results]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting.current || locked || validation || (githubInput && !linked))
      return;
    submitting.current = true;
    setBusy(true);
    setError(undefined);
    let tree: Worktree | undefined;
    try {
      tree = await createWorktree(baseCwd, branch, base, existing);
      const context = linked
        ? `${linked.title ?? "GitHub item"}\n${linked.url}`
        : "";
      await onCreated(tree, {
        keepOpen,
        session: sessionOptions
          ? {
              ...choice,
              modelSettings: preferredModelSettings(
                resolveModel(choice.harness, choice.model),
                settings,
              ),
              linkedWorkItem: linked,
              composerSeed:
                [context, prompt.trim()].filter(Boolean).join("\n\n") ||
                undefined,
            }
          : undefined,
      });
      if (keepOpen) {
        changeInput("");
        setOverride("");
        setPrompt("");
        setAutomaticName(temporaryWorktreeBranchName());
        setCreated(`Created ${tree.branch ?? branch}`);
      }
    } catch (err) {
      if (tree) {
        // Creation succeeded: never retry Git just because opening/refreshing failed.
        changeInput("");
        setOverride("");
        setAutomaticName(temporaryWorktreeBranchName());
        setCreated(
          `Created ${tree.branch ?? branch}. Open it from the sidebar.`,
        );
      }
      setError(
        tree
          ? `Worktree created, but could not open it: ${String(err)}`
          : String(err),
      );
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };
  const field =
    "h-9 w-full rounded-md border border-content/20 bg-background-base px-3 text-sm outline-none focus:border-content/50 disabled:opacity-50";
  return (
    <Modal
      title="Create worktree"
      size="md"
      fitViewport
      onClose={() => {
        if (!busy) onCancel();
      }}
    >
      <form
        className="flex flex-col gap-4 p-4 text-xs"
        onSubmit={(event) => void submit(event)}
      >
        <div className="flex items-center gap-3 rounded-lg bg-content/5 p-3">
          <GitBranch className="size-4 shrink-0 text-content/60" />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{projectName(cwd)}</p>
            <p className="break-all text-content/60">{prettyCwd(cwd)}</p>
          </div>
        </div>
        <p className="text-content/60">
          An independent working copy. Uncommitted changes and running sessions
          stay where they are.
        </p>
        <div className="flex flex-col gap-2">
          <span className="font-medium">Create from</span>
          <div
            role="group"
            aria-label="Creation source"
            className="flex gap-1 rounded-lg bg-content/5 p-1"
          >
            {(
              [
                ["smart", "Smart"],
                ["github", "GitHub"],
                ["branch", "Existing branch"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                disabled={locked}
                aria-pressed={source === value}
                onClick={() => {
                  setSource(value);
                  changeInput("");
                  setOverride("");
                }}
                className={`flex-1 rounded-md px-3 py-2 font-medium disabled:opacity-50 ${source === value ? "bg-content/10 text-content" : "text-content/60 hover:bg-content/5"}`}
              >
                {label}
              </button>
            ))}
          </div>
          {existing ? (
            <SearchableSelect
              label="Existing branch"
              value={name}
              disabled={locked}
              options={localBranches}
              onChange={changeInput}
              placeholder="Choose a branch…"
              searchPlaceholder="Search local branches…"
              emptyLabel="No matching local branches"
              layer={LAYER.dialogPopover}
            />
          ) : (
            <input
              ref={input}
              aria-label={
                source === "github"
                  ? "GitHub issue or pull request"
                  : "Worktree name"
              }
              className={field}
              value={name}
              disabled={busy}
              placeholder={
                source === "github"
                  ? "Search issues and PRs, paste a URL, or #123"
                  : "A task name, GitHub URL, or #123 — optional"
              }
              autoComplete="off"
              spellCheck={false}
              role={githubInput ? "combobox" : undefined}
              aria-autocomplete={githubInput ? "list" : undefined}
              aria-expanded={githubInput ? searchOpen && !linked : undefined}
              aria-controls={
                githubInput && searchOpen && !linked ? resultsId : undefined
              }
              aria-activedescendant={
                searchOpen && results[activeResult]
                  ? `${resultsId}-${activeResult}`
                  : undefined
              }
              data-worktree-github-search
              data-dialog-popover={
                (githubInput && searchOpen && !linked) || undefined
              }
              onFocus={() => setSearchOpen(true)}
              onKeyDown={(event) => {
                if (!githubInput || linked || !searchOpen) return;
                if (event.key === "Escape") {
                  event.preventDefault();
                  event.stopPropagation();
                  setSearchOpen(false);
                } else if (
                  event.key === "ArrowDown" ||
                  event.key === "ArrowUp"
                ) {
                  event.preventDefault();
                  setActiveResult((index) =>
                    Math.max(
                      0,
                      Math.min(
                        results.length - 1,
                        index + (event.key === "ArrowDown" ? 1 : -1),
                      ),
                    ),
                  );
                } else if (event.key === "Enter") {
                  event.preventDefault();
                  if (results[activeResult])
                    selectGithubItem(results[activeResult]);
                }
              }}
              onChange={(event) => changeInput(event.target.value)}
            />
          )}
          {githubInput && searchOpen && !linked ? (
            <Popover
              anchor={input}
              side="bottom"
              width={input.current?.getBoundingClientRect().width}
              maxHeight={240}
              onDismiss={() => setSearchOpen(false)}
              ignore="[data-worktree-github-search]"
              role="listbox"
              id={resultsId}
              aria-label="GitHub issues and pull requests"
              aria-busy={lookingUp}
              className="overflow-y-auto p-1"
            >
              {searchError && !lookingUp ? (
                <p
                  role="alert"
                  className={`break-words px-3 py-2 ${results.length ? "text-amber-400" : "text-red-400"}`}
                >
                  {searchError}
                </p>
              ) : null}
              {lookingUp ? (
                <p
                  role="status"
                  className="flex items-center gap-2 px-3 py-2 text-content/60"
                >
                  <Loader className="size-3 animate-spin" />
                  Searching GitHub…
                </p>
              ) : !results.length && !searchError ? (
                <p className="px-3 py-2 text-content/60">
                  No matching issues or pull requests
                </p>
              ) : (
                results.map((item, index) => (
                  <button
                    key={`${item.kind}-${item.number}`}
                    ref={index === activeResult ? activeOption : undefined}
                    type="button"
                    role="option"
                    id={`${resultsId}-${index}`}
                    aria-selected={index === activeResult}
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => setActiveResult(index)}
                    onClick={() => selectGithubItem(item)}
                    title={item.title}
                    className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs ${index === activeResult ? "bg-selection" : "hover:bg-content/5"}`}
                  >
                    <span className="shrink-0 text-content/60">
                      {item.kind === "pr" ? "PR" : "Issue"} #{item.number}
                    </span>
                    <span className="truncate">{item.title}</span>
                  </button>
                ))
              )}
            </Popover>
          ) : null}
          {linked ? (
            <p className="text-content/60">
              {linked.repo} #{linked.number} · {linked.title}
            </p>
          ) : null}
          {!existing ? (
            <p className="break-all text-content/60">
              Branch: <code className="text-content">{branch || "—"}</code>
              {!name && !override ? " · automatically named" : ""}
            </p>
          ) : null}
          {validation && (existing ? !!name : !!name || !!override) ? (
            <p role="alert" className="text-amber-400">
              {validation}
            </p>
          ) : null}
        </div>
        {sessionOptions ? (
          <div className="flex flex-col gap-2">
            <span className="font-medium">Agent & model</span>
            <fieldset
              disabled={locked}
              className="w-fit rounded-md border border-content/20 px-2 py-1"
            >
              <ModelPicker
                project={cwd}
                harness={choice.harness}
                model={choice.model}
                values={settings}
                hotkeys={false}
                hideSettings
                onChange={(harness, model) => {
                  setChoice({ harness, model });
                  setSettings({});
                }}
                onSettingsChange={setSettings}
              />
            </fieldset>
            <p className="text-content/60">
              Opens a new session. The agent starts only when you send a prompt.
            </p>
          </div>
        ) : null}
        <details className="rounded-lg border border-stroke p-3">
          <summary className="cursor-pointer font-medium">Advanced</summary>
          <div className="mt-4 flex flex-col gap-4">
            {!existing ? (
              <>
                <label className="flex flex-col gap-2">
                  <span>Branch name override</span>
                  <input
                    aria-label="Branch name override"
                    className={field}
                    value={override}
                    disabled={locked}
                    placeholder={branch}
                    autoComplete="off"
                    spellCheck={false}
                    onChange={(event) => setOverride(event.target.value)}
                  />
                </label>
                <div className="flex flex-col gap-2">
                  <span>Start from</span>
                  <SearchableSelect
                    label="Start from"
                    value={base}
                    disabled={locked}
                    options={baseOptions}
                    onChange={setBase}
                    searchPlaceholder="Search branches and refs…"
                    layer={LAYER.dialogPopover}
                  />
                  {githubInput ? (
                    <p className="text-content/60">
                      GitHub links do not check out PR code. This ref controls
                      the starting code.
                    </p>
                  ) : null}
                </div>
              </>
            ) : null}
            {sessionOptions ? (
              <fieldset
                disabled={locked}
                className="flex flex-wrap items-center gap-2"
              >
                <ModelControlPills
                  harness={choice.harness}
                  model={choice.model}
                  values={settings}
                  onSettingsChange={setSettings}
                />
              </fieldset>
            ) : null}
            {sessionOptions ? (
              <label className="flex flex-col gap-2">
                <span>Starter prompt</span>
                <textarea
                  aria-label="Starter prompt"
                  value={prompt}
                  disabled={locked}
                  rows={3}
                  placeholder="What should the agent work on? Saved in the composer, not sent automatically."
                  className={`${field} h-auto resize-y py-2`}
                  onChange={(event) => setPrompt(event.target.value)}
                />
              </label>
            ) : null}
            {defaultRoot ? (
              <p className="break-all text-content/60">
                Created in {prettyCwd(defaultRoot)}
              </p>
            ) : null}
            <p className="text-content/60">
              Full checkout · no setup commands run automatically.
            </p>
          </div>
        </details>
        {!existing ? (
          <p className="text-content/60">
            Start from:{" "}
            <span className="text-content">
              {base === "HEAD" ? (branches?.current ?? "current commit") : base}
            </span>
          </p>
        ) : null}
        {created ? (
          <p role="status" className="text-emerald-400">
            {created}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="break-words text-red-400">
            {error}
          </p>
        ) : null}
        <div className="flex items-center justify-between gap-3 border-t border-stroke pt-4">
          <label className="flex cursor-pointer items-center gap-2 text-content/70">
            <input
              type="checkbox"
              checked={keepOpen}
              disabled={locked}
              onChange={(event) => setKeepOpen(event.target.checked)}
            />
            Create more
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={onCancel}
              className="rounded-md px-3 py-2 hover:bg-content/8"
            >
              {created ? "Done" : "Cancel"}
            </button>
            <button
              type="submit"
              disabled={locked || !!validation || (githubInput && !linked)}
              className="inline-flex items-center gap-2 rounded-md bg-content px-3 py-2 font-medium text-background-base disabled:opacity-40 active:scale-[0.97]"
            >
              {busy && <Loader className="size-3.5 animate-spin" />}Create
              worktree
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
