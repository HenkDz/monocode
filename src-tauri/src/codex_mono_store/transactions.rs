use super::*;

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "snake_case")]
pub(super) enum ClaimIntent {
    Keep,
    UseAccount,
    IsolateHooks,
    IsolateSkills,
    CloneHooks,
    CloneRollout,
    CloneMemory,
    RetainRollouts { preserved: String },
    RetainMemory { preserved: String },
    Relink,
    CorruptSnapshot { preserved: String },
}

#[derive(Serialize, Deserialize, Clone)]
pub(super) struct RecordedEntry {
    name: String,
    identity: (u64, u64),
    fingerprint: Option<String>,
}

impl RecordedEntry {
    pub(super) fn new(path: &Path) -> Result<Self, String> {
        Ok(Self {
            name: filename(path)?,
            identity: entry_identity(path)?,
            fingerprint: fingerprint(path).ok(),
        })
    }

    pub(super) fn cleanup(&self, path: &Path) -> Result<(), String> {
        if exists(path)? {
            remove_staged(path, self)?;
        }
        Ok(())
    }

    pub(super) fn publish(&self, path: &Path, target: &Path) -> Result<(), String> {
        #[cfg(windows)]
        let file = open_entry(path, true)?;
        if !matches_record(path, self)? {
            return Err(recovery(
                "A staged recovery entry changed; it was preserved.",
                &[path.into()],
            ));
        }
        #[cfg(windows)]
        return rename_handle(&file, target, false);
        #[cfg(unix)]
        rename_no_replace(path, target)
    }
}

#[derive(Serialize, Deserialize)]
struct Transaction {
    entry: String,
    intent: ClaimIntent,
    claim: RecordedEntry,
    staged: Option<RecordedEntry>,
    verified: bool,
    archive: Option<PathBuf>,
}

pub(super) struct ClaimJournal {
    path: PathBuf,
    transaction: Transaction,
}

pub(super) fn create_json(path: &Path, value: &impl Serialize) -> Result<(), String> {
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|e| e.to_string())?;
    file.write_all(&serde_json::to_vec(value).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    file.sync_all().map_err(|e| e.to_string())
}

fn filename(path: &Path) -> Result<String, String> {
    path.file_name()
        .and_then(|name| name.to_str())
        .map(String::from)
        .ok_or_else(|| "Invalid Codex transaction filename".into())
}

impl ClaimJournal {
    pub(super) fn clone_hooks(target: &Path, staged: &RecordedEntry) -> Result<Self, String> {
        Self::clone_file(target, staged, ClaimIntent::CloneHooks)
    }

    pub(super) fn clone_rollout(target: &Path, staged: &RecordedEntry) -> Result<Self, String> {
        Self::clone_file(target, staged, ClaimIntent::CloneRollout)
    }

    pub(super) fn clone_memory(target: &Path, staged: &RecordedEntry) -> Result<Self, String> {
        Self::clone_file(target, staged, ClaimIntent::CloneMemory)
    }

    #[cfg(windows)]
    pub(super) fn keep_clone_on_close(&self, file: &std::fs::File) -> Result<(), String> {
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::Storage::FileSystem::{
            FileDispositionInfoEx, SetFileInformationByHandle, FILE_DISPOSITION_INFO_EX,
        };
        if file_identity(file)?
            != self
                .transaction
                .staged
                .as_ref()
                .ok_or("Missing file clone")?
                .identity
        {
            return Err("Private file clone identity changed; it was preserved".into());
        }
        let info = FILE_DISPOSITION_INFO_EX { Flags: 8 }; // ON_CLOSE clears deletion at close.
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

    fn clone_file(
        target: &Path,
        staged: &RecordedEntry,
        intent: ClaimIntent,
    ) -> Result<Self, String> {
        let id = uuid::Uuid::new_v4();
        let mut writing = staged.clone();
        writing.fingerprint = None;
        let journal = Self {
            path: target.with_file_name(format!(".monocode-txn-{id}.json")),
            transaction: Transaction {
                entry: filename(target)?,
                intent,
                claim: RecordedEntry {
                    name: format!(".monocode-claim-{id}"),
                    ..staged.clone()
                },
                staged: Some(writing),
                verified: false,
                archive: None,
            },
        };
        create_json(&journal.path, &journal.transaction)?;
        Ok(journal)
    }

    pub(super) fn verify_clone(&mut self, path: &Path) -> Result<(), String> {
        let staged = self
            .transaction
            .staged
            .as_mut()
            .ok_or("Missing hook clone")?;
        if !matches_record(path, staged)
            .map_err(|error| format!("Could not verify clone identity: {error}"))?
        {
            return Err("Private hook clone changed during preparation; it was preserved".into());
        }
        staged.fingerprint = Some(
            fingerprint(path)
                .map_err(|error| format!("Could not verify clone contents: {error}"))?,
        );
        self.verify(None)
            .map_err(|error| format!("Could not journal completed clone: {error}"))
    }

    pub(super) fn publish_clone(&self, path: &Path, target: &Path) -> Result<(), String> {
        if !self.transaction.verified || filename(target)? != self.transaction.entry {
            return Err("Unverified private file clone cannot be published".into());
        }
        self.transaction
            .staged
            .as_ref()
            .ok_or("Missing file clone")?
            .publish(path, target)
    }

    pub(super) fn new(
        target: &Path,
        claim: &Path,
        intent: ClaimIntent,
        staged: Option<&RecordedEntry>,
        identity: (u64, u64),
    ) -> Result<Self, String> {
        let claim_name = filename(claim)?;
        let path = claim.with_file_name(format!(
            ".monocode-txn-{}.json",
            claim_name
                .strip_prefix(".monocode-claim-")
                .ok_or("Invalid claim")?
        ));
        let journal = Self {
            path,
            transaction: Transaction {
                entry: filename(target)?,
                intent,
                claim: RecordedEntry {
                    name: claim_name,
                    identity,
                    fingerprint: fingerprint(target).ok(),
                },
                staged: staged.cloned(),
                verified: false,
                archive: None,
            },
        };
        create_json(&journal.path, &journal.transaction)?;
        Ok(journal)
    }

    pub(super) fn verify(&mut self, archive: Option<&Path>) -> Result<(), String> {
        self.transaction.verified = true;
        self.transaction.archive = archive.map(PathBuf::from);
        write_private_json(&self.path, &self.transaction)
    }

    pub(super) fn finish(&self) -> Result<(), String> {
        let parent = self.path.parent().ok_or("Missing journal parent")?;
        if let Some(stage) = &self.transaction.staged {
            let path = parent.join(&stage.name);
            if exists(&path)? {
                if !matches_record(&path, stage)? {
                    return Err(recovery(
                        "A staged recovery entry changed; it was preserved.",
                        &[path, self.path.clone()],
                    ));
                }
                remove_staged(&path, stage)?;
            }
        }
        match std::fs::remove_file(&self.path) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(error.to_string()),
        }
    }
}

fn exists(path: &Path) -> Result<bool, String> {
    match std::fs::symlink_metadata(path) {
        Ok(_) => Ok(true),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(error.to_string()),
    }
}

fn matches_record(path: &Path, entry: &RecordedEntry) -> Result<bool, String> {
    Ok(entry_identity(path)? == entry.identity
        && entry
            .fingerprint
            .as_ref()
            .is_none_or(|expected| fingerprint(path).is_ok_and(|actual| actual == *expected)))
}

fn remove_staged(path: &Path, expected: &RecordedEntry) -> Result<(), String> {
    #[cfg(windows)]
    let file = open_entry(path, true)?;
    if !matches_record(path, expected)? {
        return Err(recovery(
            "A staged recovery entry changed; it was preserved.",
            &[path.into()],
        ));
    }
    #[cfg(windows)]
    return discard_handle(&file);
    // shortcut: Unix cannot exclude concurrent path replacements; add native writer exclusion before promising concurrent Unix cleanup.
    #[cfg(unix)]
    if replaceable_link(path)? {
        remove_link(path)
    } else if std::fs::symlink_metadata(path)
        .map_err(|e| e.to_string())?
        .is_dir()
    {
        std::fs::remove_dir(path).map_err(|e| e.to_string())
    } else {
        std::fs::remove_file(path).map_err(|e| e.to_string())
    }
}

fn recovery(reason: &str, paths: &[PathBuf]) -> String {
    serde_json::json!({
        "recovery": true,
        "reason": reason,
        "paths": paths.iter().map(|p| crate::fs::path_to_js(p)).collect::<Vec<_>>()
    })
    .to_string()
}

fn read_journal(path: &Path) -> Result<ClaimJournal, String> {
    #[cfg(windows)]
    let file = open_entry(path, false)?;
    #[cfg(unix)]
    let file = {
        use std::os::unix::fs::OpenOptionsExt;
        std::fs::OpenOptions::new()
            .read(true)
            .custom_flags(libc::O_NOFOLLOW)
            .open(path)
            .map_err(|e| e.to_string())?
    };
    let metadata = file.metadata().map_err(|e| e.to_string())?;
    if !metadata.is_file()
        || std::fs::symlink_metadata(path)
            .map_err(|e| e.to_string())?
            .file_type()
            .is_symlink()
    {
        return Err("Transaction metadata must be a real private file".into());
    }
    #[cfg(windows)]
    if handle_file_info(&file)?.nNumberOfLinks != 1 {
        return Err("Transaction metadata must be a real private file".into());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if metadata.nlink() != 1 {
            return Err("Transaction metadata must be a real private file".into());
        }
    }
    let transaction: Transaction =
        serde_json::from_reader(file.take(64 * 1024)).map_err(|e| e.to_string())?;
    if matches!(transaction.intent, ClaimIntent::CloneMemory) {
        if transaction.entry.is_empty()
            || matches!(transaction.entry.as_str(), "." | "..")
            || transaction
                .entry
                .contains(['/', '\\', ':', '\0', '<', '>', '"', '|', '?', '*'])
            || transaction.entry.ends_with(['.', ' '])
            || transaction.entry.starts_with(".monocode-")
        {
            return Err("Invalid native memory filename".into());
        }
    } else if matches!(transaction.intent, ClaimIntent::RetainMemory { .. }) {
        if transaction.entry != "memories" {
            return Err("Memory retention cannot target another entry".into());
        }
    } else if matches!(transaction.intent, ClaimIntent::RetainRollouts { .. }) {
        if !matches!(transaction.entry.as_str(), "sessions" | "archived_sessions") {
            return Err("Rollout retention cannot target another entry".into());
        }
    } else {
        validate_entry(&transaction.entry)?;
    }
    let id = filename(path)?;
    let id = id
        .strip_prefix(".monocode-txn-")
        .and_then(|s| s.strip_suffix(".json"))
        .ok_or("Invalid transaction name")?;
    uuid::Uuid::parse_str(id).map_err(|e| e.to_string())?;
    if transaction.claim.name != format!(".monocode-claim-{id}") {
        return Err("Transaction claim name does not match its journal".into());
    }
    if let Some(stage) = &transaction.staged {
        let id = stage
            .name
            .strip_prefix(".monocode-link-")
            .ok_or("Invalid staged entry")?;
        uuid::Uuid::parse_str(id).map_err(|e| e.to_string())?;
    }
    if let ClaimIntent::CorruptSnapshot { preserved } = &transaction.intent {
        if path
            .parent()
            .and_then(Path::file_name)
            .is_none_or(|name| name != ".monocode-links")
        {
            return Err("Corrupt snapshot transactions must remain in link metadata".into());
        }
        let prefix = format!("{}.corrupt-", transaction.entry);
        let id = preserved
            .strip_prefix(&prefix)
            .ok_or("Invalid corrupt snapshot path")?;
        uuid::Uuid::parse_str(id).map_err(|e| e.to_string())?;
    } else {
        if path
            .parent()
            .and_then(Path::file_name)
            .is_some_and(|name| name == ".monocode-links")
        {
            return Err("Shared entry transactions cannot target link metadata".into());
        }
        if matches!(
            transaction.intent,
            ClaimIntent::IsolateHooks | ClaimIntent::CloneHooks
        ) && transaction.entry != "hooks.json"
        {
            return Err("Hook isolation cannot target another entry".into());
        }
        if matches!(transaction.intent, ClaimIntent::CloneRollout)
            && (!transaction.entry.starts_with("rollout-")
                || !(transaction.entry.ends_with(".jsonl")
                    || transaction.entry.ends_with(".jsonl.zst")))
        {
            return Err("Rollout cloning cannot target another entry".into());
        }
        if matches!(
            transaction.intent,
            ClaimIntent::CloneHooks | ClaimIntent::CloneRollout | ClaimIntent::CloneMemory
        ) && (transaction.staged.is_none() || transaction.archive.is_some())
        {
            return Err("Invalid private hook clone transaction".into());
        }
        if matches!(transaction.intent, ClaimIntent::IsolateSkills) && transaction.entry != "skills"
        {
            return Err("Skill isolation cannot target another entry".into());
        }
        if let ClaimIntent::RetainRollouts { preserved } | ClaimIntent::RetainMemory { preserved } =
            &transaction.intent
        {
            let prefix = format!(".monocode-retained-{}-", transaction.entry);
            let id = preserved
                .strip_prefix(&prefix)
                .ok_or("Invalid retained rollout path")?;
            uuid::Uuid::parse_str(id).map_err(|e| e.to_string())?;
        }
    }
    Ok(ClaimJournal {
        path: path.into(),
        transaction,
    })
}

fn archive_valid(home: &Path, transaction: &Transaction) -> Result<bool, String> {
    let Some(archive) = &transaction.archive else {
        return Ok(false);
    };
    let relative = archive.strip_prefix(home).map_err(|e| e.to_string())?;
    let components: Vec<_> = relative.components().collect();
    if components.len() != 3
        || components[0].as_os_str() != ".monocode-conflicts"
        || components[2].as_os_str() != transaction.entry.as_str()
        || !components
            .iter()
            .all(|p| matches!(p, std::path::Component::Normal(_)))
    {
        return Err("Invalid recovery archive path".into());
    }
    for path in [
        home.join(".monocode-conflicts"),
        archive.parent().unwrap().into(),
    ] {
        let metadata = std::fs::symlink_metadata(path).map_err(|e| e.to_string())?;
        if !metadata.is_dir() || metadata.file_type().is_symlink() {
            return Err("Recovery archives must remain in real private directories".into());
        }
    }
    let metadata = std::fs::symlink_metadata(archive).map_err(|e| e.to_string())?;
    Ok(metadata.is_file()
        && !metadata.file_type().is_symlink()
        && !replaceable_link(archive)?
        && transaction
            .claim
            .fingerprint
            .as_ref()
            .is_some_and(|expected| fingerprint(archive).is_ok_and(|actual| actual == *expected)))
}

fn invalid_snapshot(home: &Path, transaction: &Transaction) -> Result<(), String> {
    if matches!(
        transaction.intent,
        ClaimIntent::Keep | ClaimIntent::UseAccount
    ) {
        write_snapshot(
            home,
            &transaction.entry,
            &LinkSnapshot {
                invalid: true,
                ..LinkSnapshot::default()
            },
        )?;
    }
    Ok(())
}

fn reconcile_journal(home: &Path, journal: ClaimJournal) -> Result<(), String> {
    let parent = journal
        .path
        .parent()
        .ok_or("Missing transaction parent")?
        .to_path_buf();
    let original = parent.join(&journal.transaction.entry);
    let claim = parent.join(&journal.transaction.claim.name);
    let occupied = exists(&original)?;
    let claimed = exists(&claim)?;
    let paths = [original.clone(), claim.clone(), journal.path.clone()];
    if matches!(
        journal.transaction.intent,
        ClaimIntent::CloneHooks | ClaimIntent::CloneRollout | ClaimIntent::CloneMemory
    ) {
        let staged = journal
            .transaction
            .staged
            .as_ref()
            .ok_or("Missing hook clone")?;
        if claimed
            || (occupied && (!journal.transaction.verified || !matches_record(&original, staged)?))
        {
            return Err(recovery(
                "An interrupted hook clone has an unfamiliar entry; all recovery entries were preserved.",
                &paths,
            ));
        }
        return journal.finish();
    }
    if claimed && !matches_record(&claim, &journal.transaction.claim)? {
        return Err(recovery(
            "An interrupted claim changed; all recovery entries were preserved.",
            &paths,
        ));
    }
    if !occupied && claimed {
        // Restored bytes must require a fresh choice even when an old snapshot could authorize healing.
        invalid_snapshot(home, &journal.transaction)?;
        journal.transaction.claim.publish(&claim, &original)?;
        return journal.finish();
    }
    if occupied && !claimed && matches_record(&original, &journal.transaction.claim)? {
        if journal.transaction.verified && matches!(journal.transaction.intent, ClaimIntent::Keep) {
            write_snapshot(
                home,
                &journal.transaction.entry,
                &LinkSnapshot {
                    fingerprint: fingerprint(&original)?,
                    private_override: true,
                    invalid: false,
                },
            )?;
        } else {
            invalid_snapshot(home, &journal.transaction)?;
        }
        return journal.finish();
    }
    let published = journal
        .transaction
        .staged
        .as_ref()
        .is_some_and(|stage| occupied && matches_record(&original, stage).unwrap_or(false));
    if published && journal.transaction.verified {
        if let ClaimIntent::RetainRollouts { preserved } | ClaimIntent::RetainMemory { preserved } =
            &journal.transaction.intent
        {
            let retained = parent.join(preserved);
            let path = if claimed { &claim } else { &retained };
            if !exists(path)?
                || !matches_record(path, &journal.transaction.claim)?
                || !std::fs::symlink_metadata(path)
                    .map_err(|e| e.to_string())?
                    .is_dir()
                || replaceable_link(path)?
                || !replaceable_link(&original)?
            {
                return Err(recovery(
                    "Interrupted rollout retention contains an unexpected entry; it was preserved.",
                    &paths,
                ));
            }
            if claimed {
                journal.transaction.claim.publish(&claim, &retained)?;
            }
            return journal.finish();
        }
        if matches!(journal.transaction.intent, ClaimIntent::IsolateSkills)
            && (!std::fs::symlink_metadata(&original)
                .map_err(|e| e.to_string())?
                .is_dir()
                || replaceable_link(&original)?
                || (claimed && !claim.is_dir()))
        {
            return Err(recovery(
                "Interrupted skill isolation contains an unexpected entry; it was preserved.",
                &paths,
            ));
        }
        if let ClaimIntent::CorruptSnapshot { preserved } = &journal.transaction.intent {
            let preserved = parent.join(preserved);
            if claimed {
                journal.transaction.claim.publish(&claim, &preserved)?;
            } else if !exists(&preserved)?
                || !matches_record(&preserved, &journal.transaction.claim)?
            {
                return Err(recovery(
                    "Corrupt metadata could not be verified; recovery entries were preserved.",
                    &paths,
                ));
            }
            return journal.finish();
        }
        if (matches!(journal.transaction.intent, ClaimIntent::Relink)
            && !replaceable_link(&original)?)
            || (matches!(
                journal.transaction.intent,
                ClaimIntent::Relink | ClaimIntent::IsolateSkills
            ) && claimed
                && !replaceable_link(&claim)?)
        {
            return Err(recovery(
                "An interrupted relink contains a real private entry; it was preserved.",
                &paths,
            ));
        }
        if matches!(
            journal.transaction.intent,
            ClaimIntent::Relink | ClaimIntent::IsolateSkills
        ) || archive_valid(home, &journal.transaction)?
        {
            if claimed {
                let mut entry = ClaimedEntry {
                    original: original.clone(),
                    path: claim,
                    active: true,
                    #[cfg(windows)]
                    file: open_entry(&parent.join(&journal.transaction.claim.name), true)?,
                    journal,
                };
                // Recheck under the held Windows handle before deleting a completed claim.
                if !matches_record(&entry.path, &entry.journal.transaction.claim)?
                    || (matches!(
                        entry.journal.transaction.intent,
                        ClaimIntent::Relink | ClaimIntent::IsolateSkills
                    ) && !replaceable_link(&entry.path)?)
                {
                    return Err(recovery(
                        "A recovery claim changed; it was preserved.",
                        &paths,
                    ));
                }
                entry.discard()?;
                return entry.finish(Ok(()));
            }
            return journal.finish();
        }
    }
    Err(recovery("An interrupted storage transaction has another entry at its original path. Both versions were preserved; inspect the recovery files before retrying.", &paths))
}

pub(super) fn reconcile(home: &Path) -> Result<(), String> {
    let mut directories = vec![home.to_path_buf()];
    if exists(&home.join(".monocode-links"))? {
        directories.push(private_directory(home, ".monocode-links")?);
    }
    for directory in directories {
        let entries = std::fs::read_dir(&directory)
            .map_err(|e| e.to_string())?
            .map(|entry| entry.map(|entry| entry.path()).map_err(|e| e.to_string()))
            .collect::<Result<Vec<_>, _>>()?;
        for path in entries.iter().filter(|path| {
            path.file_name()
                .is_some_and(|n| n.to_string_lossy().starts_with(".monocode-txn-"))
        }) {
            let journal = read_journal(path).map_err(|error| {
                recovery(
                    &format!("An unreadable storage transaction was preserved: {error}"),
                    &[path.clone()],
                )
            })?;
            reconcile_journal(home, journal).map_err(|error| {
                if error.starts_with('{') {
                    error
                } else {
                    recovery(
                        &format!("Storage recovery preserved unfinished entries: {error}"),
                        &[path.clone()],
                    )
                }
            })?;
        }
        for path in entries.iter().filter(|path| {
            path.file_name()
                .is_some_and(|n| n.to_string_lossy().starts_with(".monocode-claim-"))
        }) {
            if exists(path)? {
                return Err(recovery("An unlabelled legacy claim was preserved. Its original filename is unknown; inspect it before retrying.", &[path.clone()]));
            }
        }
    }
    Ok(())
}
