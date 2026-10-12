use super::*;

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "snake_case")]
pub(super) enum ClaimIntent {
    Keep,
    UseAccount,
    PrivateConfig,
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
#[serde(deny_unknown_fields)]
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

    #[cfg(windows)]
    pub(super) fn pin_attributes(&self, path: &Path) -> Result<std::fs::File, String> {
        use std::os::windows::fs::OpenOptionsExt;
        use windows_sys::Win32::{
            Foundation::GENERIC_READ,
            Storage::FileSystem::{
                DELETE, FILE_FLAG_OPEN_REPARSE_POINT, FILE_SHARE_READ, FILE_WRITE_ATTRIBUTES,
            },
        };
        let file = std::fs::OpenOptions::new()
            .access_mode(GENERIC_READ | DELETE | FILE_WRITE_ATTRIBUTES)
            .share_mode(FILE_SHARE_READ)
            .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT)
            .open(path)
            .map_err(|e| e.to_string())?;
        if !matches_record(path, self)? {
            return Err(recovery(
                "A staged recovery entry changed; it was preserved.",
                &[path.into()],
            ));
        }
        Ok(file)
    }
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(deny_unknown_fields)]
struct Transaction {
    entry: String,
    intent: ClaimIntent,
    claim: RecordedEntry,
    staged: Option<RecordedEntry>,
    verified: bool,
    archive: Option<PathBuf>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    authority: Option<RecordedEntry>,
}

pub(super) struct ClaimJournal {
    path: PathBuf,
    transaction: Transaction,
    record: RecordedEntry,
    verification: Option<RecordedEntry>,
    retired: std::cell::Cell<bool>,
}

pub(super) fn create_json(path: &Path, value: &impl Serialize) -> Result<(), String> {
    let bytes = serde_json::to_vec(value).map_err(|e| e.to_string())?;
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|e| e.to_string())?;
    file.write_all(&bytes).map_err(|e| e.to_string())?;
    file.sync_all().map_err(|e| e.to_string())
}

const JOURNAL_LIMIT: u64 = 64 * 1024;

fn verification_path(path: &Path) -> PathBuf {
    path.with_extension("verified.json")
}

fn pending_path(path: &Path) -> PathBuf {
    path.with_extension("json.pending")
}

fn publish_journal(path: &Path, transaction: &Transaction) -> Result<RecordedEntry, String> {
    // Serialize before allocation; only the complete, synced file becomes authoritative.
    let bytes = serde_json::to_vec(transaction).map_err(|e| e.to_string())?;
    if bytes.len() as u64 > JOURNAL_LIMIT {
        return Err("Storage transaction exceeds the recovery size limit".into());
    }
    let pending = pending_path(path);
    let mut options = std::fs::OpenOptions::new();
    options.read(true).write(true).create_new(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        use windows_sys::Win32::{
            Foundation::{GENERIC_READ, GENERIC_WRITE},
            Storage::FileSystem::{DELETE, FILE_SHARE_READ},
        };
        options
            .access_mode(GENERIC_READ | GENERIC_WRITE | DELETE)
            .share_mode(FILE_SHARE_READ);
    }
    let mut file = options.open(&pending).map_err(|e| e.to_string())?;
    #[cfg(test)]
    crash_tests::checkpoint("journal-after-create");
    file.write_all(&bytes).map_err(|e| e.to_string())?;
    #[cfg(test)]
    crash_tests::checkpoint("journal-after-write");
    file.sync_all().map_err(|e| e.to_string())?;
    let record = metadata_record(&pending, &file, &bytes)?;
    #[cfg(test)]
    crash_tests::checkpoint(if transaction.authority.is_some() {
        "verify-before-rename"
    } else {
        "journal-before-publish"
    });
    #[cfg(windows)]
    rename_handle(&file, path, false)?;
    #[cfg(unix)]
    record.publish(&pending, path)?;
    #[cfg(test)]
    crash_tests::checkpoint(if transaction.authority.is_some() {
        "verify-after-rename"
    } else {
        "journal-after-publish"
    });
    Ok(RecordedEntry {
        name: filename(path)?,
        ..record
    })
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
        stage_on_close(file, false)
    }

    fn clone_file(
        target: &Path,
        staged: &RecordedEntry,
        intent: ClaimIntent,
    ) -> Result<Self, String> {
        let id = uuid::Uuid::new_v4();
        let mut writing = staged.clone();
        writing.fingerprint = None;
        let path = target.with_file_name(format!(".monocode-txn-{id}.json"));
        let transaction = Transaction {
            entry: filename(target)?,
            intent,
            claim: RecordedEntry {
                name: format!(".monocode-claim-{id}"),
                ..staged.clone()
            },
            staged: Some(writing),
            verified: false,
            archive: None,
            authority: None,
        };
        let record = publish_journal(&path, &transaction)?;
        let journal = Self {
            path,
            transaction,
            record,
            verification: None,
            retired: std::cell::Cell::new(false),
        };
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
        let transaction = Transaction {
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
            authority: None,
        };
        #[cfg(windows)]
        let stage_file = if let Some(stage) = staged {
            let stage_path = target.with_file_name(&stage.name);
            let file = open_entry(&stage_path, true)?;
            if !matches_record(&stage_path, stage)? {
                publish_journal(&path, &transaction)?;
                return Err(recovery(
                    "An unpublished stage changed; it was preserved.",
                    &[stage_path],
                ));
            }
            stage_delete_pending(&file, true)?;
            Some(file)
        } else {
            None
        };
        let record = publish_journal(&path, &transaction)?;
        #[cfg(windows)]
        if let Some(file) = stage_file {
            stage_delete_pending(&file, false)?;
        }
        let journal = Self {
            path,
            transaction,
            record,
            verification: None,
            retired: std::cell::Cell::new(false),
        };
        Ok(journal)
    }

    pub(super) fn verify(&mut self, archive: Option<&Path>) -> Result<(), String> {
        let _authority = pin_metadata(&self.path, &self.record)?;
        let mut transaction = self.transaction.clone();
        transaction.verified = true;
        transaction.archive = archive.map(PathBuf::from);
        transaction.authority = Some(self.record.clone());
        // Keep the original authority immutable until its recorded verification is published.
        let record = publish_journal(&verification_path(&self.path), &transaction)?;
        self.transaction = transaction;
        self.verification = Some(record);
        Ok(())
    }

    pub(super) fn finish(&self) -> Result<(), String> {
        if self.retired.get() {
            return Ok(());
        }
        #[cfg(test)]
        crash_tests::checkpoint("before-journal-remove");
        let authority = if exists(&self.path)? {
            Some(pin_metadata(&self.path, &self.record)?)
        } else {
            None
        };
        let verified_path = verification_path(&self.path);
        let verification = if exists(&verified_path)? {
            Some(pin_metadata(
                &verified_path,
                self.verification.as_ref().ok_or_else(|| {
                    recovery(
                        "An unfamiliar verification journal was preserved.",
                        &[verified_path.clone()],
                    )
                })?,
            )?)
        } else {
            None
        };
        if self.verification.is_some() && verification.is_none() {
            return Err(recovery(
                "A verification journal disappeared; its recovery entries were preserved.",
                &[verified_path],
            ));
        }
        if authority.is_none() && verification.is_none() {
            return Err(recovery(
                "A storage journal disappeared; its recovery entries were preserved.",
                &[self.path.clone()],
            ));
        }
        for pending in [pending_path(&self.path), pending_path(&verified_path)] {
            if exists(&pending)? {
                return Err(incomplete_recovery(&pending)?);
            }
        }
        let parent = self.path.parent().ok_or("Missing journal parent")?;
        if matches!(self.transaction.intent, ClaimIntent::PrivateConfig) {
            let original = parent.join(&self.transaction.entry);
            if self.transaction.staged.as_ref().is_some_and(|stage| {
                exists(&original).unwrap_or(false)
                    && matches_record(&original, stage).unwrap_or(false)
            }) {
                let snapshot = read_snapshot(parent, &self.transaction.entry)?;
                if !snapshot.is_some_and(|snapshot| {
                    snapshot.private_override
                        && !snapshot.invalid
                        && fingerprint(&original).is_ok_and(|actual| actual == snapshot.fingerprint)
                }) {
                    return Err(recovery(
                        "Published private config is awaiting its recovery snapshot.",
                        &[original, self.path.clone()],
                    ));
                }
            }
        }
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
        if let Some(file) = authority {
            retire_metadata(&self.path, &file)?;
        }
        #[cfg(test)]
        crash_tests::checkpoint("after-journal-remove");
        if let Some(file) = verification {
            retire_metadata(&verified_path, &file)?;
        }
        self.retired.set(true);
        Ok(())
    }
}

fn exists(path: &Path) -> Result<bool, String> {
    match std::fs::symlink_metadata(path) {
        Ok(_) => Ok(true),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(error.to_string()),
    }
}

#[cfg(windows)]
fn stage_on_close(file: &std::fs::File, delete: bool) -> Result<(), String> {
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::Storage::FileSystem::{
        FileDispositionInfoEx, SetFileInformationByHandle, FILE_ATTRIBUTE_READONLY,
        FILE_DISPOSITION_FLAG_DELETE, FILE_DISPOSITION_FLAG_IGNORE_READONLY_ATTRIBUTE,
        FILE_DISPOSITION_FLAG_ON_CLOSE, FILE_DISPOSITION_INFO_EX,
    };
    let info = FILE_DISPOSITION_INFO_EX {
        Flags: FILE_DISPOSITION_FLAG_ON_CLOSE
            | if delete {
                FILE_DISPOSITION_FLAG_DELETE
                    | if handle_file_info(file)?.dwFileAttributes & FILE_ATTRIBUTE_READONLY != 0 {
                        FILE_DISPOSITION_FLAG_IGNORE_READONLY_ATTRIBUTE
                    } else {
                        0
                    }
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

#[cfg(windows)]
fn stage_delete_pending(file: &std::fs::File, delete: bool) -> Result<(), String> {
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::Storage::FileSystem::{
        FileDispositionInfoEx, SetFileInformationByHandle, FILE_ATTRIBUTE_READONLY,
        FILE_DISPOSITION_FLAG_DELETE, FILE_DISPOSITION_FLAG_IGNORE_READONLY_ATTRIBUTE,
        FILE_DISPOSITION_INFO_EX,
    };
    let info = FILE_DISPOSITION_INFO_EX {
        Flags: if delete {
            FILE_DISPOSITION_FLAG_DELETE
                | if handle_file_info(file)?.dwFileAttributes & FILE_ATTRIBUTE_READONLY != 0 {
                    FILE_DISPOSITION_FLAG_IGNORE_READONLY_ATTRIBUTE
                } else {
                    0
                }
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

fn open_metadata(path: &Path) -> Result<std::fs::File, String> {
    #[cfg(windows)]
    let file = open_entry(path, true)?;
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
    if handle_file_info(&file)?.nNumberOfLinks != 1
        || handle_file_info(&file)?.dwFileAttributes
            & windows_sys::Win32::Storage::FileSystem::FILE_ATTRIBUTE_REPARSE_POINT
            != 0
    {
        return Err("Transaction metadata must be a real private file".into());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if metadata.nlink() != 1 {
            return Err("Transaction metadata must be a real private file".into());
        }
    }
    Ok(file)
}

fn metadata_bytes(file: &mut std::fs::File) -> Result<Vec<u8>, String> {
    if file.metadata().map_err(|e| e.to_string())?.len() > JOURNAL_LIMIT {
        return Err("Storage transaction exceeds the recovery size limit".into());
    }
    file.rewind().map_err(|e| e.to_string())?;
    let mut bytes = Vec::new();
    file.take(JOURNAL_LIMIT + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() as u64 > JOURNAL_LIMIT {
        return Err("Storage transaction exceeds the recovery size limit".into());
    }
    Ok(bytes)
}

fn metadata_record(
    path: &Path,
    file: &std::fs::File,
    bytes: &[u8],
) -> Result<RecordedEntry, String> {
    Ok(RecordedEntry {
        name: filename(path)?,
        identity: file_identity(file)?,
        fingerprint: Some(format!("{:x}", Sha256::digest(bytes))),
    })
}

fn pin_metadata(path: &Path, record: &RecordedEntry) -> Result<std::fs::File, String> {
    let mut file = open_metadata(path).map_err(|error| {
        recovery(
            &format!("A storage journal could not be verified; it was preserved: {error}"),
            &[path.into()],
        )
    })?;
    let bytes = metadata_bytes(&mut file).map_err(|error| {
        recovery(
            &format!("A storage journal could not be verified; it was preserved: {error}"),
            &[path.into()],
        )
    })?;
    if file_identity(&file)? != record.identity
        || record.fingerprint.as_ref() != Some(&format!("{:x}", Sha256::digest(&bytes)))
    {
        return Err(recovery(
            "A storage journal changed; its authority and recovery entries were preserved.",
            &[path.into()],
        ));
    }
    Ok(file)
}

fn retire_metadata(_path: &Path, file: &std::fs::File) -> Result<(), String> {
    #[cfg(windows)]
    return discard_handle(file);
    // shortcut: Unix cannot exclude path replacements; require native exclusion before promising concurrent Unix retirement.
    #[cfg(unix)]
    {
        if entry_identity(_path)? != file_identity(file)? {
            return Err(recovery(
                "A storage journal changed; it was preserved.",
                &[_path.into()],
            ));
        }
        std::fs::remove_file(_path).map_err(|e| e.to_string())
    }
}

fn read_journal(path: &Path) -> Result<ClaimJournal, String> {
    let verified = filename(path)?.ends_with(".verified.json");
    if !verified && exists(&verification_path(path))? {
        return read_journal(&verification_path(path));
    }
    let mut file = open_metadata(path)?;
    let bytes = metadata_bytes(&mut file)?;
    let record = metadata_record(path, &file, &bytes)?;
    let transaction: Transaction = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
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
        .and_then(|s| s.strip_suffix(if verified { ".verified.json" } else { ".json" }))
        .ok_or("Invalid transaction name")?;
    uuid::Uuid::parse_str(id).map_err(|e| e.to_string())?;
    if transaction.claim.name != format!(".monocode-claim-{id}") {
        return Err("Transaction claim name does not match its journal".into());
    }
    if matches!(transaction.intent, ClaimIntent::PrivateConfig)
        && (transaction.entry != "config.toml" || transaction.staged.is_none())
    {
        return Err("Private config repair cannot target another entry".into());
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
    if verified {
        let authority = transaction
            .authority
            .as_ref()
            .ok_or("Verification is missing its journal authority")?;
        let primary = path.with_file_name(format!(".monocode-txn-{id}.json"));
        if !transaction.verified
            || authority.name != filename(&primary)?
            || authority.fingerprint.is_none()
        {
            return Err("Invalid verification journal authority".into());
        }
        if exists(&primary)? {
            let _file = pin_metadata(&primary, authority)?;
        }
        Ok(ClaimJournal {
            path: primary,
            record: authority.clone(),
            verification: Some(record),
            transaction,
            retired: std::cell::Cell::new(false),
        })
    } else {
        if transaction.authority.is_some() {
            return Err("Unexpected verification authority in an initial journal".into());
        }
        Ok(ClaimJournal {
            path: path.into(),
            transaction,
            record,
            verification: None,
            retired: std::cell::Cell::new(false),
        })
    }
}

#[derive(Serialize, Deserialize)]
pub(crate) struct RecoveryMetadata {
    path: PathBuf,
    identity: String,
    fingerprint: String,
}

fn incomplete_name(path: &Path) -> Result<bool, String> {
    let name = filename(path)?;
    let name = name
        .strip_prefix(".monocode-txn-")
        .ok_or("Invalid recovery metadata name")?;
    let (id, pending) = if let Some(id) = name.strip_suffix(".verified.json.pending") {
        (id, true)
    } else if let Some(id) = name.strip_suffix(".json.pending") {
        (id, true)
    } else {
        (
            name.strip_suffix(".json")
                .ok_or("Invalid recovery metadata name")?,
            false,
        )
    };
    uuid::Uuid::parse_str(id).map_err(|e| e.to_string())?;
    Ok(pending)
}

fn incomplete_recovery(path: &Path) -> Result<String, String> {
    let pending = incomplete_name(path)?;
    let mut file = open_metadata(path)?;
    let bytes = metadata_bytes(&mut file)?;
    if !pending && !bytes.is_empty() {
        return Err(
            "Only unpublished or empty metadata can be preserved through this recovery choice"
                .into(),
        );
    }
    let record = metadata_record(path, &file, &bytes)?;
    Ok(serde_json::json!({
        "recovery": true,
        "reason": "Incomplete transaction metadata was preserved. Archive this metadata before retrying; private files and any claims remain untouched.",
        "paths": [crate::fs::path_to_js(path)],
        "metadata": { "path": crate::fs::path_to_js(path), "identity": format!("{}:{}", record.identity.0, record.identity.1), "fingerprint": record.fingerprint }
    }).to_string())
}

pub(super) fn preserve_metadata(
    home: &Path,
    expected: &RecoveryMetadata,
) -> Result<PathBuf, String> {
    #[cfg(windows)]
    let native_path = PathBuf::from(expected.path.to_string_lossy().replace('/', "\\"));
    #[cfg(windows)]
    let path = &native_path;
    #[cfg(not(windows))]
    let path = &expected.path;
    let relative = path
        .strip_prefix(home)
        .map_err(|_| "Recovery metadata is outside the held account's private home")?;
    if !relative
        .components()
        .all(|component| matches!(component, std::path::Component::Normal(_)))
    {
        return Err("Invalid recovery metadata path".into());
    }
    let mut parent = home.to_path_buf();
    for component in relative
        .parent()
        .ok_or("Missing recovery parent")?
        .components()
    {
        parent.push(component);
        let metadata = std::fs::symlink_metadata(&parent).map_err(|e| e.to_string())?;
        if !metadata.is_dir() || replaceable_link(&parent)? {
            return Err("Recovery metadata must remain in real private directories".into());
        }
    }
    let pending = incomplete_name(path)?;
    let mut file = open_metadata(path)?;
    let bytes = metadata_bytes(&mut file)?;
    let identity = file_identity(&file)?;
    if (!pending && !bytes.is_empty())
        || expected.identity != format!("{}:{}", identity.0, identity.1)
        || expected.fingerprint != format!("{:x}", Sha256::digest(&bytes))
    {
        return Err(recovery(
            "Recovery metadata changed; refresh the issue before preserving it.",
            &[path.clone()],
        ));
    }
    let archive_directory = private_directory(&parent, ".monocode-preserved-transactions")?;
    if replaceable_link(&archive_directory)? {
        return Err(
            "Preserved transaction metadata must remain in a real private directory".into(),
        );
    }
    let archive = archive_directory.join(format!("{}-{}", filename(path)?, uuid::Uuid::new_v4()));
    #[cfg(windows)]
    rename_handle(&file, &archive, false)?;
    #[cfg(unix)]
    rename_no_replace(path, &archive)?;
    Ok(archive)
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
        ClaimIntent::Keep | ClaimIntent::UseAccount | ClaimIntent::PrivateConfig
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
    if !occupied
        && !claimed
        && matches!(journal.transaction.intent, ClaimIntent::PrivateConfig)
        && journal.transaction.verified
        && archive_valid(home, &journal.transaction)?
    {
        let staged = journal
            .transaction
            .staged
            .as_ref()
            .ok_or("Missing private config")?;
        let path = parent.join(&staged.name);
        if !exists(&path)? || replaceable_link(&path)? || !path.is_file() {
            return Err(recovery(
                "An interrupted private config repair changed; recovery entries were preserved.",
                &paths,
            ));
        }
        #[cfg(windows)]
        {
            use std::os::windows::fs::OpenOptionsExt;
            use windows_sys::Win32::{
                Foundation::GENERIC_READ,
                Storage::FileSystem::{
                    DELETE, FILE_ATTRIBUTE_REPARSE_POINT, FILE_FLAG_OPEN_REPARSE_POINT,
                    FILE_SHARE_READ, FILE_WRITE_ATTRIBUTES,
                },
            };
            let mut archive = open_entry(
                journal
                    .transaction
                    .archive
                    .as_ref()
                    .ok_or("Missing private config archive")?,
                true,
            )?;
            let archive_info = handle_file_info(&archive)?;
            if !archive
                .metadata()
                .map_err(|error| error.to_string())?
                .is_file()
                || archive_info.nNumberOfLinks != 1
                || archive_info.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT != 0
                || journal.transaction.claim.fingerprint.as_ref()
                    != Some(&fingerprint_file(&mut archive)?)
            {
                return Err(recovery(
                    "A private config recovery archive changed; it was preserved.",
                    &paths,
                ));
            }
            let file = std::fs::OpenOptions::new()
                .access_mode(GENERIC_READ | DELETE | FILE_WRITE_ATTRIBUTES)
                .share_mode(FILE_SHARE_READ)
                .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT)
                .open(&path)
                .map_err(|error| error.to_string())?;
            let info = handle_file_info(&file)?;
            if file_identity(&file)? != staged.identity
                || info.nNumberOfLinks != 1
                || info.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT != 0
                || !matches_record(&path, staged)?
            {
                return Err(recovery(
                    "An interrupted private config stage changed; it was preserved.",
                    &paths,
                ));
            }
            // A kill immediately after disposal can precede the stage's READONLY copy.
            file.set_permissions(
                archive
                    .metadata()
                    .map_err(|error| error.to_string())?
                    .permissions(),
            )
            .map_err(|error| error.to_string())?;
        }
        staged.publish(&path, &original)?;
        return reconcile_journal(home, journal);
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
            // Older private repairs used UseAccount; their real staged config also needs its override restored.
            if journal.transaction.entry == "config.toml"
                && matches!(
                    journal.transaction.intent,
                    ClaimIntent::PrivateConfig | ClaimIntent::UseAccount
                )
                && original.is_file()
                && !replaceable_link(&original)?
            {
                write_snapshot(
                    home,
                    "config.toml",
                    &LinkSnapshot {
                        fingerprint: fingerprint(&original)?,
                        private_override: true,
                        invalid: false,
                    },
                )?;
            }
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
        let mut entries = std::fs::read_dir(&directory)
            .map_err(|e| e.to_string())?
            .map(|entry| entry.map(|entry| entry.path()).map_err(|e| e.to_string()))
            .collect::<Result<Vec<_>, _>>()?;
        entries.sort();
        for path in entries.iter().filter(|path| {
            path.file_name().is_some_and(|n| {
                let name = n.to_string_lossy();
                name.starts_with(".monocode-txn-") && name.ends_with(".pending")
            })
        }) {
            return Err(incomplete_recovery(path).unwrap_or_else(|error| {
                recovery(
                    &format!("Unpublished transaction metadata was preserved: {error}"),
                    &[path.clone()],
                )
            }));
        }
        for path in entries.iter().filter(|path| {
            path.file_name()
                .is_some_and(|n| n.to_string_lossy().starts_with(".monocode-txn-"))
        }) {
            if !exists(path)? {
                continue;
            }
            let journal = read_journal(path).map_err(|error| {
                incomplete_recovery(path).unwrap_or_else(|_| {
                    recovery(
                        &format!("An unreadable storage transaction was preserved: {error}"),
                        &[path.clone()],
                    )
                })
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
