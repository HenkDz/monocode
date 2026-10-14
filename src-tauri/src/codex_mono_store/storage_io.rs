use super::*;
use std::time::{Duration, Instant};

pub(super) fn context(operation: &str, path: &Path, error: String) -> String {
    // Conflict/source/metadata envelopes carry authority; do not wrap or reinterpret them.
    if error.starts_with('{') {
        return error;
    }
    let code = error
        .rsplit_once("(os error ")
        .and_then(|(_, tail)| tail.split_once(')'))
        .and_then(|(code, _)| code.parse::<i32>().ok());
    if code.is_none() && error.contains(&path.display().to_string()) {
        return format!("{operation}: {error}");
    }
    let sharing = cfg!(windows) && code == Some(32);
    let name = path.file_name().unwrap_or_default().to_string_lossy();
    let holder = if name.contains(".sqlite") || name.ends_with("-wal") || name.ends_with("-shm") {
        "SQLite connection (Codex app-server or another context)"
    } else if name.contains("codex-global-state") || transient(&name) {
        "Codex desktop state writer or another file reader"
    } else {
        "another Codex process or file reader (exact holder unknown)"
    };
    let path = crate::fs::path_to_js(path);
    serde_json::json!({
        "recovery": true,
        "reason": if sharing {
            format!("Could not {operation}: {path}. {holder} is keeping this file open. Let its write finish or close the program using this file; MonoCode will check again automatically. {error}")
        } else { format!("Could not {operation}: {path}. {error}") },
        "paths": [path],
        "io": {"operation": operation, "path": path, "holder": if sharing { Some(holder) } else { None },
            "osError": code, "retryable": sharing}
    }).to_string()
}

pub(super) fn run<T>(
    operation: &str,
    path: &Path,
    mut action: impl FnMut() -> std::io::Result<T>,
) -> Result<T, String> {
    let started = Instant::now();
    let budget = Duration::from_secs(2);
    let mut delay = Duration::from_millis(25);
    loop {
        match action() {
            Ok(value) => return Ok(value),
            Err(error) => {
                if !cfg!(windows) || error.raw_os_error() != Some(32) || started.elapsed() >= budget
                {
                    return Err(context(operation, path, error.to_string()));
                }
                std::thread::sleep(delay.min(budget.saturating_sub(started.elapsed())));
                delay = (delay * 2).min(Duration::from_millis(400));
            }
        }
    }
}

pub(super) fn sharing(error: &str) -> bool {
    serde_json::from_str::<serde_json::Value>(error).is_ok_and(|value| {
        value["recovery"] == true
            && value["io"]["osError"] == 32
            && value["io"]["retryable"] == true
    })
}

pub(super) fn transient(name: &str) -> bool {
    let name = name.to_ascii_lowercase();
    if ["-wal", "-shm", "-journal"]
        .iter()
        .any(|suffix| name.ends_with(suffix))
    {
        return true;
    }
    if name.contains(".bak.tmp-") {
        return true;
    }
    name.rsplit_once(".tmp-").is_some_and(|(_, suffix)| {
        suffix.split_once('-').is_some_and(|(ts, id)| {
            !ts.is_empty()
                && ts.bytes().all(|b| b.is_ascii_digit())
                && uuid::Uuid::parse_str(id).is_ok()
        })
    })
}

pub(super) fn defer(home: &Path, name: &str, error: &str) -> Result<(), String> {
    let root = private_directory(home, ".monocode-deferred")?;
    let path = root.join(format!("{name}.json"));
    // Pending records are diagnostics; preparation re-scans the actual entries on every run.
    if path.exists() && replaceable_link(&path)? {
        return Err(context(
            "record deferred reconciliation",
            &path,
            "Pending metadata must remain private".into(),
        ));
    }
    if let Err(record_error) =
        write_private_json(&path, &serde_json::json!({"entry": name, "error": error}))
    {
        log_storage_issue(format!("Deferred record could not be published; the next prepare still re-scans this entry: {record_error}"));
    }
    log_storage_issue(format!("Mono Codex reconciliation deferred: {error}"));
    Ok(())
}

pub(super) fn clear_deferred(home: &Path, name: &str) -> Result<(), String> {
    let root = home.join(".monocode-deferred");
    if !root.exists() {
        return Ok(());
    }
    let root = private_directory(home, ".monocode-deferred")?;
    let path = root.join(format!("{name}.json"));
    if path.exists() {
        if let Err(error) = retire_record(home, &path) {
            if !sharing(&error) {
                return Err(error);
            }
            log_storage_issue(format!(
                "Resolved deferred record retirement postponed: {error}"
            ));
        }
    }
    Ok(())
}

fn retire_record(home: &Path, path: &Path) -> Result<(), String> {
    // Preserve the record's opaque bytes by an atomic, non-replacing move; never remove its linked file.
    let root = private_directory(home, ".monocode-retired-links")?;
    let target = root.join(format!(
        "{}-{}",
        uuid::Uuid::new_v4(),
        path.file_name().unwrap().to_string_lossy()
    ));
    #[cfg(windows)]
    {
        let file = open_entry(path, true)?;
        rename_handle(&file, &target, false)
    }
    #[cfg(unix)]
    {
        rename_no_replace(path, &target)
    }
}

pub(super) fn retire_transients(home: &Path) -> Result<(), String> {
    let root = home.join(".monocode-links");
    if !root.exists() {
        return Ok(());
    }
    let root = private_directory(home, ".monocode-links")?;
    for entry in
        std::fs::read_dir(&root).map_err(|e| context("list link records", &root, e.to_string()))?
    {
        let entry = entry.map_err(|e| context("read link record", &root, e.to_string()))?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.strip_suffix(".json").is_some_and(transient) {
            if let Err(error) = retire_record(home, &entry.path()) {
                if !sharing(&error) {
                    return Err(error);
                }
                log_storage_issue(format!(
                    "Mono Codex transient record retirement deferred: {error}"
                ));
            }
        }
    }
    Ok(())
}

#[cfg(windows)]
pub(super) fn handle_path(file: &std::fs::File) -> PathBuf {
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::Storage::FileSystem::GetFinalPathNameByHandleW;
    let mut path = vec![0u16; 32768];
    let len = unsafe {
        GetFinalPathNameByHandleW(
            file.as_raw_handle() as _,
            path.as_mut_ptr(),
            path.len() as u32,
            0,
        )
    };
    if len == 0 || len as usize >= path.len() {
        return PathBuf::from("<unresolved storage handle>");
    }
    PathBuf::from(String::from_utf16_lossy(&path[..len as usize]))
}
