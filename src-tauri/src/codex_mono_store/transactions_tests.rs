use super::*;

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
