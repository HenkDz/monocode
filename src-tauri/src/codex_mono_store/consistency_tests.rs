use super::*;
use std::cell::RefCell;
use std::collections::BTreeMap;

fn auth(account: &str, refresh: &str) -> String {
    serde_json::json!({"tokens":{"account_id":account},"last_refresh":refresh}).to_string()
}

#[test]
fn credential_sync_requires_identity_even_when_the_source_has_not_changed() {
    for service in ["Codex Auth", "codex"] {
        for (source, private, accepted) in [
            (auth("first", "1"), auth("second", "2"), false),
            (
                auth("first", "1"),
                auth("first", "2"),
                service == "Codex Auth",
            ),
            ("opaque-source".into(), "opaque-private".into(), false),
        ] {
            let values = RefCell::new(BTreeMap::from([
                ("source".to_string(), source.clone()),
                ("private".to_string(), private.clone()),
            ]));
            let store = MonoCodexStore {
                home: PathBuf::new(),
                sqlite_home: PathBuf::new(),
                auth: Mutex::new(vec![KeyringMirror {
                    service,
                    source_key: "source".into(),
                    private_key: "private".into(),
                    source_value: Some(source.clone()),
                    private_created: false,
                }]),
                lease: None,
                credentials: Arc::new(credential_lifetime::SystemCredentials),
            };
            store.sync_auth_with(
                |_, key| Ok(values.borrow().get(key).cloned()),
                |_, key, value| {
                    values.borrow_mut().insert(key.into(), value.into());
                    Ok(())
                },
            );
            assert!(values.borrow()["source"] == if accepted { private } else { source });
        }
    }
}

#[test]
fn credential_sync_preserves_a_racing_source_change() {
    let baseline = auth("first", "1");
    let source = auth("second", "2");
    let private = auth("first", "3");
    let writes = RefCell::new(Vec::new());
    let store = MonoCodexStore {
        home: PathBuf::new(),
        sqlite_home: PathBuf::new(),
        auth: Mutex::new(vec![KeyringMirror {
            service: "Codex Auth",
            source_key: "source".into(),
            private_key: "private".into(),
            source_value: Some(baseline),
            private_created: false,
        }]),
        lease: None,
        credentials: Arc::new(credential_lifetime::SystemCredentials),
    };
    store.sync_auth_with(
        |_, key| {
            Ok(Some(if key == "source" {
                source.clone()
            } else {
                private.clone()
            }))
        },
        |_, key, value| {
            writes.borrow_mut().push((key.to_owned(), value.to_owned()));
            Ok(())
        },
    );
    assert!(writes.borrow().is_empty());
}

#[test]
fn credential_prepare_uses_only_the_supplied_synthetic_backend_and_reuses_context_keys() {
    let root = std::env::temp_dir().join(format!(
        "monocode-cc0i-credentials-{}",
        uuid::Uuid::new_v4()
    ));
    let (source, home) = storage_roots(&root.join("source"), &root.join("mono")).unwrap();
    std::fs::write(
        home.join("config.toml"),
        "cli_auth_credentials_store='keyring'",
    )
    .unwrap();
    let source_key = format!("cli|{}", home_key(&source).unwrap());
    let private_key = format!("cli|{}", home_key(&home).unwrap());
    let values = RefCell::new(BTreeMap::from([
        (
            ("Codex Auth".to_string(), source_key.clone()),
            auth("first", "1"),
        ),
        (
            ("Codex Auth".to_string(), private_key.clone()),
            auth("second", "2"),
        ),
    ]));
    let rejected = prepare_keyring_with(
        &source,
        &home,
        |service, key| Ok(values.borrow().get(&(service.into(), key.into())).cloned()),
        |_, _, _| panic!("A different-account credential must not be overwritten"),
    );
    assert!(rejected.is_err());
    assert!(values.borrow()[&("Codex Auth".into(), private_key.clone())] == auth("second", "2"));
    values.borrow_mut().insert(
        ("Codex Auth".into(), private_key.clone()),
        auth("first", "1"),
    );
    for _ in 0..2 {
        let mirrors = prepare_keyring_with(
            &source,
            &home,
            |service, key| {
                Ok(values
                    .borrow()
                    .get(&(service.to_string(), key.to_string()))
                    .cloned())
            },
            |service, key, value| {
                values
                    .borrow_mut()
                    .insert((service.into(), key.into()), value.into());
                Ok(())
            },
        )
        .unwrap();
        assert_eq!(mirrors.len(), 1);
        assert!(
            values.borrow()[&("Codex Auth".to_string(), source_key.clone())] == auth("first", "1")
        );
        assert!(
            values.borrow()[&("Codex Auth".to_string(), private_key.clone())] == auth("first", "1")
        );
        assert_eq!(values.borrow().len(), 2);
    }
    values
        .borrow_mut()
        .insert(("Codex Auth".into(), private_key), auth("first", "2"));
    prepare_keyring_with(
        &source,
        &home,
        |service, key| {
            Ok(values
                .borrow()
                .get(&(service.to_string(), key.to_string()))
                .cloned())
        },
        |service, key, value| {
            values
                .borrow_mut()
                .insert((service.into(), key.into()), value.into());
            Ok(())
        },
    )
    .unwrap();
    assert!(values.borrow()[&("Codex Auth".into(), source_key)] == auth("first", "2"));
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn repeated_migration_preserves_private_dependency_turns_and_source_identity() {
    let root = std::env::temp_dir().join(format!("monocode-cc0i-copy-{}", uuid::Uuid::new_v4()));
    let (source, home) = storage_roots(&root.join("account"), &root.join("mono")).unwrap();
    let day = source.join("sessions/2026/10/12");
    std::fs::create_dir_all(&day).unwrap();
    let write = |id: &str, base: Option<&str>| {
        let path = day.join(format!("rollout-2026-10-12T00-00-00-{id}.jsonl"));
        let mut payload = serde_json::json!({"id":id});
        if let Some(base) = base {
            payload["history_base"] = serde_json::json!({"thread_id":base});
        }
        std::fs::write(
            &path,
            format!(
                "{}\n",
                serde_json::json!({"type":"session_meta","payload":payload})
            ),
        )
        .unwrap();
        path
    };
    let b = write("b", None);
    let a = write("a", Some("b"));
    let c = write("c", Some("b"));
    let proof = (std::fs::read(&b).unwrap(), entry_identity(&b).unwrap());
    copy_rollouts(&source, &home, "a", &[a.clone()]).unwrap();
    let private = home
        .join("sessions/2026/10/12")
        .join(b.file_name().unwrap());
    let identity = entry_identity(&private).unwrap();
    copy_rollouts(&source, &home, "a", &[a]).unwrap();
    assert_eq!(entry_identity(&private).unwrap(), identity);
    std::fs::OpenOptions::new()
        .append(true)
        .open(&private)
        .unwrap()
        .write_all(b"private turn\n")
        .unwrap();
    let continued = std::fs::read(&private).unwrap();
    let error = copy_rollouts(&source, &home, "c", &[c]).unwrap_err();
    let value: serde_json::Value = serde_json::from_str(&error).unwrap();
    assert_eq!(value["recovery"], true);
    assert_eq!(std::fs::read(&private).unwrap(), continued);
    assert_eq!(entry_identity(&private).unwrap(), identity);
    assert_eq!(
        (std::fs::read(&b).unwrap(), entry_identity(&b).unwrap()),
        proof
    );
    assert!(home.join(".monocode-migrations/c").exists());
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn repeated_context_prepare_keeps_private_config_and_instructions_in_place() {
    let root = std::env::temp_dir().join(format!("monocode-cc0i-context-{}", uuid::Uuid::new_v4()));
    let (source, home) = storage_roots(&root.join("account"), &root.join("mono")).unwrap();
    for name in ["config.toml", "AGENTS.md"] {
        std::fs::write(source.join(name), b"source config").unwrap();
        std::fs::write(home.join(name), b"private config").unwrap();
        if name == "AGENTS.md" {
            write_snapshot(
                &home,
                name,
                &LinkSnapshot {
                    fingerprint: fingerprint(&home.join(name)).unwrap(),
                    private_override: true,
                    invalid: false,
                },
            )
            .unwrap();
        }
    }
    let context = private_directory(&home, ".monocode-skill-contexts").unwrap();
    let context = private_directory(&context, &"a".repeat(64)).unwrap();
    skills::prepare_context_files(&source, &home, &context).unwrap();
    let identities: Vec<_> = ["config.toml", "AGENTS.md"]
        .map(|name| entry_identity(&context.join(name)).unwrap())
        .into();
    BEFORE_CLAIM.with(|hook| {
        *hook.borrow_mut() = Some(Box::new(|| {
            panic!("Private configuration must not be claimed during re-prepare")
        }))
    });
    skills::prepare_context_files(&source, &home, &context).unwrap();
    BEFORE_CLAIM.with(|hook| *hook.borrow_mut() = None);
    for (index, name) in ["config.toml", "AGENTS.md"].iter().enumerate() {
        assert_eq!(
            std::fs::read(context.join(name)).unwrap(),
            b"private config"
        );
        assert_eq!(
            entry_identity(&context.join(name)).unwrap(),
            identities[index]
        );
        assert_eq!(std::fs::read(source.join(name)).unwrap(), b"source config");
    }
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn migration_preserves_a_late_destination_writer_and_allows_an_identical_partial_retry() {
    let root =
        std::env::temp_dir().join(format!("monocode-cc0i-late-copy-{}", uuid::Uuid::new_v4()));
    let (source, home) = storage_roots(&root.join("account"), &root.join("mono")).unwrap();
    let day = source.join("sessions/2026/10/12");
    std::fs::create_dir_all(&day).unwrap();
    let path = day.join("rollout-2026-10-12T00-00-00-root.jsonl");
    let original = b"{\"type\":\"session_meta\",\"payload\":{\"id\":\"root\"}}\n";
    std::fs::write(&path, original).unwrap();
    let destination = home
        .join("sessions/2026/10/12")
        .join(path.file_name().unwrap());
    let late = destination.clone();
    BEFORE_ROLLOUT_PUBLISH.with(|hook| {
        *hook.borrow_mut() = Some(Box::new(move || {
            std::fs::write(late, b"late private turn").unwrap()
        }))
    });
    let error = copy_rollouts(&source, &home, "root", &[path.clone()]).unwrap_err();
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&error).unwrap()["recovery"],
        true
    );
    assert_eq!(std::fs::read(&destination).unwrap(), b"late private turn");
    assert_eq!(std::fs::read(&path).unwrap(), original);
    assert!(home.join(".monocode-migrations/root").exists());
    std::fs::write(&destination, original).unwrap();
    let identity = entry_identity(&destination).unwrap();
    copy_rollouts(&source, &home, "root", &[path]).unwrap();
    assert_eq!(entry_identity(&destination).unwrap(), identity);
    assert!(!home.join(".monocode-migrations/root").exists());
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn migration_waits_for_the_storage_lock_used_by_prepare() {
    let root =
        std::env::temp_dir().join(format!("monocode-cc0i-lock-copy-{}", uuid::Uuid::new_v4()));
    let (source, home) = storage_roots(&root.join("account"), &root.join("mono")).unwrap();
    let day = source.join("sessions/2026/10/12");
    std::fs::create_dir_all(&day).unwrap();
    let path = day.join("rollout-2026-10-12T00-00-00-root.jsonl");
    std::fs::write(
        &path,
        b"{\"type\":\"session_meta\",\"payload\":{\"id\":\"root\"}}\n",
    )
    .unwrap();
    let lock = STORAGE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let (started, start) = std::sync::mpsc::channel();
    let (done, completion) = std::sync::mpsc::channel();
    let worker = std::thread::spawn(move || {
        started.send(()).unwrap();
        done.send(copy_rollouts(&source, &home, "root", &[path]))
            .unwrap();
    });
    start
        .recv_timeout(std::time::Duration::from_secs(2))
        .unwrap();
    assert!(completion
        .recv_timeout(std::time::Duration::from_millis(100))
        .is_err());
    drop(lock);
    completion
        .recv_timeout(std::time::Duration::from_secs(2))
        .unwrap()
        .unwrap();
    worker.join().unwrap();
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn divergent_descendant_is_preserved_during_migration() {
    let root =
        std::env::temp_dir().join(format!("monocode-cc0i-child-copy-{}", uuid::Uuid::new_v4()));
    let (source, home) = storage_roots(&root.join("account"), &root.join("mono")).unwrap();
    let day = source.join("sessions/2026/10/12");
    std::fs::create_dir_all(&day).unwrap();
    let root_thread = day.join("rollout-2026-10-12T00-00-00-root.jsonl");
    let child = day.join("rollout-2026-10-12T00-00-00-child.jsonl");
    std::fs::write(
        &root_thread,
        b"{\"type\":\"session_meta\",\"payload\":{\"id\":\"root\"}}\n",
    )
    .unwrap();
    let child_bytes = b"{\"type\":\"session_meta\",\"payload\":{\"id\":\"child\"}}\n";
    std::fs::write(&child, child_bytes).unwrap();
    copy_rollouts(
        &source,
        &home,
        "root",
        &[root_thread.clone(), child.clone()],
    )
    .unwrap();
    let private = home
        .join("sessions/2026/10/12")
        .join(child.file_name().unwrap());
    std::fs::OpenOptions::new()
        .append(true)
        .open(&private)
        .unwrap()
        .write_all(b"private child turn")
        .unwrap();
    let proof = (
        std::fs::read(&private).unwrap(),
        entry_identity(&private).unwrap(),
    );
    assert!(copy_rollouts(&source, &home, "root", &[root_thread, child.clone()]).is_err());
    assert_eq!(
        (
            std::fs::read(&private).unwrap(),
            entry_identity(&private).unwrap()
        ),
        proof
    );
    assert_eq!(std::fs::read(child).unwrap(), child_bytes);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn external_readers_never_observe_source_config_or_missing_private_overrides_during_reprepare() {
    let root = std::env::temp_dir().join(format!("monocode-cc0i-readers-{}", uuid::Uuid::new_v4()));
    let (source, home) = storage_roots(&root.join("source"), &root.join("mono")).unwrap();
    for name in ["config.toml", "AGENTS.md", "custom.json"] {
        std::fs::write(source.join(name), b"source bytes").unwrap();
        std::fs::write(home.join(name), b"private bytes").unwrap();
        if name != "config.toml" {
            write_snapshot(
                &home,
                name,
                &LinkSnapshot {
                    fingerprint: fingerprint(&home.join(name)).unwrap(),
                    private_override: true,
                    invalid: false,
                },
            )
            .unwrap();
        }
    }
    let context = private_directory(
        &private_directory(&home, ".monocode-skill-contexts").unwrap(),
        &"a".repeat(64),
    )
    .unwrap();
    skills::prepare_context_files(&source, &home, &context).unwrap();
    let original: Vec<_> = ["config.toml", "AGENTS.md", "custom.json"]
        .iter()
        .map(|name| entry_identity(&context.join(name)).unwrap())
        .collect();
    let finished = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let signal = finished.clone();
    let reader_home = context.clone();
    let (ready, synchronized) = std::sync::mpsc::channel();
    let reader = std::thread::spawn(move || {
        ready.send(()).unwrap();
        let mut reads = 0;
        while !signal.load(std::sync::atomic::Ordering::SeqCst) {
            for name in ["config.toml", "AGENTS.md", "custom.json"] {
                if std::fs::read(reader_home.join(name)).ok().as_deref() != Some(b"private bytes") {
                    return Err(name);
                }
                reads += 1;
            }
        }
        Ok(reads)
    });
    synchronized
        .recv_timeout(std::time::Duration::from_secs(2))
        .unwrap();
    let result = (|| {
        for _ in 0..20 {
            skills::prepare_context_files(&source, &home, &context)?;
        }
        Ok::<_, String>(())
    })();
    finished.store(true, std::sync::atomic::Ordering::SeqCst);
    let reads = reader.join().unwrap();
    result.unwrap();
    assert!(reads.unwrap() > 0);
    for (index, name) in ["config.toml", "AGENTS.md", "custom.json"]
        .iter()
        .enumerate()
    {
        assert_eq!(
            entry_identity(&context.join(name)).unwrap(),
            original[index]
        );
        assert_eq!(std::fs::read(source.join(name)).unwrap(), b"source bytes");
    }
    remove_link(&context.join("AGENTS.md")).unwrap();
    std::fs::write(context.join("AGENTS.md"), b"context-owned override").unwrap();
    write_snapshot(
        &context,
        "AGENTS.md",
        &LinkSnapshot {
            fingerprint: fingerprint(&context.join("AGENTS.md")).unwrap(),
            private_override: true,
            invalid: false,
        },
    )
    .unwrap();
    skills::prepare_context_files(&source, &home, &context).unwrap();
    assert_eq!(
        std::fs::read(context.join("AGENTS.md")).unwrap(),
        b"context-owned override"
    );
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn original_three_legacy_kill_points_expose_archive_metadata_and_recover_exact_originals() {
    for (point, skip) in [
        ("journal-after-create", 1),
        ("journal-before-publish", 1),
        ("verify-before-rename", 0),
    ] {
        let fixture = crash_tests::Fixture::new(&format!("cc0i-legacy-{point}"));
        let context = private_directory(
            &private_directory(&fixture.home(), ".monocode-skill-contexts").unwrap(),
            &"a".repeat(64),
        )
        .unwrap();
        let day = context.join("sessions/2026/10/12");
        std::fs::create_dir_all(&day).unwrap();
        let name = "rollout-2026-10-12T00-00-00-legacy.jsonl";
        let original = day.join(name);
        let bytes = b"{\"type\":\"session_meta\",\"payload\":{\"id\":\"legacy\"}}\nprivate turns\n";
        std::fs::write(&original, bytes).unwrap();
        let original_identity = entry_identity(&original).unwrap();
        fixture.kill_at_skip("legacy-retention", "AGENTS.md", point, skip);
        let error = archive::prepare_base_state(&fixture.home()).unwrap_err();
        let value: serde_json::Value = serde_json::from_str(&error).unwrap();
        assert_eq!(value["recovery"], true);
        assert!(value["metadata"].is_object());
        let metadata: transactions::RecoveryMetadata =
            serde_json::from_value(value["metadata"].clone()).unwrap();
        transactions::preserve_metadata(&fixture.home(), &metadata).unwrap();
        archive::prepare_base_state(&fixture.home()).unwrap();
        archive::prepare_base_state(&fixture.home()).unwrap();
        assert_eq!(
            std::fs::read(fixture.home().join("sessions/2026/10/12").join(name)).unwrap(),
            bytes
        );
        let retained = std::fs::read_dir(&context)
            .unwrap()
            .find_map(|entry| {
                let path = entry.unwrap().path();
                let file = path.join("2026/10/12").join(name);
                (path
                    .file_name()
                    .unwrap()
                    .to_string_lossy()
                    .starts_with(".monocode-retained-sessions-")
                    && file.is_file())
                .then_some(file)
            })
            .unwrap();
        assert_eq!(std::fs::read(&retained).unwrap(), bytes);
        assert_eq!(entry_identity(&retained).unwrap(), original_identity);
        std::fs::remove_dir_all(fixture.0).unwrap();
    }
}
