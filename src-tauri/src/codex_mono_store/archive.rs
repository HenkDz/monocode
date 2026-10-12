use super::*;

const ROOTS: [&str; 2] = ["sessions", "archived_sessions"];

pub(super) fn prepare_base_state(base: &Path) -> Result<(), String> {
    source_binding::guard_bound_contexts(base)?;
    for name in ROOTS {
        private_directory(base, name)?;
    }
    private_directory(base, "memories")?;
    let contexts = base.join(".monocode-skill-contexts");
    if !contexts.exists() {
        return Ok(());
    }
    let contexts = private_directory(base, ".monocode-skill-contexts")?;
    for entry in std::fs::read_dir(&contexts).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name();
        let id = name.to_str().ok_or("Invalid Mono context filename")?;
        if id.len() == 64
            && id
                .bytes()
                .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
            && entry.file_type().map_err(|e| e.to_string())?.is_dir()
        {
            skills::with_context_home(base, id, |home| {
                prepare_context_state(base, home)?;
                prepare_memory_state(base, home)
            })?;
        }
    }
    Ok(())
}

pub(super) fn prepare_context_state(base: &Path, home: &Path) -> Result<(), String> {
    transactions::reconcile(home)?;
    for name in ROOTS {
        let shared = private_directory(base, name)?;
        let target = home.join(name);
        if same_entry(&shared, &target) {
            continue;
        }
        match std::fs::symlink_metadata(&target) {
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => link_entry(&shared, &target)?,
            Err(e) => return Err(e.to_string()),
            Ok(meta) if meta.is_dir() && !replaceable_link(&target)? => {
                retain_and_share(base, home, name, &shared, &target)?;
            }
            Ok(_) => {
                return Err(format!(
                    "Unexpected Mono rollout root; preserved: {}",
                    target.display()
                ))
            }
        }
    }
    Ok(())
}

pub(super) fn prepare_memory_state(base: &Path, home: &Path) -> Result<(), String> {
    transactions::reconcile(home)?;
    let shared = private_directory(base, "memories")?;
    let target = home.join("memories");
    if same_entry(&shared, &target) {
        return Ok(());
    }
    match std::fs::symlink_metadata(&target) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => link_entry(&shared, &target),
        Err(e) => Err(e.to_string()),
        Ok(meta) if meta.is_dir() && !replaceable_link(&target)? => {
            retain_and_share(base, home, "memories", &shared, &target)
        }
        Ok(_) => Err(format!(
            "Unexpected Mono memory root; preserved: {}",
            target.display()
        )),
    }
}

fn retain_and_share(
    base: &Path,
    home: &Path,
    name: &str,
    shared: &Path,
    target: &Path,
) -> Result<(), String> {
    let temp = home.join(format!(".monocode-link-{}", uuid::Uuid::new_v4()));
    create_link(shared, &temp)?;
    let staged = transactions::RecordedEntry::new(&temp)?;
    let preserved = format!(".monocode-retained-{name}-{}", uuid::Uuid::new_v4());
    let result = (|| {
        let intent = if name == "memories" {
            ClaimIntent::RetainMemory {
                preserved: preserved.clone(),
            }
        } else {
            ClaimIntent::RetainRollouts {
                preserved: preserved.clone(),
            }
        };
        let mut claimed = ClaimedEntry::new(target, intent, Some(&staged))?;
        let result = (|| {
            let mut files = Vec::new();
            let mut directory_guards = Vec::new();
            collect_files(
                &claimed.path,
                &mut files,
                &mut directory_guards,
                name == "memories",
            )?;
            // Hold every original against native append writers until the common root is published.
            #[cfg(windows)]
            let _writers = files
                .iter()
                .map(|path| -> Result<_, String> {
                    let file = open_entry(path, true)?;
                    if replaceable_link(path)?
                        || !file.metadata().map_err(|e| e.to_string())?.is_file()
                    {
                        return Err(
                            "Native state changed while excluding writers; originals preserved"
                                .into(),
                        );
                    }
                    Ok(file)
                })
                .collect::<Result<Vec<_>, _>>()?;
            for file in &files {
                retain_file(
                    file,
                    shared,
                    file.strip_prefix(&claimed.path)
                        .map_err(|e| e.to_string())?,
                    name == "memories",
                    false,
                )
                .map_err(|e| retain_error(e, &format!("Could not retain {}", file.display())))?;
            }
            if name != "memories" {
                update_index(base, target, shared, &files, &claimed.path)
                    .map_err(|e| format!("Could not update native rollout index: {e}"))?;
            }
            claimed.journal.verify(None)?;
            #[cfg(test)]
            crash_tests::checkpoint(if name == "memories" {
                "memory-before-publish"
            } else {
                "rollouts-before-publish"
            });
            staged
                .publish(&temp, target)
                .map_err(|e| format!("Could not publish shared rollout root: {e}"))?;
            #[cfg(test)]
            crash_tests::checkpoint(if name == "memories" {
                "memory-after-publish"
            } else {
                "rollouts-after-publish"
            });
            #[cfg(windows)]
            drop(_writers);
            drop(directory_guards);
            claimed
                .move_to(&home.join(&preserved))
                .map_err(|e| format!("Could not retain original rollout directory: {e}"))?;
            claimed.active = false;
            #[cfg(test)]
            crash_tests::checkpoint("rollouts-after-retain");
            Ok(())
        })();
        claimed.finish(result)
    })();
    staged.cleanup(&temp)?;
    result
}

fn collect_files(
    directory: &Path,
    files: &mut Vec<PathBuf>,
    guards: &mut Vec<std::fs::File>,
    memory: bool,
) -> Result<(), String> {
    if replaceable_link(directory)?
        || !std::fs::symlink_metadata(directory)
            .map_err(|e| e.to_string())?
            .is_dir()
    {
        return Err("Native state directory changed; originals preserved".into());
    }
    for entry in std::fs::read_dir(directory).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let meta = entry.file_type().map_err(|e| e.to_string())?;
        if meta.is_symlink() || replaceable_link(&entry.path())? {
            return Err(format!(
                "Linked rollout state was preserved: {}",
                entry.path().display()
            ));
        }
        if meta.is_dir() {
            #[cfg(windows)]
            guards.push(lock_directory(&entry.path())?);
            collect_files(&entry.path(), files, guards, memory)?;
        } else if meta.is_file() && (memory || rollout_file(&entry.path())) {
            files.push(entry.path());
        } else {
            return Err(format!(
                "Unexpected rollout entry was preserved: {}",
                entry.path().display()
            ));
        }
    }
    Ok(())
}

fn rollout_file(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| {
            name.starts_with("rollout-")
                && (name.ends_with(".jsonl") || name.ends_with(".jsonl.zst"))
        })
}

fn retain_error(error: String, context: &str) -> String {
    if error.starts_with('{') {
        error
    } else {
        format!("{context}: {error}")
    }
}

pub(super) fn retain_file(
    source: &Path,
    shared: &Path,
    relative: &Path,
    memory: bool,
    migration: bool,
) -> Result<(), String> {
    let mut parent = shared.to_path_buf();
    #[cfg(windows)]
    let mut guards = vec![lock_directory(shared)?];
    for component in relative
        .parent()
        .ok_or("Missing rollout directory")?
        .components()
    {
        let std::path::Component::Normal(name) = component else {
            return Err("Invalid rollout directory".into());
        };
        parent = private_directory(&parent, name.to_str().ok_or("Invalid rollout directory")?)?;
        #[cfg(windows)]
        guards.push(lock_directory(&parent)?);
    }
    let destination = parent.join(relative.file_name().ok_or("Missing rollout filename")?);
    transactions::reconcile(&parent)?;
    #[cfg(windows)]
    let mut original = {
        use std::os::windows::fs::OpenOptionsExt;
        use windows_sys::Win32::Storage::FileSystem::{FILE_SHARE_DELETE, FILE_SHARE_READ};
        std::fs::OpenOptions::new()
            .read(true)
            .share_mode(FILE_SHARE_READ | FILE_SHARE_DELETE)
            .open(source)
            .map_err(|e| e.to_string())?
    };
    #[cfg(unix)]
    let mut original = std::fs::File::open(source).map_err(|e| e.to_string())?;
    let expected = fingerprint_file(&mut original).map_err(|e| format!("reading original: {e}"))?;
    match std::fs::symlink_metadata(&destination) {
        Ok(meta)
            if meta.is_file()
                && !replaceable_link(&destination)?
                && fingerprint(&destination)? == expected =>
        {
            return Ok(())
        }
        Ok(_) => {
            let name = destination
                .file_name()
                .and_then(|name| name.to_str())
                .ok_or("Invalid native state filename")?;
            let preserved = archive_file(
                shared.parent().ok_or("Missing private state owner")?,
                name,
                &mut original,
                &expected,
            )?;
            if migration {
                return migration_recovery::retain_private(
                    shared.parent().ok_or("Missing private state owner")?,
                    source,
                    &destination,
                    &preserved,
                );
            }
            return Err(transactions::recovery(
                "Conflicting native state copies were preserved. Keep the private thread and review the source copy before retrying migration.",
                &[destination, preserved, source.to_path_buf()],
            ));
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(e.to_string()),
    }
    let temp = parent.join(format!(".monocode-link-{}", uuid::Uuid::new_v4()));
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        use windows_sys::Win32::Storage::FileSystem::FILE_SHARE_READ;
        options.share_mode(FILE_SHARE_READ);
    }
    let mut copy = options
        .open(&temp)
        .map_err(|e| format!("creating copy: {e}"))?;
    let staged =
        transactions::RecordedEntry::new(&temp).map_err(|e| format!("recording copy: {e}"))?;
    let mut journal = if memory {
        ClaimJournal::clone_memory(&destination, &staged)
    } else {
        ClaimJournal::clone_rollout(&destination, &staged)
    }
    .map_err(|e| retain_error(e, "journaling copy"))?;
    let result = (|| {
        original.rewind().map_err(|e| e.to_string())?;
        std::io::copy(&mut original, &mut copy).map_err(|e| e.to_string())?;
        copy.sync_all().map_err(|e| e.to_string())?;
        if fingerprint_file(&mut original)? != expected || fingerprint(&temp)? != expected {
            return Err("Native rollout changed while retaining it; originals preserved".into());
        }
        journal
            .verify_clone(&temp)
            .map_err(|e| retain_error(e, "verifying copy"))?;
        drop(copy);
        #[cfg(test)]
        crash_tests::checkpoint("rollouts-copy-before-publish");
        #[cfg(test)]
        BEFORE_ROLLOUT_PUBLISH.with(|hook| {
            if let Some(writer) = hook.borrow_mut().take() {
                writer();
            }
        });
        journal
            .publish_clone(&temp, &destination)
            .map_err(|e| {
                if !e.starts_with('{') && std::fs::symlink_metadata(&destination).is_ok() {
                    transactions::recovery("A private thread appeared during migration. Both versions were preserved; review them before retrying.", &[destination.clone(), source.to_path_buf()])
                } else { retain_error(e, "publishing copy") }
            })
    })();
    journal
        .finish()
        .map_err(|e| retain_error(e, "finishing copy"))?;
    result
}

#[cfg(windows)]
pub(super) fn lock_directory(path: &Path) -> Result<std::fs::File, String> {
    use std::os::windows::fs::OpenOptionsExt;
    use windows_sys::Win32::Storage::FileSystem::{
        FILE_FLAG_BACKUP_SEMANTICS, FILE_FLAG_OPEN_REPARSE_POINT, FILE_SHARE_READ, FILE_SHARE_WRITE,
    };
    // Exclude directory replacement while allowing native file publication beneath it.
    std::fs::OpenOptions::new()
        .read(true)
        .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE)
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT)
        .open(path)
        .map_err(|e| e.to_string())
}

fn index_path(path: &str) -> String {
    let path = path.replace('\\', "/");
    let path = path.strip_prefix("//?/").unwrap_or(&path);
    if cfg!(windows) {
        path.to_ascii_lowercase()
    } else {
        path.into()
    }
}

fn update_index(
    base: &Path,
    old: &Path,
    shared: &Path,
    files: &[PathBuf],
    claimed: &Path,
) -> Result<(), String> {
    let Some(path) = state_db(base)? else {
        return Ok(());
    };
    let mut db =
        rusqlite::Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_WRITE)
            .map_err(|e| e.to_string())?;
    db.busy_timeout(std::time::Duration::from_secs(5))
        .map_err(|e| e.to_string())?;
    let tx = db.transaction().map_err(|e| e.to_string())?;
    let exists: bool = tx
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='threads')",
            [],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    if exists {
        let rows = {
            let mut statement = tx
                .prepare("SELECT id, rollout_path FROM threads")
                .map_err(|e| e.to_string())?;
            let rows = statement
                .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
                .map_err(|e| e.to_string())?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?
        };
        for file in files {
            let relative = file.strip_prefix(claimed).map_err(|e| e.to_string())?;
            let previous = index_path(&old.join(relative).to_string_lossy());
            let destination = shared
                .join(relative)
                .canonicalize()
                .map_err(|e| e.to_string())?;
            for (id, path) in &rows {
                if index_path(path) == previous {
                    tx.execute(
                        "UPDATE threads SET rollout_path=?1 WHERE id=?2 AND rollout_path=?3",
                        rusqlite::params![destination.to_string_lossy(), id, path],
                    )
                    .map_err(|e| e.to_string())?;
                }
            }
        }
    }
    tx.commit().map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests;
