use super::*;
use credential_lifetime::{ContextLease, CredentialBackend};

const LIMIT: u64 = 4096;
const ENTRIES: [(&str, &str, &str, &str); 3] = [
    (
        ".monocode-credential-owner-cli.json",
        "Codex Auth",
        "cli",
        "",
    ),
    (
        ".monocode-credential-owner-secrets.json",
        "codex",
        "secrets",
        "",
    ),
    (
        ".monocode-credential-owner-gateway.json",
        "codex",
        "secrets",
        "|gateway-oauth",
    ),
];

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct OwnedCopy {
    version: u8,
    id: String,
    context_identity: (u64, u64),
    source_identity: (u64, u64),
    service: String,
    key: String,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct OwnerReceipt {
    entry: String,
    identity: String,
    fingerprint: String,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct RetirementReceipt {
    context_id: String,
    context_identity: String,
    owners: Vec<OwnerReceipt>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CredentialNamespace {
    context_id: String,
    home: String,
    copies: usize,
    active: bool,
    receipt: RetirementReceipt,
}

fn identity(value: (u64, u64)) -> String {
    format!("{}:{}", value.0, value.1)
}

fn read_owned(
    source: &Path,
    home: &Path,
    entry: &str,
) -> Result<(OwnedCopy, OwnerReceipt, std::fs::File), String> {
    let (_, service, prefix, suffix) = ENTRIES
        .iter()
        .find(|row| row.0 == entry)
        .ok_or("Unknown private credential ownership record")?;
    let path = home.join(entry);
    if replaceable_link(&path)? {
        return Err("Private credential ownership metadata must remain a single-link file".into());
    }
    #[cfg(windows)]
    let file = open_entry(&path, true)?;
    #[cfg(unix)]
    let file = std::fs::File::open(&path).map_err(|e| e.to_string())?;
    if !credential_lifetime::private_single_file(&file) {
        return Err("Private credential ownership metadata changed; it was preserved".into());
    }
    let mut bytes = Vec::new();
    (&file)
        .take(LIMIT + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() as u64 > LIMIT {
        return Err("Private credential ownership metadata exceeds its size limit".into());
    }
    let record: OwnedCopy = serde_json::from_slice(&bytes)
        .map_err(|_| "Invalid private credential ownership metadata")?;
    let private_hash = home_key(home)?;
    if record.version != 1
        || uuid::Uuid::parse_str(&record.id).is_err()
        || record.context_identity != entry_identity(home)?
        || record.source_identity != entry_identity(source)?
        || record.service != *service
        || record.key != format!("{prefix}|{private_hash}{suffix}")
        || private_hash == home_key(source)?
    {
        return Err("Private credential ownership no longer matches this bound context and source; all credentials were preserved".into());
    }
    let receipt = OwnerReceipt {
        entry: entry.into(),
        identity: identity(file_identity(&file)?),
        fingerprint: format!("{:x}", Sha256::digest(&bytes)),
    };
    Ok((record, receipt, file))
}

pub(super) fn own_new_copy(
    source: &Path,
    home: &Path,
    service: &str,
    key: &str,
) -> Result<(), String> {
    let hash = home_key(home)?;
    if hash == home_key(source)? {
        return Err("Private credential namespace must differ from the source namespace".into());
    }
    let &(entry, _, _, _) = ENTRIES
        .iter()
        .find(|row| row.1 == service && key == format!("{}|{hash}{}", row.2, row.3))
        .ok_or("Unknown private credential namespace")?;
    let path = home.join(entry);
    if std::fs::symlink_metadata(&path).is_ok() {
        read_owned(source, home, entry)?;
        return Ok(());
    }
    let record = OwnedCopy {
        version: 1,
        id: uuid::Uuid::new_v4().to_string(),
        context_identity: entry_identity(home)?,
        source_identity: entry_identity(source)?,
        service: service.into(),
        key: key.into(),
    };
    let temp = home.join(format!(
        ".monocode-credential-owner-{}.pending",
        uuid::Uuid::new_v4()
    ));
    transactions::create_json(&temp, &record)?;
    let staged = transactions::RecordedEntry::new(&temp)?;
    if let Err(error) = staged.publish(&temp, &path) {
        staged.cleanup(&temp)?;
        if std::fs::symlink_metadata(&path).is_err() {
            return Err(error);
        }
    }
    read_owned(source, home, entry)?;
    Ok(())
}

fn context_home(base: &Path, id: &str) -> Result<PathBuf, String> {
    if id == "base" {
        return Ok(base.to_path_buf());
    }
    if id.len() != 64
        || !id
            .bytes()
            .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
    {
        return Err("Invalid private credential context id".into());
    }
    let parent = base.join(".monocode-skill-contexts");
    let home = parent.join(id);
    if replaceable_link(&parent)? || replaceable_link(&home)? || !home.is_dir() {
        return Err("The owned private context is missing or has been replaced".into());
    }
    Ok(home)
}

fn inspect(
    source: &Path,
    home: &Path,
    id: &str,
    backend: &dyn CredentialBackend,
) -> Result<Option<CredentialNamespace>, String> {
    let mut owners = Vec::new();
    let mut copies = 0;
    for (entry, _, _, _) in ENTRIES {
        match std::fs::symlink_metadata(home.join(entry)) {
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => continue,
            Err(e) => return Err(e.to_string()),
            Ok(_) => {}
        }
        let (record, receipt, _guard) = read_owned(source, home, entry)?;
        copies += usize::from(backend.read(&record.service, &record.key)?.is_some());
        owners.push(receipt);
    }
    if copies == 0 {
        return Ok(None);
    }
    let active = ContextLease::exclusive(home).is_err();
    Ok(Some(CredentialNamespace {
        context_id: id.into(),
        home: crate::fs::path_to_js(home),
        copies,
        active,
        receipt: RetirementReceipt {
            context_id: id.into(),
            context_identity: identity(entry_identity(home)?),
            owners,
        },
    }))
}

pub(super) fn list(
    source: &Path,
    base: &Path,
    backend: &dyn CredentialBackend,
) -> Result<Vec<CredentialNamespace>, String> {
    let (source, base) = canonical_roots(source, base)?;
    let mut namespaces = Vec::new();
    if let Some(namespace) = inspect(&source, &base, "base", backend)? {
        namespaces.push(namespace);
    }
    let contexts = base.join(".monocode-skill-contexts");
    if !contexts.exists() {
        return Ok(namespaces);
    }
    if replaceable_link(&contexts)? {
        return Err("Private context metadata must remain a real directory".into());
    }
    for entry in std::fs::read_dir(&contexts).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let id = entry.file_name();
        let id = id.to_str().ok_or("Invalid private context filename")?;
        if id.len() == 64
            && id
                .bytes()
                .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
            && entry.file_type().map_err(|e| e.to_string())?.is_dir()
        {
            let home = context_home(&base, id)?;
            if let Some(namespace) = inspect(&source, &home, id, backend)? {
                namespaces.push(namespace);
            }
        }
    }
    Ok(namespaces)
}

pub(super) fn retire(
    source: &Path,
    base: &Path,
    receipt: &RetirementReceipt,
    backend: &dyn CredentialBackend,
) -> Result<(), String> {
    let (source, base) = canonical_roots(source, base)?;
    let home = context_home(&base, &receipt.context_id)?;
    #[cfg(windows)]
    let _context_guard = archive::lock_directory(&home)?;
    let _inactive = ContextLease::exclusive(&home)?;
    if identity(entry_identity(&home)?) != receipt.context_identity
        || receipt.owners.is_empty()
        || receipt.owners.len() > ENTRIES.len()
    {
        return Err("The private context changed. Refresh its ownership details before confirming retirement.".into());
    }
    let present: Vec<_> = ENTRIES
        .iter()
        .filter(|row| std::fs::symlink_metadata(home.join(row.0)).is_ok())
        .map(|row| row.0)
        .collect();
    let expected: Vec<_> = receipt
        .owners
        .iter()
        .map(|row| row.entry.as_str())
        .collect();
    if present != expected {
        return Err(
            "Private credential ownership changed. Refresh and confirm the current namespace."
                .into(),
        );
    }
    let mut pinned = Vec::new();
    for owner in &receipt.owners {
        let (record, current, guard) = read_owned(&source, &home, &owner.entry)?;
        if current.identity != owner.identity || current.fingerprint != owner.fingerprint {
            return Err("The credential ownership record changed. All remaining private copies were preserved; refresh before confirming retirement.".into());
        }
        pinned.push((record, guard));
    }
    // Explicitly confirmed namespace retirement clears these recorded private names.
    // It does not claim value-conditional keyring deletion or touch source names.
    for (record, _) in &pinned {
        backend.clear_namespace_entry(&record.service, &record.key)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;

    struct SyntheticBackend {
        values: Mutex<BTreeMap<(String, String), String>>,
        removed: Mutex<Vec<(String, String)>>,
    }
    impl CredentialBackend for SyntheticBackend {
        fn read(&self, service: &str, key: &str) -> Result<Option<String>, String> {
            Ok(self
                .values
                .lock()
                .unwrap()
                .get(&(service.into(), key.into()))
                .cloned())
        }
        fn write(&self, service: &str, key: &str, value: &str) -> Result<(), String> {
            self.values
                .lock()
                .unwrap()
                .insert((service.into(), key.into()), value.into());
            Ok(())
        }
        fn retire_owned(&self, _: &str, _: &str, _: &str) -> Result<bool, String> {
            Ok(false)
        }
        fn clear_namespace_entry(&self, service: &str, key: &str) -> Result<(), String> {
            self.removed
                .lock()
                .unwrap()
                .push((service.into(), key.into()));
            self.values
                .lock()
                .unwrap()
                .remove(&(service.into(), key.into()));
            Ok(())
        }
    }

    fn fixture() -> (PathBuf, PathBuf, PathBuf, SyntheticBackend) {
        let root = std::env::temp_dir().join(format!(
            "monocode-cc0i-owned-credentials-{}",
            uuid::Uuid::new_v4()
        ));
        let (source, home) = storage_roots(&root.join("source"), &root.join("mono")).unwrap();
        let backend = SyntheticBackend {
            values: Mutex::new(BTreeMap::new()),
            removed: Mutex::new(Vec::new()),
        };
        (root, source, home, backend)
    }

    #[test]
    fn confirmed_inactive_namespace_clears_owned_private_copies_and_keeps_source_legacy_and_data() {
        let (root, source, home, backend) = fixture();
        let lease = ContextLease::acquire(&home).unwrap();
        let private = format!("cli|{}", home_key(&home).unwrap());
        let source_key = format!("cli|{}", home_key(&source).unwrap());
        own_new_copy(&source, &home, "Codex Auth", &private).unwrap();
        backend
            .write("Codex Auth", &source_key, "source value")
            .unwrap();
        backend
            .write(
                "Codex Auth",
                &private,
                "foreign login explicitly included in this private namespace",
            )
            .unwrap();
        let legacy = format!("secrets|{}", home_key(&home).unwrap());
        backend
            .write("codex", &legacy, "unowned legacy value")
            .unwrap();
        std::fs::write(home.join("private-session.jsonl"), b"private turns").unwrap();
        let namespace = list(&source, &home, &backend).unwrap().remove(0);
        assert!(namespace.active);
        assert!(retire(&source, &home, &namespace.receipt, &backend).is_err());
        assert!(backend.removed.lock().unwrap().is_empty());
        drop(lease);
        retire(&source, &home, &namespace.receipt, &backend).unwrap();
        assert_eq!(
            *backend.removed.lock().unwrap(),
            vec![("Codex Auth".into(), private.clone())]
        );
        assert!(backend.read("Codex Auth", &source_key).unwrap().is_some());
        assert!(backend.read("codex", &legacy).unwrap().is_some());
        assert_eq!(
            std::fs::read(home.join("private-session.jsonl")).unwrap(),
            b"private turns"
        );
        assert!(list(&source, &home, &backend).unwrap().is_empty());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn stale_owner_metadata_and_replaced_source_refuse_before_any_credential_delete() {
        for changed_source in [false, true] {
            let (root, source, home, backend) = fixture();
            drop(ContextLease::acquire(&home).unwrap());
            let key = format!("cli|{}", home_key(&home).unwrap());
            own_new_copy(&source, &home, "Codex Auth", &key).unwrap();
            backend.write("Codex Auth", &key, "synthetic copy").unwrap();
            let namespace = list(&source, &home, &backend).unwrap().remove(0);
            if changed_source {
                std::fs::rename(&source, root.join("original-source")).unwrap();
                std::fs::create_dir(&source).unwrap();
            } else {
                let path = home.join(ENTRIES[0].0);
                let mut bytes = std::fs::read(&path).unwrap();
                bytes.push(b' ');
                std::fs::write(path, bytes).unwrap();
            }
            assert!(retire(&source, &home, &namespace.receipt, &backend).is_err());
            assert!(backend.removed.lock().unwrap().is_empty());
            assert!(backend.read("Codex Auth", &key).unwrap().is_some());
            std::fs::remove_dir_all(root).unwrap();
        }
    }

    #[test]
    fn legacy_namespace_without_created_ownership_is_never_offered_or_deleted() {
        let (root, source, home, backend) = fixture();
        drop(ContextLease::acquire(&home).unwrap());
        let key = format!("cli|{}", home_key(&home).unwrap());
        backend.write("Codex Auth", &key, "legacy").unwrap();
        assert!(list(&source, &home, &backend).unwrap().is_empty());
        let receipt = RetirementReceipt {
            context_id: "base".into(),
            context_identity: identity(entry_identity(&home).unwrap()),
            owners: vec![],
        };
        assert!(retire(&source, &home, &receipt, &backend).is_err());
        assert!(backend.removed.lock().unwrap().is_empty());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn invalid_unknown_or_oversized_ownership_records_never_authorize_retirement() {
        for bytes in [
            b"{}".to_vec(),
            vec![b' '; LIMIT as usize + 1],
            br#"{"version":1,"unknown":true}"#.to_vec(),
        ] {
            let (root, source, home, backend) = fixture();
            drop(ContextLease::acquire(&home).unwrap());
            std::fs::write(home.join(ENTRIES[0].0), &bytes).unwrap();
            assert!(list(&source, &home, &backend).is_err());
            assert_eq!(std::fs::read(home.join(ENTRIES[0].0)).unwrap(), bytes);
            assert!(backend.removed.lock().unwrap().is_empty());
            std::fs::remove_dir_all(root).unwrap();
        }
    }
}
