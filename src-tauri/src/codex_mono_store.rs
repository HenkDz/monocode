//! Mono threads retain native Codex rollouts, but outside the Codex app's home.
//! Configuration and credentials remain shared with the selected provider account.

use std::collections::HashSet;
use std::io::{Read, Seek, Write};
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};

mod archive;
mod sandbox;
mod sandbox_config;
#[tauri::command(async)]
pub fn codex_mono_use_unelevated_sandbox(
    app: AppHandle,
    provider_account_id: Option<String>,
) -> Result<sandbox_config::SandboxConfigChange, String> {
    sandbox_config::codex_mono_use_unelevated_sandbox(app, provider_account_id)
}
mod skills;
mod transactions;
use transactions::{ClaimIntent, ClaimJournal};
#[cfg(test)]
mod crash_tests;
#[cfg(test)]
mod transactions_tests;

// Preparation and Repair share one lock, including harness startup.
static STORAGE_LOCK: Mutex<()> = Mutex::new(());
static STORAGE_ISSUES: LazyLock<Mutex<HashSet<String>>> =
    LazyLock::new(|| Mutex::new(HashSet::new()));

#[cfg(test)]
thread_local! {
    static BEFORE_CLAIM: std::cell::RefCell<Option<Box<dyn FnOnce()>>> = const { std::cell::RefCell::new(None) };
}

#[cfg(test)]
fn before_claim() {
    BEFORE_CLAIM.with(|hook| {
        if let Some(writer) = hook.borrow_mut().take() {
            writer();
        }
    });
}

const STATE_NAMES: &[&str] = &[
    "sessions",
    "archived_sessions",
    "session_index.jsonl",
    "history.jsonl",
    "log",
    "logs",
    "tmp",
    "shell_snapshots",
    "memories",
    "backups",
];

pub(crate) struct MonoCodexStore {
    pub home: PathBuf,
    pub sqlite_home: PathBuf,
    auth: Mutex<Vec<KeyringMirror>>,
}

struct KeyringMirror {
    service: &'static str,
    source_key: String,
    private_key: String,
    // Never serialize or log credential contents.
    source_value: Option<String>,
}

impl MonoCodexStore {
    /// Refreshes written by the private server must also reach the ordinary CLI.
    /// Do not overwrite a login changed independently while this server ran.
    pub(crate) fn sync_auth(&self) {
        let mut mirrors = self.auth.lock().unwrap_or_else(|e| e.into_inner());
        for mirror in mirrors.iter_mut() {
            let Ok(source) = read_keyring(mirror.service, &mirror.source_key) else {
                continue;
            };
            let Ok(private) = read_keyring(mirror.service, &mirror.private_key) else {
                continue;
            };
            if private == source {
                mirror.source_value = source;
                continue;
            }
            if source != mirror.source_value && !newer_same_account(&private, &source) {
                continue;
            }
            if let Some(value) = private {
                if write_keyring(mirror.service, &mirror.source_key, &value).is_ok() {
                    mirror.source_value = Some(value);
                }
            }
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreparedStore {
    home: String,
    has_thread: bool,
    source_home: String,
    source_kind: &'static str,
    share_hooks: bool,
    skills_config: serde_json::Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    private_config: Option<serde_json::Value>,
    skill_args: Vec<String>,
    skills_context_id: String,
    skill_home: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    thread_path: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageInfo {
    home: String,
    source_home: String,
    source_kind: &'static str,
    share_hooks: bool,
}

#[derive(Serialize, Deserialize, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct StorageConflict {
    entry: String,
    mono_path: String,
    source_path: String,
    mono_bytes: u64,
    source_bytes: u64,
    mono_mtime: Option<u64>,
    source_mtime: Option<u64>,
    identical: bool,
    mono_fingerprint: String,
    source_fingerprint: String,
    can_keep_mono: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StorageResolution {
    UseAccountVersion,
    KeepMonoVersion,
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct StorageComparison {
    mono_content: Option<String>,
    source_content: Option<String>,
    truncated: bool,
    unavailable: Option<String>,
}

#[derive(Serialize, Deserialize, Default)]
struct LinkSnapshot {
    fingerprint: String,
    #[serde(default)]
    private_override: bool,
    #[serde(default)]
    invalid: bool,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HooksPolicy {
    share_hooks: bool,
}

fn locations(
    app: &AppHandle,
    account_id: Option<&str>,
) -> Result<(PathBuf, PathBuf, &'static str), String> {
    let account_id = account_id.unwrap_or("default");
    // Validate the default id as well: it is used as a private directory name.
    if account_id.is_empty()
        || account_id.len() > 80
        || !account_id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    {
        return Err("Invalid Codex account id".into());
    }
    let (source, source_kind) = if let Some(source) =
        crate::harness::provider_account_dir(app, "codex", Some(account_id))?
    {
        (source, "account")
    } else if let Some(source) = std::env::var_os("CODEX_HOME").filter(|v| !v.is_empty()) {
        (PathBuf::from(source), "CODEX_HOME")
    } else {
        (
            crate::dirs_home()
                .map(|h| PathBuf::from(h).join(".codex"))
                .ok_or("Could not find the Codex home directory")?,
            "default",
        )
    };
    let home = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("codex-monos")
        .join(account_id);
    Ok((source, home, source_kind))
}

#[tauri::command(async)]
pub fn codex_mono_store_info(
    app: AppHandle,
    provider_account_id: Option<String>,
) -> Result<StorageInfo, String> {
    let (source, home, source_kind) = locations(&app, provider_account_id.as_deref())?;
    let _lock = STORAGE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    Ok(StorageInfo {
        home: crate::fs::path_to_js(&home),
        source_home: crate::fs::path_to_js(&source),
        source_kind,
        share_hooks: hooks_shared(&home)?,
    })
}

#[tauri::command(async)]
pub fn codex_mono_store_set_hooks_shared(
    app: AppHandle,
    provider_account_id: Option<String>,
    shared: bool,
) -> Result<(), String> {
    let (source, home, _) = locations(&app, provider_account_id.as_deref())?;
    let _lock = STORAGE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let (_, home) = storage_roots(&source, &home)?;
    set_hooks_shared(&home, shared)
}

#[tauri::command(async)]
pub fn codex_mono_store_resolve(
    app: AppHandle,
    provider_account_id: Option<String>,
    conflict: StorageConflict,
    resolution: StorageResolution,
) -> Result<(), String> {
    let (source, home, _) = locations(&app, provider_account_id.as_deref())?;
    resolve_files(&source, &home, &conflict, resolution).map_err(|error| {
        if error.starts_with('{') {
            storage_error(error)
        } else {
            error
        }
    })
}

#[tauri::command(async)]
pub fn codex_mono_store_compare(
    app: AppHandle,
    provider_account_id: Option<String>,
    conflict: StorageConflict,
) -> Result<StorageComparison, String> {
    let (source, home, _) = locations(&app, provider_account_id.as_deref())?;
    let _lock = STORAGE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let (source, home) = storage_roots(&source, &home)?;
    check_conflict(&source, &home, &conflict)?;
    compare_files(&source, &home, &conflict.entry)
}

#[tauri::command(async)]
pub async fn codex_mono_store_reveal(
    app: AppHandle,
    provider_account_id: Option<String>,
    entry: String,
) -> Result<(), String> {
    let (_, home, _) = locations(&app, provider_account_id.as_deref())?;
    // Resolve the account directory here; never accept a client supplied path.
    let path = if entry == ".monocode-recovery" {
        home
    } else {
        home.join(shared_entry_name(&home, &entry)?)
    };
    crate::fs::reveal_path(crate::fs::path_to_js(&path)).await
}

#[tauri::command(async)]
pub fn codex_mono_store_prepare(
    app: AppHandle,
    provider_account_id: Option<String>,
    thread_id: Option<String>,
    skills_role: Option<String>,
    skills_policy: Option<skills::SkillsPolicy>,
    project_path: Option<String>,
    sandbox_required: Option<bool>,
    windows_sandbox: Option<String>,
    sandbox_network_access: Option<bool>,
) -> Result<PreparedStore, String> {
    let (source, home, source_kind) =
        locations(&app, provider_account_id.as_deref()).map_err(storage_error)?;
    prepare_files(&source, &home).map_err(storage_error)?;
    {
        let _lock = STORAGE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        archive::prepare_base_state(&home).map_err(storage_error)?;
    }
    sandbox::validate(
        &home,
        &home,
        sandbox_required.unwrap_or(false),
        windows_sandbox.as_deref(),
        sandbox_network_access,
        None,
    )
    .map_err(storage_error)?;
    let (skills_context_id, skill_home, skills_config, skill_args) = skills::prepare(
        &source,
        &home,
        project_path.as_deref().map(Path::new),
        skills_role.as_deref().unwrap_or("worker"),
        &skills_policy.unwrap_or_default(),
    )
    .map_err(storage_error)?;
    sandbox::validate(
        &home,
        &skill_home,
        sandbox_required.unwrap_or(false),
        windows_sandbox.as_deref(),
        sandbox_network_access,
        None,
    )
    .map_err(storage_error)?;
    let thread_path = match thread_id {
        Some(id) => {
            validate_thread_id(&id)?;
            if home.join(".monocode-migrations").join(&id).exists() {
                None
            } else {
                skills::find_mono_thread(&home, &id)?
            }
        }
        None => None,
    };
    Ok(PreparedStore {
        home: crate::fs::path_to_js(&home),
        has_thread: thread_path.is_some(),
        source_home: crate::fs::path_to_js(&source),
        source_kind,
        share_hooks: hooks_shared(&home)?,
        skills_config,
        private_config: sandbox_config::private_overrides(&source, &home).map_err(storage_error)?,
        skill_args,
        skills_context_id,
        skill_home: crate::fs::path_to_js(&skill_home),
        thread_path: thread_path.as_deref().map(crate::fs::path_to_js),
    })
}

#[tauri::command(async)]
pub fn codex_mono_sandbox_check(
    app: AppHandle,
    provider_account_id: Option<String>,
    sandbox_required: Option<bool>,
    windows_sandbox: Option<String>,
    sandbox_network_access: Option<bool>,
    skills_context_id: Option<String>,
    sandbox_config: Option<serde_json::Value>,
) -> Result<(), String> {
    let (_, home, _) = locations(&app, provider_account_id.as_deref()).map_err(storage_error)?;
    let config_home = if let Some(id) = skills_context_id {
        if id.len() != 64
            || !id
                .bytes()
                .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
        {
            return Err(storage_error("Invalid Mono skills context id".into()));
        }
        let contexts = home.join(".monocode-skill-contexts");
        let context = contexts.join(id);
        if replaceable_link(&contexts)? || replaceable_link(&context)? || !context.is_dir() {
            return Err(storage_error(
                "Mono skills context is missing or is not a private directory".into(),
            ));
        }
        context
    } else {
        home.clone()
    };
    sandbox::validate(
        &home,
        &config_home,
        sandbox_required.unwrap_or(false),
        windows_sandbox.as_deref(),
        sandbox_network_access,
        sandbox_config.as_ref(),
    )
    .map_err(storage_error)
}

#[tauri::command(async)]
pub fn codex_mono_skills_catalog(
    app: AppHandle,
    provider_account_id: Option<String>,
    project_path: Option<String>,
) -> Result<skills::Catalog, String> {
    let (source, home, _) = locations(&app, provider_account_id.as_deref())?;
    let user_home = crate::dirs_home().map(PathBuf::from);
    skills::catalog(
        &source,
        &home,
        user_home.as_deref(),
        project_path.as_deref().map(Path::new),
    )
}

#[tauri::command(async)]
pub fn codex_mono_store_copy(
    app: AppHandle,
    provider_account_id: Option<String>,
    thread_id: String,
    paths: Vec<String>,
    sqlite_home: Option<String>,
) -> Result<String, String> {
    let (source, home, _) = locations(&app, provider_account_id.as_deref())?;
    let sqlite_home = sqlite_home
        .map(PathBuf::from)
        .or_else(|| {
            std::env::var_os("CODEX_SQLITE_HOME")
                .filter(|p| !p.is_empty())
                .map(PathBuf::from)
        })
        .unwrap_or_else(|| source.clone());
    let edges = closed_agent_edges(&sqlite_home, &thread_id)?;
    copy_rollouts_with_edges(
        &source,
        &home,
        &thread_id,
        &paths.into_iter().map(PathBuf::from).collect::<Vec<_>>(),
        &edges,
    )?;
    skills::find_mono_thread(&home, &thread_id)?
        .as_deref()
        .map(crate::fs::path_to_js)
        .ok_or_else(|| "Copied Mono thread could not be located".into())
}

#[tauri::command(async)]
pub fn codex_mono_store_restore_agent_state(
    app: AppHandle,
    provider_account_id: Option<String>,
    thread_id: String,
) -> Result<(), String> {
    validate_thread_id(&thread_id)?;
    let (_, home, _) = locations(&app, provider_account_id.as_deref())?;
    restore_agent_edges(&home, &thread_id)
}

pub(crate) fn prepare(
    app: &AppHandle,
    account_id: Option<&str>,
    skills_context: Option<&str>,
) -> Result<MonoCodexStore, String> {
    let (source, sqlite_home, _) = locations(app, account_id).map_err(storage_error)?;
    let _lock = STORAGE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    prepare_files_locked(&source, &sqlite_home).map_err(storage_error)?;
    archive::prepare_base_state(&sqlite_home).map_err(storage_error)?;
    let home = match skills_context {
        Some(id) => skills::with_context_home(&sqlite_home, id, |home| {
            skills::prepare_context_files(&source, &sqlite_home, home)?;
            Ok(home.to_path_buf())
        })
        .map_err(storage_error)?,
        None => sqlite_home.clone(),
    };
    let auth = prepare_keyring(&source, &home).map_err(storage_error)?;
    Ok(MonoCodexStore {
        home,
        sqlite_home,
        auth: Mutex::new(auth),
    })
}

fn storage_error(error: String) -> String {
    log_storage_issue(format!("Mono Codex storage: {error}"));
    format!("Codex storage needs repair: {error}")
}

fn log_storage_issue(issue: String) {
    if STORAGE_ISSUES
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .insert(issue.clone())
    {
        eprintln!("{issue}");
    }
}

fn required_entry(name: &str) -> bool {
    let normalized = name.to_ascii_lowercase();
    let name = normalized.as_str();
    !name.ends_with(".bak")
        && (matches!(
            name,
            "auth.json" | ".credentials.json" | "secrets" | "agents.md" | "skills" | "hooks.json"
        ) || name == "config"
            || name.starts_with("config."))
}

fn private_entry(name: &str) -> bool {
    let normalized = name.to_ascii_lowercase();
    let name = normalized.as_str();
    STATE_NAMES.contains(&name)
        || name.contains(".sqlite")
        || name.ends_with(".db")
        || name.ends_with(".db-wal")
        || name.ends_with(".db-shm")
        || name.starts_with(".monocode-")
}

fn validate_entry(name: &str) -> Result<(), String> {
    if name.is_empty()
        || matches!(name, "." | "..")
        || name.contains(['/', '\\', ':', '\0', '<', '>', '"', '|', '?', '*'])
        || name.ends_with(['.', ' '])
        || private_entry(name)
    {
        return Err("Invalid shared Codex storage entry".into());
    }
    Ok(())
}

fn shared_entry_name(home: &Path, name: &str) -> Result<String, String> {
    validate_entry(name)?;
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::Storage::FileSystem::GetLongPathNameW;
        // Expand the Mono entry first; account directories can assign different short aliases.
        let input: Vec<u16> = home
            .join(name)
            .as_os_str()
            .encode_wide()
            .chain(Some(0))
            .collect();
        let mut output = vec![0u16; 32768];
        let len =
            unsafe { GetLongPathNameW(input.as_ptr(), output.as_mut_ptr(), output.len() as u32) };
        if len == 0 || len as usize >= output.len() {
            return Err(std::io::Error::last_os_error().to_string());
        }
        let long =
            PathBuf::from(String::from_utf16(&output[..len as usize]).map_err(|e| e.to_string())?);
        let name = long
            .file_name()
            .and_then(|n| n.to_str())
            .ok_or("Invalid Codex storage filename")?;
        validate_entry(name)?;
        Ok(name.into())
    }
    #[cfg(unix)]
    {
        let _ = home;
        Ok(name.into())
    }
}

fn login_entry(name: &str) -> bool {
    ["auth.json", ".credentials.json", "secrets"]
        .iter()
        .any(|entry| name.eq_ignore_ascii_case(entry))
}

fn storage_roots(source: &Path, home: &Path) -> Result<(PathBuf, PathBuf), String> {
    std::fs::create_dir_all(source)
        .map_err(|e| format!("Could not open the Codex account directory: {e}"))?;
    std::fs::create_dir_all(home)
        .map_err(|e| format!("Could not create Mono Codex storage: {e}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(home, std::fs::Permissions::from_mode(0o700))
            .map_err(|e| e.to_string())?;
    }
    let source = source.canonicalize().map_err(|e| e.to_string())?;
    let canonical_home = home.canonicalize().map_err(|e| e.to_string())?;
    if canonical_home.starts_with(&source) || source.starts_with(&canonical_home) {
        return Err("Mono Codex storage must be separate from the normal Codex home".into());
    }
    Ok((source, canonical_home))
}

fn private_directory(home: &Path, name: &str) -> Result<PathBuf, String> {
    let path = home.join(name);
    match std::fs::symlink_metadata(&path) {
        Ok(metadata) if metadata.is_dir() && !metadata.file_type().is_symlink() => {}
        Ok(_) => {
            return Err(format!(
                "Private Codex metadata must be a real directory: {}",
                path.display()
            ))
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            std::fs::create_dir(&path).map_err(|e| e.to_string())?;
        }
        Err(error) => return Err(error.to_string()),
    }
    Ok(path)
}

fn hooks_policy_path(home: &Path) -> Result<PathBuf, String> {
    let path = home.join(".monocode-hooks-policy.json");
    match std::fs::symlink_metadata(&path) {
        Ok(metadata) if metadata.is_file() && !replaceable_link(&path)? => {}
        Ok(_) => return Err("Mono hooks policy must be a real private file".into()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(error.to_string()),
    }
    Ok(path)
}

fn hooks_shared(home: &Path) -> Result<bool, String> {
    let path = hooks_policy_path(home)?;
    let mut options = std::fs::OpenOptions::new();
    options.read(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        use windows_sys::Win32::Storage::FileSystem::{
            FILE_FLAG_OPEN_REPARSE_POINT, FILE_SHARE_READ,
        };
        options
            .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT)
            .share_mode(FILE_SHARE_READ);
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW);
    }
    let file = match options.open(&path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(error) => return Err(format!("Could not read Mono hooks policy: {error}")),
    };
    let metadata = file.metadata().map_err(|e| e.to_string())?;
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return Err("Mono hooks policy must be a real private file".into());
    }
    #[cfg(windows)]
    if handle_file_info(&file)?.nNumberOfLinks != 1 {
        return Err("Mono hooks policy must be a real private file".into());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if metadata.nlink() != 1 {
            return Err("Mono hooks policy must be a real private file".into());
        }
    }
    match serde_json::from_reader::<_, HooksPolicy>(file) {
        Ok(policy) => Ok(policy.share_hooks),
        Err(error) if error.is_io() => Err(format!("Could not read Mono hooks policy: {error}")),
        Err(error) => {
            log_storage_issue(format!(
                "Invalid Mono hooks policy preserved at {}; hooks remain isolated: {error}",
                path.display()
            ));
            Ok(false)
        }
    }
}

fn set_hooks_shared(home: &Path, shared: bool) -> Result<(), String> {
    let path = hooks_policy_path(home)?;
    if shared && !hooks_shared(home)? && home.join(".monocode-links").exists() {
        if let Some(snapshot) = read_snapshot(home, "hooks.json")? {
            if snapshot.private_override && !snapshot.invalid {
                write_snapshot(home, "hooks.json", &LinkSnapshot::default())?;
            }
        }
    }
    write_private_json(
        &path,
        &HooksPolicy {
            share_hooks: shared,
        },
    )
}

fn snapshot_path(home: &Path, name: &str) -> Result<PathBuf, String> {
    validate_entry(name)?;
    let path = private_directory(home, ".monocode-links")?.join(format!("{name}.json"));
    if std::fs::symlink_metadata(&path).is_ok_and(|m| !m.is_file() || m.file_type().is_symlink()) {
        return Err("Codex link metadata must be a real file".into());
    }
    Ok(path)
}

fn read_snapshot(home: &Path, name: &str) -> Result<Option<LinkSnapshot>, String> {
    let path = snapshot_path(home, name)?;
    match std::fs::read(&path) {
        Ok(bytes) => match serde_json::from_slice(&bytes) {
            Ok(snapshot) => Ok(Some(snapshot)),
            Err(_) => {
                let preserved = format!("{name}.json.corrupt-{}", uuid::Uuid::new_v4());
                let temp = path.with_file_name(format!(".monocode-link-{}", uuid::Uuid::new_v4()));
                let snapshot = LinkSnapshot {
                    invalid: true,
                    ..LinkSnapshot::default()
                };
                transactions::create_json(&temp, &snapshot)?;
                let staged = transactions::RecordedEntry::new(&temp)?;
                let mut claimed = ClaimedEntry::new(
                    &path,
                    ClaimIntent::CorruptSnapshot {
                        preserved: preserved.clone(),
                    },
                    Some(&staged),
                )?;
                let result = (|| {
                    if !claimed.real_file()? {
                        return Err("Codex link metadata must be a real file".into());
                    }
                    let bytes = std::fs::read(&claimed.path).map_err(|e| e.to_string())?;
                    if let Ok(snapshot) = serde_json::from_slice(&bytes) {
                        claimed.restore()?;
                        return Ok(Some(snapshot));
                    }
                    claimed.journal.verify(None)?;
                    // Publish the invalid guard before moving corrupt bytes out of the claim.
                    #[cfg(test)]
                    crash_tests::checkpoint("before-publish");
                    staged.publish(&temp, &path)?;
                    #[cfg(test)]
                    crash_tests::checkpoint("after-publish");
                    claimed.move_to(&path.with_file_name(preserved))?;
                    claimed.active = false;
                    #[cfg(test)]
                    crash_tests::checkpoint("corrupt-after-move");
                    Ok(Some(snapshot))
                })();
                claimed.finish(result)
            }
        },
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            let prefix = format!("{name}.json.corrupt-");
            let preserved = std::fs::read_dir(path.parent().ok_or("Missing snapshot parent")?)
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?
                .iter()
                .any(|entry| entry.file_name().to_string_lossy().starts_with(&prefix));
            if preserved {
                let snapshot = LinkSnapshot {
                    invalid: true,
                    ..LinkSnapshot::default()
                };
                write_snapshot(home, name, &snapshot)?;
                Ok(Some(snapshot))
            } else {
                Ok(None)
            }
        }
        Err(error) => Err(error.to_string()),
    }
}

fn write_snapshot(home: &Path, name: &str, snapshot: &LinkSnapshot) -> Result<(), String> {
    let path = snapshot_path(home, name)?;
    write_private_json(&path, snapshot)
}

fn write_private_json(path: &Path, value: &impl Serialize) -> Result<(), String> {
    let temp = path.with_file_name(format!(".monocode-link-{}", uuid::Uuid::new_v4()));
    let result = (|| {
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)
            .map_err(|e| e.to_string())?;
        file.write_all(&serde_json::to_vec(value).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
        drop(file);
        replace_link(&temp, &path)
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(temp);
    }
    result
}

fn fingerprint(path: &Path) -> Result<String, String> {
    let mut file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    fingerprint_file(&mut file)
}

fn fingerprint_file(file: &mut std::fs::File) -> Result<String, String> {
    file.rewind().map_err(|e| e.to_string())?;
    let mut hash = Sha256::new();
    let mut buffer = [0u8; 8192];
    loop {
        let read = file.read(&mut buffer).map_err(|e| e.to_string())?;
        if read == 0 {
            break;
        }
        hash.update(&buffer[..read]);
    }
    Ok(format!("{:x}", hash.finalize()))
}

fn file_conflict(source: &Path, home: &Path, name: &str) -> Result<StorageConflict, String> {
    let name = shared_entry_name(home, name)?;
    file_conflict_at(source, home, &name, &home.join(&name))
}

fn file_conflict_at(
    source: &Path,
    home: &Path,
    name: &str,
    mono: &Path,
) -> Result<StorageConflict, String> {
    let account = source.join(name);
    let mono_meta = std::fs::symlink_metadata(mono).map_err(|e| e.to_string())?;
    let source_meta = std::fs::metadata(&account).map_err(|e| e.to_string())?;
    if !mono_meta.is_file() || mono_meta.file_type().is_symlink() || !source_meta.is_file() {
        return Err("Only conflicting real files can be resolved".into());
    }
    let mono_fingerprint = fingerprint(mono)?;
    let source_fingerprint = fingerprint(&account)?;
    let mtime = |meta: &std::fs::Metadata| {
        meta.modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .and_then(|d| d.as_millis().try_into().ok())
    };
    Ok(StorageConflict {
        entry: name.into(),
        mono_path: crate::fs::path_to_js(&home.join(name)),
        source_path: crate::fs::path_to_js(&account),
        mono_bytes: mono_meta.len(),
        source_bytes: source_meta.len(),
        mono_mtime: mtime(&mono_meta),
        source_mtime: mtime(&source_meta),
        identical: mono_fingerprint == source_fingerprint,
        mono_fingerprint,
        source_fingerprint,
        can_keep_mono: !login_entry(name),
    })
}

fn check_conflict(source: &Path, home: &Path, expected: &StorageConflict) -> Result<(), String> {
    validate_entry(&expected.entry)?;
    if same_entry(&source.join(&expected.entry), &home.join(&expected.entry)) {
        return Err(
            "Codex files changed since this issue was shown. Retry repair to refresh it.".into(),
        );
    }
    let actual = file_conflict(source, home, &expected.entry)?;
    if actual != *expected {
        return Err(storage_error(
            serde_json::to_string(&actual).map_err(|e| e.to_string())?,
        ));
    }
    Ok(())
}

struct ClaimedEntry {
    original: PathBuf,
    path: PathBuf,
    active: bool,
    journal: ClaimJournal,
    #[cfg(windows)]
    file: std::fs::File,
}

impl ClaimedEntry {
    fn new(
        target: &Path,
        intent: ClaimIntent,
        staged: Option<&transactions::RecordedEntry>,
    ) -> Result<Self, String> {
        let path = target.with_file_name(format!(".monocode-claim-{}", uuid::Uuid::new_v4()));
        #[cfg(windows)]
        let file = open_entry(target, true)?;
        #[cfg(windows)]
        let identity = file_identity(&file)?;
        #[cfg(unix)]
        let identity = entry_identity(target)?;
        let journal = ClaimJournal::new(target, &path, intent, staged, identity)?;
        #[cfg(test)]
        crash_tests::checkpoint("after-journal");
        #[cfg(windows)]
        rename_handle(&file, &path, false)?;
        #[cfg(unix)]
        rename_no_replace(target, &path)?;
        let claimed = Self {
            original: target.into(),
            path,
            active: true,
            journal,
            #[cfg(windows)]
            file,
        };
        #[cfg(test)]
        crash_tests::checkpoint("after-claim");
        Ok(claimed)
    }

    fn real_file(&self) -> Result<bool, String> {
        let metadata = std::fs::symlink_metadata(&self.path).map_err(|e| e.to_string())?;
        Ok(metadata.is_file() && !metadata.file_type().is_symlink())
    }

    fn move_to(&mut self, target: &Path) -> Result<(), String> {
        #[cfg(windows)]
        rename_handle(&self.file, target, false)?;
        #[cfg(unix)]
        rename_no_replace(&self.path, target)?;
        self.path = target.into();
        Ok(())
    }

    fn restore(&mut self) -> Result<(), String> {
        if self.active {
            self.move_to(&self.original.clone())?;
            self.active = false;
        }
        Ok(())
    }

    fn discard(&mut self) -> Result<(), String> {
        #[cfg(windows)]
        discard_handle(&self.file)?;
        #[cfg(unix)]
        std::fs::remove_file(&self.path).map_err(|e| e.to_string())?;
        self.active = false;
        Ok(())
    }

    fn finish<T>(&mut self, result: Result<T, String>) -> Result<T, String> {
        if let Err(error) = result {
            if let Err(restore) = self.restore() {
                return Err(format!(
                    "{error}; concurrent entry was not overwritten; preserved {}: {restore}",
                    self.path.display()
                ));
            }
            self.journal.finish()?;
            return Err(error);
        }
        self.journal.finish()?;
        result
    }
}

#[cfg(windows)]
fn discard_handle(file: &std::fs::File) -> Result<(), String> {
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::Storage::FileSystem::{
        FileDispositionInfoEx, SetFileInformationByHandle, FILE_ATTRIBUTE_READONLY,
        FILE_DISPOSITION_FLAG_DELETE, FILE_DISPOSITION_FLAG_IGNORE_READONLY_ATTRIBUTE,
        FILE_DISPOSITION_FLAG_POSIX_SEMANTICS, FILE_DISPOSITION_INFO_EX,
    };
    // Unlink the held entry without changing attributes on a shared source inode.
    let info = FILE_DISPOSITION_INFO_EX {
        Flags: FILE_DISPOSITION_FLAG_DELETE
            | FILE_DISPOSITION_FLAG_POSIX_SEMANTICS
            | if handle_file_info(file)?.dwFileAttributes & FILE_ATTRIBUTE_READONLY != 0 {
                FILE_DISPOSITION_FLAG_IGNORE_READONLY_ATTRIBUTE
            } else {
                0
            },
    };
    if unsafe {
        SetFileInformationByHandle(
            file.as_raw_handle() as _,
            FileDispositionInfoEx,
            (&info as *const FILE_DISPOSITION_INFO_EX).cast(),
            std::mem::size_of_val(&info) as u32,
        )
    } == 0
    {
        return Err(std::io::Error::last_os_error().to_string());
    }
    Ok(())
}

impl Drop for ClaimedEntry {
    fn drop(&mut self) {
        if let Err(error) = self.restore() {
            log_storage_issue(format!(
                "Codex storage claim preserved {}: {error}",
                self.path.display()
            ));
        } else if let Err(error) = self.journal.finish() {
            log_storage_issue(format!("Codex storage transaction preserved: {error}"));
        }
    }
}

#[cfg(windows)]
fn open_entry(path: &Path, locked: bool) -> Result<std::fs::File, String> {
    use std::os::windows::fs::OpenOptionsExt;
    use windows_sys::Win32::{
        Foundation::GENERIC_READ,
        Storage::FileSystem::{
            DELETE, FILE_FLAG_BACKUP_SEMANTICS, FILE_FLAG_OPEN_REPARSE_POINT, FILE_SHARE_DELETE,
            FILE_SHARE_READ, FILE_SHARE_WRITE,
        },
    };
    std::fs::OpenOptions::new()
        .access_mode(GENERIC_READ | if locked { DELETE } else { 0 })
        .share_mode(if locked {
            FILE_SHARE_READ
        } else {
            FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE
        })
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT)
        .open(path)
        .map_err(|e| e.to_string())
}

fn entry_identity(path: &Path) -> Result<(u64, u64), String> {
    #[cfg(windows)]
    {
        file_identity(&open_entry(path, false)?)
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        let metadata = std::fs::symlink_metadata(path).map_err(|e| e.to_string())?;
        Ok((metadata.dev(), metadata.ino()))
    }
}

fn file_identity(file: &std::fs::File) -> Result<(u64, u64), String> {
    #[cfg(windows)]
    {
        let info = handle_file_info(file)?;
        Ok((
            info.dwVolumeSerialNumber as u64,
            (info.nFileIndexHigh as u64) << 32 | info.nFileIndexLow as u64,
        ))
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        let metadata = file.metadata().map_err(|e| e.to_string())?;
        Ok((metadata.dev(), metadata.ino()))
    }
}

#[cfg(unix)]
fn rename_no_replace(source: &Path, target: &Path) -> Result<(), String> {
    use std::os::unix::ffi::OsStrExt;
    let source =
        std::ffi::CString::new(source.as_os_str().as_bytes()).map_err(|e| e.to_string())?;
    let target =
        std::ffi::CString::new(target.as_os_str().as_bytes()).map_err(|e| e.to_string())?;
    #[cfg(target_os = "linux")]
    let result = unsafe {
        libc::renameat2(
            libc::AT_FDCWD,
            source.as_ptr(),
            libc::AT_FDCWD,
            target.as_ptr(),
            libc::RENAME_NOREPLACE,
        )
    };
    #[cfg(target_os = "macos")]
    let result = unsafe { libc::renamex_np(source.as_ptr(), target.as_ptr(), libc::RENAME_EXCL) };
    if result == 0 {
        Ok(())
    } else {
        Err(std::io::Error::last_os_error().to_string())
    }
}

fn autoheal_allowed(
    conflict: &StorageConflict,
    path: &Path,
    snapshot: Option<&LinkSnapshot>,
) -> bool {
    if snapshot.is_some_and(|s| s.invalid) {
        return false;
    }
    conflict.identical
        || (conflict.entry.eq_ignore_ascii_case("hooks.json")
            && conflict.mono_bytes <= 64 * 1024
            && std::fs::read(path)
                .ok()
                .and_then(|b| serde_json::from_slice::<serde_json::Value>(&b).ok())
                .is_some_and(|v| v == serde_json::json!({"hooks":{}})))
        || snapshot.is_some_and(|s| s.fingerprint == conflict.mono_fingerprint)
}

fn backup_and_relink(
    source: &Path,
    home: &Path,
    name: &str,
    expected: Option<&StorageConflict>,
    snapshot: Option<&LinkSnapshot>,
    resolution: StorageResolution,
) -> Result<(), String> {
    let target = home.join(name);
    let temp = home.join(format!(".monocode-link-{}", uuid::Uuid::new_v4()));
    create_link(&source.join(name), &temp)?;
    let staged = transactions::RecordedEntry::new(&temp)?;
    let result = (|| {
        #[cfg(test)]
        before_claim();
        let intent = if matches!(resolution, StorageResolution::KeepMonoVersion) {
            ClaimIntent::Keep
        } else {
            ClaimIntent::UseAccount
        };
        let mut claimed = ClaimedEntry::new(&target, intent, Some(&staged))?;
        let result = (|| {
            // The held Windows handle excludes writes and replacements until publication or restoration.
            if !claimed.real_file()?
                || replaceable_link(&claimed.path)?
                || same_entry(&source.join(name), &claimed.path)
            {
                return Err(
                    "Codex storage entry changed or is already linked. Retry repair.".into(),
                );
            }
            let actual = file_conflict_at(source, home, name, &claimed.path)?;
            if let Some(expected) = expected {
                if actual != *expected {
                    return Err(storage_error(
                        serde_json::to_string(&actual).map_err(|e| e.to_string())?,
                    ));
                }
            } else if !autoheal_allowed(&actual, &claimed.path, snapshot) {
                return Err(serde_json::to_string(&actual).map_err(|e| e.to_string())?);
            }
            if matches!(resolution, StorageResolution::KeepMonoVersion) {
                claimed.journal.verify(None)?;
                #[cfg(test)]
                crash_tests::checkpoint("before-publish");
                claimed.restore()?;
                #[cfg(test)]
                crash_tests::checkpoint("after-publish");
                return write_snapshot(
                    home,
                    name,
                    &LinkSnapshot {
                        fingerprint: actual.mono_fingerprint,
                        private_override: true,
                        invalid: false,
                    },
                );
            }
            let mut original = std::fs::File::open(&claimed.path).map_err(|e| e.to_string())?;
            let saved = archive_file(home, name, &mut original, &actual.mono_fingerprint)?;
            claimed.journal.verify(Some(&saved))?;
            // shortcut: Unix open writers can still change claimed bytes; add writer exclusion before guaranteeing concurrent Unix recovery.
            if fingerprint(&claimed.path)? != actual.mono_fingerprint {
                return Err(
                    "Codex storage bytes changed during archive creation. Retry repair.".into(),
                );
            }
            #[cfg(test)]
            crash_tests::checkpoint("before-publish");
            staged.publish(&temp, &target)?;
            #[cfg(test)]
            crash_tests::checkpoint("after-publish");
            claimed.discard()
        })();
        claimed.finish(result)
    })();
    staged.cleanup(&temp)?;
    result
}

fn archive_file(
    home: &Path,
    name: &str,
    original: &mut std::fs::File,
    expected: &str,
) -> Result<PathBuf, String> {
    let root = private_directory(home, ".monocode-conflicts")?;
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis();
    let backup = root.join(format!("{timestamp}-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir(&backup).map_err(|e| e.to_string())?;
    let saved = backup.join(name);
    // Archives have their own inode even when the original was a shared hardlink or symlink.
    let mut preserved = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&saved)
        .map_err(|e| e.to_string())?;
    original.rewind().map_err(|e| e.to_string())?;
    std::io::copy(original, &mut preserved).map_err(|e| e.to_string())?;
    preserved.sync_all().map_err(|e| e.to_string())?;
    drop(preserved);
    if fingerprint(&saved)? != expected || fingerprint_file(original)? != expected {
        return Err(format!(
            "Codex storage bytes changed during archive creation; preserved {}. Retry repair.",
            saved.display()
        ));
    }
    #[cfg(test)]
    crash_tests::checkpoint("after-archive");
    Ok(saved)
}

#[cfg(test)]
fn publish_new_entry(temp: &Path, target: &Path) -> Result<(), String> {
    transactions::RecordedEntry::new(temp)?.publish(temp, target)
}

fn prepare_isolated_hooks(home: &Path) -> Result<(), String> {
    let target = home.join("hooks.json");
    let existing = match std::fs::symlink_metadata(&target) {
        Ok(metadata) if metadata.is_file() && !replaceable_link(&target)? => return Ok(()),
        Ok(_) => true,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => false,
        Err(error) => return Err(error.to_string()),
    };
    let temp = home.join(format!(".monocode-link-{}", uuid::Uuid::new_v4()));
    let mut staged = None;
    let result = (|| {
        let mut empty = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)
            .map_err(|e| e.to_string())?;
        empty
            .write_all(br#"{"hooks":{}}"#)
            .map_err(|e| e.to_string())?;
        empty.sync_all().map_err(|e| e.to_string())?;
        drop(empty);
        staged = Some(transactions::RecordedEntry::new(&temp)?);
        if !existing {
            return staged.as_ref().unwrap().publish(&temp, &target);
        }
        #[cfg(test)]
        before_claim();
        let stage = staged.as_ref().unwrap();
        let mut claimed = ClaimedEntry::new(&target, ClaimIntent::IsolateHooks, Some(stage))?;
        let result = (|| {
            if claimed.real_file()? && !replaceable_link(&claimed.path)? {
                return claimed.restore();
            }
            if !replaceable_link(&claimed.path)? {
                return Err("Mono hooks must be a real file or a readable file link".into());
            }
            let claimed_id = entry_identity(&claimed.path)?;
            #[cfg(windows)]
            let mut original = if claimed.real_file()? {
                claimed.file.try_clone().map_err(|e| e.to_string())?
            } else {
                use std::os::windows::fs::OpenOptionsExt;
                use windows_sys::Win32::Storage::FileSystem::FILE_SHARE_READ;
                std::fs::OpenOptions::new()
                    .read(true)
                    .share_mode(FILE_SHARE_READ)
                    .open(&claimed.path)
                    .map_err(|e| {
                        format!("Could not read linked Mono hooks; the link is preserved: {e}")
                    })?
            };
            #[cfg(unix)]
            let mut original = std::fs::File::open(&claimed.path).map_err(|e| {
                format!("Could not read linked Mono hooks; the link is preserved: {e}")
            })?;
            if !original.metadata().map_err(|e| e.to_string())?.is_file() {
                return Err("Linked Mono hooks must refer to a readable real file".into());
            }
            let referenced_id = file_identity(&original)?;
            let fingerprint = fingerprint_file(&mut original)?;
            let saved = archive_file(home, "hooks.json", &mut original, &fingerprint)?;
            claimed.journal.verify(Some(&saved))?;
            let current = std::fs::File::open(&claimed.path).map_err(|e| e.to_string())?;
            if entry_identity(&claimed.path)? != claimed_id
                || file_identity(&current)? != referenced_id
                || fingerprint_file(&mut original)? != fingerprint
            {
                return Err("Linked Mono hooks changed during isolation. The original is preserved; retry preparation.".into());
            }
            #[cfg(test)]
            crash_tests::checkpoint("before-publish");
            stage.publish(&temp, &target)?;
            #[cfg(test)]
            crash_tests::checkpoint("after-publish");
            claimed.discard()
        })();
        claimed.finish(result)
    })();
    if let Some(staged) = staged {
        staged.cleanup(&temp)?;
    }
    result.map_err(|error| format!("Could not isolate Mono hooks {}: {error}", target.display()))
}

fn resolve_files(
    source: &Path,
    home: &Path,
    conflict: &StorageConflict,
    resolution: StorageResolution,
) -> Result<(), String> {
    let _lock = STORAGE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let (source, home) = storage_roots(source, home)?;
    transactions::reconcile(&home)?;
    let name = shared_entry_name(&home, &conflict.entry)?;
    if name.eq_ignore_ascii_case("hooks.json") && !hooks_shared(&home)? {
        return Err("Mono hooks are isolated. Refresh storage details or explicitly enable account hooks sharing.".into());
    }
    snapshot_path(&home, &name)?;
    if matches!(resolution, StorageResolution::KeepMonoVersion) && login_entry(&name) {
        return Err("Login files must remain shared with the selected account".into());
    }
    let use_account = matches!(resolution, StorageResolution::UseAccountVersion);
    backup_and_relink(&source, &home, &name, Some(conflict), None, resolution)?;
    if use_account {
        write_snapshot(
            &home,
            &name,
            &LinkSnapshot {
                fingerprint: fingerprint(&home.join(&name))?,
                private_override: false,
                invalid: false,
            },
        )?;
    }
    Ok(())
}

fn compare_files(source: &Path, home: &Path, name: &str) -> Result<StorageComparison, String> {
    let name = shared_entry_name(home, name)?;
    if !name.eq_ignore_ascii_case("hooks.json") && !name.eq_ignore_ascii_case("AGENTS.md") {
        return Ok(StorageComparison { unavailable: Some("Open these files locally to compare. Configuration and login files may contain secrets.".into()), ..StorageComparison::default() });
    }
    const LIMIT: u64 = 64 * 1024;
    let read = |path: PathBuf| -> Result<(String, bool), String> {
        let mut bytes = Vec::new();
        std::fs::File::open(path)
            .map_err(|e| e.to_string())?
            .take(LIMIT + 1)
            .read_to_end(&mut bytes)
            .map_err(|e| e.to_string())?;
        let truncated = bytes.len() > LIMIT as usize;
        bytes.truncate(LIMIT as usize);
        Ok((String::from_utf8_lossy(&bytes).into_owned(), truncated))
    };
    let (mono, mono_truncated) = read(home.join(&name))?;
    let (account, source_truncated) = read(source.join(&name))?;
    Ok(StorageComparison {
        mono_content: Some(mono),
        source_content: Some(account),
        truncated: mono_truncated || source_truncated,
        unavailable: None,
    })
}

fn prepare_files(source: &Path, home: &Path) -> Result<(), String> {
    let _lock = STORAGE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    prepare_files_locked(source, home)
}

fn prepare_files_locked(source: &Path, home: &Path) -> Result<(), String> {
    prepare_files_with_state_locked(source, home, None)
}

fn prepare_files_with_state_locked(
    source: &Path,
    home: &Path,
    state_home: Option<&Path>,
) -> Result<(), String> {
    let (source, home) = storage_roots(source, home)?;
    transactions::reconcile(&home)?;
    if let Some(base) = state_home {
        archive::prepare_context_state(base, &home)?;
    }
    let share_hooks = hooks_shared(&home)?;
    skills::private_skills(&home)?;
    if !share_hooks {
        prepare_isolated_hooks(&home)?;
    }
    for name in STATE_NAMES {
        if std::fs::symlink_metadata(home.join(name)).is_ok_and(|m| m.file_type().is_symlink())
            && !state_home.is_some_and(|base| {
                matches!(*name, "sessions" | "archived_sessions" | "memories")
                    && std::fs::symlink_metadata(base.join(name))
                        .is_ok_and(|m| m.is_dir() && !m.file_type().is_symlink())
                    && same_entry(&base.join(name), &home.join(name))
            })
        {
            return Err("Mono Codex state must remain in its private storage directory".into());
        }
    }
    for entry in std::fs::read_dir(&home).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name();
        if name.to_string_lossy().eq_ignore_ascii_case("skills")
            || (!share_hooks && name.to_string_lossy().eq_ignore_ascii_case("hooks.json"))
        {
            continue;
        }
        if private_entry(&name.to_string_lossy()) {
            continue;
        }
        let result = match std::fs::symlink_metadata(source.join(&name)) {
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => (|| {
                if replaceable_link(&entry.path())? {
                    remove_link(&entry.path())?;
                } else if login_entry(&name.to_string_lossy()) {
                    return Err(format!(
                        "Real login entry conflicts with the selected Codex home; preserved: {}",
                        entry.path().display()
                    ));
                }
                Ok(())
            })(),
            Err(e) => Err(e.to_string()),
            Ok(_) => Ok(()),
        };
        if let Err(error) = result {
            let error = format!(
                "Could not reconcile Codex storage {}: {error}",
                entry.path().display()
            );
            if required_entry(&name.to_string_lossy()) {
                return Err(error);
            }
            log_storage_issue(format!(
                "Mono Codex storage skipped optional entry: {error}"
            ));
        }
    }
    for entry in std::fs::read_dir(&source).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name();
        if name.to_string_lossy().eq_ignore_ascii_case("skills")
            || (!share_hooks && name.to_string_lossy().eq_ignore_ascii_case("hooks.json"))
        {
            continue;
        }
        if private_entry(&name.to_string_lossy()) {
            continue;
        }
        let target = home.join(&name);
        let result = (|| {
            let name = name
                .to_str()
                .ok_or("Invalid Codex configuration filename")?;
            let normalized_name = name.to_ascii_lowercase();
            let snapshot = if entry.path().is_file() {
                read_snapshot(&home, name)?
            } else {
                None
            };
            if snapshot
                .as_ref()
                .is_some_and(|s| s.private_override && !s.invalid)
            {
                match std::fs::symlink_metadata(&target) {
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                    Ok(metadata)
                        if metadata.is_file()
                            && !metadata.file_type().is_symlink()
                            && !replaceable_link(&target)?
                            && !login_entry(name) =>
                    {
                        return Ok(())
                    }
                    _ => {
                        return Err(
                            "Private Codex override must remain a real configuration file".into(),
                        )
                    }
                }
            }
            if entry.path().is_file()
                && std::fs::symlink_metadata(&target)
                    .is_ok_and(|m| m.is_file() && !m.file_type().is_symlink())
                && !replaceable_link(&target)?
                && !same_entry(&entry.path(), &target)
            {
                let conflict = file_conflict(&source, &home, name)?;
                if autoheal_allowed(&conflict, &target, snapshot.as_ref()) {
                    backup_and_relink(
                        &source,
                        &home,
                        name,
                        None,
                        snapshot.as_ref(),
                        StorageResolution::UseAccountVersion,
                    )?;
                } else if normalized_name != "config.toml" && normalized_name != "config.toml.bak" {
                    return Err(serde_json::to_string(&conflict).map_err(|e| e.to_string())?);
                } else if snapshot.is_some() {
                    return Err(serde_json::to_string(&conflict).map_err(|e| e.to_string())?);
                }
            }
            if (normalized_name == "config.toml" || normalized_name == "config.toml.bak")
                && std::fs::symlink_metadata(&target).is_ok_and(|m| m.is_file())
                && !replaceable_link(&target)?
            {
                log_storage_issue(format!(
                    "Mono Codex storage preserves private configuration overriding {}: {}",
                    entry.path().display(),
                    target.display()
                ));
                return Ok(());
            }
            link_entry(&entry.path(), &target)?;
            if entry.path().is_file() {
                write_snapshot(
                    &home,
                    name,
                    &LinkSnapshot {
                        fingerprint: fingerprint(&target)?,
                        private_override: false,
                        invalid: false,
                    },
                )?;
            }
            Ok(())
        })();
        if let Err(error) = result {
            if error.starts_with('{') && required_entry(&name.to_string_lossy()) {
                return Err(error);
            }
            let error = format!("Codex storage entry {}: {error}", target.display());
            if required_entry(&name.to_string_lossy()) {
                return Err(error);
            }
            log_storage_issue(format!(
                "Mono Codex storage skipped optional entry: {error}"
            ));
        }
    }
    // Keep the auth link valid even if login creates/replaces the original later.
    #[cfg(unix)]
    for name in ["auth.json", ".credentials.json"] {
        link_entry(&source.join(name), &home.join(name))
            .map_err(|e| format!("Codex storage entry {}: {e}", home.join(name).display()))?;
    }
    // Encrypted auth/MCP files are replaced atomically. Sharing their directory,
    // rather than individual files, preserves those writes in both homes.
    std::fs::create_dir_all(source.join("secrets")).map_err(|e| {
        format!(
            "Could not create Codex secrets {}: {e}",
            source.join("secrets").display()
        )
    })?;
    link_entry(&source.join("secrets"), &home.join("secrets")).map_err(|e| {
        format!(
            "Codex storage entry {}: {e}",
            home.join("secrets").display()
        )
    })?;
    std::fs::create_dir_all(home.join("sessions")).map_err(|e| e.to_string())?;
    Ok(())
}

fn link_entry(source: &Path, target: &Path) -> Result<(), String> {
    if same_entry(source, target) {
        return Ok(());
    }
    let existing = match std::fs::symlink_metadata(target) {
        Ok(metadata) => Some(metadata),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(e) => return Err(e.to_string()),
    };
    if existing.is_some() && !replaceable_link(target)? {
        return Err(format!(
            "Real entry conflicts with Codex storage; preserved: {}",
            target.display()
        ));
    }
    if existing.is_some() {
        let inspected = entry_identity(target)?;
        let temp = target.with_file_name(format!(".monocode-link-{}", uuid::Uuid::new_v4()));
        create_link(source, &temp)?;
        let staged = transactions::RecordedEntry::new(&temp)?;
        let result = (|| {
            #[cfg(test)]
            before_claim();
            let mut claimed = ClaimedEntry::new(target, ClaimIntent::Relink, Some(&staged))?;
            let result = (|| {
                if entry_identity(&claimed.path)? != inspected || !replaceable_link(&claimed.path)?
                {
                    return Err(format!(
                        "Codex storage entry changed; concurrent entry preserved: {}",
                        target.display()
                    ));
                }
                claimed.journal.verify(None)?;
                #[cfg(test)]
                crash_tests::checkpoint("before-publish");
                staged.publish(&temp, target)?;
                #[cfg(test)]
                crash_tests::checkpoint("after-publish");
                claimed.discard()
            })();
            claimed.finish(result)
        })();
        if let Err(error) = result {
            staged.cleanup(&temp)?;
            return Err(format!(
                "Could not relink Codex storage {}: {error}",
                target.display()
            ));
        }
    } else {
        create_link(source, target)?;
    }
    Ok(())
}

fn same_entry(source: &Path, target: &Path) -> bool {
    // Resolve BOTH ends: the selected account entry may itself be a link.
    if source
        .canonicalize()
        .ok()
        .zip(target.canonicalize().ok())
        .is_some_and(|(a, b)| a == b)
    {
        return true;
    }
    #[cfg(windows)]
    return file_info(source)
        .ok()
        .zip(file_info(target).ok())
        .is_some_and(|(a, b)| {
            a.dwVolumeSerialNumber == b.dwVolumeSerialNumber
                && a.nFileIndexHigh == b.nFileIndexHigh
                && a.nFileIndexLow == b.nFileIndexLow
        });
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        std::fs::metadata(source)
            .ok()
            .zip(std::fs::metadata(target).ok())
            .is_some_and(|(a, b)| a.dev() == b.dev() && a.ino() == b.ino())
    }
}

#[cfg(windows)]
fn file_info(
    path: &Path,
) -> Result<windows_sys::Win32::Storage::FileSystem::BY_HANDLE_FILE_INFORMATION, String> {
    use std::os::windows::fs::OpenOptionsExt;
    use windows_sys::Win32::Storage::FileSystem::FILE_FLAG_BACKUP_SEMANTICS;
    let file = std::fs::OpenOptions::new()
        .read(true)
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS)
        .open(path)
        .map_err(|e| e.to_string())?;
    handle_file_info(&file)
}

#[cfg(windows)]
fn handle_file_info(
    file: &std::fs::File,
) -> Result<windows_sys::Win32::Storage::FileSystem::BY_HANDLE_FILE_INFORMATION, String> {
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::Storage::FileSystem::{
        GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION,
    };
    let mut info = BY_HANDLE_FILE_INFORMATION::default();
    if unsafe { GetFileInformationByHandle(file.as_raw_handle() as _, &mut info) } == 0 {
        return Err(std::io::Error::last_os_error().to_string());
    }
    Ok(info)
}

fn replaceable_link(path: &Path) -> Result<bool, String> {
    let metadata = std::fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    if metadata.file_type().is_symlink() {
        return Ok(true);
    }
    #[cfg(windows)]
    if metadata.is_file() {
        // A lone file may be private data or a detached former hardlink: preserve it.
        return Ok(file_info(path)?.nNumberOfLinks > 1);
    }
    #[cfg(unix)]
    if metadata.is_file() {
        use std::os::unix::fs::MetadataExt;
        return Ok(metadata.nlink() > 1);
    }
    Ok(false)
}

fn remove_link(path: &Path) -> Result<(), String> {
    if !replaceable_link(path)? {
        return Err(format!(
            "Refusing to remove a real Codex storage entry: {}",
            path.display()
        ));
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        use windows_sys::Win32::Storage::FileSystem::FILE_ATTRIBUTE_DIRECTORY;
        if std::fs::symlink_metadata(path)
            .map_err(|e| e.to_string())?
            .file_attributes()
            & FILE_ATTRIBUTE_DIRECTORY
            != 0
        {
            return std::fs::remove_dir(path).map_err(|e| e.to_string());
        }
    }
    std::fs::remove_file(path).map_err(|e| e.to_string())
}

#[cfg(unix)]
fn replace_link(temp: &Path, target: &Path) -> Result<(), String> {
    std::fs::rename(temp, target).map_err(|e| e.to_string())
}

#[cfg(windows)]
fn replace_link(temp: &Path, target: &Path) -> Result<(), String> {
    use std::os::windows::{ffi::OsStrExt, fs::OpenOptionsExt};
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, DELETE, FILE_FLAG_BACKUP_SEMANTICS, FILE_FLAG_OPEN_REPARSE_POINT,
        FILE_SHARE_DELETE, FILE_SHARE_READ, FILE_SHARE_WRITE, MOVEFILE_REPLACE_EXISTING,
    };
    if std::fs::symlink_metadata(temp)
        .map_err(|e| e.to_string())?
        .is_file()
    {
        // File replacement uses DOS paths; the junction rename below uses NT paths.
        let wide = |path: &Path| {
            path.as_os_str()
                .encode_wide()
                .chain(Some(0))
                .collect::<Vec<_>>()
        };
        let source = wide(temp);
        let target = wide(target);
        if unsafe { MoveFileExW(source.as_ptr(), target.as_ptr(), MOVEFILE_REPLACE_EXISTING) } == 0
        {
            return Err(std::io::Error::last_os_error().to_string());
        }
        return Ok(());
    }
    // Open the junction itself, never the directory it points to.
    let file = std::fs::OpenOptions::new()
        .access_mode(DELETE)
        .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE)
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT)
        .open(temp)
        .map_err(|e| e.to_string())?;
    rename_handle(&file, target, true)
}

#[cfg(windows)]
fn rename_handle(file: &std::fs::File, target: &Path, replace: bool) -> Result<(), String> {
    use std::os::windows::{ffi::OsStrExt, io::AsRawHandle};
    use windows_sys::Win32::Storage::FileSystem::{
        FileRenameInfoEx, SetFileInformationByHandle, FILE_RENAME_INFO,
    };
    let absolute = target
        .parent()
        .ok_or("Missing link parent")?
        .canonicalize()
        .map_err(|e| e.to_string())?
        .join(target.file_name().ok_or("Missing link name")?);
    // The native rename information expects an NT path, not a DOS drive path.
    let canonical = absolute.to_string_lossy();
    let native = format!(
        r"\??\{}",
        canonical.strip_prefix(r"\\?\").unwrap_or(&canonical)
    );
    let name: Vec<u16> = std::ffi::OsStr::new(&native).encode_wide().collect();
    // Win32's path conversion also reads the NUL beyond the counted filename.
    let bytes = std::mem::offset_of!(FILE_RENAME_INFO, FileName) + (name.len() + 1) * 2;
    // usize storage supplies the alignment required by FILE_RENAME_INFO.
    let mut buffer = vec![0usize; bytes.div_ceil(std::mem::size_of::<usize>())];
    let info = buffer.as_mut_ptr().cast::<FILE_RENAME_INFO>();
    unsafe {
        (*info).Anonymous.Flags = if replace { 3 } else { 2 }; // REPLACE_IF_EXISTS | POSIX_SEMANTICS
        (*info).FileNameLength = (name.len() * 2) as u32;
        std::ptr::copy_nonoverlapping(
            name.as_ptr(),
            std::ptr::addr_of_mut!((*info).FileName).cast::<u16>(),
            name.len(),
        );
        if SetFileInformationByHandle(
            file.as_raw_handle() as _,
            FileRenameInfoEx,
            info.cast(),
            bytes as u32,
        ) == 0
        {
            return Err(std::io::Error::last_os_error().to_string());
        }
    }
    Ok(())
}

fn create_link(source: &Path, target: &Path) -> Result<(), String> {
    #[cfg(unix)]
    if let Err(error) = std::os::unix::fs::symlink(source, target) {
        if !same_entry(source, target) {
            return Err(format!("Could not share Codex configuration: {error}"));
        }
    }
    #[cfg(windows)]
    {
        if source.is_dir() {
            // Junctions work without Administrator privileges or Developer Mode.
            // Windows PowerShell adds an NT prefix to an already verbatim
            // canonical path, producing a junction with an unreadable target.
            junction::create(source, target)
                .map_err(|e| format!("Could not share the Codex configuration directory: {e}"))?;
        } else if source.is_file() {
            // A file symlink follows temp+rename writes; hardlinks need snapshot recovery on prepare.
            if std::os::windows::fs::symlink_file(source, target).is_err() {
                std::fs::hard_link(source, target)
                    .map_err(|e| format!("Could not share Codex configuration: {e}"))?;
            }
        } else {
            return Err(format!(
                "Codex account entry is missing or unsupported: {}",
                source.display()
            ));
        }
    }
    Ok(())
}

fn home_key(home: &Path) -> Result<String, String> {
    let canonical = home.canonicalize().map_err(|e| e.to_string())?;
    let digest = format!(
        "{:x}",
        Sha256::digest(canonical.to_string_lossy().as_bytes())
    );
    Ok(digest[..16].to_owned())
}

fn read_keyring(service: &str, key: &str) -> Result<Option<String>, String> {
    let entry =
        keyring::Entry::new(service, key).map_err(|_| "Could not access Codex credentials")?;
    match entry.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(_) => Err("Could not read Codex credentials from the system credential store".into()),
    }
}

fn write_keyring(service: &str, key: &str, value: &str) -> Result<(), String> {
    keyring::Entry::new(service, key)
        .and_then(|e| e.set_password(value))
        .map_err(|_| "Could not share Codex credentials with Mono storage".into())
}

fn prepare_keyring(source: &Path, home: &Path) -> Result<Vec<KeyringMirror>, String> {
    let explicit_keyring = std::fs::read_to_string(home.join("config.toml"))
        .ok()
        .and_then(|s| s.parse::<toml::Value>().ok())
        .and_then(|v| {
            v.get("cli_auth_credentials_store")
                .and_then(toml::Value::as_str)
                .map(str::to_owned)
        })
        .is_some_and(|v| v == "keyring" || v == "auto");
    let encrypted = std::fs::read_dir(source.join("secrets"))
        .map(|mut entries| entries.next().is_some())
        .unwrap_or(false);
    // The default file store shares auth.json directly, with no Keychain prompt.
    if !explicit_keyring && !encrypted {
        return Ok(Vec::new());
    }
    let source_hash = home_key(source)?;
    let private_hash = home_key(home)?;
    let mut mirrors = Vec::new();
    for (service, prefix, suffix) in [
        ("Codex Auth", "cli", ""),
        ("codex", "secrets", ""),
        ("codex", "secrets", "|gateway-oauth"),
    ] {
        let source_key = format!("{prefix}|{source_hash}{suffix}");
        let private_key = format!("{prefix}|{private_hash}{suffix}");
        let value = match read_keyring(service, &source_key) {
            Ok(value) => value,
            Err(error) if explicit_keyring || encrypted => return Err(error),
            Err(_) => continue,
        };
        let value = if service == "Codex Auth" {
            let private = read_keyring(service, &private_key)?;
            if newer_same_account(&private, &value) {
                let recovered = private.as_ref().unwrap();
                write_keyring(service, &source_key, recovered)?;
                private
            } else {
                value
            }
        } else {
            value
        };
        if let Some(value) = &value {
            write_keyring(service, &private_key, value)?;
        } else if let Ok(entry) = keyring::Entry::new(service, &private_key) {
            match entry.delete_credential() {
                Ok(()) | Err(keyring::Error::NoEntry) => {}
                Err(_) => return Err("Could not clear the previous Mono Codex login".into()),
            }
        }
        mirrors.push(KeyringMirror {
            service,
            source_key,
            private_key,
            source_value: value,
        });
    }
    Ok(mirrors)
}

fn newer_same_account(private: &Option<String>, source: &Option<String>) -> bool {
    let Some((private, source)) = private.as_ref().zip(source.as_ref()) else {
        return false;
    };
    let Ok(private) = serde_json::from_str::<serde_json::Value>(private) else {
        return false;
    };
    let Ok(source) = serde_json::from_str::<serde_json::Value>(source) else {
        return false;
    };
    let account = |v: &serde_json::Value| {
        v.get("tokens")
            .and_then(|v| v.get("account_id"))
            .and_then(|v| v.as_str())
            .map(str::to_owned)
    };
    let Some(private_account) = account(&private) else {
        return false;
    };
    if Some(private_account) != account(&source) {
        return false;
    }
    private
        .get("last_refresh")
        .and_then(|v| v.as_str())
        .zip(source.get("last_refresh").and_then(|v| v.as_str()))
        .is_some_and(|(private, source)| private > source)
}

fn validate_thread_id(id: &str) -> Result<(), String> {
    if id.is_empty()
        || id.len() > 128
        || !id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    {
        return Err("Invalid Codex thread id".into());
    }
    Ok(())
}

fn contains_thread(dir: &Path, id: &str) -> Result<bool, String> {
    Ok(find_thread(dir, id)?.is_some())
}

#[cfg(test)]
fn copy_rollouts(
    source: &Path,
    home: &Path,
    thread_id: &str,
    paths: &[PathBuf],
) -> Result<(), String> {
    copy_rollouts_with_edges(source, home, thread_id, paths, &[])
}

fn copy_rollouts_with_edges(
    source: &Path,
    home: &Path,
    thread_id: &str,
    paths: &[PathBuf],
    edges: &[AgentEdge],
) -> Result<(), String> {
    validate_thread_id(thread_id)?;
    if paths.is_empty() {
        return Err("Codex did not return a saved Mono thread".into());
    }
    let source = source.canonicalize().map_err(|e| e.to_string())?;
    let allowed_roots = [source.join("sessions"), source.join("archived_sessions")]
        .into_iter()
        .filter_map(|p| p.canonicalize().ok())
        .collect::<Vec<_>>();
    let mut staged = Vec::new();
    // Validate every path before copying. The RPC cannot copy arbitrary files.
    let mut files = Vec::new();
    let mut queue = paths.to_vec();
    let mut index = 0;
    while index < queue.len() {
        let path = &queue[index];
        // Compressed Codex rollouts can retain a plain JSONL append tail. Both
        // files comprise one native context; preserve both when present.
        let sibling = if path.extension().is_some_and(|ext| ext == "zst") {
            path.with_extension("")
        } else {
            let mut compressed = path.as_os_str().to_os_string();
            compressed.push(".zst");
            PathBuf::from(compressed)
        };
        let mut found = false;
        for candidate in [path, &sibling] {
            if candidate.is_file() {
                found = true;
                if !files.contains(candidate) {
                    files.push(candidate.clone());
                }
            }
        }
        if !found {
            return Err("Could not read the saved Codex thread file".into());
        }
        index += 1;
        // Forks and reverted turns can inherit a prefix from another rollout.
        // Retain those native dependencies as well, without archiving unrelated
        // source threads that merely supplied a fork's initial context.
        for file in &files {
            let canonical = file.canonicalize().map_err(|e| e.to_string())?;
            if !allowed_roots.iter().any(|root| canonical.starts_with(root)) {
                return Err("The saved thread is outside the selected Codex account".into());
            }
            if let Some(base) = history_base(&canonical)? {
                validate_thread_id(&base)?;
                if queue.iter().any(|p| rollout_matches(p, &base)) {
                    continue;
                }
                let path = allowed_roots
                    .iter()
                    .find_map(|root| find_thread(root, &base).transpose())
                    .transpose()?
                    .ok_or("Could not retain an inherited Codex context file")?;
                queue.push(path);
            }
        }
    }
    for path in files {
        let path = path
            .canonicalize()
            .map_err(|e| format!("Could not read the saved Codex thread: {e}"))?;
        if !allowed_roots.iter().any(|root| path.starts_with(root)) {
            return Err("The saved thread is outside the selected Codex account".into());
        }
        let name = path
            .file_name()
            .ok_or("Missing Codex rollout filename")?
            .to_string_lossy();
        if !path.is_file()
            || !name.starts_with("rollout-")
            || !(name.ends_with(".jsonl") || name.ends_with(".jsonl.zst"))
        {
            return Err("Not a saved Codex rollout file".into());
        }
        let date = name
            .get(8..18)
            .filter(|date| {
                date.bytes().enumerate().all(|(i, b)| {
                    if i == 4 || i == 7 {
                        b == b'-'
                    } else {
                        b.is_ascii_digit()
                    }
                })
            })
            .ok_or("Missing Codex rollout date")?;
        let dir = home
            .join("sessions")
            .join(&date[..4])
            .join(&date[5..7])
            .join(&date[8..10]);
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let dest = dir.join(path.file_name().unwrap());
        // Retrying a partial migration can replace already copied descendants.
        // The provider checks for the root before invoking this operation.
        staged.push((path, dest));
    }
    let root_name = staged[0].0.file_name().unwrap().to_string_lossy();
    if !root_name.ends_with(&format!("-{thread_id}.jsonl"))
        && !root_name.ends_with(&format!("-{thread_id}.jsonl.zst"))
    {
        return Err("The saved Mono root does not match its thread id".into());
    }
    let pending_dir = home.join(".monocode-migrations");
    std::fs::create_dir_all(&pending_dir).map_err(|e| e.to_string())?;
    let pending = pending_dir.join(thread_id);
    std::fs::write(&pending, b"pending").map_err(|e| e.to_string())?;
    // Copy descendants first and the root last, so a partial migration is not
    // mistaken for a successfully migrated root on the next connection.
    for (path, dest) in staged.iter().rev() {
        let temp = dest.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
        std::fs::copy(path, &temp)
            .map_err(|e| format!("Could not retain the full Codex thread: {e}"))?;
        // Windows requires write access when flushing a file to disk.
        std::fs::File::options()
            .write(true)
            .open(&temp)
            .and_then(|f| f.sync_all())
            .map_err(|e| e.to_string())?;
        std::fs::rename(&temp, dest).map_err(|e| e.to_string())?;
    }
    let edge_snapshot = edge_snapshot_path(home, thread_id);
    if !edges.is_empty() {
        let path = edge_snapshot;
        std::fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
        std::fs::write(&path, serde_json::to_vec(edges).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
        std::fs::File::options()
            .write(true)
            .open(&path)
            .and_then(|f| f.sync_all())
            .map_err(|e| e.to_string())?;
    } else if edge_snapshot.exists() {
        // A retry must not apply a closure changed in the original meanwhile.
        std::fs::remove_file(edge_snapshot).map_err(|e| e.to_string())?;
    }
    std::fs::remove_file(pending).map_err(|e| e.to_string())?;
    Ok(())
}

// Rollouts reconstruct the graph, but explicit agent closure lives only in
// SQLite. Apply that small snapshot after private app-server initialization
// and before it restores agent identities while resuming the root.
#[derive(Serialize, Deserialize)]
struct AgentEdge {
    parent: String,
    child: String,
    status: String,
}

fn edge_snapshot_path(home: &Path, thread_id: &str) -> PathBuf {
    home.join(".monocode-agent-state")
        .join(format!("{thread_id}.json"))
}

fn state_db(home: &Path) -> Result<Option<PathBuf>, String> {
    let entries = match std::fs::read_dir(home) {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e.to_string()),
    };
    let mut databases = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if let Some(version) = name
            .strip_prefix("state_")
            .and_then(|n| n.strip_suffix(".sqlite"))
            .and_then(|n| n.parse::<u32>().ok())
        {
            if entry.file_type().map_err(|e| e.to_string())?.is_file() {
                databases.push((version, entry.path()));
            }
        }
    }
    Ok(databases
        .into_iter()
        .max_by_key(|(version, _)| *version)
        .map(|(_, path)| path))
}

fn closed_agent_edges(home: &Path, thread_id: &str) -> Result<Vec<AgentEdge>, String> {
    validate_thread_id(thread_id)?;
    let Some(path) = state_db(home)? else {
        return Ok(Vec::new());
    };
    let db =
        rusqlite::Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
            .map_err(|e| e.to_string())?;
    db.busy_timeout(std::time::Duration::from_secs(5))
        .map_err(|e| e.to_string())?;
    let exists: bool = db.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='thread_spawn_edges')", [], |row| row.get(0)).map_err(|e| e.to_string())?;
    if !exists {
        return Ok(Vec::new());
    }
    let mut statement = db.prepare("WITH RECURSIVE subtree(child) AS (SELECT child_thread_id FROM thread_spawn_edges WHERE parent_thread_id = ?1 UNION SELECT edge.child_thread_id FROM thread_spawn_edges edge JOIN subtree ON edge.parent_thread_id = subtree.child) SELECT parent_thread_id, child_thread_id, status FROM thread_spawn_edges WHERE child_thread_id IN subtree AND status <> 'open'").map_err(|e| e.to_string())?;
    let rows = statement
        .query_map([thread_id], |row| {
            Ok(AgentEdge {
                parent: row.get(0)?,
                child: row.get(1)?,
                status: row.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

fn restore_agent_edges(home: &Path, thread_id: &str) -> Result<(), String> {
    let snapshot = edge_snapshot_path(home, thread_id);
    let bytes = match std::fs::read(&snapshot) {
        Ok(bytes) => bytes,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(e.to_string()),
    };
    let edges: Vec<AgentEdge> = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
    let path = state_db(home)?.ok_or("Codex has not initialized the private Mono index")?;
    let mut db =
        rusqlite::Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_WRITE)
            .map_err(|e| e.to_string())?;
    db.busy_timeout(std::time::Duration::from_secs(5))
        .map_err(|e| e.to_string())?;
    let tx = db.transaction().map_err(|e| e.to_string())?;
    for edge in edges {
        validate_thread_id(&edge.parent)?;
        validate_thread_id(&edge.child)?;
        tx.execute("INSERT INTO thread_spawn_edges(parent_thread_id, child_thread_id, status) VALUES (?1, ?2, ?3) ON CONFLICT(child_thread_id) DO UPDATE SET status=excluded.status WHERE parent_thread_id=excluded.parent_thread_id", rusqlite::params![edge.parent, edge.child, edge.status]).map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    std::fs::remove_file(snapshot).map_err(|e| e.to_string())?;
    Ok(())
}

fn rollout_matches(path: &Path, id: &str) -> bool {
    path.file_name().is_some_and(|name| {
        let name = name.to_string_lossy();
        name.ends_with(&format!("-{id}.jsonl")) || name.ends_with(&format!("-{id}.jsonl.zst"))
    })
}

fn find_thread(dir: &Path, id: &str) -> Result<Option<PathBuf>, String> {
    for entry in std::fs::read_dir(dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let kind = entry.file_type().map_err(|e| e.to_string())?;
        if kind.is_file() && rollout_matches(&entry.path(), id) {
            return Ok(Some(entry.path()));
        }
        if kind.is_dir() {
            if let Some(path) = find_thread(&entry.path(), id)? {
                return Ok(Some(path));
            }
        }
    }
    Ok(None)
}

fn history_base(path: &Path) -> Result<Option<String>, String> {
    use std::io::BufRead;
    let file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let reader: Box<dyn std::io::Read> = if path.extension().is_some_and(|ext| ext == "zst") {
        Box::new(zstd::stream::read::Decoder::new(file).map_err(|e| e.to_string())?)
    } else {
        Box::new(file)
    };
    let mut reader = std::io::BufReader::new(reader);
    let mut first = String::new();
    reader.read_line(&mut first).map_err(|e| e.to_string())?;
    if first.trim().is_empty() {
        return Ok(None);
    }
    let meta: serde_json::Value =
        serde_json::from_str(&first).map_err(|_| "Could not read native Codex context metadata")?;
    Ok(meta
        .pointer("/payload/history_base/thread_id")
        .and_then(|v| v.as_str())
        .map(str::to_owned))
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let dir =
                std::env::temp_dir().join(format!("monocode-codex-store-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir_all(&dir).unwrap();
            Self(dir)
        }
        fn source(&self) -> PathBuf {
            self.0.join("account")
        }
        fn home(&self) -> PathBuf {
            self.0.join("mono")
        }
        fn rollout(&self, id: &str, base: Option<&str>) -> PathBuf {
            let dir = self.source().join("archived_sessions");
            std::fs::create_dir_all(&dir).unwrap();
            let path = dir.join(format!("rollout-2026-10-08T10-00-00-{id}.jsonl"));
            let meta = serde_json::json!({"type":"session_meta", "payload": {"id":id, "history_base":base.map(|id| serde_json::json!({"thread_id":id}))}});
            std::fs::write(&path, format!("{meta}\n{{\"type\":\"response_item\",\"payload\":{{\"tool_history\":\"retained\"}}}}\n")).unwrap();
            path
        }
    }
    // Keep isolated fixtures for inspection; never recursively clean Codex homes.

    fn conflict_fixture(name: &str, mono: &[u8], account: &[u8]) -> (Fixture, StorageConflict) {
        let fixture = Fixture::new();
        std::fs::create_dir_all(fixture.source()).unwrap();
        std::fs::create_dir_all(fixture.home()).unwrap();
        std::fs::write(fixture.source().join(name), account).unwrap();
        std::fs::write(fixture.home().join(name), mono).unwrap();
        if name.eq_ignore_ascii_case("hooks.json") {
            opt_in_hooks(&fixture);
        }
        let (source, home) = storage_roots(&fixture.source(), &fixture.home()).unwrap();
        let conflict = file_conflict(&source, &home, name).unwrap();
        (fixture, conflict)
    }

    fn saved_bytes(fixture: &Fixture, name: &str) -> Vec<Vec<u8>> {
        std::fs::read_dir(fixture.home().join(".monocode-conflicts"))
            .unwrap()
            .map(|e| std::fs::read(e.unwrap().path().join(name)).unwrap())
            .collect()
    }

    fn opt_in_hooks(fixture: &Fixture) {
        std::fs::create_dir_all(fixture.home()).unwrap();
        std::fs::write(
            fixture.home().join(".monocode-hooks-policy.json"),
            br#"{"shareHooks":true}"#,
        )
        .unwrap();
    }

    #[test]
    fn storage_repair_atomic_source_replacement_detaches_hardlink_and_recovers_snapshot() {
        for name in ["hooks.json", "AGENTS.md", "config.toml"] {
            let fixture = Fixture::new();
            std::fs::create_dir_all(fixture.source()).unwrap();
            std::fs::create_dir_all(fixture.home()).unwrap();
            opt_in_hooks(&fixture);
            let source = fixture.source().join(name);
            let target = fixture.home().join(name);
            std::fs::write(&source, b"tracked native bytes\0").unwrap();
            std::fs::hard_link(&source, &target).unwrap();
            prepare_files(&fixture.source(), &fixture.home()).unwrap();
            let temp = fixture.source().join("replacement");
            std::fs::write(&temp, b"new account bytes").unwrap();
            replace_link(&temp, &source).unwrap();
            assert!(!same_entry(&source, &target));
            #[cfg(windows)]
            assert_eq!(file_info(&target).unwrap().nNumberOfLinks, 1);
            assert_eq!(std::fs::read(&target).unwrap(), b"tracked native bytes\0");
            prepare_files(&fixture.source(), &fixture.home()).unwrap();
            assert!(same_entry(&source, &target));
            assert_eq!(
                saved_bytes(&fixture, name),
                vec![b"tracked native bytes\0".to_vec()]
            );
            prepare_files(&fixture.source(), &fixture.home()).unwrap();
            assert_eq!(saved_bytes(&fixture, name).len(), 1);
            println!(
                "atomic-replacement {name}: preserved and relinked {}",
                fixture.0.display()
            );
        }
    }

    #[test]
    fn storage_repair_recovers_legacy_empty_hooks_and_identical_bytes_without_discarding_them() {
        for (mono, account) in [
            (
                br#"{ "hooks": {} }"#.as_slice(),
                b"changed hooks".as_slice(),
            ),
            (b"same bytes".as_slice(), b"same bytes".as_slice()),
        ] {
            let (fixture, _) = conflict_fixture("hooks.json", mono, account);
            prepare_files(&fixture.source(), &fixture.home()).unwrap();
            assert!(same_entry(
                &fixture.source().join("hooks.json"),
                &fixture.home().join("hooks.json")
            ));
            assert_eq!(saved_bytes(&fixture, "hooks.json"), vec![mono.to_vec()]);
            assert_eq!(
                std::fs::read(fixture.source().join("hooks.json")).unwrap(),
                account
            );
        }
    }

    #[test]
    fn storage_repair_unknown_bytes_need_explicit_choice_and_account_choice_preserves_bytes() {
        let (fixture, _) = conflict_fixture("hooks.json", b"unique mono bytes\0", b"account hooks");
        let error = prepare_files(&fixture.source(), &fixture.home()).unwrap_err();
        let conflict: StorageConflict = serde_json::from_str(&error).unwrap();
        assert!(!conflict.identical);
        assert_eq!(conflict.mono_bytes, 18);
        resolve_files(
            &fixture.source(),
            &fixture.home(),
            &conflict,
            StorageResolution::UseAccountVersion,
        )
        .unwrap();
        assert_eq!(
            saved_bytes(&fixture, "hooks.json"),
            vec![b"unique mono bytes\0".to_vec()]
        );
        assert_eq!(
            std::fs::read(fixture.source().join("hooks.json")).unwrap(),
            b"account hooks"
        );
        prepare_files(&fixture.source(), &fixture.home()).unwrap();
    }

    #[test]
    fn storage_repair_keep_mono_is_durable_and_independent_per_entry() {
        let (fixture, conflict) =
            conflict_fixture("hooks.json", b"private hooks", b"account hooks");
        std::fs::write(fixture.source().join("AGENTS.md"), b"account instructions").unwrap();
        resolve_files(
            &fixture.source(),
            &fixture.home(),
            &conflict,
            StorageResolution::KeepMonoVersion,
        )
        .unwrap();
        prepare_files(&fixture.source(), &fixture.home()).unwrap();
        std::fs::write(fixture.source().join("hooks.json"), b"later account hooks").unwrap();
        std::fs::write(fixture.home().join("hooks.json"), b"later private hooks").unwrap();
        prepare_files(&fixture.source(), &fixture.home()).unwrap();
        assert_eq!(
            std::fs::read(fixture.home().join("hooks.json")).unwrap(),
            b"later private hooks"
        );
        assert_eq!(
            std::fs::read(fixture.source().join("hooks.json")).unwrap(),
            b"later account hooks"
        );
        assert!(same_entry(
            &fixture.source().join("AGENTS.md"),
            &fixture.home().join("AGENTS.md")
        ));
    }

    #[test]
    fn storage_repair_deleted_private_override_returns_to_account_link() {
        let (fixture, conflict) =
            conflict_fixture("hooks.json", b"private hooks", b"account hooks");
        resolve_files(
            &fixture.source(),
            &fixture.home(),
            &conflict,
            StorageResolution::KeepMonoVersion,
        )
        .unwrap();
        std::fs::remove_file(fixture.home().join("hooks.json")).unwrap();
        prepare_files(&fixture.source(), &fixture.home()).unwrap();
        assert!(same_entry(
            &fixture.source().join("hooks.json"),
            &fixture.home().join("hooks.json")
        ));
        assert!(
            !read_snapshot(&fixture.home(), "hooks.json")
                .unwrap()
                .unwrap()
                .private_override
        );
        prepare_files(&fixture.source(), &fixture.home()).unwrap();
    }

    #[test]
    fn storage_repair_stale_choice_refreshes_conflict_without_changing_any_bytes() {
        for change_mono in [false, true] {
            let (fixture, conflict) = conflict_fixture("hooks.json", b"private", b"account");
            let path = if change_mono {
                fixture.home()
            } else {
                fixture.source()
            }
            .join("hooks.json");
            std::fs::write(&path, b"changed concurrently").unwrap();
            let error = resolve_files(
                &fixture.source(),
                &fixture.home(),
                &conflict,
                StorageResolution::UseAccountVersion,
            )
            .unwrap_err();
            let fresh: StorageConflict =
                serde_json::from_str(error.strip_prefix("Codex storage needs repair: ").unwrap())
                    .unwrap();
            assert_ne!(fresh, conflict);
            assert_eq!(std::fs::read(path).unwrap(), b"changed concurrently");
            assert!(!fixture.home().join(".monocode-conflicts").exists());
        }
    }

    #[test]
    fn storage_repair_rejects_other_account_paths_state_traversal_directories_and_missing_source() {
        let (fixture, mut conflict) = conflict_fixture("hooks.json", b"private", b"account");
        conflict.source_path.push_str("/other-account");
        assert!(resolve_files(
            &fixture.source(),
            &fixture.home(),
            &conflict,
            StorageResolution::UseAccountVersion
        )
        .is_err());
        for name in [
            "../hooks.json",
            "other/hooks.json",
            "C:\\hooks.json",
            "sessions",
            "state_5.sqlite",
            ".monocode-links",
            "..",
            "",
            "auth.json.",
            "auth.json ",
            "HISTORY.JSONL",
        ] {
            conflict.entry = name.into();
            assert!(
                resolve_files(
                    &fixture.source(),
                    &fixture.home(),
                    &conflict,
                    StorageResolution::KeepMonoVersion
                )
                .is_err(),
                "{name}"
            );
        }
        let (fixture, conflict) = conflict_fixture("hooks.json", b"private", b"account");
        std::fs::remove_file(fixture.source().join("hooks.json")).unwrap();
        assert!(resolve_files(
            &fixture.source(),
            &fixture.home(),
            &conflict,
            StorageResolution::UseAccountVersion
        )
        .is_err());
        assert_eq!(
            std::fs::read(fixture.home().join("hooks.json")).unwrap(),
            b"private"
        );
        let fixture = Fixture::new();
        std::fs::create_dir_all(fixture.source().join("skills")).unwrap();
        std::fs::create_dir_all(fixture.home().join("skills")).unwrap();
        assert!(file_conflict(&fixture.source(), &fixture.home(), "skills").is_err());
    }

    #[test]
    fn storage_repair_auth_cannot_be_private_and_comparison_does_not_export_configuration_secrets()
    {
        for name in [
            "auth.json",
            "AUTH.JSON",
            "Auth.Json",
            ".credentials.json",
            ".CrEdEnTiAlS.JsOn",
            "config.toml",
            "config.json",
        ] {
            let (fixture, conflict) = conflict_fixture(name, b"private token", b"account token");
            let comparison = compare_files(&fixture.source(), &fixture.home(), name).unwrap();
            assert!(comparison.mono_content.is_none());
            assert!(comparison.source_content.is_none());
            assert!(comparison.unavailable.is_some());
            if login_entry(name) {
                assert!(!conflict.can_keep_mono);
                assert!(resolve_files(
                    &fixture.source(),
                    &fixture.home(),
                    &conflict,
                    StorageResolution::KeepMonoVersion
                )
                .is_err());
                assert_eq!(
                    std::fs::read(fixture.home().join(name)).unwrap(),
                    b"private token"
                );
            }
        }
    }

    #[cfg(windows)]
    #[test]
    fn storage_repair_windows_name_aliases_keep_auth_required_and_state_private() {
        let (fixture, _) = conflict_fixture("AuTh.JsOn", b"private login", b"account login");
        let error = prepare_files(&fixture.source(), &fixture.home()).unwrap_err();
        let conflict: StorageConflict = serde_json::from_str(&error).unwrap();
        assert!(!conflict.can_keep_mono);
        assert!(resolve_files(
            &fixture.source(),
            &fixture.home(),
            &conflict,
            StorageResolution::KeepMonoVersion
        )
        .is_err());
        assert_eq!(
            std::fs::read(fixture.home().join("auth.json")).unwrap(),
            b"private login"
        );
        let fixture = Fixture::new();
        std::fs::create_dir_all(fixture.source().join("SESSIONS")).unwrap();
        std::fs::write(
            fixture.source().join("SESSIONS/account-history"),
            b"account history",
        )
        .unwrap();
        std::fs::write(fixture.source().join("HISTORY.JSONL"), b"account history").unwrap();
        prepare_files(&fixture.source(), &fixture.home()).unwrap();
        assert!(!fixture.home().join("sessions/account-history").exists());
        assert!(!fixture.home().join("history.jsonl").exists());
        assert!(!std::fs::symlink_metadata(fixture.home().join("sessions"))
            .unwrap()
            .file_type()
            .is_symlink());
        for name in [
            "AUTH.JSON",
            ".CrEdEnTiAlS.JsOn",
            "SeCrEtS",
            "HOOKS.JSON",
            "AGENTS.md",
            "CONFIG.TOML",
        ] {
            assert!(required_entry(name), "{name}");
        }
    }

    #[test]
    fn storage_repair_comparison_is_plain_bounded_text() {
        let bytes = vec![b'x'; 70 * 1024];
        let (fixture, _) = conflict_fixture("hooks.json", &bytes, b"<script>plain text</script>");
        let comparison = compare_files(&fixture.source(), &fixture.home(), "hooks.json").unwrap();
        assert!(comparison.truncated);
        assert_eq!(comparison.mono_content.unwrap().len(), 64 * 1024);
        assert_eq!(
            comparison.source_content.unwrap(),
            "<script>plain text</script>"
        );
    }

    #[test]
    fn storage_hooks_default_creates_private_empty_file_without_sharing_account_hooks() {
        let fixture = Fixture::new();
        std::fs::create_dir_all(fixture.source()).unwrap();
        std::fs::write(fixture.source().join("hooks.json"), b"account hooks").unwrap();
        prepare_files(&fixture.source(), &fixture.home()).unwrap();
        let target = fixture.home().join("hooks.json");
        assert_eq!(std::fs::read(&target).unwrap(), br#"{"hooks":{}}"#);
        assert!(!replaceable_link(&target).unwrap());
        assert!(!same_entry(&fixture.source().join("hooks.json"), &target));
        assert_eq!(
            std::fs::read(fixture.source().join("hooks.json")).unwrap(),
            b"account hooks"
        );
        assert!(!fixture.home().join(".monocode-conflicts").exists());
    }

    #[test]
    fn storage_hooks_isolation_preserves_real_custom_hooks_and_ignores_corrupt_shared_snapshot() {
        let fixture = Fixture::new();
        std::fs::create_dir_all(fixture.source()).unwrap();
        std::fs::create_dir_all(fixture.home()).unwrap();
        std::fs::write(fixture.source().join("hooks.json"), b"account hooks").unwrap();
        std::fs::write(fixture.home().join("hooks.json"), b"custom private hooks").unwrap();
        let snapshot = snapshot_path(&fixture.home(), "hooks.json").unwrap();
        std::fs::write(&snapshot, b"{broken").unwrap();
        for _ in 0..2 {
            prepare_files(&fixture.source(), &fixture.home()).unwrap();
            assert_eq!(
                std::fs::read(fixture.home().join("hooks.json")).unwrap(),
                b"custom private hooks"
            );
            assert_eq!(std::fs::read(&snapshot).unwrap(), b"{broken");
            assert!(!fixture.home().join(".monocode-conflicts").exists());
        }
    }

    #[test]
    fn storage_hooks_migrates_existing_symlink_and_hardlink_with_independent_real_archive() {
        for hardlink in [false, true] {
            let fixture = Fixture::new();
            std::fs::create_dir_all(fixture.source()).unwrap();
            std::fs::create_dir_all(fixture.home()).unwrap();
            let account = fixture.source().join("hooks.json");
            let target = fixture.home().join("hooks.json");
            std::fs::write(&account, b"previous shared hooks").unwrap();
            let account_id = entry_identity(&account).unwrap();
            if hardlink {
                std::fs::hard_link(&account, &target).unwrap();
            } else {
                create_link(&account, &target).unwrap();
            }
            prepare_files(&fixture.source(), &fixture.home()).unwrap();
            assert_eq!(std::fs::read(&target).unwrap(), br#"{"hooks":{}}"#);
            assert!(!replaceable_link(&target).unwrap());
            assert_eq!(
                saved_bytes(&fixture, "hooks.json"),
                vec![b"previous shared hooks".to_vec()]
            );
            let archive = std::fs::read_dir(fixture.home().join(".monocode-conflicts"))
                .unwrap()
                .next()
                .unwrap()
                .unwrap()
                .path()
                .join("hooks.json");
            assert!(!std::fs::symlink_metadata(&archive)
                .unwrap()
                .file_type()
                .is_symlink());
            assert_ne!(entry_identity(&archive).unwrap(), account_id);
            assert_eq!(entry_identity(&account).unwrap(), account_id);
            std::fs::write(&account, b"later account hooks").unwrap();
            assert_eq!(std::fs::read(&archive).unwrap(), b"previous shared hooks");
            assert_eq!(std::fs::read(&target).unwrap(), br#"{"hooks":{}}"#);
            prepare_files(&fixture.source(), &fixture.home()).unwrap();
            assert_eq!(saved_bytes(&fixture, "hooks.json").len(), 1);
        }
    }

    #[test]
    fn storage_hooks_atomic_account_rewrites_never_change_or_block_isolated_hooks() {
        let fixture = Fixture::new();
        std::fs::create_dir_all(fixture.source()).unwrap();
        std::fs::write(fixture.source().join("hooks.json"), b"account hooks").unwrap();
        prepare_files(&fixture.source(), &fixture.home()).unwrap();
        for content in [b"rewritten hooks".as_slice(), b"next account hooks"] {
            let replacement = fixture.source().join("replacement");
            std::fs::write(&replacement, content).unwrap();
            replace_link(&replacement, &fixture.source().join("hooks.json")).unwrap();
            prepare_files(&fixture.source(), &fixture.home()).unwrap();
            assert_eq!(
                std::fs::read(fixture.home().join("hooks.json")).unwrap(),
                br#"{"hooks":{}}"#
            );
            assert_eq!(
                std::fs::read(fixture.source().join("hooks.json")).unwrap(),
                content
            );
        }
    }

    #[test]
    fn storage_hooks_explicit_opt_in_shares_only_selected_account_home() {
        let fixture = Fixture::new();
        std::fs::create_dir_all(fixture.source()).unwrap();
        std::fs::write(fixture.source().join("hooks.json"), b"account hooks").unwrap();
        opt_in_hooks(&fixture);
        prepare_files(&fixture.source(), &fixture.home()).unwrap();
        assert!(same_entry(
            &fixture.source().join("hooks.json"),
            &fixture.home().join("hooks.json")
        ));
        let other_home = fixture.0.join("other-mono");
        prepare_files(&fixture.source(), &other_home).unwrap();
        assert_eq!(
            std::fs::read(other_home.join("hooks.json")).unwrap(),
            br#"{"hooks":{}}"#
        );
        assert!(!same_entry(
            &fixture.source().join("hooks.json"),
            &other_home.join("hooks.json")
        ));
    }

    #[test]
    fn storage_hooks_policy_getter_is_read_only_and_malformed_json_stays_isolated() {
        let fixture = Fixture::new();
        assert!(!hooks_shared(&fixture.home()).unwrap());
        assert!(!fixture.home().exists());
        std::fs::create_dir_all(fixture.home()).unwrap();
        let policy = fixture.home().join(".monocode-hooks-policy.json");
        for bytes in [b"{broken".as_slice(), br#"{"shareHooks":"true"}"#, b"{}"] {
            std::fs::write(&policy, bytes).unwrap();
            assert!(!hooks_shared(&fixture.home()).unwrap());
            prepare_files(&fixture.source(), &fixture.home()).unwrap();
            assert_eq!(std::fs::read(&policy).unwrap(), bytes);
            assert_eq!(
                std::fs::read(fixture.home().join("hooks.json")).unwrap(),
                br#"{"hooks":{}}"#
            );
        }
    }

    #[test]
    fn storage_hooks_policy_setter_applies_on_next_prepare_and_avoids_snapshot_name_collision() {
        let fixture = Fixture::new();
        std::fs::create_dir_all(fixture.source()).unwrap();
        std::fs::write(fixture.source().join("hooks.json"), b"account hooks").unwrap();
        std::fs::write(
            fixture.source().join("hooks-policy"),
            b"unrelated optional account file",
        )
        .unwrap();
        prepare_files(&fixture.source(), &fixture.home()).unwrap();
        set_hooks_shared(&fixture.home(), true).unwrap();
        assert!(hooks_shared(&fixture.home()).unwrap());
        assert_eq!(
            std::fs::read(fixture.home().join("hooks.json")).unwrap(),
            br#"{"hooks":{}}"#
        );
        prepare_files(&fixture.source(), &fixture.home()).unwrap();
        assert!(hooks_shared(&fixture.home()).unwrap());
        assert!(same_entry(
            &fixture.source().join("hooks.json"),
            &fixture.home().join("hooks.json")
        ));
        assert_eq!(
            saved_bytes(&fixture, "hooks.json"),
            vec![br#"{"hooks":{}}"#.to_vec()]
        );
        set_hooks_shared(&fixture.home(), false).unwrap();
        assert!(same_entry(
            &fixture.source().join("hooks.json"),
            &fixture.home().join("hooks.json")
        ));
        prepare_files(&fixture.source(), &fixture.home()).unwrap();
        assert_eq!(
            std::fs::read(fixture.home().join("hooks.json")).unwrap(),
            br#"{"hooks":{}}"#
        );
        assert_eq!(saved_bytes(&fixture, "hooks.json").len(), 2);
        assert_eq!(
            std::fs::read(fixture.source().join("hooks.json")).unwrap(),
            b"account hooks"
        );
    }

    #[test]
    fn storage_hooks_opt_in_refreshes_prior_private_override_without_authorizing_custom_bytes() {
        let (fixture, conflict) =
            conflict_fixture("hooks.json", b"private hooks", b"account hooks");
        resolve_files(
            &fixture.source(),
            &fixture.home(),
            &conflict,
            StorageResolution::KeepMonoVersion,
        )
        .unwrap();
        set_hooks_shared(&fixture.home(), true).unwrap();
        assert!(
            read_snapshot(&fixture.home(), "hooks.json")
                .unwrap()
                .unwrap()
                .private_override
        );
        set_hooks_shared(&fixture.home(), false).unwrap();
        prepare_files(&fixture.source(), &fixture.home()).unwrap();
        set_hooks_shared(&fixture.home(), true).unwrap();
        let snapshot = read_snapshot(&fixture.home(), "hooks.json")
            .unwrap()
            .unwrap();
        assert!(!snapshot.private_override && !snapshot.invalid && snapshot.fingerprint.is_empty());
        let error = prepare_files(&fixture.source(), &fixture.home()).unwrap_err();
        let fresh: StorageConflict = serde_json::from_str(&error).unwrap();
        assert_eq!(
            std::fs::read(fixture.home().join("hooks.json")).unwrap(),
            b"private hooks"
        );
        assert!(!fixture.home().join(".monocode-conflicts").exists());
        resolve_files(
            &fixture.source(),
            &fixture.home(),
            &fresh,
            StorageResolution::UseAccountVersion,
        )
        .unwrap();
        assert_eq!(
            saved_bytes(&fixture, "hooks.json"),
            vec![b"private hooks".to_vec()]
        );
    }

    #[test]
    fn storage_hooks_isolation_claim_preserves_concurrent_custom_file() {
        let fixture = Fixture::new();
        std::fs::create_dir_all(fixture.source()).unwrap();
        std::fs::create_dir_all(fixture.home()).unwrap();
        let account = fixture.source().join("hooks.json");
        let target = fixture.home().join("hooks.json");
        std::fs::write(&account, b"account hooks").unwrap();
        create_link(&account, &target).unwrap();
        let racing_target = target.clone();
        synchronized_claim_writer(move || {
            std::fs::remove_file(&racing_target).unwrap();
            std::fs::write(racing_target, b"concurrent private custom hooks").unwrap();
        });
        prepare_files(&fixture.source(), &fixture.home()).unwrap();
        assert_eq!(
            std::fs::read(target).unwrap(),
            b"concurrent private custom hooks"
        );
        assert_eq!(std::fs::read(account).unwrap(), b"account hooks");
        assert!(!fixture.home().join(".monocode-conflicts").exists());
    }

    #[test]
    fn storage_hooks_isolated_resolution_rejects_stale_choices_and_actual_windows_alias() {
        let (fixture, conflict) =
            conflict_fixture("hooks.json", b"private hooks", b"account hooks");
        set_hooks_shared(&fixture.home(), false).unwrap();
        let mut names = vec!["hooks.json".to_owned()];
        #[cfg(windows)]
        names.push(short_name(&fixture.home().join("hooks.json")));
        for name in names {
            for resolution in [
                StorageResolution::UseAccountVersion,
                StorageResolution::KeepMonoVersion,
            ] {
                let mut stale: StorageConflict =
                    serde_json::from_value(serde_json::to_value(&conflict).unwrap()).unwrap();
                stale.entry = name.clone();
                let error = resolve_files(&fixture.source(), &fixture.home(), &stale, resolution)
                    .unwrap_err();
                assert!(error.contains("hooks are isolated"), "{error}");
            }
        }
        prepare_files(&fixture.source(), &fixture.home()).unwrap();
        assert_eq!(
            std::fs::read(fixture.home().join("hooks.json")).unwrap(),
            b"private hooks"
        );
        assert_eq!(
            std::fs::read(fixture.source().join("hooks.json")).unwrap(),
            b"account hooks"
        );
        assert!(!fixture.home().join(".monocode-conflicts").exists());
    }

    #[test]
    fn storage_hooks_dangling_link_is_retained_with_actionable_error() {
        let fixture = Fixture::new();
        std::fs::create_dir_all(fixture.source()).unwrap();
        std::fs::create_dir_all(fixture.home()).unwrap();
        let missing = fixture.0.join("missing-hooks");
        let target = fixture.home().join("hooks.json");
        #[cfg(windows)]
        std::os::windows::fs::symlink_file(&missing, &target).unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(&missing, &target).unwrap();
        let error = prepare_files(&fixture.source(), &fixture.home()).unwrap_err();
        assert!(
            error.contains("Could not read linked Mono hooks") && error.contains("preserved"),
            "{error}"
        );
        assert!(std::fs::symlink_metadata(&target)
            .unwrap()
            .file_type()
            .is_symlink());
        assert!(!missing.exists());
        assert!(!fixture.home().join(".monocode-conflicts").exists());
    }

    #[test]
    fn storage_hooks_policy_rejects_linked_metadata_without_modifying_referent() {
        for hardlink in [false, true] {
            let fixture = Fixture::new();
            std::fs::create_dir_all(fixture.home()).unwrap();
            let outside = fixture.0.join("outside-policy");
            let policy = fixture.home().join(".monocode-hooks-policy.json");
            std::fs::write(&outside, br#"{"shareHooks":true}"#).unwrap();
            if hardlink {
                std::fs::hard_link(&outside, &policy).unwrap();
            } else {
                #[cfg(windows)]
                std::os::windows::fs::symlink_file(&outside, &policy).unwrap();
                #[cfg(unix)]
                std::os::unix::fs::symlink(&outside, &policy).unwrap();
            }
            assert!(hooks_shared(&fixture.home()).is_err());
            assert!(set_hooks_shared(&fixture.home(), false).is_err());
            assert_eq!(std::fs::read(outside).unwrap(), br#"{"shareHooks":true}"#);
        }
    }

    #[cfg(windows)]
    #[test]
    fn storage_hooks_busy_symlink_referent_and_hardlink_preserve_all_bytes() {
        use std::os::windows::fs::OpenOptionsExt;
        use windows_sys::Win32::Storage::FileSystem::{
            FILE_SHARE_DELETE, FILE_SHARE_READ, FILE_SHARE_WRITE,
        };
        for hardlink in [false, true] {
            let fixture = Fixture::new();
            std::fs::create_dir_all(fixture.source()).unwrap();
            std::fs::create_dir_all(fixture.home()).unwrap();
            let account = fixture.source().join("hooks.json");
            let target = fixture.home().join("hooks.json");
            std::fs::write(&account, b"busy shared hooks").unwrap();
            if hardlink {
                std::fs::hard_link(&account, &target).unwrap();
            } else {
                create_link(&account, &target).unwrap();
            }
            let mut writer = std::fs::OpenOptions::new()
                .write(true)
                .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE)
                .open(&account)
                .unwrap();
            assert!(prepare_files(&fixture.source(), &fixture.home()).is_err());
            assert_eq!(std::fs::read(&target).unwrap(), b"busy shared hooks");
            assert!(!fixture.home().join(".monocode-conflicts").exists());
            writer.write_all(b"new account hooks").unwrap();
            drop(writer);
            prepare_files(&fixture.source(), &fixture.home()).unwrap();
            assert_eq!(
                saved_bytes(&fixture, "hooks.json"),
                vec![b"new account hooks".to_vec()]
            );
            assert_eq!(std::fs::read(target).unwrap(), br#"{"hooks":{}}"#);
        }
    }

    fn synchronized_claim_writer(writer: impl FnOnce() + Send + 'static) {
        BEFORE_CLAIM.with(|hook| {
            *hook.borrow_mut() = Some(Box::new(move || {
                std::thread::spawn(writer).join().unwrap();
            }));
        });
    }

    #[cfg(windows)]
    fn short_name(path: &Path) -> String {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::Storage::FileSystem::GetShortPathNameW;
        let input: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
        let mut output = vec![0u16; 32768];
        let len =
            unsafe { GetShortPathNameW(input.as_ptr(), output.as_mut_ptr(), output.len() as u32) };
        assert!(len > 0 && (len as usize) < output.len());
        let short = String::from_utf16(&output[..len as usize]).unwrap();
        Path::new(&short)
            .file_name()
            .unwrap()
            .to_str()
            .unwrap()
            .into()
    }

    #[cfg(windows)]
    #[test]
    fn storage_review_short_aliases_cannot_keep_credentials_private() {
        for name in ["auth.json", ".credentials.json"] {
            let (fixture, _) =
                conflict_fixture(name, b"private credentials", b"account credentials");
            let alias = short_name(&fixture.home().join(name));
            assert_ne!(
                alias.to_ascii_lowercase(),
                name,
                "NTFS fixture needs an actual 8.3 alias"
            );
            let conflict = file_conflict(&fixture.source(), &fixture.home(), &alias).unwrap();
            assert!(!conflict.can_keep_mono, "{name} -> {alias}");
            assert!(shared_entry_name(&fixture.home(), &alias)
                .unwrap()
                .eq_ignore_ascii_case(name));
            assert!(resolve_files(
                &fixture.source(),
                &fixture.home(),
                &conflict,
                StorageResolution::KeepMonoVersion
            )
            .is_err());
            let comparison = compare_files(&fixture.source(), &fixture.home(), &alias).unwrap();
            assert!(comparison.mono_content.is_none());
            assert!(comparison.source_content.is_none());
            assert_eq!(
                std::fs::read(fixture.home().join(name)).unwrap(),
                b"private credentials"
            );
        }
    }

    #[cfg(windows)]
    #[test]
    fn storage_review_short_aliases_cannot_resolve_or_compare_private_sqlite() {
        let fixture = Fixture::new();
        std::fs::create_dir_all(fixture.source()).unwrap();
        std::fs::create_dir_all(fixture.home()).unwrap();
        let name = "state_5.sqlite";
        std::fs::write(fixture.source().join(name), b"account state").unwrap();
        std::fs::write(fixture.home().join(name), b"private state").unwrap();
        let alias = short_name(&fixture.home().join(name));
        assert_ne!(
            alias.to_ascii_lowercase(),
            name,
            "NTFS fixture needs an actual 8.3 alias"
        );
        assert!(file_conflict(&fixture.source(), &fixture.home(), &alias).is_err());
        assert!(compare_files(&fixture.source(), &fixture.home(), &alias).is_err());
        assert!(shared_entry_name(&fixture.home(), &alias).is_err());
        std::fs::write(fixture.source().join("hooks.json"), b"account hooks").unwrap();
        std::fs::write(fixture.home().join("hooks.json"), b"private hooks").unwrap();
        let mut forged = file_conflict(&fixture.source(), &fixture.home(), "hooks.json").unwrap();
        forged.entry = alias;
        assert!(resolve_files(
            &fixture.source(),
            &fixture.home(),
            &forged,
            StorageResolution::UseAccountVersion
        )
        .is_err());
        assert_eq!(
            std::fs::read(fixture.home().join(name)).unwrap(),
            b"private state"
        );
        assert!(!fixture.home().join(".monocode-conflicts").exists());
    }

    #[test]
    fn storage_review_ordinary_relink_preserves_concurrent_real_file() {
        let fixture = Fixture::new();
        std::fs::create_dir_all(fixture.source()).unwrap();
        std::fs::create_dir_all(fixture.home()).unwrap();
        let old = fixture.0.join("old-account-hooks");
        let account = fixture.source().join("hooks.json");
        let target = fixture.home().join("hooks.json");
        std::fs::write(&old, b"old shared bytes").unwrap();
        std::fs::write(&account, b"current account bytes").unwrap();
        create_link(&old, &target).unwrap();
        let concurrent_target = target.clone();
        synchronized_claim_writer(move || {
            std::fs::remove_file(&concurrent_target).unwrap();
            std::fs::write(concurrent_target, b"unique concurrent Mono bytes").unwrap();
        });
        assert!(link_entry(&account, &target).is_err());
        assert_eq!(
            std::fs::read(&target).unwrap(),
            b"unique concurrent Mono bytes"
        );
        assert!(!std::fs::symlink_metadata(&target)
            .unwrap()
            .file_type()
            .is_symlink());
        assert_eq!(std::fs::read(account).unwrap(), b"current account bytes");
    }

    #[test]
    fn storage_review_autoheal_rechecks_claimed_bytes_after_concurrent_write() {
        let (fixture, _) = conflict_fixture("hooks.json", br#"{"hooks":{}}"#, b"account hooks");
        let target = fixture.home().join("hooks.json");
        let racing_target = target.clone();
        synchronized_claim_writer(move || {
            std::fs::write(racing_target, b"new distinct private hooks").unwrap();
        });
        let error = prepare_files(&fixture.source(), &fixture.home()).unwrap_err();
        let fresh: StorageConflict = serde_json::from_str(&error).unwrap();
        assert_eq!(fresh.mono_bytes, b"new distinct private hooks".len() as u64);
        assert_eq!(
            std::fs::read(target).unwrap(),
            b"new distinct private hooks"
        );
        assert!(!fixture.home().join(".monocode-conflicts").exists());
    }

    #[test]
    fn storage_review_explicit_resolution_rejects_racing_symlink_without_archiving_it() {
        for resolution in [
            StorageResolution::UseAccountVersion,
            StorageResolution::KeepMonoVersion,
        ] {
            let (fixture, conflict) =
                conflict_fixture("hooks.json", b"reviewed private bytes", b"account bytes");
            let target = fixture.home().join("hooks.json");
            let outside = fixture.0.join("external-hooks");
            std::fs::write(&outside, b"concurrent external bytes").unwrap();
            let racing_target = target.clone();
            let racing_outside = outside.clone();
            synchronized_claim_writer(move || {
                std::fs::remove_file(&racing_target).unwrap();
                #[cfg(unix)]
                std::os::unix::fs::symlink(racing_outside, racing_target).unwrap();
                #[cfg(windows)]
                std::os::windows::fs::symlink_file(racing_outside, racing_target).unwrap();
            });
            assert!(
                resolve_files(&fixture.source(), &fixture.home(), &conflict, resolution).is_err()
            );
            assert!(std::fs::symlink_metadata(&target)
                .unwrap()
                .file_type()
                .is_symlink());
            std::fs::write(&outside, b"later external bytes").unwrap();
            assert_eq!(std::fs::read(target).unwrap(), b"later external bytes");
            assert!(!fixture.home().join(".monocode-conflicts").exists());
        }
    }

    #[test]
    fn storage_review_corrupt_snapshot_preserves_metadata_and_requires_explicit_choice() {
        for mono in [
            b"private hooks".as_slice(),
            br#"{"hooks":{}}"#,
            b"account hooks",
        ] {
            let (fixture, _) = conflict_fixture("hooks.json", mono, b"account hooks");
            let metadata = snapshot_path(&fixture.home(), "hooks.json").unwrap();
            std::fs::write(&metadata, b"{broken").unwrap();
            let mut conflict = None;
            for _ in 0..2 {
                let error = prepare_files(&fixture.source(), &fixture.home()).unwrap_err();
                conflict = Some(serde_json::from_str::<StorageConflict>(&error).unwrap());
                assert_eq!(
                    std::fs::read(fixture.home().join("hooks.json")).unwrap(),
                    mono
                );
                assert!(!fixture.home().join(".monocode-conflicts").exists());
            }
            let preserved: Vec<_> = std::fs::read_dir(metadata.parent().unwrap())
                .unwrap()
                .map(|entry| entry.unwrap().path())
                .filter(|path| {
                    path.file_name()
                        .unwrap()
                        .to_string_lossy()
                        .contains(".corrupt-")
                })
                .collect();
            assert_eq!(preserved.len(), 1);
            assert_eq!(std::fs::read(&preserved[0]).unwrap(), b"{broken");
            assert!(!std::fs::symlink_metadata(&preserved[0])
                .unwrap()
                .file_type()
                .is_symlink());
            resolve_files(
                &fixture.source(),
                &fixture.home(),
                &conflict.unwrap(),
                StorageResolution::KeepMonoVersion,
            )
            .unwrap();
            prepare_files(&fixture.source(), &fixture.home()).unwrap();
            assert_eq!(
                std::fs::read(fixture.home().join("hooks.json")).unwrap(),
                mono
            );
            assert_eq!(std::fs::read(&preserved[0]).unwrap(), b"{broken");
        }
    }

    #[test]
    fn storage_review_archive_is_a_new_real_file_with_independent_identity() {
        let (fixture, conflict) =
            conflict_fixture("hooks.json", b"private native bytes", b"account hooks");
        let original_id = entry_identity(&fixture.home().join("hooks.json")).unwrap();
        resolve_files(
            &fixture.source(),
            &fixture.home(),
            &conflict,
            StorageResolution::UseAccountVersion,
        )
        .unwrap();
        let backup = std::fs::read_dir(fixture.home().join(".monocode-conflicts"))
            .unwrap()
            .next()
            .unwrap()
            .unwrap()
            .path()
            .join("hooks.json");
        let metadata = std::fs::symlink_metadata(&backup).unwrap();
        assert!(metadata.is_file() && !metadata.file_type().is_symlink());
        assert_ne!(entry_identity(&backup).unwrap(), original_id);
        #[cfg(windows)]
        assert_eq!(file_info(&backup).unwrap().nNumberOfLinks, 1);
        std::fs::write(fixture.source().join("hooks.json"), b"later account hooks").unwrap();
        assert_eq!(std::fs::read(&backup).unwrap(), b"private native bytes");
    }

    #[cfg(windows)]
    #[test]
    fn storage_review_existing_writer_handle_blocks_autoheal_and_both_explicit_choices() {
        use std::os::windows::fs::OpenOptionsExt;
        use windows_sys::Win32::Storage::FileSystem::{
            FILE_SHARE_DELETE, FILE_SHARE_READ, FILE_SHARE_WRITE,
        };
        for resolution in [
            None,
            Some(StorageResolution::UseAccountVersion),
            Some(StorageResolution::KeepMonoVersion),
        ] {
            let (fixture, conflict) =
                conflict_fixture("hooks.json", br#"{"hooks":{}}"#, b"account hooks");
            let mut writer = std::fs::OpenOptions::new()
                .write(true)
                .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE)
                .open(fixture.home().join("hooks.json"))
                .unwrap();
            let result = match resolution {
                None => prepare_files(&fixture.source(), &fixture.home()),
                Some(resolution) => {
                    resolve_files(&fixture.source(), &fixture.home(), &conflict, resolution)
                }
            };
            assert!(result.is_err());
            writer.write_all(b"still writable").unwrap();
            assert_eq!(
                std::fs::read(fixture.home().join("hooks.json")).unwrap(),
                b"still writable"
            );
            assert!(!fixture.home().join(".monocode-conflicts").exists());
        }
    }

    #[test]
    fn storage_repair_recreated_target_is_not_overwritten_after_original_is_archived() {
        let (fixture, _) = conflict_fixture("hooks.json", b"concurrent writer", b"account");
        let saved = fixture.home().join("archived-original");
        std::fs::write(&saved, b"original").unwrap();
        let temp = fixture
            .home()
            .join(format!(".monocode-link-{}", uuid::Uuid::new_v4()));
        create_link(&fixture.source().join("hooks.json"), &temp).unwrap();
        let staged = transactions::RecordedEntry::new(&temp).unwrap();
        assert!(staged
            .publish(&temp, &fixture.home().join("hooks.json"))
            .is_err());
        staged.cleanup(&temp).unwrap();
        assert_eq!(
            std::fs::read(fixture.home().join("hooks.json")).unwrap(),
            b"concurrent writer"
        );
        assert_eq!(std::fs::read(saved).unwrap(), b"original");
        assert_eq!(
            std::fs::read(fixture.source().join("hooks.json")).unwrap(),
            b"account"
        );
    }

    #[test]
    fn storage_repair_failed_publication_restores_original_and_retains_archived_bytes() {
        let fixture = Fixture::new();
        std::fs::create_dir_all(fixture.home()).unwrap();
        let source = fixture.0.join("invalid-source/parent/entry");
        std::fs::write(fixture.0.join("invalid-source"), b"cannot be a directory").unwrap();
        let target = fixture.home().join("hooks.json");
        let saved = fixture.home().join("archived-original");
        std::fs::write(&saved, b"original").unwrap();
        std::fs::write(&target, b"original").unwrap();
        let mut claimed = ClaimedEntry::new(&target, ClaimIntent::UseAccount, None).unwrap();
        let result = publish_new_entry(&source, &target);
        assert!(claimed.finish(result).is_err());
        assert_eq!(std::fs::read(&target).unwrap(), b"original");
        assert_eq!(std::fs::read(saved).unwrap(), b"original");
    }

    #[test]
    fn storage_repair_recreated_symlink_and_linked_snapshot_cannot_redirect_writes() {
        let (fixture, conflict) = conflict_fixture("hooks.json", b"private", b"account");
        let outside = fixture.0.join("outside-file");
        let target = fixture.home().join("hooks.json");
        let saved = fixture.home().join("archived-original");
        std::fs::rename(&target, &saved).unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(&outside, &target).unwrap();
        #[cfg(windows)]
        if std::os::windows::fs::symlink_file(&outside, &target).is_err() {
            println!(
                "File-symlink privilege unavailable; junction metadata rejection tested separately"
            );
            return;
        }
        let temp = fixture
            .home()
            .join(format!(".monocode-link-{}", uuid::Uuid::new_v4()));
        create_link(&fixture.source().join("hooks.json"), &temp).unwrap();
        let staged = transactions::RecordedEntry::new(&temp).unwrap();
        assert!(staged.publish(&temp, &target).is_err());
        staged.cleanup(&temp).unwrap();
        assert!(!outside.exists());
        assert_eq!(std::fs::read(&saved).unwrap(), b"private");
        remove_link(&target).unwrap();
        std::fs::rename(&saved, &target).unwrap();
        let metadata = private_directory(&fixture.home(), ".monocode-links")
            .unwrap()
            .join("hooks.json.json");
        #[cfg(unix)]
        std::os::unix::fs::symlink(&outside, &metadata).unwrap();
        #[cfg(windows)]
        std::os::windows::fs::symlink_file(&outside, &metadata).unwrap();
        assert!(resolve_files(
            &fixture.source(),
            &fixture.home(),
            &conflict,
            StorageResolution::UseAccountVersion
        )
        .is_err());
        assert!(!outside.exists());
        assert_eq!(std::fs::read(target).unwrap(), b"private");
    }

    #[test]
    fn storage_repair_linked_metadata_directories_cannot_redirect_backups_or_overrides() {
        for name in [".monocode-links", ".monocode-conflicts"] {
            let (fixture, conflict) = conflict_fixture("hooks.json", b"private", b"account");
            let outside = fixture.0.join("outside");
            std::fs::create_dir(&outside).unwrap();
            #[cfg(unix)]
            std::os::unix::fs::symlink(&outside, fixture.home().join(name)).unwrap();
            #[cfg(windows)]
            junction::create(&outside, fixture.home().join(name)).unwrap();
            let choice = if name == ".monocode-links" {
                StorageResolution::KeepMonoVersion
            } else {
                StorageResolution::UseAccountVersion
            };
            assert!(resolve_files(&fixture.source(), &fixture.home(), &conflict, choice).is_err());
            assert_eq!(std::fs::read_dir(outside).unwrap().count(), 0);
            assert_eq!(
                std::fs::read(fixture.home().join("hooks.json")).unwrap(),
                b"private"
            );
            assert_eq!(
                std::fs::read(fixture.source().join("hooks.json")).unwrap(),
                b"account"
            );
        }
    }

    #[cfg(windows)]
    #[test]
    fn storage_repair_busy_detached_target_keeps_all_bytes_and_cleans_staged_link() {
        use std::os::windows::fs::OpenOptionsExt;
        use windows_sys::Win32::Storage::FileSystem::{FILE_SHARE_READ, FILE_SHARE_WRITE};
        let (fixture, conflict) = conflict_fixture("hooks.json", b"private", b"account");
        let _busy = std::fs::OpenOptions::new()
            .read(true)
            .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE)
            .open(fixture.home().join("hooks.json"))
            .unwrap();
        assert!(resolve_files(
            &fixture.source(),
            &fixture.home(),
            &conflict,
            StorageResolution::UseAccountVersion
        )
        .is_err());
        assert_eq!(
            std::fs::read(fixture.home().join("hooks.json")).unwrap(),
            b"private"
        );
        assert_eq!(
            std::fs::read(fixture.source().join("hooks.json")).unwrap(),
            b"account"
        );
        assert!(std::fs::read_dir(fixture.home()).unwrap().all(|e| !e
            .unwrap()
            .file_name()
            .to_string_lossy()
            .starts_with(".monocode-link-")));
    }

    #[cfg(windows)]
    #[test]
    fn storage_repair_file_symlinks_follow_account_atomic_replacement_when_permitted() {
        let fixture = Fixture::new();
        std::fs::create_dir_all(fixture.source()).unwrap();
        std::fs::create_dir_all(fixture.home()).unwrap();
        let source = fixture.source().join("hooks.json");
        let target = fixture.home().join("hooks.json");
        std::fs::write(&source, b"old").unwrap();
        if std::os::windows::fs::symlink_file(&source, &target).is_err() {
            println!(
                "File-symlink privilege unavailable; snapshot hardlink recovery tested separately"
            );
            return;
        }
        let replacement = fixture.source().join("replacement");
        std::fs::write(&replacement, b"new").unwrap();
        replace_link(&replacement, &source).unwrap();
        assert_eq!(std::fs::read(target).unwrap(), b"new");
        println!("File-symlink privilege available; source rename followed without prepare");
    }

    #[test]
    fn shares_settings_and_login_but_not_codex_state() {
        let fixture = Fixture::new();
        let source = fixture.source();
        let home = fixture.home();
        std::fs::create_dir_all(source.join("sessions")).unwrap();
        for name in [
            "config.toml",
            "auth.json",
            "history.jsonl",
            "state_5.sqlite",
            "session_index.jsonl",
        ] {
            std::fs::write(source.join(name), name).unwrap();
        }
        std::fs::create_dir_all(source.join("skills")).unwrap();
        prepare_files(&source, &home).unwrap();
        prepare_files(&source, &home).unwrap();
        assert_eq!(
            std::fs::read_to_string(home.join("config.toml")).unwrap(),
            "config.toml"
        );
        std::fs::write(home.join("auth.json"), "refreshed login").unwrap();
        assert_eq!(
            std::fs::read_to_string(source.join("auth.json")).unwrap(),
            "refreshed login"
        );
        assert!(home.join("skills").is_dir());
        assert!(home.join("sessions").is_dir());
        for name in ["history.jsonl", "state_5.sqlite", "session_index.jsonl"] {
            assert!(!home.join(name).exists());
        }
        std::fs::write(home.join("sessions/private"), "private").unwrap();
        assert!(!source.join("sessions/private").exists());
        std::fs::write(home.join("secrets/shared"), "encrypted").unwrap();
        assert_eq!(
            std::fs::read_to_string(source.join("secrets/shared")).unwrap(),
            "encrypted"
        );
    }

    #[test]
    fn rejects_a_private_state_link_to_the_original_home() {
        let fixture = Fixture::new();
        std::fs::create_dir_all(fixture.source().join("sessions")).unwrap();
        std::fs::create_dir_all(fixture.home()).unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(
            fixture.source().join("sessions"),
            fixture.home().join("sessions"),
        )
        .unwrap();
        #[cfg(windows)]
        junction::create(
            fixture.source().join("sessions"),
            fixture.home().join("sessions"),
        )
        .unwrap();
        assert!(prepare_files(&fixture.source(), &fixture.home()).is_err());
    }

    #[cfg(windows)]
    #[test]
    fn shares_readable_directory_junctions_with_verbatim_paths() {
        let fixture = Fixture::new();
        let source = fixture.source().join("skills [shared]");
        std::fs::create_dir_all(&source).unwrap();
        std::fs::create_dir_all(fixture.home()).unwrap();
        std::fs::write(source.join("skill.txt"), "shared skill").unwrap();
        // canonicalize supplies the verbatim prefix that broke PowerShell.
        let source = source.canonicalize().unwrap();
        let target = fixture.home().canonicalize().unwrap().join("skills");
        link_entry(&source, &target).unwrap();
        assert_eq!(
            std::fs::read_to_string(target.join("skill.txt")).unwrap(),
            "shared skill"
        );
        link_entry(&source, &target).unwrap();
        assert_eq!(target.canonicalize().unwrap(), source);
    }

    #[test]
    fn link_safety_preserves_real_files_directories_and_private_state() {
        let fixture = Fixture::new();
        std::fs::create_dir_all(fixture.source()).unwrap();
        std::fs::create_dir_all(fixture.home().join("sessions")).unwrap();
        std::fs::create_dir_all(fixture.home().join(".monocode-migrations")).unwrap();
        for name in ["config.toml", "config.toml.bak", "AGENTS.md"] {
            std::fs::write(fixture.source().join(name), "source").unwrap();
            std::fs::write(fixture.home().join(name), "private data").unwrap();
            assert!(
                link_entry(&fixture.source().join(name), &fixture.home().join(name))
                    .unwrap_err()
                    .contains("preserved")
            );
            assert!(remove_link(&fixture.home().join(name)).is_err());
            assert_eq!(
                std::fs::read_to_string(fixture.home().join(name)).unwrap(),
                "private data"
            );
        }
        std::fs::write(fixture.home().join("sessions/keep"), "rollout").unwrap();
        std::fs::write(fixture.home().join(".monocode-migrations/keep"), "marker").unwrap();
        std::fs::create_dir_all(fixture.source().join("skills")).unwrap();
        std::fs::create_dir_all(fixture.home().join("skills")).unwrap();
        std::fs::write(fixture.home().join("skills/keep"), "private skill").unwrap();
        assert!(link_entry(
            &fixture.source().join("skills"),
            &fixture.home().join("skills")
        )
        .is_err());
        assert!(prepare_files(&fixture.source(), &fixture.home()).is_err());
        for name in ["sessions/keep", ".monocode-migrations/keep", "skills/keep"] {
            assert!(fixture.home().join(name).is_file());
        }
    }

    #[cfg(windows)]
    #[test]
    fn link_safety_accepts_hardlink_identity_and_relinks_only_links() {
        let fixture = Fixture::new();
        std::fs::create_dir_all(fixture.source()).unwrap();
        std::fs::create_dir_all(fixture.home()).unwrap();
        let old = fixture.source().join("old.json");
        let new = fixture.source().join("new.json");
        let target = fixture.home().join("auth.json");
        std::fs::write(&old, "old login").unwrap();
        std::fs::write(&new, "new login").unwrap();
        std::fs::hard_link(&old, &target).unwrap();
        assert!(same_entry(&old, &target));
        let before = file_info(&target).unwrap();
        link_entry(&old, &target).unwrap();
        assert_eq!(
            before.nFileIndexLow,
            file_info(&target).unwrap().nFileIndexLow
        );
        link_entry(&new, &target).unwrap();
        assert!(same_entry(&new, &target));
        assert_eq!(std::fs::read_to_string(&old).unwrap(), "old login");
        assert_eq!(std::fs::read_to_string(&new).unwrap(), "new login");
    }

    #[cfg(windows)]
    #[test]
    fn link_safety_relinks_backup_hardlinks_between_homes() {
        let fixture = Fixture::new();
        opt_in_hooks(&fixture);
        let other = fixture.0.join("other-account");
        for (source, content) in [(&other, "old hooks"), (&fixture.source(), "new hooks")] {
            std::fs::create_dir_all(source).unwrap();
            for name in ["hooks.json", "hooks.json.bak"] {
                std::fs::write(source.join(name), content).unwrap();
            }
        }
        prepare_files(&other, &fixture.home()).unwrap();
        prepare_files(&fixture.source(), &fixture.home()).unwrap();
        for name in ["hooks.json", "hooks.json.bak"] {
            assert!(same_entry(
                &fixture.source().join(name),
                &fixture.home().join(name)
            ));
            assert_eq!(
                std::fs::read_to_string(other.join(name)).unwrap(),
                "old hooks"
            );
            assert_eq!(
                std::fs::read_to_string(fixture.source().join(name)).unwrap(),
                "new hooks"
            );
        }
        assert!(same_entry(
            &fixture.source().join("secrets"),
            &fixture.home().join("secrets")
        ));
        println!(
            "retained backup source-switch fixture: {}",
            fixture.0.display()
        );
    }

    #[test]
    fn link_safety_optional_real_conflicts_are_preserved_and_do_not_block() {
        let fixture = Fixture::new();
        opt_in_hooks(&fixture);
        std::fs::create_dir_all(fixture.source()).unwrap();
        std::fs::create_dir_all(fixture.home()).unwrap();
        for name in ["hooks.json.bak", "models_cache.json", "cache"] {
            std::fs::write(fixture.source().join(name), "source data").unwrap();
            std::fs::write(fixture.home().join(name), "private data").unwrap();
        }
        std::fs::write(fixture.source().join("hooks.json"), "hooks").unwrap();
        prepare_files(&fixture.source(), &fixture.home()).unwrap();
        assert!(same_entry(
            &fixture.source().join("hooks.json"),
            &fixture.home().join("hooks.json")
        ));
        for name in ["hooks.json.bak", "models_cache.json", "cache"] {
            assert_eq!(
                std::fs::read_to_string(fixture.home().join(name)).unwrap(),
                "private data"
            );
            assert_eq!(
                std::fs::read_to_string(fixture.source().join(name)).unwrap(),
                "source data"
            );
        }
        for name in [
            "auth.json",
            ".credentials.json",
            "secrets",
            "config.toml",
            "config.json",
            "AGENTS.md",
            "skills",
            "hooks.json",
        ] {
            assert!(required_entry(name), "{name}");
            assert!(!required_entry(&format!("{name}.bak")), "{name}.bak");
        }
    }

    #[cfg(windows)]
    #[test]
    fn link_safety_busy_backup_is_skipped_but_busy_hooks_blocks() {
        use std::os::windows::fs::OpenOptionsExt;
        use windows_sys::Win32::Storage::FileSystem::{FILE_SHARE_READ, FILE_SHARE_WRITE};
        for name in ["hooks.json.bak", "hooks.json"] {
            let fixture = Fixture::new();
            opt_in_hooks(&fixture);
            let other = fixture.0.join("other-account");
            std::fs::create_dir_all(&other).unwrap();
            std::fs::create_dir_all(fixture.source()).unwrap();
            std::fs::write(other.join(name), "old hooks").unwrap();
            std::fs::write(fixture.source().join(name), "new hooks").unwrap();
            prepare_files(&other, &fixture.home()).unwrap();
            // Hold the shared file itself: file symlinks can safely be relinked while their referent is busy.
            remove_link(&fixture.home().join(name)).unwrap();
            std::fs::hard_link(other.join(name), fixture.home().join(name)).unwrap();
            let _busy = std::fs::OpenOptions::new()
                .read(true)
                .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE)
                .open(fixture.home().join(name))
                .unwrap();
            let result = prepare_files(&fixture.source(), &fixture.home());
            if name.ends_with(".bak") {
                result.unwrap();
                assert!(same_entry(
                    &fixture.source().join("secrets"),
                    &fixture.home().join("secrets")
                ));
                assert!(fixture.home().join("sessions").is_dir());
            } else {
                assert!(result.unwrap_err().contains("hooks.json"));
            }
            let empty = fixture.0.join("empty-account");
            std::fs::create_dir_all(&empty).unwrap();
            let cleanup = prepare_files(&empty, &fixture.home());
            if name.ends_with(".bak") {
                cleanup.unwrap();
            } else {
                assert!(cleanup.unwrap_err().contains("hooks.json"));
            }
            assert!(same_entry(&other.join(name), &fixture.home().join(name)));
            assert_eq!(
                std::fs::read_to_string(other.join(name)).unwrap(),
                "old hooks"
            );
            assert_eq!(
                std::fs::read_to_string(fixture.source().join(name)).unwrap(),
                "new hooks"
            );
            assert!(std::fs::read_dir(fixture.home())
                .unwrap()
                .all(|entry| !entry
                    .unwrap()
                    .file_name()
                    .to_string_lossy()
                    .starts_with(".monocode-link-")));
        }
    }

    #[test]
    fn storage_issues_are_logged_once_per_distinct_message() {
        let issue = format!("test issue {}", uuid::Uuid::new_v4());
        log_storage_issue(issue.clone());
        log_storage_issue(issue.clone());
        let other = format!("{issue} another entry");
        log_storage_issue(other.clone());
        let issues = STORAGE_ISSUES.lock().unwrap();
        assert_eq!(issues.iter().filter(|value| **value == issue).count(), 1);
        assert!(issues.contains(&other));
    }

    #[test]
    fn link_safety_missing_source_secrets_names_and_preserves_real_conflict() {
        let fixture = Fixture::new();
        let target = fixture.home().join("secrets");
        std::fs::create_dir_all(fixture.source()).unwrap();
        std::fs::create_dir_all(&target).unwrap();
        std::fs::write(target.join("keep"), "private secret").unwrap();
        let error = prepare_files(&fixture.source(), &fixture.home()).unwrap_err();
        assert!(error.contains(&target.display().to_string()), "{error}");
        assert!(error.contains("preserved"), "{error}");
        assert_eq!(
            std::fs::read_to_string(target.join("keep")).unwrap(),
            "private secret"
        );
    }

    #[test]
    fn link_safety_resolves_a_linked_source_and_a_link_chain() {
        let fixture = Fixture::new();
        std::fs::create_dir_all(fixture.source()).unwrap();
        std::fs::create_dir_all(fixture.home()).unwrap();
        let actual = fixture.0.join("actual-AGENTS.md");
        let source = fixture.source().join("AGENTS.md");
        let target = fixture.home().join("AGENTS.md");
        std::fs::write(&actual, "instructions").unwrap();
        std::fs::write(fixture.source().join("auth.json"), "{}").unwrap();
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(&actual, &source).unwrap();
            std::os::unix::fs::symlink(&actual, &target).unwrap();
        }
        #[cfg(windows)]
        {
            std::os::windows::fs::symlink_file(&actual, &source).unwrap();
            std::os::windows::fs::symlink_file(&source, &target).unwrap();
        }
        prepare_files(&fixture.source(), &fixture.home()).unwrap();
        prepare_files(&fixture.source(), &fixture.home()).unwrap();
        assert!(same_entry(&source, &target));
        assert_eq!(std::fs::read_to_string(&actual).unwrap(), "instructions");
        println!("retained linked-source fixture: {}", fixture.0.display());
    }

    #[test]
    fn link_safety_removes_only_stale_links_missing_from_the_new_source() {
        let fixture = Fixture::new();
        let other = fixture.0.join("other-account");
        std::fs::create_dir_all(&other).unwrap();
        std::fs::create_dir_all(fixture.source()).unwrap();
        std::fs::write(other.join("auth.json"), "old login").unwrap();
        std::fs::create_dir_all(other.join("skills")).unwrap();
        std::fs::write(other.join("skills/keep"), "old skill").unwrap();
        prepare_files(&other, &fixture.home()).unwrap();
        prepare_files(&fixture.source(), &fixture.home()).unwrap();
        assert_eq!(
            std::fs::read_to_string(other.join("auth.json")).unwrap(),
            "old login"
        );
        assert_eq!(
            std::fs::read_to_string(other.join("skills/keep")).unwrap(),
            "old skill"
        );
        assert!(!fixture.home().join("auth.json").exists());
        assert!(fixture.home().join("skills").is_dir());
        assert!(!replaceable_link(&fixture.home().join("skills")).unwrap());
    }

    #[test]
    fn link_safety_preserves_a_real_login_absent_from_the_selected_home() {
        let fixture = Fixture::new();
        std::fs::create_dir_all(fixture.source()).unwrap();
        std::fs::create_dir_all(fixture.home()).unwrap();
        std::fs::write(fixture.home().join("auth.json"), "private login").unwrap();
        assert!(prepare_files(&fixture.source(), &fixture.home())
            .unwrap_err()
            .contains("preserved"));
        assert_eq!(
            std::fs::read_to_string(fixture.home().join("auth.json")).unwrap(),
            "private login"
        );
    }

    #[test]
    fn link_safety_preparation_preserves_private_configuration_and_state() {
        let fixture = Fixture::new();
        std::fs::create_dir_all(fixture.source()).unwrap();
        std::fs::create_dir_all(fixture.home().join("sessions")).unwrap();
        std::fs::create_dir_all(fixture.home().join(".monocode-migrations")).unwrap();
        for name in ["config.toml", "config.toml.bak"] {
            std::fs::write(fixture.source().join(name), "source configuration").unwrap();
            std::fs::write(fixture.home().join(name), "private configuration").unwrap();
        }
        for name in ["sessions/keep", ".monocode-migrations/keep"] {
            std::fs::write(fixture.home().join(name), "private state").unwrap();
        }
        prepare_files(&fixture.source(), &fixture.home()).unwrap();
        prepare_files(&fixture.source(), &fixture.home()).unwrap();
        for name in ["config.toml", "config.toml.bak"] {
            assert_eq!(
                std::fs::read_to_string(fixture.home().join(name)).unwrap(),
                "private configuration"
            );
            assert_eq!(
                std::fs::read_to_string(fixture.source().join(name)).unwrap(),
                "source configuration"
            );
        }
        for name in ["sessions/keep", ".monocode-migrations/keep"] {
            assert_eq!(
                std::fs::read_to_string(fixture.home().join(name)).unwrap(),
                "private state"
            );
        }
    }

    #[test]
    fn link_safety_source_switch_relinks_link_chains_and_keeps_both_homes() {
        let fixture = Fixture::new();
        let first = fixture.source();
        let second = fixture.0.join("clean-account");
        for (source, content) in [(&first, "inherited source"), (&second, "clean source")] {
            std::fs::create_dir_all(source).unwrap();
            let actual = source.join("instructions.md");
            std::fs::write(&actual, content).unwrap();
            std::fs::write(source.join("auth.json"), "{}").unwrap();
            std::fs::write(source.join("config.toml"), "").unwrap();
            #[cfg(unix)]
            std::os::unix::fs::symlink(&actual, source.join("AGENTS.md")).unwrap();
            #[cfg(windows)]
            std::os::windows::fs::symlink_file(&actual, source.join("AGENTS.md")).unwrap();
        }
        prepare_files(&first, &fixture.home()).unwrap();
        prepare_files(&second, &fixture.home()).unwrap();
        assert!(same_entry(
            &second.join("AGENTS.md"),
            &fixture.home().join("AGENTS.md")
        ));
        assert!(same_entry(
            &second.join("auth.json"),
            &fixture.home().join("auth.json")
        ));
        assert_eq!(
            std::fs::read_to_string(first.join("instructions.md")).unwrap(),
            "inherited source"
        );
        assert_eq!(
            std::fs::read_to_string(second.join("instructions.md")).unwrap(),
            "clean source"
        );
        println!("retained source-switch fixture: {}", fixture.0.display());
    }

    #[cfg(windows)]
    #[test]
    fn link_safety_failed_atomic_replacement_keeps_the_old_link_and_both_sources() {
        use std::os::windows::fs::OpenOptionsExt;
        use windows_sys::Win32::Storage::FileSystem::{FILE_SHARE_READ, FILE_SHARE_WRITE};
        let fixture = Fixture::new();
        std::fs::create_dir_all(fixture.source()).unwrap();
        std::fs::create_dir_all(fixture.home()).unwrap();
        let old = fixture.source().join("old.json");
        let new = fixture.source().join("new.json");
        let target = fixture.home().join("auth.json");
        std::fs::write(&old, "old").unwrap();
        std::fs::write(&new, "new").unwrap();
        std::fs::hard_link(&old, &target).unwrap();
        let _busy = std::fs::OpenOptions::new()
            .read(true)
            .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE)
            .open(&target)
            .unwrap();
        assert!(link_entry(&new, &target).is_err());
        assert!(same_entry(&old, &target));
        assert_eq!(std::fs::read_to_string(&old).unwrap(), "old");
        assert_eq!(std::fs::read_to_string(&new).unwrap(), "new");
        assert_eq!(std::fs::read_dir(fixture.home()).unwrap().count(), 1);
    }

    #[cfg(windows)]
    #[test]
    fn relinks_an_unrelated_configuration_junction_without_touching_targets() {
        let fixture = Fixture::new();
        let source = fixture.source();
        let other = fixture.0.join("other-account");
        let target = fixture.home().join("skills");
        std::fs::create_dir_all(&source).unwrap();
        std::fs::create_dir_all(&other).unwrap();
        std::fs::create_dir_all(fixture.home()).unwrap();
        std::fs::write(other.join("keep.txt"), "old account data").unwrap();
        std::fs::write(source.join("keep.txt"), "new account data").unwrap();
        junction::create(&other, &target).unwrap();
        link_entry(&source.canonicalize().unwrap(), &target).unwrap();
        assert_eq!(
            target.canonicalize().unwrap(),
            source.canonicalize().unwrap()
        );
        assert_eq!(
            std::fs::read_to_string(other.join("keep.txt")).unwrap(),
            "old account data"
        );
        assert_eq!(
            std::fs::read_to_string(source.join("keep.txt")).unwrap(),
            "new account data"
        );
        remove_link(&target).unwrap();
        assert!(source.join("keep.txt").exists());
    }

    #[cfg(windows)]
    #[test]
    fn link_safety_relinks_nested_source_junctions_at_every_name_alignment() {
        let fixture = Fixture::new();
        let old = fixture.0.join("old-account/skills");
        let actual = fixture.0.join("shared-skills");
        std::fs::create_dir_all(&old).unwrap();
        std::fs::create_dir_all(&actual).unwrap();
        std::fs::create_dir_all(fixture.source()).unwrap();
        std::fs::write(old.join("keep"), "old skill").unwrap();
        std::fs::write(actual.join("keep"), "new skill").unwrap();
        std::fs::write(old.join("hooks.json.bak"), "old backup").unwrap();
        std::fs::write(actual.join("hooks.json.bak"), "new backup").unwrap();
        junction::create(&actual, fixture.source().join("skills")).unwrap();
        let source = fixture.source().canonicalize().unwrap().join("skills");
        for padding in 0..4 {
            let home = fixture.0.join(format!("home{}", "x".repeat(padding)));
            std::fs::create_dir_all(&home).unwrap();
            let target = home.join("skills");
            junction::create(&old, &target).unwrap();
            link_entry(&source, &target).unwrap();
            assert!(same_entry(&source, &target));
            assert_eq!(
                std::fs::read_to_string(target.join("keep")).unwrap(),
                "new skill"
            );
            assert_eq!(
                std::fs::read_to_string(old.join("keep")).unwrap(),
                "old skill"
            );
            assert_eq!(
                std::fs::read_to_string(actual.join("keep")).unwrap(),
                "new skill"
            );
            let backup = home.join("hooks.json.bak");
            std::fs::hard_link(old.join("hooks.json.bak"), &backup).unwrap();
            link_entry(&source.join("hooks.json.bak"), &backup).unwrap();
            assert!(same_entry(&source.join("hooks.json.bak"), &backup));
            assert_eq!(
                std::fs::read_to_string(old.join("hooks.json.bak")).unwrap(),
                "old backup"
            );
            assert_eq!(
                std::fs::read_to_string(actual.join("hooks.json.bak")).unwrap(),
                "new backup"
            );
            assert!(std::fs::read_dir(&home)
                .unwrap()
                .all(|entry| ["skills", "hooks.json.bak"].iter().any(|name| entry
                    .as_ref()
                    .unwrap()
                    .file_name()
                    == *name)));
        }
    }

    #[test]
    fn retains_native_bytes_descendants_compressed_tails_and_inherited_history() {
        let fixture = Fixture::new();
        let base = fixture.rollout("base-id", None);
        let root = fixture.rollout("root-id", Some("base-id"));
        let child = fixture.rollout("child-id", Some("root-id"));
        let child_bytes = std::fs::read(&child).unwrap();
        let compressed = child.with_extension("jsonl.zst");
        std::fs::write(
            &compressed,
            zstd::stream::encode_all(child_bytes.as_slice(), 0).unwrap(),
        )
        .unwrap();
        std::fs::write(
            &child,
            "{\"type\":\"event_msg\",\"payload\":{\"after_compression\":true}}\n",
        )
        .unwrap();
        prepare_files(&fixture.source(), &fixture.home()).unwrap();
        copy_rollouts(
            &fixture.source(),
            &fixture.home(),
            "root-id",
            &[root.clone(), compressed.clone()],
        )
        .unwrap();
        for path in [&root, &base, &child, &compressed] {
            let target = fixture
                .home()
                .join("sessions/2026/10/08")
                .join(path.file_name().unwrap());
            assert_eq!(std::fs::read(path).unwrap(), std::fs::read(target).unwrap());
        }
        assert!(contains_thread(&fixture.home().join("sessions"), "root-id").unwrap());
        assert!(!fixture.home().join(".monocode-migrations/root-id").exists());
        // A retry is safe and leaves source files intact.
        copy_rollouts(
            &fixture.source(),
            &fixture.home(),
            "root-id",
            &[root, child],
        )
        .unwrap();
    }

    #[test]
    fn rejects_unrelated_files_and_missing_inherited_context() {
        let fixture = Fixture::new();
        let root = fixture.rollout("root-id", Some("missing-id"));
        prepare_files(&fixture.source(), &fixture.home()).unwrap();
        assert!(copy_rollouts(&fixture.source(), &fixture.home(), "root-id", &[root]).is_err());
        assert!(!contains_thread(&fixture.home().join("sessions"), "root-id").unwrap());
        let outside = fixture.0.join("rollout-2026-10-08T10-00-00-root-id.jsonl");
        std::fs::write(&outside, "{}\n").unwrap();
        assert!(copy_rollouts(&fixture.source(), &fixture.home(), "root-id", &[outside]).is_err());
        assert!(validate_thread_id("../other").is_err());
    }

    #[test]
    fn refreshed_keyring_credentials_only_recover_the_same_account() {
        let auth = |account: &str, at: &str| {
            Some(
                serde_json::json!({"tokens":{"account_id":account}, "last_refresh":at}).to_string(),
            )
        };
        assert!(newer_same_account(
            &auth("one", "2026-10-08T12:00:00Z"),
            &auth("one", "2026-10-08T11:00:00Z")
        ));
        assert!(!newer_same_account(
            &auth("one", "2026-10-08T11:00:00Z"),
            &auth("one", "2026-10-08T12:00:00Z")
        ));
        assert!(!newer_same_account(
            &auth("two", "2026-10-08T12:00:00Z"),
            &auth("one", "2026-10-08T11:00:00Z")
        ));
        assert!(!newer_same_account(
            &auth("one", "2026-10-08T12:00:00Z"),
            &None
        ));
    }

    #[test]
    fn migration_keeps_closed_agents_closed_and_leaves_other_threads_out() {
        let fixture = Fixture::new();
        let root = fixture.rollout("root", None);
        let child = fixture.rollout("closed-child", Some("root"));
        let db = rusqlite::Connection::open(fixture.source().join("state_5.sqlite")).unwrap();
        db.execute_batch("CREATE TABLE thread_spawn_edges(parent_thread_id TEXT NOT NULL, child_thread_id TEXT PRIMARY KEY, status TEXT NOT NULL); INSERT INTO thread_spawn_edges VALUES ('root','open-child','open'), ('root','closed-child','closed'), ('other','unrelated','closed');").unwrap();
        let edges = closed_agent_edges(&fixture.source(), "root").unwrap();
        assert_eq!(edges.len(), 1);
        assert_eq!(edges[0].child, "closed-child");
        prepare_files(&fixture.source(), &fixture.home()).unwrap();
        copy_rollouts_with_edges(
            &fixture.source(),
            &fixture.home(),
            "root",
            &[root, child],
            &edges,
        )
        .unwrap();
        // app-server creates this schema during initialization. It can backfill
        // an open edge before or after the saved closure is restored.
        let private = rusqlite::Connection::open(fixture.home().join("state_5.sqlite")).unwrap();
        private.execute_batch("CREATE TABLE thread_spawn_edges(parent_thread_id TEXT NOT NULL, child_thread_id TEXT PRIMARY KEY, status TEXT NOT NULL); INSERT INTO thread_spawn_edges VALUES ('root','closed-child','open');").unwrap();
        restore_agent_edges(&fixture.home(), "root").unwrap();
        let status: String = private
            .query_row(
                "SELECT status FROM thread_spawn_edges WHERE child_thread_id='closed-child'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(status, "closed");
        let count: i64 = private
            .query_row("SELECT count(*) FROM thread_spawn_edges", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(count, 1);
        assert!(!edge_snapshot_path(&fixture.home(), "root").exists());
        // Later changes in the private graph must not be overwritten on resume.
        private
            .execute("UPDATE thread_spawn_edges SET status='open'", [])
            .unwrap();
        restore_agent_edges(&fixture.home(), "root").unwrap();
        let status: String = private
            .query_row("SELECT status FROM thread_spawn_edges", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(status, "open");
    }
}
