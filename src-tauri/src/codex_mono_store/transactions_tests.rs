use super::*;
use transactions::RecordedEntry;

const PRIVATE: &[u8] = b"Synthetic private instructions; preserve these bytes";
const ACCOUNT: &[u8] = b"Synthetic account instructions";

struct TransactionFixture {
    root: PathBuf,
    source: PathBuf,
    home: PathBuf,
    original: PathBuf,
    claim: PathBuf,
    staged: PathBuf,
    journal_path: PathBuf,
    journal: ClaimJournal,
}

impl TransactionFixture {
    fn new(intent: ClaimIntent) -> Self {
        let root = std::env::temp_dir().join(format!(
            "monocode-cc0g-transactions-{}",
            uuid::Uuid::new_v4()
        ));
        let (source, home) = storage_roots(&root.join("account"), &root.join("mono")).unwrap();
        let root = root.canonicalize().unwrap();
        let original = home.join("AGENTS.md");
        let id = uuid::Uuid::new_v4();
        let claim = home.join(format!(".monocode-claim-{id}"));
        let staged = home.join(format!(".monocode-link-{}", uuid::Uuid::new_v4()));
        let journal_path = home.join(format!(".monocode-txn-{id}.json"));
        std::fs::write(source.join("AGENTS.md"), ACCOUNT).unwrap();
        std::fs::write(&original, PRIVATE).unwrap();
        create_link(&source.join("AGENTS.md"), &staged).unwrap();
        let staged_record = transactions::RecordedEntry::new(&staged).unwrap();
        let journal = ClaimJournal::new(
            &original,
            &claim,
            intent,
            Some(&staged_record),
            entry_identity(&original).unwrap(),
        )
        .unwrap();
        Self {
            root,
            source,
            home,
            original,
            claim,
            staged,
            journal_path,
            journal,
        }
    }

    fn claim(&self) {
        publish_new_entry(&self.original, &self.claim).unwrap();
    }

    fn assert_blocked(&self) -> serde_json::Value {
        let error = prepare_files(&self.source, &self.home).unwrap_err();
        let conflict: serde_json::Value = serde_json::from_str(&error).unwrap();
        assert_eq!(conflict["recovery"], true, "{error}");
        assert!(self.journal_path.exists());
        assert_eq!(
            std::fs::read(self.source.join("AGENTS.md")).unwrap(),
            ACCOUNT
        );
        conflict
    }

    fn change_journal(&self, change: impl FnOnce(&mut serde_json::Value)) {
        let mut value =
            serde_json::from_slice(&std::fs::read(&self.journal_path).unwrap()).unwrap();
        change(&mut value);
        std::fs::write(&self.journal_path, serde_json::to_vec(&value).unwrap()).unwrap();
    }
}

#[test]
fn recovery_preserves_legacy_claims_in_both_storage_locations() {
    for metadata in [false, true] {
        let fixture = TransactionFixture::new(ClaimIntent::Keep);
        fixture.journal.finish().unwrap();
        let directory = if metadata {
            private_directory(&fixture.home, ".monocode-links").unwrap()
        } else {
            fixture.home.clone()
        };
        let legacy = directory.join(format!(".monocode-claim-{}", uuid::Uuid::new_v4()));
        std::fs::write(&legacy, PRIVATE).unwrap();
        let error = prepare_files(&fixture.source, &fixture.home).unwrap_err();
        let conflict: serde_json::Value = serde_json::from_str(&error).unwrap();
        assert_eq!(conflict["recovery"], true);
        assert_eq!(
            conflict["paths"],
            serde_json::json!([crate::fs::path_to_js(&legacy)])
        );
        assert_eq!(std::fs::read(&legacy).unwrap(), PRIVATE);
        assert_eq!(std::fs::read(&fixture.original).unwrap(), PRIVATE);
    }
}

#[test]
fn recovery_preserves_a_claim_and_a_recreated_original() {
    let fixture = TransactionFixture::new(ClaimIntent::Keep);
    fixture.claim();
    std::fs::write(&fixture.original, b"Concurrent private instructions").unwrap();
    fixture.assert_blocked();
    assert_eq!(std::fs::read(&fixture.claim).unwrap(), PRIVATE);
    assert_eq!(
        std::fs::read(&fixture.original).unwrap(),
        b"Concurrent private instructions"
    );
    assert!(std::fs::symlink_metadata(&fixture.staged).is_ok());
}

#[test]
fn recovery_does_not_clean_a_replaced_staged_entry() {
    let fixture = TransactionFixture::new(ClaimIntent::Keep);
    remove_link(&fixture.staged).unwrap();
    std::fs::write(&fixture.staged, b"Concurrent staged-path file").unwrap();
    fixture.assert_blocked();
    assert_eq!(
        std::fs::read(&fixture.staged).unwrap(),
        b"Concurrent staged-path file"
    );
    assert_eq!(std::fs::read(&fixture.original).unwrap(), PRIVATE);
}

#[test]
fn hook_isolation_preserves_a_stage_replaced_before_the_claim() {
    let fixture = TransactionFixture::new(ClaimIntent::Keep);
    fixture.journal.finish().unwrap();
    let hooks = fixture.source.join("hooks.json");
    let original = fixture.home.join("hooks.json");
    std::fs::write(&hooks, b"Synthetic linked hooks to preserve").unwrap();
    create_link(&hooks, &original).unwrap();
    let home = fixture.home.clone();
    let staged_path = std::sync::Arc::new(Mutex::new(None));
    let changed = staged_path.clone();
    BEFORE_CLAIM.with(|hook| {
        *hook.borrow_mut() = Some(Box::new(move || {
            let staged = std::fs::read_dir(&home)
                .unwrap()
                .map(|entry| entry.unwrap().path())
                .find(|path| {
                    path.file_name()
                        .unwrap()
                        .to_string_lossy()
                        .starts_with(".monocode-link-")
                })
                .unwrap();
            std::fs::remove_file(&staged).unwrap();
            std::fs::write(&staged, b"Concurrent staged-path file").unwrap();
            *changed.lock().unwrap() = Some(staged);
        }));
    });
    assert!(prepare_isolated_hooks(&fixture.home).is_err());
    let staged = staged_path.lock().unwrap().clone().unwrap();
    assert_eq!(
        std::fs::read(staged).unwrap(),
        b"Concurrent staged-path file"
    );
    assert_eq!(
        std::fs::read(&original).unwrap(),
        b"Synthetic linked hooks to preserve"
    );
    assert!(same_entry(&hooks, &original));
    let error = prepare_files(&fixture.source, &fixture.home).unwrap_err();
    let conflict: serde_json::Value = serde_json::from_str(&error).unwrap();
    assert_eq!(conflict["recovery"], true);
}

#[test]
fn a_legacy_corrupt_sibling_requires_an_explicit_choice_without_a_journal() {
    for resolution in [
        StorageResolution::KeepMonoVersion,
        StorageResolution::UseAccountVersion,
    ] {
        let fixture = TransactionFixture::new(ClaimIntent::Keep);
        fixture.journal.finish().unwrap();
        std::fs::remove_file(&fixture.original).unwrap();
        std::fs::remove_file(fixture.source.join("AGENTS.md")).unwrap();
        let hooks = fixture.home.join("hooks.json");
        let account_hooks = fixture.source.join("hooks.json");
        std::fs::write(&hooks, br#"{"hooks":{}}"#).unwrap();
        std::fs::write(
            &account_hooks,
            br#"{"hooks":{"Stop":[{"command":"synthetic-command"}]}}"#,
        )
        .unwrap();
        set_hooks_shared(&fixture.home, true).unwrap();
        let snapshot = snapshot_path(&fixture.home, "hooks.json").unwrap();
        let corrupt =
            snapshot.with_file_name(format!("hooks.json.json.corrupt-{}", uuid::Uuid::new_v4()));
        std::fs::write(&corrupt, b"{invalid-legacy-snapshot").unwrap();
        let error = prepare_files(&fixture.source, &fixture.home).unwrap_err();
        let conflict: StorageConflict = serde_json::from_str(&error).unwrap();
        assert_eq!(conflict.entry, "hooks.json");
        assert_eq!(std::fs::read(&hooks).unwrap(), br#"{"hooks":{}}"#);
        assert!(
            read_snapshot(&fixture.home, "hooks.json")
                .unwrap()
                .unwrap()
                .invalid
        );
        resolve_files(&fixture.source, &fixture.home, &conflict, resolution).unwrap();
        prepare_files(&fixture.source, &fixture.home).unwrap();
        assert!(
            !read_snapshot(&fixture.home, "hooks.json")
                .unwrap()
                .unwrap()
                .invalid
        );
        assert_eq!(
            std::fs::read(&corrupt).unwrap(),
            b"{invalid-legacy-snapshot"
        );
    }
}

#[test]
fn recovery_rejects_invalid_original_and_staged_paths() {
    for field in ["entry", "staged"] {
        let fixture = TransactionFixture::new(ClaimIntent::Keep);
        fixture.claim();
        let outside = fixture.root.join("outside-private");
        std::fs::write(&outside, b"Outside transaction storage").unwrap();
        fixture.change_journal(|value| {
            if field == "entry" {
                value["entry"] = serde_json::json!("../outside-private");
            } else {
                value["staged"]["name"] = serde_json::json!("../outside-private");
            }
        });
        fixture.assert_blocked();
        assert_eq!(std::fs::read(&fixture.claim).unwrap(), PRIVATE);
        assert_eq!(
            std::fs::read(outside).unwrap(),
            b"Outside transaction storage"
        );
        assert!(!fixture.original.exists());
    }
}

#[test]
fn recovery_rejects_a_hardlinked_journal() {
    let fixture = TransactionFixture::new(ClaimIntent::Keep);
    fixture.claim();
    let alias = fixture.root.join("journal-alias.json");
    std::fs::hard_link(&fixture.journal_path, &alias).unwrap();
    let bytes = std::fs::read(&alias).unwrap();
    fixture.assert_blocked();
    assert_eq!(std::fs::read(&alias).unwrap(), bytes);
    assert_eq!(std::fs::read(&fixture.claim).unwrap(), PRIVATE);
}

#[test]
fn recovery_rejects_a_relink_journal_for_a_real_private_claim() {
    let mut fixture = TransactionFixture::new(ClaimIntent::Relink);
    fixture.claim();
    fixture.journal.verify(None).unwrap();
    publish_new_entry(&fixture.staged, &fixture.original).unwrap();
    fixture.assert_blocked();
    assert_eq!(std::fs::read(&fixture.claim).unwrap(), PRIVATE);
    assert_eq!(std::fs::read(&fixture.original).unwrap(), ACCOUNT);
}

#[test]
fn recovery_rejects_corrupt_snapshot_intent_outside_private_metadata() {
    let fixture = TransactionFixture::new(ClaimIntent::CorruptSnapshot {
        preserved: format!("AGENTS.md.corrupt-{}", uuid::Uuid::new_v4()),
    });
    fixture.claim();
    fixture.assert_blocked();
    assert_eq!(std::fs::read(&fixture.claim).unwrap(), PRIVATE);
    assert!(!fixture.original.exists());
}

#[test]
fn recovery_preserves_claims_when_an_archive_is_changed_or_escapes_storage() {
    for escape in [false, true] {
        let mut fixture = TransactionFixture::new(ClaimIntent::UseAccount);
        fixture.claim();
        let archive_root = private_directory(&fixture.home, ".monocode-conflicts").unwrap();
        let directory = archive_root.join(format!("test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&directory).unwrap();
        let archive = directory.join("AGENTS.md");
        std::fs::write(&archive, PRIVATE).unwrap();
        fixture.journal.verify(Some(&archive)).unwrap();
        publish_new_entry(&fixture.staged, &fixture.original).unwrap();
        if escape {
            let outside = fixture.root.join("outside-private");
            std::fs::write(&outside, PRIVATE).unwrap();
            fixture.change_journal(|value| value["archive"] = serde_json::json!(outside));
        } else {
            std::fs::write(&archive, b"Changed archive bytes").unwrap();
        }
        fixture.assert_blocked();
        assert_eq!(std::fs::read(&fixture.claim).unwrap(), PRIVATE);
        assert_eq!(std::fs::read(&fixture.original).unwrap(), ACCOUNT);
        assert!(archive.exists());
    }
}

#[test]
fn hook_clone_recovery_cleans_only_the_recorded_staging_file() {
    for completed in [false, true] {
        let fixture = TransactionFixture::new(ClaimIntent::Keep);
        fixture.journal.finish().unwrap();
        let staged = fixture
            .home
            .join(format!(".monocode-link-{}", uuid::Uuid::new_v4()));
        std::fs::write(&staged, b"").unwrap();
        let record = RecordedEntry::new(&staged).unwrap();
        let mut journal =
            ClaimJournal::clone_hooks(&fixture.home.join("hooks.json"), &record).unwrap();
        std::fs::write(&staged, b"Synthetic partial or complete clone").unwrap();
        if completed {
            journal.verify_clone(&staged).unwrap();
        }
        let unrelated = [b"".as_slice(), b"Unfamiliar file to preserve".as_slice()].map(|bytes| {
            let path = fixture
                .home
                .join(format!(".monocode-link-{}", uuid::Uuid::new_v4()));
            std::fs::write(&path, bytes).unwrap();
            (path, bytes)
        });
        transactions::reconcile(&fixture.home).unwrap();
        assert!(!staged.exists());
        for (path, bytes) in unrelated {
            assert_eq!(std::fs::read(path).unwrap(), bytes);
        }
    }
}

#[test]
fn hook_clone_recovery_preserves_replaced_or_modified_staging_files() {
    for replaced in [false, true] {
        let fixture = TransactionFixture::new(ClaimIntent::Keep);
        fixture.journal.finish().unwrap();
        let staged = fixture
            .home
            .join(format!(".monocode-link-{}", uuid::Uuid::new_v4()));
        std::fs::write(&staged, PRIVATE).unwrap();
        let record = RecordedEntry::new(&staged).unwrap();
        let mut journal =
            ClaimJournal::clone_hooks(&fixture.home.join("hooks.json"), &record).unwrap();
        journal.verify_clone(&staged).unwrap();
        if replaced {
            std::fs::rename(&staged, fixture.root.join("preserved-original-stage")).unwrap();
        }
        std::fs::write(&staged, b"Unfamiliar replacement bytes").unwrap();
        assert!(transactions::reconcile(&fixture.home).is_err());
        assert_eq!(
            std::fs::read(&staged).unwrap(),
            b"Unfamiliar replacement bytes"
        );
    }
}

#[test]
fn hook_clone_recovery_preserves_a_racing_target_and_rejects_other_entries() {
    for name in ["hooks.json", "AGENTS.md"] {
        let fixture = TransactionFixture::new(ClaimIntent::Keep);
        fixture.journal.finish().unwrap();
        let staged = fixture
            .home
            .join(format!(".monocode-link-{}", uuid::Uuid::new_v4()));
        std::fs::write(&staged, PRIVATE).unwrap();
        let record = RecordedEntry::new(&staged).unwrap();
        let target = fixture.home.join(name);
        let mut journal = ClaimJournal::clone_hooks(&target, &record).unwrap();
        journal.verify_clone(&staged).unwrap();
        std::fs::write(&target, b"Unfamiliar target bytes").unwrap();
        assert!(transactions::reconcile(&fixture.home).is_err());
        assert_eq!(std::fs::read(&target).unwrap(), b"Unfamiliar target bytes");
        assert_eq!(std::fs::read(&staged).unwrap(), PRIVATE);
    }
}

#[test]
fn rollout_retention_rejects_other_entries_and_escaping_preserved_paths() {
    for entry in ["AGENTS.md", "sessions"] {
        let fixture = TransactionFixture::new(ClaimIntent::RetainRollouts {
            preserved: "../outside".into(),
        });
        fixture.change_journal(|value| value["entry"] = serde_json::json!(entry));
        fixture.assert_blocked();
        assert_eq!(std::fs::read(&fixture.original).unwrap(), PRIVATE);
    }
}

#[test]
fn journal_retirement_preserves_replacement_identity_and_changed_contents() {
    for (replace, valid) in [(true, false), (true, true), (false, true)] {
        let fixture = TransactionFixture::new(ClaimIntent::Keep);
        let mut bytes = std::fs::read(&fixture.journal_path).unwrap();
        if replace {
            std::fs::rename(
                &fixture.journal_path,
                fixture.root.join("owned-journal.json"),
            )
            .unwrap();
        }
        if valid {
            bytes.push(b' ');
        } else {
            bytes = b"{unfamiliar-authority".to_vec();
        }
        std::fs::write(&fixture.journal_path, &bytes).unwrap();
        let identity = entry_identity(&fixture.journal_path).unwrap();
        let error = fixture.journal.finish().unwrap_err();
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&error).unwrap()["recovery"],
            true
        );
        assert_eq!(std::fs::read(&fixture.journal_path).unwrap(), bytes);
        assert_eq!(entry_identity(&fixture.journal_path).unwrap(), identity);
        assert!(std::fs::symlink_metadata(&fixture.staged).is_ok());
        assert_eq!(std::fs::read(&fixture.original).unwrap(), PRIVATE);
        assert_eq!(
            std::fs::read(fixture.source.join("AGENTS.md")).unwrap(),
            ACCOUNT
        );
    }
}

#[test]
fn journal_retirement_keeps_a_valid_replacement_claim_labelled_after_restart() {
    let fixture = TransactionFixture::new(ClaimIntent::Keep);
    let mut value: serde_json::Value =
        serde_json::from_slice(&std::fs::read(&fixture.journal_path).unwrap()).unwrap();
    std::fs::rename(
        &fixture.journal_path,
        fixture.root.join("owned-journal.json"),
    )
    .unwrap();
    std::fs::write(&fixture.claim, b"Replacement private bytes").unwrap();
    value["claim"]["identity"] = serde_json::json!(entry_identity(&fixture.claim).unwrap());
    value["claim"]["fingerprint"] = serde_json::json!(fingerprint(&fixture.claim).unwrap());
    value["staged"] = serde_json::Value::Null;
    std::fs::write(&fixture.journal_path, serde_json::to_vec(&value).unwrap()).unwrap();
    assert!(fixture.journal.finish().is_err());
    for _ in 0..2 {
        fixture.assert_blocked();
    }
    assert_eq!(
        std::fs::read(&fixture.claim).unwrap(),
        b"Replacement private bytes"
    );
    assert_eq!(std::fs::read(&fixture.original).unwrap(), PRIVATE);
}

#[test]
fn journal_parser_accepts_exact_limit_and_preserves_over_limit_and_unknown_bytes() {
    for case in [
        "exact",
        "invalid-over",
        "whitespace-over",
        "invalid-tail",
        "truncated",
        "unknown-intent",
        "empty",
        "unknown-field",
    ] {
        let fixture = TransactionFixture::new(ClaimIntent::Keep);
        let mut bytes = std::fs::read(&fixture.journal_path).unwrap();
        match case {
            "exact" => bytes.resize(65536, b' '),
            "invalid-over" => {
                bytes.resize(65536, b' ');
                bytes.extend_from_slice(b"unknown trailing authority");
            }
            "whitespace-over" => bytes.resize(69632, b' '),
            "invalid-tail" => bytes.extend_from_slice(b"invalid"),
            "truncated" => {
                bytes.pop();
            }
            "unknown-intent" => {
                let mut value: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
                value["intent"] = serde_json::json!("future_unknown_intent");
                bytes = serde_json::to_vec(&value).unwrap();
            }
            "unknown-field" => {
                let mut value: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
                value["future_authority"] = serde_json::json!("preserve");
                bytes = serde_json::to_vec(&value).unwrap();
            }
            "empty" => bytes.clear(),
            _ => unreachable!(),
        }
        std::fs::write(&fixture.journal_path, &bytes).unwrap();
        let identity = entry_identity(&fixture.journal_path).unwrap();
        let modified = std::fs::metadata(&fixture.journal_path)
            .unwrap()
            .modified()
            .unwrap();
        if case == "exact" {
            let error = prepare_files(&fixture.source, &fixture.home).unwrap_err();
            let conflict: StorageConflict = serde_json::from_str(&error).unwrap();
            assert_eq!(conflict.entry, "AGENTS.md");
            assert!(!fixture.journal_path.exists());
        } else {
            for _ in 0..2 {
                fixture.assert_blocked();
            }
            assert_eq!(std::fs::read(&fixture.journal_path).unwrap(), bytes);
            assert_eq!(entry_identity(&fixture.journal_path).unwrap(), identity);
            assert_eq!(
                std::fs::metadata(&fixture.journal_path)
                    .unwrap()
                    .modified()
                    .unwrap(),
                modified
            );
        }
        assert_eq!(std::fs::read(&fixture.original).unwrap(), PRIVATE);
        assert_eq!(
            std::fs::read(fixture.source.join("AGENTS.md")).unwrap(),
            ACCOUNT
        );
    }
}

#[test]
fn incomplete_metadata_requires_a_current_choice_and_archives_exact_bytes_and_identity() {
    for suffix in [".json", ".json.pending", ".verified.json.pending"] {
        let fixture = TransactionFixture::new(ClaimIntent::Keep);
        fixture.journal.finish().unwrap();
        let path = fixture
            .home
            .join(format!(".monocode-txn-{}{suffix}", uuid::Uuid::new_v4()));
        let bytes = if suffix == ".json" {
            b"".as_slice()
        } else {
            b"{interrupted-metadata".as_slice()
        };
        std::fs::write(&path, bytes).unwrap();
        let identity = entry_identity(&path).unwrap();
        let modified = std::fs::metadata(&path).unwrap().modified().unwrap();
        let unrelated = fixture
            .home
            .join(format!(".monocode-link-{}", uuid::Uuid::new_v4()));
        std::fs::write(&unrelated, PRIVATE).unwrap();
        let mut metadata = None;
        for _ in 0..2 {
            let error = transactions::reconcile(&fixture.home).unwrap_err();
            let recovery: serde_json::Value = serde_json::from_str(&error).unwrap();
            metadata = Some(
                serde_json::from_value::<transactions::RecoveryMetadata>(
                    recovery["metadata"].clone(),
                )
                .unwrap(),
            );
        }
        let archived = transactions::preserve_metadata(&fixture.home, &metadata.unwrap()).unwrap();
        assert!(!path.exists());
        assert_eq!(entry_identity(&archived).unwrap(), identity);
        assert_eq!(std::fs::read(&archived).unwrap(), bytes);
        assert_eq!(
            std::fs::metadata(&archived).unwrap().modified().unwrap(),
            modified
        );
        for _ in 0..2 {
            transactions::reconcile(&fixture.home).unwrap();
        }
        let conflict = file_conflict(&fixture.source, &fixture.home, "AGENTS.md").unwrap();
        resolve_files(
            &fixture.source,
            &fixture.home,
            &conflict,
            StorageResolution::KeepMonoVersion,
        )
        .unwrap();
        prepare_files(&fixture.source, &fixture.home).unwrap();
        assert_eq!(std::fs::read(&fixture.original).unwrap(), PRIVATE);
        assert_eq!(std::fs::read(&unrelated).unwrap(), PRIVATE);
        assert_eq!(
            std::fs::read(fixture.source.join("AGENTS.md")).unwrap(),
            ACCOUNT
        );
    }
}

#[test]
fn incomplete_metadata_recovery_refuses_stale_linked_and_outside_authority() {
    for change in [
        "bytes",
        "identity",
        "hardlink",
        "outside",
        "nonempty-final",
        "directory-link",
        "archive-link",
    ] {
        let fixture = TransactionFixture::new(ClaimIntent::Keep);
        fixture.journal.finish().unwrap();
        let path = fixture.home.join(format!(
            ".monocode-txn-{}.json.pending",
            uuid::Uuid::new_v4()
        ));
        std::fs::write(&path, b"pending").unwrap();
        let recovery: serde_json::Value =
            serde_json::from_str(&transactions::reconcile(&fixture.home).unwrap_err()).unwrap();
        let mut value = recovery["metadata"].clone();
        match change {
            "bytes" => std::fs::write(&path, b"unfamiliar").unwrap(),
            "identity" => {
                std::fs::rename(&path, fixture.root.join("old-pending")).unwrap();
                std::fs::write(&path, b"pending").unwrap();
            }
            "hardlink" => std::fs::hard_link(&path, fixture.root.join("alias")).unwrap(),
            "outside" => {
                let outside = fixture.root.join(path.file_name().unwrap());
                std::fs::write(&outside, b"pending").unwrap();
                value["path"] = serde_json::json!(outside);
            }
            "nonempty-final" => {
                value["path"] = serde_json::json!(fixture.journal_path);
                std::fs::write(&fixture.journal_path, b"unfamiliar final authority").unwrap();
            }
            "directory-link" => {
                let alias = fixture.home.join("alias");
                #[cfg(windows)]
                junction::create(&fixture.root, &alias).unwrap();
                #[cfg(unix)]
                std::os::unix::fs::symlink(&fixture.root, &alias).unwrap();
                value["path"] = serde_json::json!(alias.join(path.file_name().unwrap()));
            }
            "archive-link" => {
                let alias = fixture.home.join(".monocode-preserved-transactions");
                #[cfg(windows)]
                junction::create(&fixture.root, &alias).unwrap();
                #[cfg(unix)]
                std::os::unix::fs::symlink(&fixture.root, &alias).unwrap();
            }
            _ => unreachable!(),
        }
        let metadata = serde_json::from_value::<transactions::RecoveryMetadata>(value).unwrap();
        assert!(transactions::preserve_metadata(&fixture.home, &metadata).is_err());
        assert!(path.exists());
        assert_eq!(std::fs::read(&fixture.original).unwrap(), PRIVATE);
        assert_eq!(
            std::fs::read(fixture.source.join("AGENTS.md")).unwrap(),
            ACCOUNT
        );
    }
}

#[test]
fn journal_parser_preserves_symlinked_authority() {
    let fixture = TransactionFixture::new(ClaimIntent::Keep);
    let owned = fixture.root.join("owned-journal.json");
    std::fs::rename(&fixture.journal_path, &owned).unwrap();
    #[cfg(windows)]
    std::os::windows::fs::symlink_file(&owned, &fixture.journal_path).unwrap();
    #[cfg(unix)]
    std::os::unix::fs::symlink(&owned, &fixture.journal_path).unwrap();
    let bytes = std::fs::read(&owned).unwrap();
    for _ in 0..2 {
        fixture.assert_blocked();
    }
    assert_eq!(std::fs::read(&owned).unwrap(), bytes);
    assert!(std::fs::symlink_metadata(&fixture.journal_path)
        .unwrap()
        .file_type()
        .is_symlink());
}

#[test]
fn verification_and_cleanup_refuse_changed_authority_and_preserve_unfamiliar_pending_files() {
    for change in [
        "initial-before-verify",
        "verification-identity",
        "verification-content",
        "pending",
    ] {
        let mut fixture = TransactionFixture::new(ClaimIntent::Keep);
        let verified = fixture.journal_path.with_extension("verified.json");
        if change == "initial-before-verify" {
            fixture.change_journal(|value| value["verified"] = serde_json::json!(true));
            let bytes = std::fs::read(&fixture.journal_path).unwrap();
            assert!(fixture.journal.verify(None).is_err());
            assert_eq!(std::fs::read(&fixture.journal_path).unwrap(), bytes);
            assert!(!verified.exists());
        } else {
            fixture.journal.verify(None).unwrap();
            let path = if change == "pending" {
                verified.with_extension("json.pending")
            } else {
                verified.clone()
            };
            if change == "verification-identity" {
                std::fs::rename(&path, fixture.root.join("owned-verification.json")).unwrap();
            }
            std::fs::write(&path, b"unfamiliar metadata").unwrap();
            assert!(fixture.journal.finish().is_err());
            assert_eq!(std::fs::read(&path).unwrap(), b"unfamiliar metadata");
            assert!(fixture.journal_path.exists());
        }
        assert!(std::fs::symlink_metadata(&fixture.staged).is_ok());
        assert_eq!(std::fs::read(&fixture.original).unwrap(), PRIVATE);
        assert_eq!(
            std::fs::read(fixture.source.join("AGENTS.md")).unwrap(),
            ACCOUNT
        );
    }
}

#[cfg(windows)]
#[test]
fn metadata_archival_preserves_readonly_source_private_and_metadata_attributes() {
    let fixture = TransactionFixture::new(ClaimIntent::Keep);
    fixture.journal.finish().unwrap();
    let source = fixture.source.join("AGENTS.md");
    let pending = fixture.home.join(format!(
        ".monocode-txn-{}.json.pending",
        uuid::Uuid::new_v4()
    ));
    std::fs::write(&pending, b"incomplete metadata").unwrap();
    for path in [&source, &fixture.original, &pending] {
        let mut permissions = std::fs::metadata(path).unwrap().permissions();
        permissions.set_readonly(true);
        std::fs::set_permissions(path, permissions).unwrap();
    }
    let before = [&source, &fixture.original, &pending].map(|path| {
        (
            entry_identity(path).unwrap(),
            handle_file_info(&open_entry(path, false).unwrap())
                .unwrap()
                .dwFileAttributes,
        )
    });
    let recovery: serde_json::Value =
        serde_json::from_str(&transactions::reconcile(&fixture.home).unwrap_err()).unwrap();
    let metadata =
        serde_json::from_value::<transactions::RecoveryMetadata>(recovery["metadata"].clone())
            .unwrap();
    let archived = transactions::preserve_metadata(&fixture.home, &metadata).unwrap();
    let after = [&source, &fixture.original, &archived].map(|path| {
        (
            entry_identity(path).unwrap(),
            handle_file_info(&open_entry(path, false).unwrap())
                .unwrap()
                .dwFileAttributes,
        )
    });
    assert_eq!(after, before);
    assert_eq!(std::fs::read(&source).unwrap(), ACCOUNT);
    assert_eq!(std::fs::read(&fixture.original).unwrap(), PRIVATE);
    assert_eq!(std::fs::read(&archived).unwrap(), b"incomplete metadata");
    for _ in 0..2 {
        transactions::reconcile(&fixture.home).unwrap();
    }
}

#[test]
fn recovery_root_validation_never_creates_account_or_private_directories() {
    let fixture = TransactionFixture::new(ClaimIntent::Keep);
    let missing_source = fixture.root.join("missing-account");
    let missing_home = fixture.root.join("missing-private");
    assert!(canonical_roots(&missing_source, &fixture.home).is_err());
    assert!(canonical_roots(&fixture.source, &missing_home).is_err());
    assert!(!missing_source.exists());
    assert!(!missing_home.exists());
    assert!(canonical_roots(&fixture.source, &fixture.source).is_err());
    let (source, home) = canonical_roots(&fixture.source, &fixture.home).unwrap();
    assert_eq!(source, fixture.source);
    assert_eq!(home, fixture.home);
    assert_eq!(std::fs::read(&fixture.original).unwrap(), PRIVATE);
    assert_eq!(
        std::fs::read(fixture.source.join("AGENTS.md")).unwrap(),
        ACCOUNT
    );
}
