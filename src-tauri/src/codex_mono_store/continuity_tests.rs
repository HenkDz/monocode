use super::*;

#[test]
fn cc0k_original_source_never_creates_an_empty_separate_home() {
    let root =
        std::env::temp_dir().join(format!("monocode-cc0k-original-{}", uuid::Uuid::new_v4()));
    let (source, home) = storage_roots(&root.join("source"), &root.join("mono")).unwrap();
    source_binding::ensure(&source, &home, false).unwrap();
    std::fs::write(home.join("private.jsonl"), b"Mono-only original turns").unwrap();
    let id = entry_identity(&home.join("private.jsonl")).unwrap();
    assert_eq!(
        source_binding::selected_home(&source, &home, true).unwrap(),
        home,
        "Confirming the original source must return its original home"
    );
    assert_eq!(entry_identity(&home.join("private.jsonl")).unwrap(), id);
    assert_eq!(
        std::fs::read(home.join("private.jsonl")).unwrap(),
        b"Mono-only original turns"
    );
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn cc0k_partial_canonical_archive_retry_preserves_unknown_bytes() {
    let root = std::env::temp_dir().join(format!("monocode-cc0k-partial-{}", uuid::Uuid::new_v4()));
    let (_, home) = storage_roots(&root.join("source"), &root.join("mono")).unwrap();
    let name = "rollout-2026-10-13T00-00-00-thread.jsonl";
    let original = home.join(name);
    std::fs::write(&original, b"complete Mono-only history\n").unwrap();
    let expected = fingerprint(&original).unwrap();
    let root_archive = private_directory(&home, ".monocode-conflicts").unwrap();
    let canonical = private_directory(&root_archive, &format!("rollout-{expected}"))
        .unwrap()
        .join(name);
    std::fs::write(&canonical, b"unfamiliar partial").unwrap();
    let id = entry_identity(&canonical).unwrap();
    let saved = archive_file(
        &home,
        name,
        &mut std::fs::File::open(&original).unwrap(),
        &expected,
    )
    .expect("An unfamiliar partial dedupe archive must not permanently block retry");
    assert_ne!(saved, canonical);
    assert_eq!(fingerprint(&saved).unwrap(), expected);
    assert_eq!(entry_identity(&canonical).unwrap(), id);
    assert_eq!(std::fs::read(&canonical).unwrap(), b"unfamiliar partial");
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn cc0k_both_source_orders_resume_distinct_threads_and_keep_original_bytes() {
    for first in ["desktop", "orca"] {
        let root =
            std::env::temp_dir().join(format!("monocode-cc0k-orders-{}", uuid::Uuid::new_v4()));
        let (a, home) = storage_roots(&root.join(first), &root.join("mono")).unwrap();
        let b = root.join(if first == "desktop" {
            "orca"
        } else {
            "desktop"
        });
        std::fs::create_dir(&b).unwrap();
        let b = b.canonicalize().unwrap();
        source_binding::ensure(&a, &home, false).unwrap();
        let separate = source_binding::selected_home(&b, &home, true).unwrap();
        let mut threads = HashMap::new();
        let mut current = None;
        let mut previous = None;
        for (source, expected_home, thread) in [
            (&a, &home, "thread_a"),
            (&b, &separate, "thread_b"),
            (&a, &home, "thread_a"),
            (&b, &separate, "thread_b"),
        ] {
            let selected = source_binding::selected_home(source, &home, false).unwrap();
            assert_eq!(&selected, expected_home);
            let resumed = source_binding::session_thread(
                &selected,
                &home,
                previous.as_deref(),
                current.clone(),
                &threads,
            )
            .unwrap();
            if threads.contains_key(&crate::fs::path_to_js(expected_home)) {
                assert_eq!(resumed.as_deref(), Some(thread));
            } else {
                assert!(resumed.is_none());
            }
            let transcript = selected.join(format!("{thread}.jsonl"));
            if !transcript.exists() {
                std::fs::write(&transcript, format!("Mono-only {thread} turns")).unwrap();
            }
            assert_eq!(
                std::fs::read_to_string(&transcript).unwrap(),
                format!("Mono-only {thread} turns")
            );
            current = Some(thread.to_owned());
            previous = Some(crate::fs::path_to_js(&selected));
            threads.insert(previous.clone().unwrap(), thread.to_owned());
            // The native selection state is entirely on disk; emulate a fresh process map reload.
            threads = serde_json::from_slice(&serde_json::to_vec(&threads).unwrap()).unwrap();
        }
        assert_eq!(
            source_binding::selected_home(&a, &home, true).unwrap(),
            home
        );
        assert!(source_binding::session_thread(
            &separate,
            &home,
            None,
            Some("legacy_unknown".into()),
            &HashMap::new()
        )
        .unwrap()
        .is_none());
        std::fs::remove_dir_all(root).unwrap();
    }
}

#[test]
fn cc0k_recreated_source_reattaches_exact_original_and_contexts_under_exclusive_leases() {
    let root =
        std::env::temp_dir().join(format!("monocode-cc0k-reattach-{}", uuid::Uuid::new_v4()));
    let (source, home) = storage_roots(&root.join("source"), &root.join("mono")).unwrap();
    source_binding::ensure(&source, &home, false).unwrap();
    let context = private_directory(
        &private_directory(&home, ".monocode-skill-contexts").unwrap(),
        &"a".repeat(64),
    )
    .unwrap();
    source_binding::ensure_context(&source, &home, &context).unwrap();
    let binding = home.join(".monocode-source.json");
    let key = format!("cli|{}", home_key(&home).unwrap());
    credential_namespace::own_new_copy(&source, &home, "Codex Auth", &key).unwrap();
    let namespace = home.join(".monocode-credential-owner-cli.json");
    let namespace_bytes = std::fs::read(&namespace).unwrap();
    let namespace_identity = entry_identity(&namespace).unwrap();
    let bytes = std::fs::read(&binding).unwrap();
    let identity = entry_identity(&binding).unwrap();
    std::fs::write(home.join("history.jsonl"), b"private original history").unwrap();
    let old = entry_identity(&source).unwrap();
    std::fs::rename(&source, root.join("old-source")).unwrap();
    std::fs::create_dir(&source).unwrap();
    assert!(source_binding::ensure(&source, &home, false).is_err());
    let selected = crate::fs::path_to_js(&source);
    let new = entry_identity(&source).unwrap();
    assert!(source_binding::reattach_home(
        &source,
        &home,
        &selected,
        &format!("{}:{}", old.0, old.1)
    )
    .is_err());
    let lease = credential_lifetime::ContextLease::acquire(&context).unwrap();
    assert!(source_binding::reattach_home(
        &source,
        &home,
        &selected,
        &format!("{}:{}", new.0, new.1)
    )
    .is_err());
    drop(lease);
    assert_eq!(
        source_binding::reattach_home(&source, &home, &selected, &format!("{}:{}", new.0, new.1))
            .unwrap(),
        home
    );
    source_binding::ensure_context(&source, &home, &context).unwrap();
    source_binding::guard_bound_contexts(&home).unwrap();
    assert_eq!(
        source_binding::selected_home(&source, &home, false).unwrap(),
        home
    );
    assert_eq!(std::fs::read(&binding).unwrap(), bytes);
    assert_eq!(entry_identity(&binding).unwrap(), identity);
    assert_eq!(std::fs::read(&namespace).unwrap(), namespace_bytes);
    assert_eq!(entry_identity(&namespace).unwrap(), namespace_identity);
    assert_eq!(
        std::fs::read(home.join("history.jsonl")).unwrap(),
        b"private original history"
    );
    let other = root.join("foreign");
    std::fs::create_dir(&other).unwrap();
    let id = entry_identity(&other).unwrap();
    assert!(source_binding::reattach_home(
        &other,
        &home,
        &crate::fs::path_to_js(&other.canonicalize().unwrap()),
        &format!("{}:{}", id.0, id.1)
    )
    .is_err());
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn cc0k_archive_dedupe_foreign_link_and_racing_publication_preserve_identity() {
    for control in ["dedupe", "foreign", "race"] {
        let root = std::env::temp_dir().join(format!(
            "monocode-cc0k-archive-{control}-{}",
            uuid::Uuid::new_v4()
        ));
        let (_, home) = storage_roots(&root.join("source"), &root.join("mono")).unwrap();
        let name = "rollout-2026-10-13T00-00-00-thread.jsonl";
        let original = home.join(name);
        std::fs::write(&original, b"complete private turns").unwrap();
        let expected = fingerprint(&original).unwrap();
        let canonical = private_directory(
            &private_directory(&home, ".monocode-conflicts").unwrap(),
            &format!("rollout-{expected}"),
        )
        .unwrap()
        .join(name);
        let foreign = root.join("foreign");
        std::fs::write(&foreign, b"foreign partial bytes").unwrap();
        if control == "foreign" {
            create_link(&foreign, &canonical).unwrap();
        }
        if control == "race" {
            BEFORE_ARCHIVE_PUBLISH.with(|hook| {
                *hook.borrow_mut() = Some(Box::new(|path| {
                    std::fs::write(path, b"racing publisher").unwrap();
                }))
            });
        }
        let saved = archive_file(
            &home,
            name,
            &mut std::fs::File::open(&original).unwrap(),
            &expected,
        )
        .unwrap();
        assert_eq!(fingerprint(&saved).unwrap(), expected);
        if control == "dedupe" {
            let id = entry_identity(&saved).unwrap();
            assert_eq!(
                archive_file(
                    &home,
                    name,
                    &mut std::fs::File::open(&original).unwrap(),
                    &expected
                )
                .unwrap(),
                saved
            );
            assert_eq!(entry_identity(&saved).unwrap(), id);
        } else {
            assert_ne!(saved, canonical);
            assert_eq!(
                std::fs::read(&canonical).unwrap(),
                if control == "foreign" {
                    b"foreign partial bytes".as_slice()
                } else {
                    b"racing publisher".as_slice()
                }
            );
            assert_eq!(std::fs::read(&foreign).unwrap(), b"foreign partial bytes");
        }
        std::fs::remove_dir_all(root).unwrap();
    }
}

#[test]
fn cc0k_real_archive_kills_restart_migration_keep_private_and_resolve() {
    let name = "rollout-2026-10-13T00-00-00-thread.jsonl";
    for operation in ["cc0k-migrate", "cc0k-keep-private", "cc0k-resolve"] {
        for point in ["archive-created-before-copy", "archive-copy-before-sync"] {
            let fixture = crash_tests::Fixture::new(&format!("cc0k-{operation}-{point}"));
            let source = fixture.source();
            let home = fixture.home();
            let source_day = source.join("sessions/2026/10/13");
            let mono_day = home.join("sessions/2026/10/13");
            std::fs::create_dir_all(&source_day).unwrap();
            std::fs::create_dir_all(&mono_day).unwrap();
            let incoming = b"{\"type\":\"session_meta\",\"payload\":{\"id\":\"thread\"}}\n";
            let private=b"{\"type\":\"session_meta\",\"payload\":{\"id\":\"thread\"}}\nMono-only continuation\n";
            let source_file = if operation == "cc0k-resolve" {
                source.join(name)
            } else {
                source_day.join(name)
            };
            let mono_file = if operation == "cc0k-resolve" {
                home.join(name)
            } else {
                mono_day.join(name)
            };
            std::fs::write(&source_file, incoming).unwrap();
            std::fs::write(&mono_file, private).unwrap();
            let mono_id = entry_identity(&mono_file).unwrap();
            let source_id = entry_identity(&source_file).unwrap();
            if operation == "cc0k-keep-private" {
                let error = migration_recovery::retain_private(
                    &home,
                    &source_file,
                    &mono_file,
                    &source_file,
                )
                .unwrap_err();
                let value: serde_json::Value = serde_json::from_str(&error).unwrap();
                std::fs::write(
                    fixture.0.join("choice.json"),
                    serde_json::to_vec(&value["migration"]).unwrap(),
                )
                .unwrap();
            }
            fixture.kill_at_skip(operation, name, point, 0);
            assert_eq!(entry_identity(&source_file).unwrap(), source_id);
            let retry = fixture.run(operation, name, "restart");
            if operation == "cc0k-migrate" {
                let issue: serde_json::Value = serde_json::from_str(&retry.unwrap_err()).unwrap();
                assert!(issue["migration"].is_object());
                std::fs::write(
                    fixture.0.join("choice.json"),
                    serde_json::to_vec(&issue["migration"]).unwrap(),
                )
                .unwrap();
                fixture
                    .run("cc0k-keep-private", name, "keep-after-restart")
                    .unwrap();
                fixture
                    .run(operation, name, "retry-after-confirmation")
                    .unwrap();
            } else {
                retry.unwrap();
            }
            if operation != "cc0k-resolve" {
                assert_eq!(std::fs::read(&mono_file).unwrap(), private);
                assert_eq!(entry_identity(&mono_file).unwrap(), mono_id);
            } else {
                assert_eq!(std::fs::read(&mono_file).unwrap(), incoming);
            }
            println!(
                "CC0K_KILL {}",
                serde_json::json!({"fixture":crate::fs::path_to_js(&fixture.0),"operation":operation,"point":point,"sourceIdentity":source_id,"privateIdentity":mono_id,"recovered":true})
            );
        }
    }
}

#[test]
fn cc0k_keep_private_refuses_original_or_private_replacement_during_archive_publication() {
    for replace in ["source", "mono"] {
        let root = std::env::temp_dir().join(format!(
            "monocode-cc0k-replacement-{replace}-{}",
            uuid::Uuid::new_v4()
        ));
        let (source, home) = storage_roots(&root.join("source"), &root.join("mono")).unwrap();
        let name = "rollout-2026-10-13T00-00-00-thread.jsonl";
        let source_day = source.join("sessions/2026/10/13");
        let mono_day = home.join("sessions/2026/10/13");
        std::fs::create_dir_all(&source_day).unwrap();
        std::fs::create_dir_all(&mono_day).unwrap();
        let source_file = source_day.join(name);
        let mono_file = mono_day.join(name);
        std::fs::write(&source_file, b"incoming original").unwrap();
        std::fs::write(&mono_file, b"Mono-only original").unwrap();
        let error =
            migration_recovery::retain_private(&home, &source_file, &mono_file, &source_file)
                .unwrap_err();
        let value: serde_json::Value = serde_json::from_str(&error).unwrap();
        let choice = serde_json::from_value(value["migration"].clone()).unwrap();
        let source_id = entry_identity(&source_file).unwrap();
        let mono_id = entry_identity(&mono_file).unwrap();
        let raced = if replace == "source" {
            source_file.clone()
        } else {
            mono_file.clone()
        };
        let old = raced.with_extension("old");
        let old_check = old.clone();
        BEFORE_ARCHIVE_PUBLISH.with(|hook| {
            *hook.borrow_mut() = Some(Box::new(move |_| {
                std::fs::rename(&raced, &old).unwrap();
                std::fs::write(&raced, b"unfamiliar replacement").unwrap();
            }))
        });
        assert!(migration_recovery::keep(&source, &home, &choice)
            .unwrap_err()
            .contains("History changed during confirmation"));
        let replaced = if replace == "source" {
            &source_file
        } else {
            &mono_file
        };
        assert_eq!(std::fs::read(replaced).unwrap(), b"unfamiliar replacement");
        assert_eq!(
            entry_identity(&old_check).unwrap(),
            if replace == "source" {
                source_id
            } else {
                mono_id
            }
        );
        assert_eq!(
            std::fs::read_dir(home.join(".monocode-migration-choices"))
                .unwrap()
                .count(),
            0
        );
        std::fs::remove_dir_all(root).unwrap();
    }
}
