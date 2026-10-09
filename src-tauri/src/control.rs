//! Authenticated loopback transport. App windows own execution; callers never
//! receive arbitrary Tauri command access or direct database write access.
use std::collections::{HashMap, HashSet};
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Component, Path, PathBuf};
use std::process::Command;
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};

const APP_TURN_INACTIVE: &str = "MonoCode app access is inactive. Use /operator once in this thread to enable it, then call the CLI during an active agent turn. Retrying this request now will not enable access.";

#[derive(Clone)]
struct Grant {
    window: String,
    session: String,
    cwd: String,
    token: String,
}
struct Pending {
    window: String,
    reply: mpsc::Sender<Value>,
}
struct ActiveTurn {
    window: String,
    app_allowed: bool,
    mono_manager_id: Option<String>,
    org_member: bool,
}
#[derive(Default)]
struct Inner {
    grants: HashMap<String, Grant>,
    app_grants: HashMap<String, Grant>,
    pending: HashMap<String, Pending>,
    workers: HashMap<String, String>,
    unreserved_workers: HashSet<String>,
    scratch: HashMap<String, PathBuf>,
    active: HashMap<String, ActiveTurn>,
    mono_sessions: HashSet<String>,
    habit_grants: HashMap<String, Grant>,
}
impl Inner {
    fn attached_worker(&self, session: &str, window: &str) -> bool {
        !self.habit_grants.contains_key(session)
            && self
                .workers
                .get(session)
                .and_then(|lead| self.grants.get(lead))
                .is_some_and(|lead| lead.window == window)
    }
    fn checkout_grant(&self, session: &str, cwd: &str) -> Option<&Grant> {
        self.app_grants.values().find(|grant| {
            grant.session != session
                && self.active.contains_key(&grant.session)
                && self.attached_worker(&grant.session, &grant.window)
                && !self.unreserved_workers.contains(&grant.session)
                && path_within(cwd, &grant.cwd)
        })
    }

    fn authorize_checkout(&self, session: &str, window: &str, cwd: &str) -> Result<(), String> {
        // Checkout reservations serialize workers; they never exclude the user.
        if self.attached_worker(session, window)
            && !self.unreserved_workers.contains(session)
            && self.checkout_grant(session, cwd).is_some()
        {
            return Err("Another worker is assigned to this checkout. Wait for that task before starting another agent.".into());
        }
        Ok(())
    }

    // Provider processes can stay alive between turns, so install the token
    // before their first spawn. request_grant still requires an opted-in turn.
    fn prepare_app_grant(&mut self, session: &str, window: &str, cwd: &str) -> bool {
        if self.grants.contains_key(session) && !self.mono_sessions.contains(session) {
            return false;
        }
        let token = self
            .app_grants
            .get(session)
            .map(|grant| grant.token.clone())
            .unwrap_or_else(|| {
                format!(
                    "{}{}",
                    uuid::Uuid::new_v4().simple(),
                    uuid::Uuid::new_v4().simple()
                )
            });
        self.app_grants.insert(
            session.to_string(),
            Grant {
                window: window.to_string(),
                session: session.to_string(),
                cwd: cwd.to_string(),
                token,
            },
        );
        true
    }

    fn window_sessions(&self, label: &str) -> Vec<String> {
        let leads: Vec<String> = self
            .grants
            .values()
            .filter(|grant| grant.window == label)
            .map(|grant| grant.session.clone())
            .collect();
        let mut ids = leads.clone();
        ids.extend(
            self.app_grants
                .values()
                .filter(|grant| grant.window == label)
                .map(|grant| grant.session.clone()),
        );
        ids.extend(
            self.workers
                .iter()
                .filter(|(_, lead)| leads.contains(lead))
                .map(|(id, _)| id.clone()),
        );
        ids.extend(
            self.active
                .iter()
                .filter(|(_, turn)| turn.window == label)
                .map(|(id, _)| id.clone()),
        );
        ids.sort();
        ids.dedup();
        ids
    }
    fn close_window(&mut self, label: &str) -> Vec<String> {
        let ids = self.window_sessions(label);
        self.grants.retain(|id, _| !ids.contains(id));
        self.app_grants.retain(|id, _| !ids.contains(id));
        self.workers.retain(|id, _| !ids.contains(id));
        self.unreserved_workers.retain(|id| !ids.contains(id));
        self.scratch.retain(|id, _| !ids.contains(id));
        self.active.retain(|id, _| !ids.contains(id));
        self.mono_sessions.retain(|id| !ids.contains(id));
        self.habit_grants.retain(|id, _| !ids.contains(id));
        self.pending.retain(|_, pending| {
            if pending.window != label {
                return true;
            }
            let _ = pending
                .reply
                .send(json!({"ok":false,"error":"MonoCode window closed"}));
            false
        });
        ids
    }
}
pub struct ControlHost {
    endpoint: String,
    inner: Arc<Mutex<Inner>>,
}

fn path_within(path: &str, checkout: &str) -> bool {
    path == checkout || path.starts_with(&format!("{checkout}/"))
}

/** Windows paths compare case-insensitively; POSIX paths must retain case. */
fn comparison_path(path: &Path) -> String {
    let value = path.to_string_lossy().replace('\\', "/");
    if cfg!(windows) {
        value.to_lowercase()
    } else {
        value
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Request {
    token: String,
    namespace: String,
    action: String,
    input: Value,
    request_id: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Event {
    id: String,
    namespace: String,
    session_id: String,
    request_id: String,
    action: String,
    input: Value,
}

#[cfg(test)]
fn request_grant(host: &Inner, namespace: &str, token: &str) -> Result<Grant, String> {
    request_action_grant(host, namespace, token, "")
}

fn request_action_grant(
    host: &Inner,
    namespace: &str,
    token: &str,
    action: &str,
) -> Result<Grant, String> {
    let grant = match namespace {
        "control" => host
            .grants
            .values()
            .chain(host.habit_grants.values())
            .find(|grant| grant.token == token),
        "app" => host.app_grants.values().find(|grant| grant.token == token),
        _ => return Err("Unknown control namespace".into()),
    }
    .cloned()
    .ok_or("Connection revoked or unauthorized")?;
    let org_member = host
        .active
        .get(&grant.session)
        .is_some_and(|turn| turn.org_member);
    if namespace == "app" && org_member && !host.attached_worker(&grant.session, &grant.window) {
        return Err(APP_TURN_INACTIVE.into());
    }
    let member_artifact = org_member
        && matches!(
            action,
            "artifacts.list" | "artifacts.read" | "artifacts.write"
        );
    let member_message = org_member && action == "team.message";
    let member_metadata = org_member && matches!(action, "projects.status" | "models.list");
    if namespace == "control"
        && host.habit_grants.contains_key(&grant.session)
        && (host.workers.get(&grant.session).is_none_or(|owner| {
            host.grants
                .get(owner)
                .is_none_or(|parent| parent.window != grant.window)
        }) || host
            .active
            .get(&grant.session)
            .is_none_or(|turn| turn.window != grant.window || !turn.app_allowed))
    {
        return Err(APP_TURN_INACTIVE.into());
    }
    if namespace == "app"
        && ((host.grants.contains_key(&grant.session)
            && !host.mono_sessions.contains(&grant.session))
            || (host.workers.contains_key(&grant.session)
                && !host.habit_grants.contains_key(&grant.session)
                && !matches!(action, "reviews.submit" | "memory.add")
                && !member_artifact
                && !member_message
                && !member_metadata)
            || !host
                .active
                .get(&grant.session)
                .is_some_and(|turn| turn.window == grant.window && turn.app_allowed))
    {
        return Err(APP_TURN_INACTIVE.into());
    }
    if namespace == "app"
        && action.starts_with("team.")
        && !matches!(action, "team.answer" | "team.message")
        && host
            .active
            .get(&grant.session)
            .is_none_or(|turn| turn.mono_manager_id.is_none())
    {
        return Err("Only a Manager can manage its own team".into());
    }
    Ok(grant)
}

pub fn init(app: &AppHandle) -> Result<(), String> {
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    let endpoint = listener
        .local_addr()
        .map_err(|e| e.to_string())?
        .to_string();
    let inner = Arc::new(Mutex::new(Inner::default()));
    app.manage(ControlHost {
        endpoint,
        inner: inner.clone(),
    });
    let app = app.clone();
    std::thread::spawn(move || {
        // Limit concurrent readers, including unauthenticated sockets.
        let (tx, rx) = mpsc::sync_channel::<TcpStream>(32);
        let rx = Arc::new(Mutex::new(rx));
        for _ in 0..8 {
            let rx = rx.clone();
            let app = app.clone();
            let inner = inner.clone();
            std::thread::spawn(move || loop {
                let stream = match rx.lock() {
                    Ok(rx) => rx.recv(),
                    Err(_) => return,
                };
                let Ok(stream) = stream else { return };
                serve(stream, &app, &inner);
            });
        }
        for stream in listener.incoming().flatten() {
            let _ = tx.try_send(stream);
        }
    });
    Ok(())
}

fn serve(mut stream: TcpStream, app: &AppHandle, inner: &Arc<Mutex<Inner>>) {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(3)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(3)));
    let result = (|| -> Result<Value, String> {
        let mut raw = String::new();
        BufReader::new(&mut stream)
            .take(262_145)
            .read_line(&mut raw)
            .map_err(|e| e.to_string())?;
        if raw.len() > 262_144 {
            return Err("Request exceeds 256 KiB".into());
        }
        let request: Request = serde_json::from_str(&raw).map_err(|_| "Invalid control request")?;
        if !request.input.is_object()
            || request.request_id.is_empty()
            || request.request_id.len() > 128
        {
            return Err("Invalid input or request ID".into());
        }
        if request.namespace == "app" {
            crate::control_cli::validate_app_request(
                &request.action,
                &request.input,
                &request.request_id,
            )?;
        }
        let id = uuid::Uuid::new_v4().to_string();
        let (tx, rx) = mpsc::channel();
        let grant = {
            let mut host = inner.lock().map_err(|_| "Control service unavailable")?;
            let grant =
                request_action_grant(&host, &request.namespace, &request.token, &request.action)?;
            if host.pending.len() >= 24 {
                return Err("Too many pending control requests".into());
            }
            host.pending.insert(
                id.clone(),
                Pending {
                    window: grant.window.clone(),
                    reply: tx,
                },
            );
            grant
        };
        let event = Event {
            id: id.clone(),
            namespace: request.namespace,
            session_id: grant.session,
            request_id: request.request_id,
            action: request.action,
            input: request.input,
        };
        let delivered = app.emit_to(grant.window.as_str(), "monocode-control-request", event);
        let result = if delivered.is_err() {
            Err("MonoCode executor is unavailable".into())
        } else {
            rx.recv_timeout(Duration::from_secs(35))
                .map_err(|_| "Control request timed out. Retry with the same request ID.".into())
        };
        if let Ok(mut host) = inner.lock() {
            host.pending.remove(&id);
        }
        result
    })();
    let response = result.unwrap_or_else(|error| {
        if error == APP_TURN_INACTIVE {
            json!({"ok": false, "error": error, "retryable": false})
        } else {
            json!({"ok": false, "error": error})
        }
    });
    let _ = writeln!(stream, "{response}");
}

#[tauri::command]
pub fn control_enable(
    window: WebviewWindow,
    host: State<'_, ControlHost>,
    session_id: String,
    cwd: String,
) -> Result<String, String> {
    let cwd = std::fs::canonicalize(crate::fs::expand_home(&cwd)).map_err(|e| e.to_string())?;
    if !cwd.is_dir() {
        return Err("Choose a project folder first".into());
    }
    let cwd = comparison_path(&cwd);
    let mut inner = host
        .inner
        .lock()
        .map_err(|_| "Control service unavailable")?;
    // A lead may return to ordinary chat without respawning its provider.
    // Keep its app token installed but unusable until a later opted-in turn.
    inner.prepare_app_grant(&session_id, window.label(), &cwd);
    inner.grants.insert(
        session_id.clone(),
        Grant {
            window: window.label().into(),
            session: session_id.clone(),
            cwd,
            token: format!(
                "{}{}",
                uuid::Uuid::new_v4().simple(),
                uuid::Uuid::new_v4().simple()
            ),
        },
    );
    crate::control_cli::running_executable()
}

#[tauri::command]
pub fn control_disable(
    window: WebviewWindow,
    host: State<'_, ControlHost>,
    session_id: String,
) -> Result<(), String> {
    let mut inner = host
        .inner
        .lock()
        .map_err(|_| "Control service unavailable")?;
    if inner
        .grants
        .get(&session_id)
        .is_some_and(|g| g.window == window.label())
    {
        inner.grants.remove(&session_id);
        inner.workers.retain(|_, parent| parent != &session_id);
        let workers = inner.workers.clone();
        inner
            .unreserved_workers
            .retain(|id| workers.contains_key(id));
        inner.habit_grants.retain(|id, _| workers.contains_key(id));
        inner.scratch.retain(|id, _| workers.contains_key(id));
    }
    Ok(())
}

#[tauri::command]
pub fn control_attach_worker(
    window: WebviewWindow,
    host: State<'_, ControlHost>,
    lead_id: String,
    session_id: String,
    mono_habit: Option<bool>,
    checkout_reserved: Option<bool>,
) -> Result<String, String> {
    let mut inner = host
        .inner
        .lock()
        .map_err(|_| "Control service unavailable")?;
    if inner
        .grants
        .get(&lead_id)
        .is_none_or(|grant| grant.window != window.label())
    {
        return Err("Lead connection is inactive".into());
    }
    let scratch = match inner.scratch.get(&session_id) {
        Some(path) if path.is_dir() => path.clone(),
        _ => create_worker_scratch()?,
    };
    if mono_habit == Some(true) {
        let parent = inner.grants[&lead_id].clone();
        inner
            .habit_grants
            .entry(session_id.clone())
            .or_insert_with(|| Grant {
                window: parent.window,
                cwd: parent.cwd,
                session: session_id.clone(),
                token: format!(
                    "{}{}",
                    uuid::Uuid::new_v4().simple(),
                    uuid::Uuid::new_v4().simple()
                ),
            });
    } else {
        inner.habit_grants.remove(&session_id);
    }
    if checkout_reserved == Some(false) {
        inner.unreserved_workers.insert(session_id.clone());
    } else {
        inner.unreserved_workers.remove(&session_id);
    }
    inner.workers.insert(session_id.clone(), lead_id);
    // A retained worker process keeps its token; request_action_grant narrows it.
    inner.scratch.insert(session_id, scratch.clone());
    Ok(worker_scratch_path(&scratch))
}

fn create_worker_scratch() -> Result<PathBuf, String> {
    let path = std::env::temp_dir().join(format!("monocode-worker-{}", uuid::Uuid::new_v4()));
    let builder = std::fs::DirBuilder::new();
    #[cfg(unix)]
    let builder = {
        use std::os::unix::fs::DirBuilderExt;
        let mut builder = builder;
        builder.mode(0o700);
        builder
    };
    builder.create(&path).map_err(|e| e.to_string())?;
    std::fs::canonicalize(path).map_err(|e| e.to_string())
}

fn configure_worker_scratch(cmd: &mut Command, path: &Path) {
    // Native temp-file helpers and shell mktemp use the same private scope
    // that is named in the worker's assignment prompt.
    let shell_path = worker_scratch_path(path);
    cmd.env("TMPDIR", &shell_path)
        .env("TMP", &shell_path)
        .env("TEMP", &shell_path);
}

fn worker_scratch_path(path: &Path) -> String {
    let value = crate::fs::path_to_js(path);
    // Git Bash cannot use canonicalize's Win32 device prefix as TMPDIR.
    // Keep the canonical PathBuf for ownership checks; expose a shell path.
    if cfg!(windows) {
        if let Some(unc) = value.strip_prefix("//?/UNC/") {
            return format!("//{unc}");
        }
        if let Some(drive) = value.strip_prefix("//?/") {
            return drive.to_string();
        }
    }
    value
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn control_authorize_turn(
    window: WebviewWindow,
    host: State<'_, ControlHost>,
    session_id: String,
    cwd: String,
    app_access: bool,
    mono_session: Option<bool>,
    mono_manager_id: Option<String>,
    mono_member_id: Option<String>,
) -> Result<(), String> {
    let cwd = std::fs::canonicalize(crate::fs::expand_home(&cwd)).map_err(|e| e.to_string())?;
    let cwd = comparison_path(&cwd);
    let mut inner = host
        .inner
        .lock()
        .map_err(|_| "Control service unavailable")?;
    inner.authorize_checkout(&session_id, window.label(), &cwd)?;
    if mono_session == Some(true) && !inner.workers.contains_key(&session_id) {
        inner.mono_sessions.insert(session_id.clone());
    } else {
        inner.mono_sessions.remove(&session_id);
    }
    let eligible = inner.prepare_app_grant(&session_id, window.label(), &cwd);
    // Only a Mono's own conversation or its attached Habit can carry Manager
    // authority. Member workers cannot acquire it from their assignment text.
    let mono_manager_id = mono_manager_id.filter(|id| {
        !id.is_empty()
            && id.len() <= 256
            && (inner.mono_sessions.contains(&session_id)
                || inner.habit_grants.contains_key(&session_id))
    });
    let app_allowed = app_access && eligible;
    // The renderer supplies identity from the actual assigned task, not CLI input.
    let org_member = mono_member_id.is_some_and(|id| !id.is_empty() && id.len() <= 256)
        && inner.attached_worker(&session_id, window.label());
    inner.active.insert(
        session_id,
        ActiveTurn {
            window: window.label().to_string(),
            app_allowed,
            mono_manager_id,
            org_member,
        },
    );
    Ok(())
}

#[tauri::command]
pub fn control_turn_finished(host: State<'_, ControlHost>, session_id: String) {
    if let Ok(mut inner) = host.inner.lock() {
        inner.active.remove(&session_id);
    }
}

pub fn window_closed(app: &AppHandle, label: &str) {
    let host = app.state::<ControlHost>();
    let ids = {
        let Ok(inner) = host.inner.lock() else { return };
        inner.window_sessions(label)
    };
    for id in &ids {
        let _ = crate::harness::harness_kill(app.state(), id.clone());
        crate::app_cli_inputs::remove(id);
    }
    if let Ok(mut inner) = host.inner.lock() {
        inner.close_window(label);
    };
}

pub fn configure_child(app: &AppHandle, session_id: &str, cmd: &mut Command) {
    cmd.env_remove("MONOCODE_CONTROL_ENDPOINT")
        .env_remove("MONOCODE_CONTROL_TOKEN")
        .env_remove("MONOCODE_APP_ENDPOINT")
        .env_remove("MONOCODE_APP_TOKEN");
    let Some(host) = app.try_state::<ControlHost>() else {
        return;
    };
    if let Ok(inner) = host.inner.lock() {
        if let Some(grant) = inner
            .grants
            .get(session_id)
            .or_else(|| inner.habit_grants.get(session_id))
        {
            cmd.env("MONOCODE_CONTROL_ENDPOINT", &host.endpoint)
                .env("MONOCODE_CONTROL_TOKEN", &grant.token);
        }
        if let Some(grant) = inner.app_grants.get(session_id) {
            cmd.env("MONOCODE_APP_ENDPOINT", &host.endpoint)
                .env("MONOCODE_APP_TOKEN", &grant.token);
        }
        if let Some(scratch) = inner.scratch.get(session_id) {
            configure_worker_scratch(cmd, scratch);
        }
    };
}

#[tauri::command]
pub fn app_cli_path() -> Result<String, String> {
    crate::control_cli::running_executable()
}

#[tauri::command]
pub fn control_reply(
    window: WebviewWindow,
    host: State<'_, ControlHost>,
    id: String,
    response: Value,
) -> Result<(), String> {
    let mut inner = host
        .inner
        .lock()
        .map_err(|_| "Control service unavailable")?;
    if inner
        .pending
        .get(&id)
        .is_some_and(|p| p.window == window.label())
    {
        if let Some(pending) = inner.pending.remove(&id) {
            let _ = pending.reply.send(response);
        }
    }
    Ok(())
}

#[tauri::command]
pub fn control_save(
    store: State<'_, crate::session_store::SessionStore>,
    lead_id: String,
    state: String,
) -> Result<(), String> {
    if state.len() > 8_000_000 {
        return Err("Orchestration history is too large".into());
    }
    let run: Value = serde_json::from_str(&state).map_err(|_| "Invalid run state")?;
    let conn = store.lock_conn()?;
    crate::session_store::save_orchestration(&conn, &lead_id, &run).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn control_load(
    store: State<'_, crate::session_store::SessionStore>,
    lead_id: String,
) -> Result<Option<String>, String> {
    use rusqlite::OptionalExtension;
    store
        .lock_conn()?
        .query_row(
            "SELECT state FROM orchestration_runs WHERE lead_id=?1",
            [lead_id],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())
}

fn resolve_scope(root: &Path, value: &str) -> Result<String, String> {
    let path = Path::new(value);
    if value.is_empty()
        || path.is_absolute()
        || path
            .components()
            .any(|c| matches!(c, Component::ParentDir | Component::Prefix(_)))
    {
        return Err("Write scopes must be project-relative paths without '..'".into());
    }
    let root = std::fs::canonicalize(root).map_err(|e| e.to_string())?;
    let mut existing = root.join(path);
    let mut missing = Vec::new();
    while !existing.exists() {
        missing.push(existing.file_name().ok_or("Invalid scope")?.to_os_string());
        if !existing.pop() {
            return Err("Invalid scope".into());
        }
    }
    existing = std::fs::canonicalize(existing).map_err(|e| e.to_string())?;
    if !existing.starts_with(&root) {
        return Err("Write scope points outside the project".into());
    }
    for part in missing.into_iter().rev() {
        existing.push(part);
    }
    Ok(comparison_path(&existing))
}

/// Resolve reported writes as well as scopes: aliases and symlinks must not
/// turn a private scratch directory into an exemption for another worker's files.
#[tauri::command]
pub fn control_write_path(path: String) -> Result<String, String> {
    let path = Path::new(&path);
    if !path.is_absolute() {
        return Err("Reported write paths must be absolute".into());
    }
    let mut existing = path;
    let mut missing = Vec::new();
    while !existing.exists() {
        // A dangling symlink cannot be treated as a new ordinary file.
        if std::fs::symlink_metadata(existing).is_ok() {
            return Err("Reported write path contains a dangling symlink".into());
        }
        missing.push(
            existing
                .file_name()
                .ok_or("Invalid write path")?
                .to_os_string(),
        );
        existing = existing.parent().ok_or("Invalid write path")?;
    }
    let mut resolved = std::fs::canonicalize(existing).map_err(|e| e.to_string())?;
    for part in missing.into_iter().rev() {
        resolved.push(part);
    }
    Ok(resolved.to_string_lossy().replace('\\', "/"))
}

#[tauri::command]
pub fn control_scopes(cwd: String, files: Vec<String>) -> Result<Vec<String>, String> {
    if files.len() > 64 {
        return Err("At most 64 write scopes per task".into());
    }
    files
        .iter()
        .map(|file| {
            resolve_scope(&crate::fs::expand_home(&cwd), file)
                .map_err(|error| format!("Invalid write scope \"{file}\": {error}"))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn app_tokens_are_bound_to_active_turns_and_cannot_control_orchestration() {
        let mut inner = Inner::default();
        inner.app_grants.insert(
            "ordinary".into(),
            Grant {
                window: "main".into(),
                session: "ordinary".into(),
                cwd: "/repo".into(),
                token: "app-token".into(),
            },
        );
        assert!(matches!(
            request_grant(&inner, "app", "app-token"),
            Err(error) if error == APP_TURN_INACTIVE
        ));
        inner.active.insert(
            "ordinary".into(),
            ActiveTurn {
                window: "main".into(),
                app_allowed: true,
                mono_manager_id: None,
                org_member: false,
            },
        );
        assert!(request_grant(&inner, "app", "app-token").is_ok());
        assert!(request_grant(&inner, "control", "app-token").is_err());
        inner.active.get_mut("ordinary").unwrap().app_allowed = false;
        assert!(request_grant(&inner, "app", "app-token").is_err());
        inner.active.remove("ordinary");
        assert!(request_grant(&inner, "app", "app-token").is_err());
    }
    #[test]
    fn app_token_survives_normal_turns_but_only_works_when_opted_in() {
        let mut inner = Inner::default();
        assert!(inner.prepare_app_grant("ordinary", "main", "/repo"));
        let token = inner.app_grants["ordinary"].token.clone();
        inner.active.insert(
            "ordinary".into(),
            ActiveTurn {
                window: "main".into(),
                app_allowed: false,
                mono_manager_id: None,
                org_member: false,
            },
        );
        assert!(request_grant(&inner, "app", &token).is_err());
        assert!(inner.prepare_app_grant("ordinary", "main", "/repo"));
        assert_eq!(inner.app_grants["ordinary"].token, token);
        inner.grants.insert(
            "ordinary".into(),
            Grant {
                window: "main".into(),
                session: "ordinary".into(),
                cwd: "/repo".into(),
                token: "control-token".into(),
            },
        );
        assert!(!inner.prepare_app_grant("ordinary", "main", "/repo"));
        inner.active.get_mut("ordinary").unwrap().app_allowed = true;
        assert!(request_grant(&inner, "app", &token).is_err());
        inner.grants.remove("ordinary");
        assert!(inner.prepare_app_grant("ordinary", "main", "/repo"));
        assert_eq!(inner.app_grants["ordinary"].token, token);
        inner.active.get_mut("ordinary").unwrap().app_allowed = true;
        assert!(request_grant(&inner, "app", &token).is_ok());
        inner.active.remove("ordinary");
        assert!(request_grant(&inner, "app", &token).is_err());
    }

    #[test]
    fn mono_leads_keep_app_actions_and_org_workers_gain_only_artifact_actions() {
        let mut inner = Inner::default();
        assert!(inner.prepare_app_grant("lead", "main", "/repo"));
        let token = inner.app_grants["lead"].token.clone();
        inner.grants.insert(
            "lead".into(),
            Grant {
                window: "main".into(),
                session: "lead".into(),
                cwd: "/repo".into(),
                token: "control-token".into(),
            },
        );
        inner.active.insert(
            "lead".into(),
            ActiveTurn {
                window: "main".into(),
                app_allowed: true,
                mono_manager_id: None,
                org_member: false,
            },
        );
        assert!(request_action_grant(&inner, "app", &token, "chat.card").is_err());
        inner.mono_sessions.insert("lead".into());
        assert!(inner.prepare_app_grant("lead", "main", "/repo"));
        for action in [
            "soul.read",
            "memory.add",
            "habits.list",
            "chat.card",
            "team.answer",
            "projects.list",
            "goals.assign",
        ] {
            assert!(request_action_grant(&inner, "app", &token, action).is_ok());
        }
        assert!(request_action_grant(&inner, "control", &token, "list").is_err());
        inner.workers.insert("worker".into(), "lead".into());
        assert!(inner.prepare_app_grant("worker", "main", "/repo-worker"));
        let worker_token = inner.app_grants["worker"].token.clone();
        inner.active.insert(
            "worker".into(),
            ActiveTurn {
                window: "main".into(),
                app_allowed: true,
                mono_manager_id: None,
                org_member: false,
            },
        );
        for action in ["reviews.submit", "memory.add"] {
            assert!(request_action_grant(&inner, "app", &worker_token, action).is_ok());
        }
        for action in [
            "artifacts.list",
            "artifacts.read",
            "artifacts.write",
            "sessions.start",
            "team.answer",
            "team.message",
            "projects.status",
            "models.list",
            "goals.assign",
            "soul.update",
            "memory.read",
            "chat.card",
            "",
        ] {
            assert!(request_action_grant(&inner, "app", &worker_token, action).is_err());
        }
        inner.active.get_mut("worker").unwrap().org_member = true;
        for action in [
            "artifacts.list",
            "artifacts.read",
            "artifacts.write",
            "reviews.submit",
            "memory.add",
            "team.message",
            "projects.status",
            "models.list",
        ] {
            assert!(request_action_grant(&inner, "app", &worker_token, action).is_ok());
        }
        for action in [
            "sessions.stop",
            "sessions.delete",
            "goals.assign",
            "team.hire",
            "delegate",
            "artifacts.delete",
        ] {
            assert!(request_action_grant(&inner, "app", &worker_token, action).is_err());
        }
        assert!(request_action_grant(&inner, "control", &worker_token, "delegate").is_err());
        inner.active.get_mut("worker").unwrap().app_allowed = false;
        assert!(request_action_grant(&inner, "app", &worker_token, "artifacts.write").is_err());
        inner.active.get_mut("worker").unwrap().app_allowed = true;
        let parent = inner.grants.remove("lead").unwrap();
        assert!(request_action_grant(&inner, "app", &worker_token, "artifacts.write").is_err());
        inner.grants.insert("lead".into(), parent);
        inner.workers.remove("worker");
        assert!(request_action_grant(&inner, "app", &worker_token, "artifacts.write").is_err());
        assert!(request_action_grant(&inner, "app", &worker_token, "team.message").is_err());
        inner.workers.insert("worker".into(), "lead".into());
        inner.grants.get_mut("lead").unwrap().window = "other".into();
        assert!(request_action_grant(&inner, "app", &worker_token, "artifacts.write").is_err());
        inner.grants.get_mut("lead").unwrap().window = "main".into();
        inner.active.remove("worker");
        assert!(request_action_grant(&inner, "app", &worker_token, "reviews.submit").is_err());
        assert!(request_action_grant(&inner, "app", &worker_token, "team.message").is_err());
        assert!(request_action_grant(&inner, "app", &worker_token, "artifacts.write").is_err());
        inner.active.remove("lead");
        assert!(request_action_grant(&inner, "app", &token, "memory.add").is_err());
    }

    #[test]
    fn native_team_actions_require_manager_authority_and_an_active_own_turn() {
        let mut inner = Inner::default();
        for identity in ["ordinary", "orchestrator", "member", "manager"] {
            assert!(inner.prepare_app_grant(identity, "main", "/repo"));
            inner.mono_sessions.insert(identity.into());
            inner.active.insert(
                identity.into(),
                ActiveTurn {
                    window: "main".into(),
                    app_allowed: true,
                    mono_manager_id: (identity == "manager").then(|| "manager-id".into()),
                    org_member: false,
                },
            );
            let token = &inner.app_grants[identity].token;
            for action in [
                "team.list",
                "team.hire",
                "team.update",
                "team.memory.add",
                "team.memory.forget",
                "team.retire",
            ] {
                assert_eq!(
                    request_action_grant(&inner, "app", token, action).is_ok(),
                    identity == "manager"
                );
            }
        }
        let token = inner.app_grants["manager"].token.clone();
        inner.active.get_mut("manager").unwrap().app_allowed = false;
        assert!(request_action_grant(&inner, "app", &token, "team.hire").is_err());
        inner.active.get_mut("manager").unwrap().app_allowed = true;
        inner.active.get_mut("manager").unwrap().window = "other".into();
        assert!(request_action_grant(&inner, "app", &token, "team.hire").is_err());
    }

    #[test]
    fn manager_habit_has_its_own_active_only_control_identity() {
        let mut inner = Inner::default();
        inner.grants.insert(
            "manager".into(),
            Grant {
                session: "manager".into(),
                window: "main".into(),
                cwd: "/repo".into(),
                token: "manager-control".into(),
            },
        );
        inner.workers.insert("habit".into(), "manager".into());
        inner.habit_grants.insert(
            "habit".into(),
            Grant {
                session: "habit".into(),
                window: "main".into(),
                cwd: "/repo".into(),
                token: "habit-control".into(),
            },
        );
        assert!(request_action_grant(&inner, "control", "habit-control", "delegate").is_err());
        inner.active.insert(
            "habit".into(),
            ActiveTurn {
                window: "main".into(),
                app_allowed: true,
                mono_manager_id: None,
                org_member: false,
            },
        );
        assert_eq!(
            request_action_grant(&inner, "control", "habit-control", "delegate")
                .unwrap()
                .session,
            "habit"
        );
        assert!(inner.prepare_app_grant("habit", "main", "/repo"));
        let app = inner.app_grants["habit"].token.clone();
        assert!(request_action_grant(&inner, "app", &app, "memory.read").is_ok());
        assert!(request_action_grant(&inner, "control", &app, "delegate").is_err());
        inner.grants.remove("manager");
        assert!(request_action_grant(&inner, "control", "habit-control", "delegate").is_err());
    }
    #[cfg(not(windows))]
    #[test]
    fn comparison_keys_preserve_posix_case() {
        assert_eq!(comparison_path(Path::new("/tmp/Foo")), "/tmp/Foo");
        assert_ne!(
            comparison_path(Path::new("/tmp/Foo")),
            comparison_path(Path::new("/tmp/foo"))
        );
    }

    #[test]
    fn workers_get_distinct_private_scratch_and_matching_temp_environment() {
        let first = create_worker_scratch().unwrap();
        let second = create_worker_scratch().unwrap();
        assert_ne!(first, second);
        assert!(first.is_absolute());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                std::fs::metadata(&first).unwrap().permissions().mode() & 0o777,
                0o700
            );
        }
        let mut cmd = Command::new("unused");
        configure_worker_scratch(&mut cmd, &first);
        let shell_path = worker_scratch_path(&first);
        assert!(Path::new(&shell_path).is_dir());
        assert!(!shell_path.starts_with("//?/"));
        for key in ["TMPDIR", "TMP", "TEMP"] {
            assert!(cmd.get_envs().any(
                |(name, value)| name == key && value == Some(std::ffi::OsStr::new(&shell_path))
            ));
        }
        let new_file = first.join("new/helper.py");
        assert_eq!(
            control_write_path(new_file.to_string_lossy().into_owned()).unwrap(),
            new_file.to_string_lossy().replace('\\', "/")
        );
        assert!(control_write_path("relative.py".into()).is_err());
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(&second, first.join("escape")).unwrap();
            let resolved = control_write_path(
                first
                    .join("escape/helper.py")
                    .to_string_lossy()
                    .into_owned(),
            )
            .unwrap();
            assert_eq!(resolved, second.join("helper.py").to_string_lossy());
            std::os::unix::fs::symlink(first.join("missing"), first.join("dangling")).unwrap();
            assert!(control_write_path(
                first
                    .join("dangling/helper.py")
                    .to_string_lossy()
                    .into_owned()
            )
            .is_err());
        }
        std::fs::remove_dir_all(first).unwrap();
        std::fs::remove_dir_all(second).unwrap();
    }

    #[test]
    fn closing_a_window_releases_ordinary_turns_and_owned_orchestration() {
        let mut inner = Inner::default();
        for (id, window) in [
            ("ordinary", "closing"),
            ("lead", "closing"),
            ("other", "open"),
        ] {
            inner.active.insert(
                id.into(),
                ActiveTurn {
                    window: window.into(),
                    app_allowed: false,
                    mono_manager_id: None,
                    org_member: false,
                },
            );
        }
        for (id, window) in [("lead", "closing"), ("other", "open")] {
            inner.grants.insert(
                id.into(),
                Grant {
                    window: window.into(),
                    session: id.into(),
                    cwd: format!("/{id}"),
                    token: id.into(),
                },
            );
        }
        inner.workers.insert("worker".into(), "lead".into());
        inner.workers.insert("other-worker".into(), "other".into());
        let (reply, response) = mpsc::channel();
        inner.pending.insert(
            "pending".into(),
            Pending {
                window: "closing".into(),
                reply,
            },
        );
        let (reply, other_response) = mpsc::channel();
        inner.pending.insert(
            "other-pending".into(),
            Pending {
                window: "open".into(),
                reply,
            },
        );

        assert_eq!(
            inner.close_window("closing"),
            ["lead", "ordinary", "worker"]
        );
        assert_eq!(inner.active.len(), 1);
        assert_eq!(inner.active["other"].window, "open");
        assert_eq!(inner.grants.len(), 1);
        assert!(inner.grants.contains_key("other"));
        assert_eq!(inner.workers.len(), 1);
        assert_eq!(inner.workers["other-worker"], "other");
        assert_eq!(response.try_recv().unwrap()["ok"], false);
        assert!(other_response.try_recv().is_err());
        assert!(inner.pending.contains_key("other-pending"));
        assert!(inner.close_window("closing").is_empty());
    }

    #[test]
    fn scopes_reject_escape_and_resolve_new_files() {
        let root = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        std::fs::create_dir_all(&root).unwrap();
        assert!(resolve_scope(&root, "../escape").is_err());
        assert!(resolve_scope(&root, "/absolute").is_err());
        assert!(control_scopes(
            root.to_string_lossy().into_owned(),
            vec!["../escape".into()]
        )
        .unwrap_err()
        .contains("Invalid write scope \"../escape\""));
        assert!(resolve_scope(&root, "src/new.ts")
            .unwrap()
            .ends_with("/src/new.ts"));
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(std::env::temp_dir(), root.join("outside")).unwrap();
            assert!(resolve_scope(&root, "outside/file").is_err());
        }
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn controlled_checkout_does_not_block_parent_turns() {
        let checkout = comparison_path(Path::new("C:/Users/Nooro/projects/App"));
        for (cwd, blocked) in [
            ("C:/Users/Nooro", false),
            ("C:/Users/Nooro/projects/App", true),
            ("C:/Users/Nooro/projects/App/src", true),
            ("C:/Users/Nooro/projects/App-other", false),
        ] {
            assert_eq!(
                path_within(&comparison_path(Path::new(cwd)), &checkout),
                blocked
            );
        }
        #[cfg(windows)]
        assert!(path_within(
            &comparison_path(Path::new("c:\\users\\nooro\\PROJECTS\\app\\src")),
            &checkout,
        ));
    }

    #[test]
    fn project_manager_grants_never_reserve_user_checkouts() {
        let home = comparison_path(Path::new("C:/Users/Nooro"));
        let checkout = format!("{home}/projects/app");
        let mut inner = Inner::default();
        inner.grants.insert(
            "manager".into(),
            Grant {
                window: "main".into(),
                session: "manager".into(),
                cwd: checkout.clone(),
                token: "control-token".into(),
            },
        );
        inner.prepare_app_grant("manager", "main", &checkout);
        inner.active.insert(
            "manager".into(),
            ActiveTurn {
                window: "main".into(),
                app_allowed: true,
                mono_manager_id: Some("dzdistro-manager".into()),
                org_member: false,
            },
        );
        for cwd in [
            &home,
            &checkout,
            &format!("{checkout}/src"),
            &format!("{checkout}-other"),
        ] {
            assert!(inner.checkout_grant("user", cwd).is_none());
            for window in ["main", "other"] {
                assert!(inner.authorize_checkout("user", window, cwd).is_ok());
            }
        }
    }

    #[test]
    fn worker_reservations_only_exclude_other_writable_workers() {
        let mut inner = Inner::default();
        inner.grants.insert(
            "manager".into(),
            Grant {
                window: "main".into(),
                session: "manager".into(),
                cwd: "/project".into(),
                token: "token".into(),
            },
        );
        for session in ["worker", "other-worker", "read-only", "habit"] {
            inner.workers.insert(session.into(), "manager".into());
        }
        inner
            .habit_grants
            .insert("habit".into(), inner.grants["manager"].clone());
        inner.prepare_app_grant("habit", "main", "/project");
        inner.prepare_app_grant("read-only", "main", "/project");
        for session in ["habit", "read-only"] {
            inner.active.insert(
                session.into(),
                ActiveTurn {
                    window: "main".into(),
                    app_allowed: true,
                    mono_manager_id: None,
                    org_member: false,
                },
            );
        }
        inner.unreserved_workers.insert("read-only".into());
        assert!(inner
            .authorize_checkout("worker", "main", "/project")
            .is_ok());
        inner.prepare_app_grant("worker", "main", "/project/task");
        inner.active.insert(
            "worker".into(),
            ActiveTurn {
                window: "main".into(),
                app_allowed: true,
                mono_manager_id: None,
                org_member: true,
            },
        );
        for cwd in ["/project/task", "/project/task/src"] {
            assert!(inner.authorize_checkout("user", "main", cwd).is_ok());
            assert!(inner.authorize_checkout("user", "other", cwd).is_ok());
            assert!(inner.authorize_checkout("manager", "main", cwd).is_ok());
            assert!(inner.authorize_checkout("habit", "main", cwd).is_ok());
            assert!(inner.authorize_checkout("worker", "main", cwd).is_ok());
            assert!(inner.authorize_checkout("read-only", "main", cwd).is_ok());
            assert!(inner
                .authorize_checkout("other-worker", "main", cwd)
                .is_err());
        }
        for cwd in ["/project", "/project/task-other"] {
            assert!(inner
                .authorize_checkout("other-worker", "main", cwd)
                .is_ok());
        }
        inner.unreserved_workers.insert("worker".into());
        assert!(inner
            .authorize_checkout("other-worker", "main", "/project/task")
            .is_ok());
        inner.unreserved_workers.remove("worker");
        inner.active.remove("worker");
        assert!(inner
            .authorize_checkout("other-worker", "main", "/project/task")
            .is_ok());
        inner.active.insert(
            "worker".into(),
            ActiveTurn {
                window: "main".into(),
                app_allowed: true,
                mono_manager_id: None,
                org_member: true,
            },
        );
        inner.grants.remove("manager");
        assert!(inner
            .checkout_grant("other-worker", "/project/task")
            .is_none());
    }
}
