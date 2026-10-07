//! The desktop executable also provides a small, JSON-only control client.
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::time::Duration;

use serde_json::{json, Value};
use tauri::Manager;

const USAGE: &str = r#"MonoCode local control — supervise this orchestration run from the lead agent.

Usage: {exe} control ACTION [--json JSON | --input FILE|-] [--request-id ID]

Actions, with the JSON object each one takes:
  list      {}
            The run, every task with its status and latest result, and the
            harness/model IDs you may assign.
  delegate  {"title":"Short title","harness":"<id from list>",
             "model":"<id from list>","prompt":"Self-contained instructions",
             "files":["src/feature"],"dependsOn":["<taskId>"]}
            Queue a worker and return its taskId. "model" is optional and
            defaults to the first model list allows for that harness.
            "files" is the write scope: project-relative paths, where a
            directory covers its descendants and ["."] reserves the whole
            checkout. "dependsOn" holds taskIds that must be reviewed first.
            Project Managers may pass "checkout":"<path or branch>" to reuse
            a worktree explicitly named by the user; omitted creates one.
            Org Managers must pass "member":"<direct team member id>";
            the app supplies that member's model and identity. Include
            "monoGoalId":"<goalId>" for an assigned goal. Reviewer delegates
            also pass "reviewTaskId":"<completed implementation taskId>".
            For investigation/report tasks pass "readOnly":true: use the project
            checkout with enforced read-only runtime, or a worktree fallback
            when unsupported. Never modify files or commit on read-only tasks.
            Org Managers may include "project":"<exact assigned folder>"
            on every control action (required with multiple projects).
  get       {"taskId":"..."}
            One task, including its latest result.
  wait      {"timeoutSeconds":20}
            Block until a task changes state, or until the timeout (0-25).
            Returns at once when paused, stopped, or nothing is running or queued.
  respond   {"taskId":"...","requestId":7,"decision":"allow"|"deny"}
            Answer an approval an agent is blocked on. Agents never prompt the
            user; list, get and wait report the prompt as that task's
            "needsInput", and it stays stopped until you decide.
  answer    {"taskId":"...","requestId":9,"answers":{"<questionId>":["<optionId>"]}}
            Answer a question an agent asked, or pass "skip":true instead of
            "answers". The question and its options come from needsInput.
  steer     {"taskId":"...","text":"..."}
            Redirect an agent that is still running, without discarding the
            work it has already done. Use this the moment you see it going
            the wrong way; message only lands once it has stopped.
  message   {"taskId":"...","text":"..."}
            Send a stopped worker another turn within its existing scope; it
            keeps its session, checkout and history.
  retry     {"taskId":"...","text":"...","files":["src/feature"]}
  reassign  {"taskId":"...","harness":"<id>","model":"<id>","reason":"quota|unavailable|configuration|stuck|failed"}
            Project Manager only. Cancel a running worker first and confirm it stopped.
            Retains task scope, dependencies and checkout; creates a fresh worker session.
            Never use for a safety refusal. Omitted harness/model use the Manager's current choice.
            Retry a stopped worker with corrected project-relative write
            scopes. Use this only when the additional files are required.
  cancel    {"taskId":"..."}
            Cancel a task, whether it is running or still queued.
  review    {"taskId":"...","checks":"Short summary of diff review and tests"}
            Accept a completed task's result.
            Report-only tasks: {"taskId":"...","outcome":"accept-no-changes"}.
            This verifies no changed files or commits ahead of the task's base;
            changes still require the independent Reviewer and PR gate.
            Project Managers: inspect diff and tests, open a non-draft PR,
            then review. The worktree is retained; the user reviews and merges.
  finish    {}
            End the run, once every task is accepted or cancelled.

Usual loop: list -> delegate ... -> wait or get -> steer an agent that drifts,
unblock one with respond or answer -> inspect the changes yourself -> message
for corrections -> review each task -> finish.

When paused, list, get and wait still return the reason and recovery steps.
Do not keep polling or retry mutations. Explain the pause and ask the user to
click Resume in MonoCode. Resume continues interrupted workers in their
retained checkouts. A policy-blocked worker remains stopped until message,
retry or cancel explicitly resolves it.

Output is one JSON line: {"ok":true,"result":...} or {"ok":false,"error":"..."}.
The exit code is 0 only when "ok" is true.

Input must be a JSON object; unknown fields are rejected rather than ignored.
--json takes it inline, --input FILE reads a file, --input - reads stdin.

Every call carries a request ID, and the run applies each ID at most once. A
failed response reports the ID it used whenever the outcome is unknown — a
timeout, say. Retry that exact call with --request-id ID; retrying a delegate
under a fresh ID instead would queue a second worker.

Tasks run inside the MonoCode app, not in this process. Exiting this CLI, or a
failure here, never cancels a task that was already accepted.

MonoCode sets MONOCODE_CONTROL_ENDPOINT and MONOCODE_CONTROL_TOKEN for the lead
agent's process only. They are already in your environment; never print them.
"#;

const ACTIONS: [&str; 13] = [
    "list", "delegate", "get", "steer", "message", "retry", "reassign", "cancel", "wait", "review", "finish",
    "respond", "answer",
];
const APP_ACTIONS: [&str; 47] = [
    "tasks.request",
    "team.answer",
    "team.list",
    "team.hire",
    "team.update",
    "team.memory.add",
    "team.memory.forget",
    "team.retire",
    "reviews.submit",
    "projects.list",
    "projects.status",
    "goals.assign",
    "goals.message",
    "goals.cancel",
    "prs.ready",
    "models.list",
    "sessions.list",
    "sessions.read",
    "sessions.send",
    "sessions.draft",
    "sessions.start",
    "sessions.stop",
    "sessions.archive",
    "sessions.delete",
    "worktrees.list",
    "worktrees.create",
    "folders.list",
    "folders.move",
    "notes.list",
    "notes.read",
    "notes.write",
    "artifacts.list",
    "artifacts.read",
    "artifacts.write",
    "soul.read",
    "soul.update",
    "memory.read",
    "memory.search",
    "memory.add",
    "memory.replace",
    "memory.remove",
    "habits.list",
    "habits.add",
    "habits.update",
    "habits.run",
    "habits.remove",
    "chat.card",
];
const APP_USAGE: &str = r#"MonoCode app access — use in a thread enabled by /operator.

Usage: {exe} app ACTION [--json JSON | --input FILE|-] [--request-id ID]

A Mono works on several projects: add "project":"<path or name>" to the
sessions.*, worktrees.* and folders.* actions to choose which one. It may be
left out when the Mono has a single project.

Actions:
  models.list    {}  Available providers, models, settings and permission modes.
  sessions.list  {}  Project sessions with IDs, busy status, hasDraft and archived.
  sessions.read  {"sessionId":"...","before":"<turnId>","limit":3,"maxChars":1200}
                  Read up to 3 recent user/assistant exchanges. Tools and
                  reasoning are omitted. Omit before for the newest page;
                  pass nextBefore from a result for older exchanges. maxChars
                  caps each message (200-6000, default 1200).
  sessions.send  {"sessionId":"...","prompt":"...","notifyOnComplete":true}
                  Submit a follow-up to an idle session in this project.
                  A busy session is rejected. Reuse --request-id on retries.
                  Optional notifyOnComplete:true asks for a completion report
                  in the calling Mono's chat. It waits until that Mono is idle.
  sessions.draft {"sessionId":"...","prompt":"..."}
                  Save an unsent draft in an idle project session. Existing
                  drafts are preserved; send or remove one in MonoCode first.
                  Reuse --request-id on retries.
  sessions.start {"prompt":"...","harness":"codex","model":"codex:...",
                  "effort":"high","reveal":false,
                  "workspaceMode":"current","worktreeCwd":"<path>","draft":false,
                  "placement":"right",
                  "besideSessionId":"<visible session ID>"}
                  Create a tab with the prompt, or set placement to right or
                  down to split a visible session pane. A split defaults to the
                  calling session; besideSessionId chooses another visible
                  session in this project, including one just created. Set
                  draft:true to save the prompt unsent; no agent turn runs.
                  Otherwise the turn is submitted.
                  Submitted sessions notify the calling Mono by default when
                  this turn completes, fails or is cancelled. The Mono reviews
                  it and reports back once idle. Set notifyOnComplete:false
                  when the user asks not to receive a report. Drafts do not
                  notify; notifyOnComplete:true cannot be combined with draft:true.
                  Sessions monitored during the same Mono turn form one group:
                  their results arrive together after every session stops.
                  The Mono reviews the whole group and gives one combined report.
                  Rejected launches or follow-ups return a CLI error without
                  a later completion report. When a Mono successfully stops,
                  archives or deletes a monitored session, its pending report
                  for that session is dismissed; acknowledge the action in
                  the current reply. Other sessions' reports are kept.
                  Returns after creation/acceptance, not agent completion;
                  use its ID with folders.move immediately. Optional model,
                  effort, modelSettings, permission mode and workspace choice
                  use composer values. Set worktreeCwd to a path from
                  worktrees.list to choose a specific existing checkout, or
                  workspaceMode:"worktree" and optional worktreeBase to make
                  a new worktree with an automatic branch name. Omit
                  runtimeMode to inherit this
                  session's permission mode; set it to override. Run
                  models.list for allowed IDs. cwd is your project; no attachments.
  sessions.stop {"sessionId":"..."}
                  Stop a session's current turn and pause its queued messages.
                  The conversation and checkout are kept. Idle sessions are
                  unchanged. Reuse --request-id on retries.
  sessions.archive {"sessionId":"..."}
                  Stop the session if running, save its conversation, and
                  archive it. It can be restored from MonoCode's archive.
                  Open files, terminals and worktrees are kept.
                  Reuse --request-id on retries.
  sessions.delete {"sessionId":"..."}
                  Stop the session if running and permanently delete its
                  saved conversation. Open files, terminals and worktrees
                  are kept. Reuse --request-id on retries.
                  stop, archive and delete cannot target the calling session,
                  Mono chats, habit runs or orchestration workers. Sessions
                  must belong to the chosen project.
  worktrees.list {}  Working copies in this project, with paths and branches.
  worktrees.create {"branch":"feature/name","base":"HEAD","existing":false}
                  Create a worktree on a named new branch from base (a branch
                  or ref). Set existing:true and omit base to use an existing
                  local branch. Pass the returned path as sessions.start's
                  worktreeCwd to start there.
  folders.list   {}  Folders in your current project.
  folders.move   {"sessionId":"...","folderId":"..."}
                  Or use "newFolderName":"Research" to create a folder.
  notes.list     {"limit":30,"offset":0}  Titles and short previews only.
  notes.read     {"id":"..."}  Full body of one note.
  notes.write    {"title":"Plan","body":"Markdown","tags":["work"]}
                  Create a note linked to this session and project. Omit title
                  to derive it from the body. Use {"id":"...","body":"..."}
                  to edit an existing note; title and tags are also optional.
                  Omitted fields stay unchanged. Reuse --request-id on retries.
  artifacts.list {"limit":30,"offset":0}  Mono or habit only. Saved artifact titles.
  artifacts.read {"id":"..."}  Full content of one artifact.
  artifacts.write {"kind":"document","title":"PR review",
                   "summary":"Merge queue and blockers",
                   "body":"<complete Markdown>"}
                  Save a document and attach its card below your chat reply.
                  Artifacts are separate from Notes. Currently only kind "document"
                  (Markdown) is supported. Reply briefly; do not
                  repeat the document body in chat. Returns metadata only.
                  To revise, pass {"id":"...","body":"<updated Markdown>"};
                  omitted title stays unchanged. Reuse --request-id on retries.
  soul.read      {}  Mono's own conversation only. Current SOUL.md text and hash.
  soul.update    {"text":"<complete Markdown>","expectedHash":"<hash from soul.read>"}
                  Update your standing instructions only when the user asks.
                  Preserve the other instructions. If the file changed since
                  soul.read, read it again and reapply the requested changes.
                  Habit runs and other sessions cannot change a Mono's soul.
  memory.read    {"topic":"releases"}  Mono only. Without topic:
                  MEMORY.md, how much of it loads, and the topic names.
  memory.search  {"query":"release tags","since":"7d"}
                  Entries across MEMORY.md, topic notes and the archive that
                  share words with query, best first. since is a date or a
                  span (24h, 7d, 2w) and keeps dated entries from then on.
  memory.add     {"fact":"...","topic":"releases","until":"2026-11-01"}
                  Add one dated entry to MEMORY.md, or to a topic file when
                  topic is set. until is optional, for facts that expire.
                  Oldest entries move to the archive when MEMORY.md is full.
  memory.replace {"find":"text of the old entry","fact":"...","topic":"..."}
                  Strike the one entry containing find through and add fact.
  memory.remove  {"find":"text of the entry","topic":"..."}
                  Delete the one entry containing find, for a wrong entry.
  habits.list    {}  Mono only. Your habits: what each does, when it runs
                  next, and how its last run went.
  habits.add     {"name":"Morning CI check","instructions":"...",
                  "schedule":{"kind":"weekdays","time":"09:00"}}
                  Add only after the user agreed to it in this chat. kind is
                  hourly (with "minute"), daily, weekdays or weekly (with
                  "dayOfWeek", 0 = Sunday); time is local 24-hour HH:MM.
                  Each run is a hidden session that posts to this chat only
                  when it has something worth saying.
  habits.update  {"id":"...","name":"...","instructions":"...",
                  "schedule":{...},"enabled":false}  Change or pause one.
  habits.run     {"id":"..."}  Run one within a minute, to try it out.
  habits.remove  {"id":"..."}
  projects.list  Mono only. List assigned projects and worker-engine summaries.
  tasks.request  {"title":"...","prompt":"...","files":["src"]} Member chat only, direct user work request. Requires nonempty project-relative file/directory scopes. Creates an isolated task under its Manager; does not bypass review or publishing limits.
  projects.status {projectId,before?} Read a bounded page of project goals.
  goals.assign   Orchestrator only, to a direct Manager. {projectId,goal}; reuse requestId.
  goals.message  {goalId,text} Message an existing goal.
  goals.cancel   {goalId} Cancel only this goal's workers; retain work.
  prs.ready      List ready PRs in assigned projects.
  team.answer    Direct boss only. {monoId,requestId,answers} or {monoId,requestId,skip:true}.
                  For a permission: {monoId,requestId,decision:"allow"|"deny"}.
                  Never allow beyond the user's existing authority.
  team.list      Manager only, own team. {} Members, profiles, soul summary,
                  memory count, tasks and user-locked fields.
  team.hire      {name,specialty,soul,harness?,model?,modelSettings?,mascot?,color?,memory?:[facts],reviewer?}
                  Study the codebase first. Pick installed models from models.list.
                  Reviewer defaults to a different installed harness/model family;
                  omit both harness and model to use that default. Explicit choices
                  are allowed; matching implementers posts a soft warning.
                  Creates a direct member in your single project. Soul: at most 8 KiB.
  team.update    {memberId,name?,specialty?,soul?,harness?,model?,modelSettings?}
                  User-locked fields are rejected; suggest those changes in chat.
  team.memory.add {memberId,facts:["short project fact"]} Redacted and deduplicated.
  team.memory.forget {memberId,factIds:["id from team.list"]}
  team.retire    {memberId,reason} Cancels active tasks, retains worktrees/history.
                  The last Reviewer cannot retire. Team changes post Undo cards.
                  All team actions reuse --request-id on retries; no role/project override.
  reviews.submit Reviewer worker only. {decision:"approve"|"changes",notes:"...",artifactId:"..."}.
                  Reviews the exact implementing dispatch assigned by the Manager.
                  Save Review: <task> with artifacts.write purpose:"review" first.
  Org artifacts  artifacts.write also accepts purpose:"team-plan"|"review"|"pr-summary"|"report".
                  Managers write Team plan: <project> before hiring and PR summary: <task>
                  with taskId before the PR gate. Use artifacts.read body as gh --body-file source.
                  Investigation workers save Report: <task> before no-change acceptance.
                  Workers' task/project/author provenance is inferred by the app; never supply scope.
                  Managers may select an assigned project with project; ambiguous teams must select.
                  Member workers may also memory.add {fact:"..."}: three short,
                  redacted project facts per task, not transcripts.
  chat.card      Mono or habit only. Post a card to the Mono's chat:
                 {type:"dispatch"|"status"|"ready",goalIds?:["id"]} shows stored goal state.
                  {"type":"pr","repo":"owner/repo","number":123,"note":"..."}
                  {"type":"session","sessionId":"...","note":"..."}
                  {"type":"choices","options":["First choice","Second choice"]}
                  {"type":"habit","name":"...","instructions":"...",
                   "schedule":{"kind":"daily","time":"09:00"}}
                  choices accepts 1–4 options. A habit card is a suggestion;
                  the user must start it before it is scheduled.

The output is one JSON line: {"ok":true,"result":...} or {"ok":false,"error":"..."}.
Use --input - to pass JSON on stdin. Never print MonoCode credentials.
Keep the same --request-id when retrying a call after an uncertain result.
"#;

/// Quote for the shell the lead agent actually runs commands in, and only when
/// the path needs it. The path is absolute, so a leading slash means a POSIX
/// shell — where a backslash escapes rather than separates, and so is never
/// safe bare.
fn quoted(value: &str) -> String {
    if !value.starts_with('/') {
        return if value.contains([' ', '\t', '"']) {
            format!("\"{}\"", value.replace('"', ""))
        } else {
            value.into()
        };
    }
    if value
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || "._/-:".contains(c))
    {
        value.into()
    } else {
        format!("'{}'", value.replace('\'', r"'\''"))
    }
}

/// Resolve on each call: restarted/renamed previews must never inherit another
/// process's executable identity. Drop Windows device prefixes for shell argv.
pub(crate) fn running_executable() -> Result<String, String> {
    let path = std::env::current_exe().and_then(|path| path.canonicalize())
        .map_err(|error| error.to_string())?;
    let text = path.to_string_lossy();
    Ok(if cfg!(windows) {
        if let Some(unc) = text.strip_prefix(r"\\?\UNC\") { format!(r"\\{unc}") }
        else { text.trim_start_matches(r"\\?\").to_owned() }
    } else { text.into_owned() })
}

pub fn help() -> String {
    let exe = running_executable()
        .map(|path| quoted(&path))
        .unwrap_or_else(|_| "monocode".into());
    USAGE.replace("{exe}", &exe)
}

pub fn app_help() -> String {
    let exe = running_executable()
        .map(|path| quoted(&path))
        .unwrap_or_else(|_| "monocode".into());
    APP_USAGE.replace("{exe}", &exe)
}

#[tauri::command]
pub fn app_cli_approval_policy(app: tauri::AppHandle, cwd: Option<String>, session_id: String) -> Result<Value, String> {
    let input_dir = app.path().app_data_dir().ok()
        .and_then(|base| crate::app_cli_inputs::folder(&base.join("cli-inputs"), &session_id).ok());
    Ok(approval_policy(cwd, input_dir.as_deref()))
}

fn approval_policy(cwd: Option<String>, input_dir: Option<&std::path::Path>) -> Value {
    let mut shells: Vec<String> = TRUSTED_POWERSHELL.get().into_iter().flatten()
        .map(|path| path.to_string_lossy().trim_start_matches(r"\\?\").to_string()).collect();
    if let Some(cwd) = cwd {
        for name in ["powershell", "powershell.exe", "pwsh", "pwsh.exe"] {
            if app_cli_powershell_is_trusted(name.into(), cwd.clone()) { shells.push(name.into()); }
        }
    }
    json!({
        "executable": running_executable().unwrap_or_default(),
        "tempDir": input_dir.map(|path| path.to_string_lossy().trim_start_matches(r"\\?\").to_string()).unwrap_or_default(),
        "actions": APP_ACTIONS.as_slice(),
        "trustedRtk": TRUSTED_RTK.get().and_then(|path| path.as_ref()).map(|path| path.to_string_lossy().trim_start_matches(r"\\?\").to_string()),
        "trustedPowerShell": shells,
    })
}

static TRUSTED_RTK: std::sync::OnceLock<Option<std::path::PathBuf>> = std::sync::OnceLock::new();
static TRUSTED_POWERSHELL: std::sync::OnceLock<Vec<std::path::PathBuf>> = std::sync::OnceLock::new();

pub fn init_trusted_launchers() {
    init_trusted_rtk();
    TRUSTED_POWERSHELL.get_or_init(|| {
        let mut candidates = Vec::new();
        if cfg!(windows) {
            if let Some(root) = std::env::var_os("SystemRoot") {
                let root = std::path::PathBuf::from(root).join("System32/WindowsPowerShell/v1.0");
                candidates.push((root.join("powershell.exe"), root));
            }
            if let Some(programs) = std::env::var_os("ProgramFiles") {
                let root = std::path::PathBuf::from(programs).join("PowerShell");
                if let Ok(entries) = std::fs::read_dir(&root) {
                    for entry in entries.flatten() {
                        if entry.path().is_dir() { candidates.push((entry.path().join("pwsh.exe"), root.clone())); }
                    }
                }
            }
        }
        candidates.into_iter().filter_map(|(path, root)| {
            let root = root.canonicalize().ok()?;
            let path = path.canonicalize().ok()?;
            let temp = std::env::temp_dir().canonicalize().ok()?;
            (path.is_file() && rtk_install_path_allowed(&path, &[root], &temp)
                && !path.ancestors().any(|parent| parent.join(".git").exists())).then_some(path)
        }).collect()
    });
}

/// Bare launchers are rechecked for every approval, not cached with the turn.
/// Do not run the shell or execute a PATH shim in order to discover identity.
#[tauri::command]
pub fn app_cli_powershell_is_trusted(path: String, cwd: String) -> bool {
    let Some(trusted) = TRUSTED_POWERSHELL.get() else { return false; };
    let paths: Vec<_> = std::env::var_os("PATH").map(|path| std::env::split_paths(&path).collect()).unwrap_or_default();
    powershell_is_trusted(&path, std::path::Path::new(&cwd), &paths, trusted)
}

fn powershell_is_trusted(path: &str, cwd: &std::path::Path, search: &[std::path::PathBuf], trusted: &[std::path::PathBuf]) -> bool {
    let matches = |path: &std::path::Path| path.canonicalize().ok().is_some_and(|canonical|
        canonical.is_file() && trusted.iter().any(|trusted| canonical.to_string_lossy().eq_ignore_ascii_case(&trusted.to_string_lossy())));
    if std::path::Path::new(path).is_absolute() { return matches(std::path::Path::new(path)); }
    let name = path.to_ascii_lowercase();
    if !["powershell", "powershell.exe", "pwsh", "pwsh.exe"].contains(&name.as_str()) { return false; }
    if !cwd.is_absolute() || !cwd.is_dir() { return false; }
    let Ok(entries) = std::fs::read_dir(cwd) else { return false; };
    for entry in entries {
        let Ok(entry) = entry else { return false; };
        let name = entry.file_name().to_string_lossy().to_ascii_lowercase();
        if name == "powershell" || name == "pwsh" || name.starts_with("powershell.") || name.starts_with("pwsh.") { return false; }
    }
    let stem = name.trim_end_matches(".exe");
    if search.iter().any(|dir| !dir.is_absolute()) { return false; }
    let mut extensions = vec![".exe".to_string(), ".com".into(), ".cmd".into(), ".bat".into(), ".ps1".into()];
    if let Some(extra) = std::env::var_os("PATHEXT") {
        extensions.extend(extra.to_string_lossy().split(';').map(str::to_ascii_lowercase));
    }
    for dir in search {
        let entries = match std::fs::read_dir(dir) {
            Ok(entries) => entries,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(_) => return false,
        };
        let mut found = false;
        for entry in entries {
            let Ok(entry) = entry else { return false; };
            let name = entry.file_name().to_string_lossy().to_ascii_lowercase();
            if name == stem || name.strip_prefix(stem).is_some_and(|suffix| extensions.iter().any(|extension| suffix == extension)) {
                if !matches(&entry.path()) { return false; }
                found = true;
            }
        }
        if found { return true; }
    }
    false
}

/// Resolve once at app startup, never in the session's cwd. Command shims and
/// repository-controlled PATH entries are not executable identities.
pub fn init_trusted_rtk() {
    TRUSTED_RTK.get_or_init(|| {
        let home = std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" })?;
        let home = std::path::PathBuf::from(home);
        let mut roots = vec![home.join(".cargo"), home.join(".local/bin")];
        if let Some(programs) = std::env::var_os("ProgramFiles") { roots.push(std::path::PathBuf::from(programs).join("rtk")); }
        if !cfg!(windows) { roots.extend(["/usr/bin", "/usr/local/bin"].map(std::path::PathBuf::from)); }
        let roots: Vec<_> = roots.into_iter().filter_map(|root| root.canonicalize().ok()).collect();
        let binary = if cfg!(windows) { "rtk.exe" } else { "rtk" };
        let mut candidates: Vec<_> = std::env::var_os("PATH").map(|path| std::env::split_paths(&path).filter(|dir| dir.is_absolute()).map(|dir| dir.join(binary)).collect()).unwrap_or_default();
        candidates.extend([home.join(".cargo/bin").join(binary), home.join(".local/bin").join(binary)]);
        // Cargo supports versioned --root installs; do not execute or parse rtk.cmd.
        if let Ok(entries) = std::fs::read_dir(home.join(".cargo")) {
            let mut installs: Vec<_> = entries.flatten().filter(|entry| entry.file_name().to_string_lossy().starts_with("rtk-")).map(|entry| entry.path().join("bin").join(binary)).collect();
            installs.sort(); installs.reverse(); candidates.extend(installs);
        }
        candidates.into_iter().find_map(|candidate| trusted_rtk_candidate(&candidate, &roots, &std::env::temp_dir()))
    });
}

fn trusted_rtk_candidate(path: &std::path::Path, roots: &[std::path::PathBuf], temp: &std::path::Path) -> Option<std::path::PathBuf> {
    if !path.is_absolute() { return None; }
    let canonical = path.canonicalize().ok()?;
    if !canonical.is_file() || !rtk_install_path_allowed(&canonical, roots, &temp.canonicalize().ok()?) { return None; }
    if canonical.ancestors().any(|parent| parent.join(".git").exists()) { return None; }
    let expected = if cfg!(windows) { "rtk.exe" } else { "rtk" };
    if !canonical.file_name()?.to_string_lossy().eq_ignore_ascii_case(expected) { return None; }
    Some(canonical)
}

fn rtk_install_path_allowed(path: &std::path::Path, roots: &[std::path::PathBuf], temp: &std::path::Path) -> bool {
    roots.iter().any(|root| path.starts_with(root)) && !path.starts_with(temp) &&
        !path.components().any(|part| ["workspaces", "worktrees", "scratch", "temp", "tmp"].contains(&part.as_os_str().to_string_lossy().to_ascii_lowercase().as_str()))
}

#[tauri::command]
pub fn app_cli_executable_matches(path: String) -> bool {
    let candidate = std::path::Path::new(&path);
    if !candidate.is_absolute() { return false; }
    let (Ok(candidate), Ok(current)) = (candidate.canonicalize(), std::env::current_exe().and_then(|p| p.canonicalize())) else { return false; };
    // Windows canonicalization expands 8.3 paths and resolves junctions.
    if cfg!(windows) { candidate.to_string_lossy().eq_ignore_ascii_case(&current.to_string_lossy()) }
    else { candidate == current }
}

#[tauri::command]
pub fn app_cli_input_is_temp(path: String, session_id: String) -> bool {
    crate::app_cli_inputs::allows(std::path::Path::new(&path), &session_id)
}

#[cfg(test)]
fn temp_input_within(path: &std::path::Path, root: &std::path::Path) -> bool {
    let (Ok(path), Ok(root)) = (path.canonicalize(), root.canonicalize()) else { return false; };
    path != root && path.starts_with(root) && path.is_file()
}

enum Parsed {
    Help,
    Call(String, Value, String),
}

pub(crate) fn validate_app_request(action: &str, input: &Value, request_id: &str) -> Result<(), String> {
    if !APP_ACTIONS.contains(&action) { return Err(format!("Unknown app action: {action}")); }
    if request_id.is_empty() || request_id.len() > 128 || !request_id.bytes().all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_')) {
        return Err("App request IDs may contain only letters, digits, - and _".into());
    }
    if action.starts_with("team.") && action != "team.answer" {
        if request_id.len() > 120 { return Err("Team request ID exceeds 120 characters".into()); }
        validate_team_input(action, input)?;
    }
    Ok(())
}

/// Shared by the CLI parser and authenticated transport; JSON is data, never
/// authority. The app checks fresh team membership, locks and model availability.
pub(crate) fn validate_team_input(action: &str, input: &Value) -> Result<(), String> {
    let fields: &[&str] = match action {
        "team.list" => &[],
        "team.hire" => &["name", "specialty", "soul", "harness", "model", "modelSettings", "mascot", "color", "memory", "reviewer"],
        "team.update" => &["memberId", "name", "specialty", "soul", "harness", "model", "modelSettings"],
        "team.memory.add" => &["memberId", "facts"],
        "team.memory.forget" => &["memberId", "factIds"],
        "team.retire" => &["memberId", "reason"],
        _ => return Err("Unknown team action".into()),
    };
    let object = input.as_object().ok_or("Input must be a JSON object")?;
    if input.to_string().len() > 64 * 1024 { return Err("Team input exceeds 64 KiB".into()); }
    for key in object.keys() {
        if !fields.contains(&key.as_str()) { return Err(format!("Unknown field: {key}")); }
    }
    let required: &[&str] = match action {
        "team.hire" => &["name", "specialty", "soul"],
        "team.update" => &["memberId"],
        "team.memory.add" => &["memberId", "facts"],
        "team.memory.forget" => &["memberId", "factIds"],
        "team.retire" => &["memberId", "reason"],
        _ => &[],
    };
    for field in required {
        if !object.contains_key(*field) { return Err(format!("{field} is required")); }
    }
    if action == "team.hire" {
        let reviewer = object.get("reviewer").and_then(Value::as_bool) == Some(true)
            || object.get("specialty").and_then(Value::as_str).is_some_and(|value| value.trim().eq_ignore_ascii_case("reviewer"));
        let harness = object.contains_key("harness");
        let model = object.contains_key("model");
        if harness != model || (!reviewer && !harness) {
            return Err("team.hire requires harness and model; Reviewer may omit both for an independent default".into());
        }
    }
    if action == "team.update" && object.len() == 1 { return Err("Supply a field to update".into()); }
    for (key, value) in object {
        match key.as_str() {
            "memory" | "facts" | "factIds" => {
                let list = value.as_array().ok_or_else(|| format!("{key} must be an array"))?;
                if list.len() > 50 || list.is_empty() { return Err(format!("{key} must contain 1-50 entries")); }
                let mut bytes = 0;
                for entry in list {
                    let fact = entry.as_str().ok_or_else(|| format!("{key} entries must be strings"))?;
                    if fact.trim().is_empty() || fact.chars().count() > if key == "factIds" { 256 } else { 1000 } {
                        return Err(format!("Invalid {key} entry"));
                    }
                    bytes += fact.len();
                }
                if bytes > 24 * 1024 { return Err(format!("{key} exceeds 24 KiB")); }
            }
            "modelSettings" => {
                let settings = value.as_object().ok_or("modelSettings must be an object")?;
                if settings.len() > 16 { return Err("Too many model settings".into()); }
                for (setting, value) in settings {
                    if setting.is_empty() || setting.chars().count() > 100 || value.as_str().is_none_or(|v| v.chars().count() > 1000) {
                        return Err("modelSettings must contain bounded string values".into());
                    }
                }
            }
            "reviewer" => { if !value.is_boolean() { return Err("reviewer must be a boolean".into()); } }
            _ => {
                let text = value.as_str().ok_or_else(|| format!("{key} must be a string"))?;
                let max = match key.as_str() { "soul" => 8192, "name" | "specialty" => 80, "memberId" | "model" => 256, "reason" => 500, "color" => 100, _ => 128 };
                let length = if key == "soul" { text.len() } else { text.chars().count() };
                if length > max || text.trim().is_empty() {
                    return Err(format!("{key} must contain at most {max} {}", if key == "soul" { "bytes" } else { "characters" }));
                }
                if key == "harness" && !["claude", "codex", "cursor", "grok", "opencode", "pi", "omp", "fx", "hermes", "antigravity"].contains(&text) {
                    return Err("Unknown harness; run models.list".into());
                }
            }
        }
    }
    Ok(())
}

/// Handle CLI probes before desktop initialization, so --help cannot launch a
/// second renderer that recovers another process's live sessions.
pub fn maybe_run(args: Vec<String>) -> Option<i32> {
    match args.first().map(String::as_str) {
        Some("control") => Some(run(args.into_iter().skip(1).collect())),
        Some("app") => Some(run_app(args.into_iter().skip(1).collect())),
        Some("--help" | "-h") => {
            println!("{}\n{}", help(), app_help());
            Some(0)
        }
        Some("--version" | "-V") => {
            println!("MonoCode {}", env!("CARGO_PKG_VERSION"));
            Some(0)
        }
        _ => None,
    }
}

pub fn run(args: Vec<String>) -> i32 {
    run_mode(args, false)
}

pub fn run_app(args: Vec<String>) -> i32 {
    run_mode(args, true)
}

fn run_mode(args: Vec<String>, app_mode: bool) -> i32 {
    let parsed = match parse_args_for(&args, app_mode) {
        Ok(parsed) => parsed,
        Err(error) => {
            println!("{}", json!({"ok": false, "error": error}));
            return 1;
        }
    };
    let (action, input, request_id) = match parsed {
        Parsed::Help => {
            println!("{}", if app_mode { app_help() } else { help() });
            return 0;
        }
        Parsed::Call(action, input, request_id) => (action, input, request_id),
    };
    match send(&action, &input, &request_id, app_mode) {
        Ok(mut value) => {
            if value.get("ok").and_then(Value::as_bool) == Some(true) {
                println!("{value}");
                return 0;
            }
            value = with_retry_hint(value, &request_id);
            println!("{value}");
            1
        }
        Err(Failure { error, sent }) => {
            // The call may have reached the run even though its answer was
            // lost. Hand back the request ID so a retry cannot duplicate it.
            let mut response = json!({"ok": false, "error": error});
            if sent {
                response["requestId"] = json!(request_id);
                response["retryWith"] = json!(format!("--request-id {request_id}"));
            }
            println!("{response}");
            1
        }
    }
}

fn with_retry_hint(mut value: Value, request_id: &str) -> Value {
    // A denied app call never reached the executor. Repeating the same ID
    // cannot grant access, and suggesting it sends agents in loops.
    if value.get("retryable").and_then(Value::as_bool) == Some(false) {
        return value;
    }
    if let Some(object) = value.as_object_mut() {
        object
            .entry("requestId")
            .or_insert_with(|| json!(request_id));
        object
            .entry("retryWith")
            .or_insert_with(|| json!(format!("--request-id {request_id}")));
    }
    value
}

struct Failure {
    error: String,
    /// The request was already on the wire, so the run may have applied it.
    sent: bool,
}
fn unsent(error: impl Into<String>) -> Failure {
    Failure {
        error: error.into(),
        sent: false,
    }
}
fn sent(error: impl Into<String>) -> Failure {
    Failure {
        error: error.into(),
        sent: true,
    }
}

fn send(action: &str, input: &Value, request_id: &str, app_mode: bool) -> Result<Value, Failure> {
    let endpoint_key = if app_mode {
        "MONOCODE_APP_ENDPOINT"
    } else {
        "MONOCODE_CONTROL_ENDPOINT"
    };
    let token_key = if app_mode {
        "MONOCODE_APP_TOKEN"
    } else {
        "MONOCODE_CONTROL_TOKEN"
    };
    let endpoint = std::env::var(endpoint_key).map_err(|_| {
        unsent(if app_mode {
            "No MonoCode app connection. Start this agent turn in MonoCode."
        } else {
            "No MonoCode connection. Confirm the Orchestrator proposal in MonoCode first."
        })
    })?;
    let token = std::env::var(token_key)
        .map_err(|_| unsent("No MonoCode session credential. Start the agent from MonoCode."))?;
    let address: SocketAddr = endpoint
        .parse()
        .map_err(|_| unsent("Invalid MonoCode endpoint"))?;
    if !address.ip().is_loopback() {
        return Err(unsent("MonoCode control only connects to localhost"));
    }
    let mut stream = TcpStream::connect_timeout(&address, Duration::from_secs(3))
        .map_err(|error| {
            unsent(format!(
                "Cannot connect to MonoCode at {address}: {error}. The app may have restarted, or this agent's sandbox may be blocking localhost."
            ))
        })?;
    stream
        .set_read_timeout(Some(Duration::from_secs(40)))
        .map_err(|e| unsent(e.to_string()))?;
    stream
        .set_write_timeout(Some(Duration::from_secs(5)))
        .map_err(|e| unsent(e.to_string()))?;
    writeln!(
        stream,
        "{}",
        json!({"token":token,"action":action,"input":input,"requestId":request_id,"namespace":if app_mode { "app" } else { "control" }})
    )
    .map_err(|e| sent(e.to_string()))?;
    let mut line = String::new();
    let max_response: u64 = if app_mode { 4_000_000 } else { 2_000_000 };
    BufReader::new(stream)
        .take(max_response + 1)
        .read_line(&mut line)
        .map_err(|e| sent(format!("No reply from MonoCode: {e}")))?;
    if line.len() > max_response as usize {
        return Err(sent("MonoCode response is too large"));
    }
    serde_json::from_str(&line).map_err(|_| sent("MonoCode returned an invalid response"))
}

fn read_capped(mut source: impl Read) -> Result<String, String> {
    let mut raw = String::new();
    source
        .by_ref()
        .take(262_145)
        .read_to_string(&mut raw)
        .map_err(|e| e.to_string())?;
    if raw.len() > 262_144 {
        return Err("Input exceeds 256 KiB".into());
    }
    Ok(raw)
}

#[cfg(test)]
fn parse_args(args: &[String]) -> Result<Parsed, String> {
    parse_args_for(args, false)
}

fn parse_args_for(args: &[String], app_mode: bool) -> Result<Parsed, String> {
    let is_help = |value: &str| matches!(value, "help" | "--help" | "-h");
    let Some(action) = args.first() else {
        return Ok(Parsed::Help);
    };
    if is_help(action) {
        return Ok(Parsed::Help);
    }
    let action = action.clone();
    let allowed = if app_mode {
        APP_ACTIONS.contains(&action.as_str())
    } else {
        ACTIONS.contains(&action.as_str())
    };
    if !allowed {
        let names = if app_mode {
            APP_ACTIONS.join(", ")
        } else {
            ACTIONS.join(", ")
        };
        return Err(format!(
            "Unknown action: {action}. Use one of: {names}. Run {} --help.",
            if app_mode { "app" } else { "control" }
        ));
    }
    let mut input = None;
    let mut request_id = uuid::Uuid::new_v4().to_string();
    let mut index = 1;
    while index < args.len() {
        let flag = &args[index];
        // `control delegate --help` should explain the command, not fail.
        if is_help(flag) {
            return Ok(Parsed::Help);
        }
        if !flag.starts_with("--") {
            return Err(format!(
                "Unexpected argument: {flag}. Pass the JSON object as --json '<JSON>'."
            ));
        }
        let value = args.get(index + 1).ok_or_else(|| {
            format!("Missing value for {flag}. Run control --help for the argument list.")
        })?;
        match flag.as_str() {
            "--request-id" => request_id = value.clone(),
            "--json" | "--input" => {
                if input.is_some() {
                    return Err("Supply only one input".into());
                }
                let raw = if flag == "--json" {
                    if value.len() > 262_144 {
                        return Err("Input exceeds 256 KiB".into());
                    }
                    value.clone()
                } else if value == "-" {
                    read_capped(std::io::stdin())?
                } else {
                    read_capped(std::fs::File::open(value).map_err(|e| e.to_string())?)?
                };
                let parsed: Value = serde_json::from_str(&raw)
                    .map_err(|e| format!("Invalid JSON: {e}. Pass one JSON object, e.g. --json '{{\"taskId\":\"...\"}}'."))?;
                if !parsed.is_object() {
                    return Err("Input must be a JSON object".into());
                }
                input = Some(parsed);
            }
            _ => {
                return Err(format!(
                    "Unknown option: {flag}. Supported: --json, --input, --request-id."
                ))
            }
        }
        index += 2;
    }
    if request_id.is_empty() || request_id.len() > 128 {
        return Err("Invalid request ID".into());
    }
    if app_mode
        && !request_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err("App request IDs may contain only letters, digits, - and _".into());
    }
    let input = input.unwrap_or_else(|| json!({}));
    if app_mode { validate_app_request(&action, &input, &request_id)?; }
    Ok(Parsed::Call(action, input, request_id))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn args(values: &[&str]) -> Vec<String> {
        values.iter().map(|s| s.to_string()).collect()
    }
    fn call(values: &[&str]) -> Result<(String, Value, String), String> {
        match parse_args(&args(values))? {
            Parsed::Call(action, input, id) => Ok((action, input, id)),
            Parsed::Help => Err("help".into()),
        }
    }
    #[test]
    fn cli_probes_exit_before_desktop_startup() {
        assert_eq!(maybe_run(args(&[])), None);
        for probe in ["--help", "-h", "--version", "-V"] {
            assert_eq!(maybe_run(args(&[probe])), Some(0));
        }
        for namespace in ["app", "control"] {
            assert_eq!(maybe_run(args(&[namespace, "--help"])), Some(0));
            assert_eq!(maybe_run(args(&[namespace, "unknown"])), Some(1));
        }
    }

    #[test]
    fn validates_inputs_without_invoking_a_shell() {
        let (_, input, id) = call(&[
            "delegate",
            "--json",
            r#"{"prompt":"$(touch nope) `hello`\nnext"}"#,
            "--request-id",
            "retry-1",
        ])
        .unwrap();
        assert_eq!(id, "retry-1");
        assert_eq!(input["prompt"], "$(touch nope) `hello`\nnext");
        assert!(call(&["delegate", "--json", "[]"]).is_err());
        assert!(call(&["delegate", "--json", "{}", "--json", "{}"]).is_err());
        assert!(call(&["unknown"]).is_err());
    }

    #[test]
    fn team_actions_share_strict_bounded_validation_and_approval_allowlist() {
        for (action, input) in [
            ("team.list", json!({})),
            ("team.hire", json!({"name":"Backend", "specialty":"Backend", "soul":"Use cargo test", "harness":"codex", "model":"codex:installed", "memory":["Rust project"]})),
            ("team.hire", json!({"name":"Reviewer", "specialty":"Reviewer", "soul":"Review independently"})),
            ("team.hire", json!({"name":"Audit", "specialty":"Audit", "reviewer":true, "soul":"Review independently"})),
            ("team.update", json!({"memberId":"member", "soul":"New instructions"})),
            ("team.memory.add", json!({"memberId":"member", "facts":["Rust project"]})),
            ("team.memory.forget", json!({"memberId":"member", "factIds":["fact-1"]})),
            ("team.retire", json!({"memberId":"member", "reason":"Task completed"})),
        ] {
            assert!(APP_ACTIONS.contains(&action));
            assert!(app_help().contains(action));
            assert!(validate_app_request(action, &input, "retry-1").is_ok());
            assert!(matches!(parse_args_for(&args(&[action, "--json", &input.to_string(), "--request-id", "retry-1"]), true), Ok(Parsed::Call(_, _, id)) if id == "retry-1"));
            let mut injected = input.clone();
            injected["project"] = json!("another project");
            assert!(validate_app_request(action, &injected, "retry-1").is_err());
            injected.as_object_mut().unwrap().remove("project");
            injected["role"] = json!("manager");
            assert!(validate_app_request(action, &injected, "retry-1").is_err());
            assert!(parse_args_for(&args(&[action]), false).is_err());
        }
        for input in [json!({}), json!({"memberId":"member"}), json!({"memberId":"member", "name":null}), json!({"memberId":"member", "modelSettings":{"effort":3}})] {
            assert!(validate_team_input("team.update", &input).is_err());
        }
        assert!(validate_team_input("team.update", &json!({"memberId":"member", "soul":"é".repeat(4097)})).is_err());
        assert!(validate_team_input("team.memory.add", &json!({"memberId":"member", "facts":[]})).is_err());
        assert!(validate_team_input("team.memory.add", &json!({"memberId":"member", "facts":vec!["x"; 51]})).is_err());
        assert!(validate_team_input("team.memory.add", &json!({"memberId":"member", "facts":vec!["x".repeat(1000); 25]})).is_err());
        assert!(validate_app_request("team.hire", &json!({}), "bad/id").is_err());
        assert!(validate_app_request("team.unknown", &json!({}), "retry-1").is_err());
    }

    #[test]
    fn powershell_bare_names_reject_cwd_and_path_shadowing() {
        let root = std::env::temp_dir().join(format!("monocode-shell-trust-{}", uuid::Uuid::new_v4()));
        let install = root.join("install");
        let cwd = root.join("project");
        let earlier = root.join("earlier");
        for dir in [&root, &install, &cwd, &earlier] { std::fs::create_dir(dir).unwrap(); }
        let binary = install.join("powershell.exe");
        std::fs::write(&binary, "fixture, never executed").unwrap();
        let trusted = vec![binary.canonicalize().unwrap()];
        let search = vec![earlier.clone(), install.clone()];
        assert!(powershell_is_trusted("powershell", &cwd, &search, &trusted));
        assert!(powershell_is_trusted("powershell.exe", &cwd, &search, &trusted));
        #[cfg(windows)]
        assert!(powershell_is_trusted(&binary.to_string_lossy().replace('\\', "\\\\"), &cwd, &search, &trusted));
        assert!(!powershell_is_trusted("powershell", &cwd, &[std::path::PathBuf::from("tools"), install.clone()], &trusted));
        for name in ["powershell.exe", "powershell.cmd", "pwsh.ps1", "PoWeRsHeLl.anything"] {
            let shadow = cwd.join(name);
            std::fs::write(&shadow, "untrusted").unwrap();
            assert!(!powershell_is_trusted("powershell", &cwd, &search, &trusted));
            assert!(!powershell_is_trusted(&shadow.to_string_lossy(), &cwd, &search, &trusted));
            assert!(powershell_is_trusted(&binary.to_string_lossy(), &cwd, &search, &trusted));
            std::fs::remove_file(shadow).unwrap();
        }
        let shadow = earlier.join("powershell.cmd");
        std::fs::write(&shadow, "untrusted").unwrap();
        assert!(!powershell_is_trusted("powershell", &cwd, &search, &trusted));
        assert!(!powershell_is_trusted("powershell", &root.join("missing"), &search, &trusted));
        std::fs::remove_file(shadow).unwrap();
        std::fs::remove_file(binary).unwrap();
        for dir in [&cwd, &earlier, &install, &root] { std::fs::remove_dir(dir).unwrap(); }
    }

    #[cfg(windows)]
    #[test]
    fn powershell_real_parser_preserves_bounded_input_arguments() {
        // Parse, never execute, the proposed app command. This exercises the OS
        // Windows PowerShell 5.1 grammar rather than a POSIX tokenizer.
        let shell = std::path::PathBuf::from(std::env::var_os("SystemRoot").unwrap())
            .join("System32/WindowsPowerShell/v1.0/powershell.exe");
        let script = r#"
$ErrorActionPreference = 'Stop'
$samples = @(
  "& 'C:/Mono Code/monocode.exe' app projects.list --input 'C:/Temp/with spaces/input.json' --request-id retry-1",
  "& 'C:/MonoCode/monocode.exe' app projects.list",
  "'C:/MonoCode/monocode.exe' app projects.list",
  "& 'C:\\Mono Code\\monocode.exe' app projects.list --input 'C:\\Temp\\with spaces\\input.json'"
)
$result = foreach ($sample in $samples) {
  $tokens = $null; $errors = $null
  $ast = [System.Management.Automation.Language.Parser]::ParseInput($sample, [ref]$tokens, [ref]$errors)
  $commands = @($ast.FindAll({ param($node) $node -is [System.Management.Automation.Language.CommandAst] }, $true))
  $values = @(); if ($commands.Count -eq 1) { $values = @($commands[0].CommandElements | ForEach-Object { $_.Value }) }
  @{ errors = $errors.Count; commands = $commands.Count; values = $values }
}
ConvertTo-Json -InputObject @($result) -Compress -Depth 4
"#;
        let output = std::process::Command::new(shell).args(["-NoProfile", "-NonInteractive", "-Command", script]).output().unwrap();
        assert!(output.status.success(), "PowerShell parser probe failed");
        let parsed: Value = serde_json::from_slice(&output.stdout).unwrap();
        assert_eq!(parsed[0]["errors"], 0);
        assert_eq!(parsed[0]["commands"], 1);
        assert_eq!(parsed[0]["values"], json!(["C:/Mono Code/monocode.exe", "app", "projects.list", "--input", "C:/Temp/with spaces/input.json", "--request-id", "retry-1"]));
        assert_eq!(parsed[1]["errors"], 0);
        assert_eq!(parsed[1]["values"], json!(["C:/MonoCode/monocode.exe", "app", "projects.list"]));
        assert!(parsed[2]["errors"].as_u64().unwrap() > 0, "A quoted executable needs the call operator");
        assert_eq!(parsed[3]["errors"], 0);
        assert_eq!(parsed[3]["values"], json!([r"C:\\Mono Code\\monocode.exe", "app", "projects.list", "--input", r"C:\\Temp\\with spaces\\input.json"]));
    }

    #[test]
    fn renamed_preview_reports_its_own_running_executable() {
        const CHILD_PATH: &str = "MONOCODE_TEST_RENAMED_EXECUTABLE";
        if let Some(expected) = std::env::var_os(CHILD_PATH) {
            let injected = crate::control::app_cli_path().unwrap();
            assert_eq!(std::path::Path::new(&injected).canonicalize().unwrap(), std::path::PathBuf::from(expected).canonicalize().unwrap());
            assert_eq!(approval_policy(None, None)["executable"], injected);
            assert!(app_help().contains(&quoted(&injected)));
            assert!(help().contains(&quoted(&injected)));
            assert!(app_cli_executable_matches(injected.clone()));
            assert!(!app_cli_executable_matches(std::path::Path::new(&injected).with_file_name("original.exe").to_string_lossy().into_owned()));
            assert!(!app_cli_executable_matches("monocode.exe".into()));
            #[cfg(windows)] assert!(!injected.starts_with(r"\\?\"));
            return;
        }
        let root = std::env::temp_dir().join(format!("monocode-renamed-preview-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        let original = root.join("original.exe");
        let renamed = root.join("monocode-r5-renamed-preview.exe");
        std::fs::copy(std::env::current_exe().unwrap(), &original).unwrap();
        std::fs::copy(&original, &renamed).unwrap();
        let output = std::process::Command::new(&renamed).args(["--exact", "control_cli::tests::renamed_preview_reports_its_own_running_executable", "--nocapture"])
            .env(CHILD_PATH, &renamed).output().unwrap();
        std::fs::remove_file(renamed).unwrap();
        std::fs::remove_file(original).unwrap();
        std::fs::remove_dir(root).unwrap();
        assert!(output.status.success(), "renamed preview identity failed: {}{}", String::from_utf8_lossy(&output.stdout), String::from_utf8_lossy(&output.stderr));
        assert!(String::from_utf8_lossy(&output.stdout).contains("1 passed"));
    }

    #[test]
    fn approval_policy_uses_cli_actions_and_real_temp_files() {
        assert!(app_cli_executable_matches(std::env::current_exe().unwrap().to_string_lossy().into_owned()));
        assert!(!app_cli_executable_matches("monocode.exe".into()));
        assert!(!app_cli_executable_matches(std::env::temp_dir().to_string_lossy().into_owned()));
        let policy = approval_policy(None, None);
        assert_eq!(policy["tempDir"], ""); // No private root means no automatic --input.
        assert_eq!(policy["actions"], json!(APP_ACTIONS.as_slice()));
        let root = std::env::temp_dir().join(format!("monocode-cli-approval-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        let input = root.join("input.json");
        std::fs::write(&input, "{}").unwrap();
        assert!(temp_input_within(&input, &root));
        assert!(!temp_input_within(&root, &root));
        assert!(!temp_input_within(&root.join("missing.json"), &root));
        assert!(!temp_input_within(&input, &root.join("other")));
        #[cfg(unix)] {
            let escape = root.join("escape");
            std::os::unix::fs::symlink(std::env::current_exe().unwrap(), &escape).unwrap();
            assert!(!temp_input_within(&escape, &root));
            std::fs::remove_file(escape).unwrap();
        }
        std::fs::remove_file(input).unwrap();
        std::fs::remove_dir(root).unwrap();
    }

    #[test]
    fn rtk_trust_is_bounded_to_install_roots_not_names_or_path_search() {
        let home = std::path::PathBuf::from(if cfg!(windows) { "C:/Users/test" } else { "/home/test" });
        let root = home.join(".cargo");
        let temp = home.join("AppData/Local/Temp");
        let roots = vec![root.clone()];
        assert!(rtk_install_path_allowed(&root.join("rtk-1/bin/rtk.exe"), &roots, &temp));
        for path in [home.join("repo/rtk.exe"), temp.join("rtk.exe"), root.join("workspaces/a/rtk.exe"), root.join("scratch/rtk.exe"), root.join("worktrees/a/rtk.exe")] {
            assert!(!rtk_install_path_allowed(&path, &roots, &temp));
        }
        assert!(trusted_rtk_candidate(std::path::Path::new("rtk"), &roots, &temp).is_none());
    }
    #[test]
    fn explains_help_and_malformed_invocations() {
        assert!(matches!(parse_args(&args(&[])), Ok(Parsed::Help)));
        assert!(matches!(parse_args(&args(&["--help"])), Ok(Parsed::Help)));
        // Agents commonly probe a subcommand for its own usage text.
        assert!(matches!(
            parse_args(&args(&["delegate", "--help"])),
            Ok(Parsed::Help)
        ));
        assert!(call(&["get", r#"{"taskId":"x"}"#])
            .unwrap_err()
            .contains("--json"));
        assert!(call(&["get", "--json"]).unwrap_err().contains("--help"));
        assert!(call(&["get", "--taskId", "x"])
            .unwrap_err()
            .contains("Unknown option"));
        assert!(call(&["get", "--json", "{taskId}"])
            .unwrap_err()
            .contains("Invalid JSON"));
    }
    #[test]
    fn help_names_every_action_and_the_real_executable() {
        let text = help();
        for action in ACTIONS {
            assert!(text.contains(action), "help omits {action}");
        }
        assert!(!text.contains("{exe}"));
        assert!(text.contains("--request-id"));
    }
    #[test]
    fn quotes_the_control_path_only_when_the_shell_needs_it() {
        assert_eq!(
            quoted("/Applications/MonoCode.app/Contents/MacOS/monocode"),
            "/Applications/MonoCode.app/Contents/MacOS/monocode"
        );
        assert_eq!(quoted("/Users/a b/MonoCode"), "'/Users/a b/MonoCode'");
        assert_eq!(quoted("C:\\Tools\\monocode.exe"), "C:\\Tools\\monocode.exe");
        assert_eq!(
            quoted("C:\\Program Files\\MonoCode\\monocode.exe"),
            "\"C:\\Program Files\\MonoCode\\monocode.exe\""
        );
        // A backslash escapes in a POSIX shell, so bare would rewrite the path.
        assert_eq!(quoted("/Users/a\\b/MonoCode"), "'/Users/a\\b/MonoCode'");
        assert_eq!(quoted("/Users/it's/MonoCode"), r"'/Users/it'\''s/MonoCode'");
    }
    #[test]
    fn app_mode_exposes_only_app_actions_and_safe_request_ids() {
        assert!(matches!(
            parse_args_for(&args(&["notes.list"]), true),
            Ok(Parsed::Call(_, _, _))
        ));
        for action in [
            "sessions.read",
            "sessions.send",
            "sessions.draft",
            "sessions.stop",
            "sessions.archive",
            "sessions.delete",
        ] {
            assert!(matches!(
                parse_args_for(&args(&[action, "--json", r#"{"sessionId":"other"}"#]), true),
                Ok(Parsed::Call(_, _, _))
            ));
            assert!(app_help().contains(action));
            assert!(parse_args_for(&args(&[action]), false).is_err());
        }
        assert!(app_help().contains("draft:true"));
        assert!(app_help().contains("inherit this"));
        assert!(parse_args_for(&args(&["delegate"]), true).is_err());
        assert!(
            parse_args_for(&args(&["sessions.start", "--request-id", "bad/id"]), true).is_err()
        );
        assert!(app_help().contains("notes.read"));
        assert!(app_help().contains("notes.write"));
        for action in [
            "worktrees.list",
            "worktrees.create",
            "artifacts.list",
            "artifacts.read",
            "artifacts.write",
        ] {
            assert!(matches!(
                parse_args_for(&args(&[action]), true),
                Ok(Parsed::Call(_, _, _))
            ));
            assert!(app_help().contains(action));
        }
        assert!(app_help().contains(r#""kind":"document""#));
        assert!(app_help().contains("Artifacts are separate from Notes"));
    }

    #[test]
    fn inactive_app_turn_does_not_suggest_retries() {
        let denied = with_retry_hint(json!({"ok":false,"retryable":false}), "id-1");
        assert!(denied.get("retryWith").is_none());
        assert!(denied.get("requestId").is_none());
        let uncertain = with_retry_hint(json!({"ok":false,"error":"timeout"}), "id-1");
        assert_eq!(uncertain["retryWith"], "--request-id id-1");
    }

    #[test]
    fn app_mode_accepts_chat_cards_and_documents_every_type() {
        for input in [
            r#"{"type":"pr","repo":"owner/repo","number":123}"#,
            r#"{"type":"session","sessionId":"other"}"#,
            r#"{"type":"choices","options":["Review","Ship"]}"#,
            r#"{"type":"habit","name":"Check CI","instructions":"Check CI","schedule":{"kind":"daily","time":"09:00"}}"#,
        ] {
            assert!(matches!(
                parse_args_for(&args(&["chat.card", "--json", input]), true),
                Ok(Parsed::Call(action, parsed_input, _))
                    if action == "chat.card"
                        && parsed_input == serde_json::from_str::<Value>(input).unwrap()
            ));
        }
        assert!(parse_args_for(&args(&["chat.card"]), false).is_err());
        let help = app_help();
        assert!(help.contains("chat.card"));
        for kind in ["pr", "session", "choices", "habit"] {
            assert!(help.contains(&format!(r#""type":"{kind}""#)));
        }
    }

    #[test]
    fn app_mode_exposes_soul_actions_and_documents_requested_updates() {
        for (action, input) in [
            ("soul.read", r#"{}"#),
            (
                "soul.update",
                r##"{"text":"# Soul\n","expectedHash":"old-hash"}"##,
            ),
        ] {
            assert!(matches!(
                parse_args_for(&args(&[action, "--json", input]), true),
                Ok(Parsed::Call(parsed_action, parsed_input, _))
                    if parsed_action == action
                        && parsed_input == serde_json::from_str::<Value>(input).unwrap()
            ));
            assert!(parse_args_for(&args(&[action]), false).is_err());
            assert!(app_help().contains(action));
        }
        assert!(app_help().contains("only when the user asks"));
        assert!(app_help().contains("expectedHash"));
        assert!(app_help().contains("Habit runs and other sessions cannot change"));
    }
}
