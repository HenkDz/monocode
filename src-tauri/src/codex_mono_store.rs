//! Mono threads retain native Codex rollouts, but outside the Codex app's home.
//! Configuration and credentials remain shared with the selected provider account.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};

// Preparation and Repair share one lock, including harness startup.
static STORAGE_LOCK: Mutex<()> = Mutex::new(());

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
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageInfo {
    home: String,
    source_home: String,
    source_kind: &'static str,
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
    Ok(StorageInfo {
        home: crate::fs::path_to_js(&home),
        source_home: crate::fs::path_to_js(&source),
        source_kind,
    })
}

#[tauri::command(async)]
pub fn codex_mono_store_prepare(
    app: AppHandle,
    provider_account_id: Option<String>,
    thread_id: Option<String>,
) -> Result<PreparedStore, String> {
    let (source, home, source_kind) =
        locations(&app, provider_account_id.as_deref()).map_err(storage_error)?;
    prepare_files(&source, &home).map_err(storage_error)?;
    let has_thread = match thread_id {
        Some(id) => {
            validate_thread_id(&id)?;
            !home.join(".monocode-migrations").join(&id).exists()
                && contains_thread(&home.join("sessions"), &id)?
        }
        None => false,
    };
    Ok(PreparedStore {
        home: crate::fs::path_to_js(&home),
        has_thread,
        source_home: crate::fs::path_to_js(&source),
        source_kind,
    })
}

#[tauri::command(async)]
pub fn codex_mono_store_copy(
    app: AppHandle,
    provider_account_id: Option<String>,
    thread_id: String,
    paths: Vec<String>,
    sqlite_home: Option<String>,
) -> Result<(), String> {
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
    )
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

pub(crate) fn prepare(app: &AppHandle, account_id: Option<&str>) -> Result<MonoCodexStore, String> {
    let (source, home, _) = locations(app, account_id).map_err(storage_error)?;
    prepare_files(&source, &home).map_err(storage_error)?;
    let auth = prepare_keyring(&source, &home).map_err(storage_error)?;
    Ok(MonoCodexStore {
        home,
        auth: Mutex::new(auth),
    })
}

fn storage_error(error: String) -> String {
    eprintln!("Mono Codex storage: {error}");
    format!("Codex storage needs repair: {error}")
}

fn private_entry(name: &str) -> bool {
    STATE_NAMES.contains(&name)
        || name.contains(".sqlite")
        || name.ends_with(".db")
        || name.ends_with(".db-wal")
        || name.ends_with(".db-shm")
        || name.starts_with(".monocode-")
}

fn prepare_files(source: &Path, home: &Path) -> Result<(), String> {
    let _lock = STORAGE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
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
    for name in STATE_NAMES {
        if std::fs::symlink_metadata(home.join(name)).is_ok_and(|m| m.file_type().is_symlink()) {
            return Err("Mono Codex state must remain in its private storage directory".into());
        }
    }
    for entry in std::fs::read_dir(home).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name();
        if private_entry(&name.to_string_lossy()) {
            continue;
        }
        match std::fs::symlink_metadata(source.join(&name)) {
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                if replaceable_link(&entry.path())? {
                    remove_link(&entry.path())?;
                } else if name == "auth.json" || name == ".credentials.json" {
                    return Err(format!(
                        "Real login entry conflicts with the selected Codex home; preserved: {}",
                        entry.path().display()
                    ));
                }
            }
            Err(e) => return Err(e.to_string()),
            Ok(_) => {}
        }
    }
    for entry in std::fs::read_dir(&source).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name();
        if private_entry(&name.to_string_lossy()) {
            continue;
        }
        let target = home.join(&name);
        if (name == "config.toml" || name == "config.toml.bak")
            && std::fs::symlink_metadata(&target).is_ok_and(|m| m.is_file())
            && !replaceable_link(&target)?
        {
            eprintln!(
                "Mono Codex storage preserves private configuration overriding {}: {}",
                entry.path().display(),
                target.display()
            );
            continue;
        }
        link_entry(&entry.path(), &target)?;
    }
    // Keep the auth link valid even if login creates/replaces the original later.
    #[cfg(unix)]
    for name in ["auth.json", ".credentials.json"] {
        link_entry(&source.join(name), &home.join(name))?;
    }
    // Encrypted auth/MCP files are replaced atomically. Sharing their directory,
    // rather than individual files, preserves those writes in both homes.
    std::fs::create_dir_all(source.join("secrets")).map_err(|e| e.to_string())?;
    link_entry(&source.join("secrets"), &home.join("secrets"))?;
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
        let temp = target.with_file_name(format!(".monocode-link-{}", uuid::Uuid::new_v4()));
        create_link(source, &temp)?;
        // Publish only a complete link; failed replacement leaves the old link intact.
        if let Err(error) = replace_link(&temp, target) {
            remove_link(&temp)?;
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
    use std::os::windows::{fs::OpenOptionsExt, io::AsRawHandle};
    use windows_sys::Win32::Storage::FileSystem::{
        GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION, FILE_FLAG_BACKUP_SEMANTICS,
    };
    let file = std::fs::OpenOptions::new()
        .read(true)
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS)
        .open(path)
        .map_err(|e| e.to_string())?;
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
    use std::os::windows::{ffi::OsStrExt, fs::OpenOptionsExt, io::AsRawHandle};
    use windows_sys::Win32::Storage::FileSystem::{
        FileRenameInfoEx, SetFileInformationByHandle, DELETE, FILE_FLAG_BACKUP_SEMANTICS,
        FILE_FLAG_OPEN_REPARSE_POINT, FILE_RENAME_INFO, FILE_SHARE_DELETE, FILE_SHARE_READ,
        FILE_SHARE_WRITE,
    };
    // Open the junction itself, never the directory it points to.
    let file = std::fs::OpenOptions::new()
        .access_mode(DELETE)
        .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE)
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT)
        .open(temp)
        .map_err(|e| e.to_string())?;
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
    let bytes = std::mem::offset_of!(FILE_RENAME_INFO, FileName) + name.len() * 2;
    // usize storage supplies the alignment required by FILE_RENAME_INFO.
    let mut buffer = vec![0usize; bytes.div_ceil(std::mem::size_of::<usize>())];
    let info = buffer.as_mut_ptr().cast::<FILE_RENAME_INFO>();
    unsafe {
        (*info).Anonymous.Flags = 3; // REPLACE_IF_EXISTS | POSIX_SEMANTICS
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
            std::fs::hard_link(source, target)
                .map_err(|e| format!("Could not share Codex configuration: {e}"))?;
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
        assert!(!fixture.home().join("skills").exists());
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
