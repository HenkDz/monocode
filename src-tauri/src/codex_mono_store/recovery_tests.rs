use super::*;
use std::cell::RefCell;

#[test]
fn cc0j_divergent_source_owned_mirrors_prepare_without_source_writeback() {
    let root = std::env::temp_dir().join(format!("monocode-cc0j-mirrors-{}", uuid::Uuid::new_v4()));
    let (source, home) = storage_roots(&root.join("source"), &root.join("mono")).unwrap();
    std::fs::create_dir_all(source.join("secrets")).unwrap();
    std::fs::write(
        source.join("secrets/encrypted"),
        b"synthetic encrypted fixture",
    )
    .unwrap();
    let source_hash = home_key(&source).unwrap();
    let private_hash = home_key(&home).unwrap();
    let writes = RefCell::new(Vec::new());
    let mirrors = prepare_keyring_with(
        &source,
        &home,
        |service, key| {
            assert_eq!(service, "codex");
            Ok(Some(
                if key.contains(&source_hash) {
                    "synthetic source"
                } else {
                    "synthetic private refresh"
                }
                .into(),
            ))
        },
        |service, key, value| {
            assert_eq!(service, "codex");
            assert!(key.contains(&private_hash));
            assert_eq!(value, "synthetic source");
            writes.borrow_mut().push(key.to_owned());
            Ok(())
        },
    )
    .expect("Source-owned divergent mirrors must prepare");
    assert_eq!(mirrors.len(), 2);
    assert_eq!(writes.borrow().len(), 2);
    assert!(mirrors.iter().all(|mirror| mirror.service == "codex"));
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn cc0j_source_mismatch_offers_a_separate_home_without_touching_the_original() {
    let root = std::env::temp_dir().join(format!("monocode-cc0j-source-{}", uuid::Uuid::new_v4()));
    let (source, home) = storage_roots(&root.join("source"), &root.join("mono")).unwrap();
    let other = root.join("other");
    std::fs::create_dir_all(&other).unwrap();
    source_binding::ensure(&source, &home, false).unwrap();
    std::fs::write(home.join("private.jsonl"), b"private turns").unwrap();
    let binding = std::fs::read(home.join(".monocode-source.json")).unwrap();
    let error = source_binding::ensure(&other, &home, false).unwrap_err();
    let value: serde_json::Value = serde_json::from_str(&error).unwrap();
    assert_eq!(
        value["sourceBinding"]["canSeparate"], true,
        "Mismatch must have an in-app safe recovery choice"
    );
    assert_eq!(
        std::fs::read(home.join(".monocode-source.json")).unwrap(),
        binding
    );
    assert_eq!(
        std::fs::read(home.join("private.jsonl")).unwrap(),
        b"private turns"
    );
    assert_eq!(
        source_binding::selected_home(&other, &home, false).unwrap(),
        home
    );
    let separate = source_binding::selected_home(&other, &home, true).unwrap();
    let separate_binding = std::fs::read(separate.join(".monocode-source.json")).unwrap();
    let old_source_identity = entry_identity(&other).unwrap();
    assert_ne!(separate, home);
    prepare_files(&other, &separate).unwrap();
    assert_eq!(
        source_binding::selected_home(&other, &home, false).unwrap(),
        separate
    );
    assert_eq!(
        source_binding::selected_home(&source, &home, false).unwrap(),
        home
    );
    assert!(source_binding::check_session_home(
        &other,
        &separate,
        Some(&crate::fs::path_to_js(&home))
    )
    .is_err());
    source_binding::check_session_home(&other, &separate, Some(&crate::fs::path_to_js(&separate)))
        .unwrap();
    // Rename keeps the old identity allocated, so recreating cannot reuse its inode.
    std::fs::rename(&other, root.join("old-other")).unwrap();
    std::fs::create_dir_all(&other).unwrap();
    let recreated_issue = source_binding::ensure(&other, &separate, false).unwrap_err();
    let recreated_issue: serde_json::Value = serde_json::from_str(&recreated_issue).unwrap();
    assert_eq!(recreated_issue["sourceBinding"]["canSeparate"], true);
    assert!(source_binding::confirm_home(
        &other,
        &home,
        &crate::fs::path_to_js(&other.canonicalize().unwrap()),
        &format!("{}:{}", old_source_identity.0, old_source_identity.1)
    )
    .is_err());
    assert_eq!(
        source_binding::selected_home(&other, &home, false).unwrap(),
        home
    );
    let recreated = source_binding::selected_home(&other, &home, true).unwrap();
    assert_ne!(recreated, separate);
    assert_eq!(
        std::fs::read(separate.join(".monocode-source.json")).unwrap(),
        separate_binding
    );
    prepare_files(&other, &recreated).unwrap();
    assert_eq!(
        source_binding::selected_home(&other, &home, false).unwrap(),
        recreated
    );
    assert_eq!(
        std::fs::read(home.join(".monocode-source.json")).unwrap(),
        binding
    );
    assert_eq!(
        std::fs::read(home.join("private.jsonl")).unwrap(),
        b"private turns"
    );
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn cc0j_separate_home_refuses_active_managed_contexts() {
    let root = std::env::temp_dir().join(format!("monocode-cc0j-active-{}", uuid::Uuid::new_v4()));
    let (source, home) = storage_roots(&root.join("source"), &root.join("mono")).unwrap();
    source_binding::ensure(&source, &home, false).unwrap();
    let lease = credential_lifetime::ContextLease::acquire(&home).unwrap();
    assert!(source_binding::selected_home(&source, &home, true).is_err());
    drop(lease);
    source_binding::selected_home(&source, &home, true).unwrap();
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn cc0j_interrupted_account_config_link_is_replaceable_without_private_byte_loss() {
    let root = std::env::temp_dir().join(format!("monocode-cc0j-link-{}", uuid::Uuid::new_v4()));
    let (source, home) = storage_roots(&root.join("source"), &root.join("mono")).unwrap();
    std::fs::write(source.join("config.toml"), b"model='source'").unwrap();
    std::fs::write(home.join("config.toml"), b"model='private'").unwrap();
    std::fs::write(source.join("AGENTS.md"), b"source instructions").unwrap();
    std::fs::write(home.join("AGENTS.md"), b"private instructions").unwrap();
    write_snapshot(
        &home,
        "AGENTS.md",
        &LinkSnapshot {
            fingerprint: fingerprint(&home.join("AGENTS.md")).unwrap(),
            private_override: true,
            invalid: false,
        },
    )
    .unwrap();
    let context = private_directory(
        &private_directory(&home, ".monocode-skill-contexts").unwrap(),
        &"a".repeat(64),
    )
    .unwrap();
    create_link(&source.join("config.toml"), &context.join("config.toml")).unwrap();
    create_link(&source.join("AGENTS.md"), &context.join("AGENTS.md")).unwrap();
    prepare_files_with_state_locked(&source, &context, Some(&home))
        .expect("An account-target link owns no private bytes");
    assert_eq!(
        std::fs::read(context.join("config.toml")).unwrap(),
        b"model='private'"
    );
    assert_eq!(
        std::fs::read(source.join("config.toml")).unwrap(),
        b"model='source'"
    );
    assert_eq!(
        std::fs::read(context.join("AGENTS.md")).unwrap(),
        b"private instructions"
    );
    assert_eq!(
        std::fs::read(source.join("AGENTS.md")).unwrap(),
        b"source instructions"
    );
    prepare_files_with_state_locked(&source, &context, Some(&home)).unwrap();
    let foreign = root.join("foreign.toml");
    std::fs::write(&foreign, b"foreign private bytes").unwrap();
    remove_link(&context.join("config.toml")).unwrap();
    create_link(&foreign, &context.join("config.toml")).unwrap();
    assert!(prepare_files_with_state_locked(&source, &context, Some(&home)).is_err());
    assert_eq!(std::fs::read(&foreign).unwrap(), b"foreign private bytes");
    remove_link(&context.join("config.toml")).unwrap();
    std::fs::write(context.join("config.toml"), b"real private bytes").unwrap();
    assert!(prepare_files_with_state_locked(&source, &context, Some(&home)).is_err());
    assert_eq!(
        std::fs::read(context.join("config.toml")).unwrap(),
        b"real private bytes"
    );
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn cc0j_account_link_upgrade_preserves_a_racing_real_private_file() {
    let root =
        std::env::temp_dir().join(format!("monocode-cc0j-link-race-{}", uuid::Uuid::new_v4()));
    let (source, home) = storage_roots(&root.join("source"), &root.join("mono")).unwrap();
    std::fs::write(source.join("config.toml"), b"source").unwrap();
    std::fs::write(home.join("config.toml"), b"private").unwrap();
    let target = root.join("context.toml");
    create_link(&source.join("config.toml"), &target).unwrap();
    let raced = target.clone();
    BEFORE_CLAIM.with(|hook| {
        *hook.borrow_mut() = Some(Box::new(move || {
            remove_link(&raced).unwrap();
            std::fs::write(&raced, b"late private bytes").unwrap();
        }))
    });
    assert!(link_context_private(
        &home.join("config.toml"),
        &target,
        &source.join("config.toml")
    )
    .is_err());
    assert_eq!(std::fs::read(&target).unwrap(), b"late private bytes");
    assert_eq!(
        std::fs::read(source.join("config.toml")).unwrap(),
        b"source"
    );
    std::fs::remove_dir_all(root).unwrap();
}
