use super::*;

pub(super) trait CredentialBackend: Send + Sync {
    fn read(&self, service: &str, key: &str) -> Result<Option<String>, String>;
    fn write(&self, service: &str, key: &str, value: &str) -> Result<(), String>;
    fn retire_owned(&self, service: &str, key: &str, expected: &str) -> Result<bool, String>;
    fn clear_namespace_entry(&self, service: &str, key: &str) -> Result<(), String>;
}

pub(super) struct SystemCredentials;
impl CredentialBackend for SystemCredentials {
    fn read(&self, service: &str, key: &str) -> Result<Option<String>, String> {
        read_keyring(service, key)
    }
    fn write(&self, service: &str, key: &str, value: &str) -> Result<(), String> {
        write_keyring(service, key, value)
    }
    fn retire_owned(&self, _service: &str, _key: &str, _expected: &str) -> Result<bool, String> {
        // No platform credential identity or conditional deletion exists in this backend.
        // A context lease excludes managed users, not independent Credential Manager writers.
        Ok(false)
    }
    fn clear_namespace_entry(&self, service: &str, key: &str) -> Result<(), String> {
        let entry = keyring::Entry::new(service, key)
            .map_err(|_| "Could not access private Codex credentials")?;
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(_) => Err("Could not clear this inactive context's owned private credential copies. Refresh and retry; source credentials were not changed.".into()),
        }
    }
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct LeaseIdentity {
    version: u8,
    id: String,
}

pub(super) struct ContextLease {
    path: PathBuf,
    identity: (u64, u64),
    home_identity: (u64, u64),
    fingerprint: String,
    file: Option<std::fs::File>,
}

pub(super) fn open_lease(path: &Path, exclusive: bool) -> Result<std::fs::File, String> {
    let mut options = std::fs::OpenOptions::new();
    options.read(true).write(exclusive);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        use windows_sys::Win32::Storage::FileSystem::{
            FILE_FLAG_OPEN_REPARSE_POINT, FILE_SHARE_READ,
        };
        options
            .share_mode(if exclusive { 0 } else { FILE_SHARE_READ })
            .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT);
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW);
    }
    let file = options.open(path).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::fd::AsRawFd;
        if unsafe {
            libc::flock(
                file.as_raw_fd(),
                if exclusive {
                    libc::LOCK_EX | libc::LOCK_NB
                } else {
                    libc::LOCK_SH | libc::LOCK_NB
                },
            )
        } != 0
        {
            return Err("This private context still has a managed credential user".into());
        }
    }
    Ok(file)
}

impl ContextLease {
    pub(super) fn still_owns(&self, home: &Path) -> bool {
        entry_identity(home).ok() == Some(self.home_identity)
            && entry_identity(&self.path).ok() == Some(self.identity)
    }
    pub(super) fn exclusive(home: &Path) -> Result<std::fs::File, String> {
        let path = home.join(".monocode-credential-lease.json");
        let file = open_lease(&path, true).map_err(|_| "This private context is active or busy. Close every managed server using it before clearing its credentials.")?;
        if !private_single_file(&file) {
            return Err("Credential lease metadata must remain a private, single-link file".into());
        }
        let mut bytes = Vec::new();
        (&file)
            .take(1025)
            .read_to_end(&mut bytes)
            .map_err(|e| e.to_string())?;
        let identity: LeaseIdentity = serde_json::from_slice(&bytes)
            .map_err(|_| "Invalid private credential lease metadata")?;
        if bytes.len() > 1024
            || identity.version != 1
            || uuid::Uuid::parse_str(&identity.id).is_err()
        {
            return Err("Invalid private credential lease metadata".into());
        }
        Ok(file)
    }
    pub(super) fn acquire(home: &Path) -> Result<Self, String> {
        let path = home.join(".monocode-credential-lease.json");
        if std::fs::symlink_metadata(&path).is_err_and(|e| e.kind() == std::io::ErrorKind::NotFound)
        {
            let temp = home.join(format!(
                ".monocode-credential-lease-{}.pending",
                uuid::Uuid::new_v4()
            ));
            transactions::create_json(
                &temp,
                &LeaseIdentity {
                    version: 1,
                    id: uuid::Uuid::new_v4().to_string(),
                },
            )?;
            let record = transactions::RecordedEntry::new(&temp)?;
            if let Err(error) = record.publish(&temp, &path) {
                record.cleanup(&temp)?;
                if std::fs::symlink_metadata(&path).is_err() {
                    return Err(error);
                }
            }
        }
        if replaceable_link(&path)? {
            return Err("Credential lease metadata must remain a private, single-link file".into());
        }
        let mut file = open_lease(&path, false)?;
        if !file.metadata().map_err(|e| e.to_string())?.is_file() {
            return Err("Invalid private credential lease metadata".into());
        }
        let identity = file_identity(&file)?;
        let mut bytes = Vec::new();
        (&mut file)
            .take(1025)
            .read_to_end(&mut bytes)
            .map_err(|e| e.to_string())?;
        let record: LeaseIdentity = serde_json::from_slice(&bytes)
            .map_err(|_| "Invalid private credential lease metadata")?;
        if bytes.len() > 1024 || record.version != 1 || uuid::Uuid::parse_str(&record.id).is_err() {
            return Err("Invalid private credential lease metadata".into());
        }
        let fingerprint = format!("{:x}", Sha256::digest(&bytes));
        Ok(Self {
            path,
            identity,
            home_identity: entry_identity(home)?,
            fingerprint,
            file: Some(file),
        })
    }

    pub(super) fn retire(
        &mut self,
        mirrors: &[KeyringMirror],
        read: impl Fn(&str, &str) -> Result<Option<String>, String>,
        remove_if_unchanged: impl Fn(&str, &str, &str) -> Result<bool, String>,
    ) -> usize {
        drop(self.file.take());
        let Ok(mut exclusive) = open_lease(&self.path, true) else {
            return 0;
        };
        if file_identity(&exclusive).ok() != Some(self.identity)
            || self
                .path
                .parent()
                .and_then(|home| entry_identity(home).ok())
                != Some(self.home_identity)
            || !private_single_file(&exclusive)
            || fingerprint_file(&mut exclusive).ok().as_ref() != Some(&self.fingerprint)
        {
            return 0;
        }
        let mut removed = 0;
        for mirror in mirrors.iter().filter(|mirror| mirror.private_created) {
            let (Ok(source), Ok(private)) = (
                read(mirror.service, &mirror.source_key),
                read(mirror.service, &mirror.private_key),
            ) else {
                continue;
            };
            let Some(expected) = mirror.source_value.as_ref() else {
                continue;
            };
            if source != mirror.source_value
                || private != mirror.source_value
                || (mirror.service == "Codex Auth" && !same_account(&private, &source))
            {
                continue;
            }
            // The backend must prove entry ownership and exclude a writer between checking and deleting.
            if remove_if_unchanged(mirror.service, &mirror.private_key, expected).unwrap_or(false) {
                removed += 1;
            }
        }
        removed
    }
}

pub(super) fn private_single_file(file: &std::fs::File) -> bool {
    #[cfg(windows)]
    {
        use windows_sys::Win32::Storage::FileSystem::FILE_ATTRIBUTE_REPARSE_POINT;
        handle_file_info(file).is_ok_and(|info| {
            info.nNumberOfLinks == 1 && info.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT == 0
        })
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        file.metadata().is_ok_and(|m| m.is_file() && m.nlink() == 1)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;
    use std::collections::BTreeMap;

    struct SyntheticCredentials {
        values: Mutex<BTreeMap<String, String>>,
        owned: Mutex<bool>,
        retired: std::sync::atomic::AtomicUsize,
    }
    impl CredentialBackend for SyntheticCredentials {
        fn read(&self, _service: &str, key: &str) -> Result<Option<String>, String> {
            Ok(self.values.lock().unwrap().get(key).cloned())
        }
        fn write(&self, _service: &str, key: &str, value: &str) -> Result<(), String> {
            self.values.lock().unwrap().insert(key.into(), value.into());
            Ok(())
        }
        fn retire_owned(&self, _service: &str, key: &str, expected: &str) -> Result<bool, String> {
            let mut values = self.values.lock().unwrap();
            if !*self.owned.lock().unwrap()
                || values.get(key).map(String::as_str) != Some(expected)
                || values.get("source").map(String::as_str) != Some(expected)
            {
                return Ok(false);
            }
            values.remove(key);
            self.retired
                .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            Ok(true)
        }
        fn clear_namespace_entry(&self, _service: &str, key: &str) -> Result<(), String> {
            self.values.lock().unwrap().remove(key);
            Ok(())
        }
    }

    fn fixture() -> (PathBuf, PathBuf) {
        let root = std::env::temp_dir().join(format!(
            "monocode-cc0i-credential-lease-{}",
            uuid::Uuid::new_v4()
        ));
        let (_, home) = storage_roots(&root.join("source"), &root.join("context")).unwrap();
        (root, home)
    }
    fn mirror(created: bool) -> KeyringMirror {
        KeyringMirror {
            service: "Codex Auth",
            source_key: "source".into(),
            private_key: "private".into(),
            source_value: Some(
                serde_json::json!({"tokens":{"account_id":"synthetic"}}).to_string(),
            ),
            private_created: created,
        }
    }

    #[test]
    fn concurrent_context_leases_exclude_retirement_until_every_managed_user_stops() {
        let (root, home) = fixture();
        let mut first = ContextLease::acquire(&home).unwrap();
        let mut second = ContextLease::acquire(&home).unwrap();
        let first_mirror = mirror(true);
        let expected = first_mirror.source_value.clone();
        let attempts = RefCell::new(0);
        assert_eq!(
            first.retire(
                &[first_mirror],
                |_, _| Ok(expected.clone()),
                |_, _, _| {
                    *attempts.borrow_mut() += 1;
                    Ok(true)
                }
            ),
            0
        );
        assert_eq!(*attempts.borrow(), 0);
        let mirror = mirror(true);
        assert_eq!(
            second.retire(
                &[mirror],
                |_, _| Ok(expected.clone()),
                |_, _, _| {
                    *attempts.borrow_mut() += 1;
                    Ok(true)
                }
            ),
            1
        );
        assert_eq!(*attempts.borrow(), 1);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn legacy_foreign_changed_and_nonexclusive_credentials_are_preserved() {
        for case in [
            "legacy",
            "source-change",
            "private-change",
            "foreign-login",
            "no-conditional-delete",
        ] {
            let (root, home) = fixture();
            let mut lease = ContextLease::acquire(&home).unwrap();
            let mirror = mirror(case != "legacy");
            let expected = mirror.source_value.clone();
            let attempts = RefCell::new(0);
            let removed = lease.retire(
                &[mirror],
                |_, key| {
                    if (case == "source-change" && key == "source")
                        || (case == "private-change" && key == "private")
                    {
                        Ok(Some("changed".into()))
                    } else if case == "foreign-login" && key == "private" {
                        Ok(Some(
                            serde_json::json!({"tokens":{"account_id":"foreign"}}).to_string(),
                        ))
                    } else {
                        Ok(expected.clone())
                    }
                },
                |_, _, _| {
                    *attempts.borrow_mut() += 1;
                    Ok(false)
                },
            );
            assert_eq!(removed, 0);
            assert_eq!(
                *attempts.borrow(),
                usize::from(case == "no-conditional-delete")
            );
            std::fs::remove_dir_all(root).unwrap();
        }
    }

    #[test]
    fn late_entry_identity_or_value_change_is_refused_by_the_synthetic_conditional_backend() {
        let (root, home) = fixture();
        let mut lease = ContextLease::acquire(&home).unwrap();
        let mirror = mirror(true);
        let expected = mirror.source_value.clone();
        let value = RefCell::new(expected.clone());
        let generation = RefCell::new(1);
        let removed = lease.retire(
            &[mirror],
            |_, _| Ok(expected.clone()),
            |_, _, old| {
                *value.borrow_mut() = Some("late foreign value".into());
                *generation.borrow_mut() = 2;
                if *generation.borrow() == 1 && value.borrow().as_deref() == Some(old) {
                    *value.borrow_mut() = None;
                    Ok(true)
                } else {
                    Ok(false)
                }
            },
        );
        assert_eq!(removed, 0);
        assert!(value.borrow().is_some());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn shared_store_holds_credentials_across_renderers_early_stdout_close_and_final_drain() {
        let (root, home) = fixture();
        let initial =
            serde_json::json!({"tokens":{"account_id":"synthetic"},"last_refresh":"1"}).to_string();
        let refreshed =
            serde_json::json!({"tokens":{"account_id":"synthetic"},"last_refresh":"2"}).to_string();
        let backend = Arc::new(SyntheticCredentials {
            values: Mutex::new(BTreeMap::from([
                ("source".into(), initial.clone()),
                ("private".into(), refreshed.clone()),
            ])),
            owned: Mutex::new(true),
            retired: std::sync::atomic::AtomicUsize::new(0),
        });
        let store = shared_store(&home, || {
            Ok(MonoCodexStore {
                home: home.clone(),
                sqlite_home: root.join("base"),
                auth: Mutex::new(vec![KeyringMirror {
                    service: "Codex Auth",
                    source_key: "source".into(),
                    private_key: "private".into(),
                    source_value: Some(initial),
                    private_created: true,
                }]),
                lease: Some(ContextLease::acquire(&home)?),
                credentials: backend.clone(),
            })
        })
        .unwrap();
        let stdout = store.clone();
        let wait = store.clone();
        let renderer = shared_store(&home, || {
            panic!("Another renderer must share the existing store and ownership")
        })
        .unwrap();
        assert!(Arc::ptr_eq(&store, &renderer));
        drop(stdout);
        drop(store);
        assert_eq!(backend.retired.load(std::sync::atomic::Ordering::SeqCst), 0);
        wait.sync_auth();
        drop(wait);
        assert_eq!(backend.retired.load(std::sync::atomic::Ordering::SeqCst), 0);
        assert!(backend.values.lock().unwrap()["source"] == refreshed);
        drop(renderer);
        assert_eq!(backend.retired.load(std::sync::atomic::Ordering::SeqCst), 1);
        assert!(!backend.values.lock().unwrap().contains_key("private"));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn failed_or_cancelled_spawn_releases_only_its_own_context_lease() {
        for cancelled in [false, true] {
            let (root, home) = fixture();
            let mut waiting_server = ContextLease::acquire(&home).unwrap();
            let attempt = ContextLease::acquire(&home).unwrap();
            if cancelled {
                let final_wait = Arc::new(attempt);
                let stdout = final_wait.clone();
                drop(stdout);
                assert!(open_lease(&waiting_server.path, true).is_err());
                drop(final_wait);
            } else {
                drop(attempt);
            }
            let mirror = mirror(true);
            let expected = mirror.source_value.clone();
            assert_eq!(
                waiting_server.retire(&[mirror], |_, _| Ok(expected.clone()), |_, _, _| Ok(false)),
                0
            );
            std::fs::remove_dir_all(root).unwrap();
        }
    }

    #[test]
    fn independent_process_lease_excludes_retirement() {
        use std::process::{Command, Stdio};
        let (root, home) = fixture();
        let mut lease = ContextLease::acquire(&home).unwrap();
        let ready = root.join("ready");
        let mut child = Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "codex_mono_store::credential_lifetime::tests::lease_child",
                "--ignored",
                "--nocapture",
            ])
            .env("CC0I_LEASE_HOME", &home)
            .env("CC0I_LEASE_READY", &ready)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        let started = std::time::Instant::now();
        while !ready.exists() {
            if child.try_wait().unwrap().is_some()
                || started.elapsed() > std::time::Duration::from_secs(20)
            {
                let _ = child.kill();
                let _ = child.wait();
                panic!("Credential lease child did not become ready");
            }
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        let mirror = mirror(true);
        let expected = mirror.source_value.clone();
        assert_eq!(
            lease.retire(
                &[mirror],
                |_, _| Ok(expected.clone()),
                |_, _, _| panic!("Another native process still owns this context")
            ),
            0
        );
        child.kill().unwrap();
        child.wait().unwrap();
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    #[ignore = "synthetic credential lease subprocess entrypoint"]
    fn lease_child() {
        let Some(home) = std::env::var_os("CC0I_LEASE_HOME") else {
            return;
        };
        let home = PathBuf::from(home);
        assert!(home.starts_with(std::env::temp_dir().canonicalize().unwrap()));
        let _lease = ContextLease::acquire(&home).unwrap();
        let ready = PathBuf::from(std::env::var_os("CC0I_LEASE_READY").unwrap());
        std::fs::write(ready, b"ready").unwrap();
        loop {
            std::thread::sleep(std::time::Duration::from_millis(25));
        }
    }

    #[test]
    fn windows_backend_declines_retirement_without_atomic_ownership_proof() {
        assert!(!SystemCredentials
            .retire_owned("synthetic", "synthetic", "synthetic")
            .unwrap());
    }
}
