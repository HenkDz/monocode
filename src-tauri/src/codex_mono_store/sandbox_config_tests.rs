#![cfg(windows)]

use super::*;
use std::os::windows::fs::MetadataExt;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

const ORIGINAL: &[u8] = b"# synthetic ordinary Codex account\r\nmodel='account-model'\r\n[windows]\r\nsandbox='elevated'\r\n";
const CHILD: &str = "codex_mono_store::sandbox_config::repair_tests::readonly_repair_child";

#[test]
fn private_engine_override_reaches_prepared_context_without_changing_source_or_other_settings() {
    let fixture = Fixture::new();
    assert_eq!(
        private_overrides(&fixture.source, &fixture.home).unwrap(),
        None
    );
    change_configs(&fixture.source, &fixture.home).unwrap();
    let (_, context, _, _) = super::super::skills::prepare(
        &fixture.source,
        &fixture.home,
        None,
        "worker",
        &super::super::skills::SkillsPolicy::default(),
    )
    .unwrap();
    assert!(super::super::same_entry(
        &fixture.home.join("config.toml"),
        &context.join("config.toml")
    ));
    let fallback = fixture
        .home
        .join(".monocode-skill-contexts")
        .join("f".repeat(64));
    std::fs::create_dir_all(&fallback).unwrap();
    std::fs::hard_link(
        fixture.home.join("config.toml"),
        fallback.join("config.toml"),
    )
    .unwrap();
    assert_eq!(
        private_overrides(&fixture.source, &fixture.home).unwrap(),
        Some(serde_json::json!({"windows": {"sandbox": "unelevated"}}))
    );
    fixture.source_proof();
    fixture.original_backup();
    fixture.clean();
}

struct Fixture {
    root: PathBuf,
    source: PathBuf,
    home: PathBuf,
    attributes: u32,
}

#[test]
fn same_inode_stage_alias_before_claim_refuses_attribute_changes() {
    let fixture = Fixture::new();
    let alias = fixture.root.join("unfamiliar-stage-alias.toml");
    let observed = std::sync::Arc::new(std::sync::Mutex::new(None));
    let captured = observed.clone();
    let home = fixture.home.clone();
    let target = alias.clone();
    super::super::BEFORE_CLAIM.with(|hook| {
        *hook.borrow_mut() = Some(Box::new(move || {
            let stage = std::fs::read_dir(&home)
                .unwrap()
                .map(|entry| entry.unwrap().path())
                .find(|path| {
                    path.file_name()
                        .unwrap()
                        .to_string_lossy()
                        .starts_with(".monocode-link-")
                })
                .unwrap();
            std::fs::hard_link(&stage, &target).unwrap();
            assert!(super::super::same_entry(&stage, &target));
            *captured.lock().unwrap() = Some((
                super::super::entry_identity(&stage).unwrap(),
                std::fs::metadata(&stage).unwrap().file_attributes(),
                std::fs::read(&stage).unwrap(),
            ));
        }));
    });
    let error = change_configs(&fixture.source, &fixture.home)
        .err()
        .unwrap();
    assert!(error.contains("shared"), "{error}");
    let (identity, attributes, bytes) = observed.lock().unwrap().take().unwrap();
    assert_eq!(attributes, 32);
    assert_eq!(super::super::entry_identity(&alias).unwrap(), identity);
    assert_eq!(
        std::fs::metadata(&alias).unwrap().file_attributes(),
        attributes
    );
    assert_eq!(std::fs::read(&alias).unwrap(), bytes);
    assert_eq!(
        std::fs::read(fixture.home.join("config.toml")).unwrap(),
        ORIGINAL
    );
    fixture.source_proof();
    fixture.clean();
}

impl Fixture {
    fn new() -> Self {
        let root =
            std::env::temp_dir().join(format!("monocode-cc6j-repair-{}", uuid::Uuid::new_v4()));
        let (source, home) =
            super::super::storage_roots(&root.join("account"), &root.join("codex-monos/default"))
                .unwrap();
        let root = root.canonicalize().unwrap();
        let config = source.join("config.toml");
        std::fs::write(&config, ORIGINAL).unwrap();
        std::fs::hard_link(&config, home.join("config.toml")).unwrap();
        let mut permissions = std::fs::metadata(&config).unwrap().permissions();
        permissions.set_readonly(true);
        std::fs::set_permissions(&config, permissions).unwrap();
        super::super::prepare_files(&source, &home).unwrap();
        let attributes = std::fs::metadata(&config).unwrap().file_attributes();
        Self {
            root,
            source,
            home,
            attributes,
        }
    }

    fn source_proof(&self) {
        let path = self.source.join("config.toml");
        assert_eq!(std::fs::read(&path).unwrap(), ORIGINAL);
        assert_eq!(
            std::fs::metadata(&path).unwrap().file_attributes(),
            self.attributes
        );
        for entry in std::fs::read_dir(&self.source).unwrap() {
            assert!(matches!(
                entry.unwrap().file_name().to_str(),
                Some("config.toml" | "secrets")
            ));
        }
    }

    fn clean(&self) {
        for directory in [&self.home, &self.home.join(".monocode-links")] {
            for entry in std::fs::read_dir(directory).unwrap() {
                let name = entry.unwrap().file_name().to_string_lossy().into_owned();
                assert!(
                    ![".monocode-claim-", ".monocode-txn-", ".monocode-link-"]
                        .iter()
                        .any(|prefix| name.starts_with(prefix)),
                    "stranded {name}; inspect {}",
                    self.root.display()
                );
            }
        }
    }

    fn backups(&self) -> Vec<PathBuf> {
        std::fs::read_dir(self.home.join(".monocode-conflicts"))
            .unwrap()
            .map(|entry| entry.unwrap().path().join("config.toml"))
            .collect()
    }

    fn original_backup(&self) {
        let backups = self.backups();
        assert!(backups
            .iter()
            .any(|path| std::fs::read(path).unwrap() == ORIGINAL));
        for backup in backups {
            if std::fs::read(&backup).unwrap() == ORIGINAL {
                assert_eq!(
                    std::fs::metadata(&backup).unwrap().file_attributes(),
                    self.attributes
                );
            }
            assert!(!super::super::replaceable_link(&backup).unwrap());
            assert!(!super::super::same_entry(
                &backup,
                &self.source.join("config.toml")
            ));
        }
    }

    fn prepare_twice_and_retry(&self) {
        super::super::transactions::reconcile(&self.home).unwrap();
        for _ in 0..2 {
            super::super::prepare_files(&self.source, &self.home).unwrap();
        }
        let private = self.home.join("config.toml");
        let bytes = std::fs::read(&private).unwrap();
        let attributes = std::fs::metadata(&private).unwrap().file_attributes();
        let changed = change_configs(&self.source, &self.home).unwrap();
        assert_eq!(std::fs::read(&changed.backup_path).unwrap(), bytes);
        assert_eq!(
            std::fs::metadata(&changed.backup_path)
                .unwrap()
                .file_attributes(),
            attributes
        );
        self.source_proof();
        self.clean();
        assert!(std::fs::read_to_string(self.home.join("config.toml"))
            .unwrap()
            .contains("unelevated"));
        assert!(!super::super::same_entry(
            &self.source.join("config.toml"),
            &self.home.join("config.toml")
        ));
    }

    fn kill_at(&self, point: &str) {
        let ready = self.root.join("ready");
        let mut command = Command::new(std::env::current_exe().unwrap());
        command
            .args(["--exact", CHILD, "--ignored", "--nocapture"])
            .env("CC6J_REPAIR_FIXTURE", &self.root)
            .env("CC0G_CRASH_FIXTURE", &self.root)
            .env("CC0G_CRASH_READY", &ready)
            .env("CC0G_CRASH_POINT", point)
            .env("HOME", self.root.join("environment"))
            .env("USERPROFILE", self.root.join("environment"))
            .env("APPDATA", self.root.join("environment/AppData/Roaming"))
            .env("LOCALAPPDATA", self.root.join("environment/AppData/Local"))
            .env_remove("CODEX_HOME")
            .current_dir(&self.root)
            .stdout(Stdio::from(
                std::fs::File::create(self.root.join("child.stdout.log")).unwrap(),
            ))
            .stderr(Stdio::from(
                std::fs::File::create(self.root.join("child.stderr.log")).unwrap(),
            ));
        for (name, _) in std::env::vars_os() {
            if name.to_string_lossy().starts_with("ORCA_") {
                command.env_remove(name);
            }
        }
        let mut child = OwnedChild(command.spawn().unwrap());
        let start = Instant::now();
        while std::fs::read_to_string(&ready).ok().as_deref() != Some(point) {
            assert!(
                child.0.try_wait().unwrap().is_none(),
                "child exited before {point}; inspect {}",
                self.root.display()
            );
            assert!(
                start.elapsed() < Duration::from_secs(20),
                "checkpoint {point} timed out; inspect {}",
                self.root.display()
            );
            std::thread::sleep(Duration::from_millis(10));
        }
        child.0.kill().unwrap();
        assert!(!child.0.wait().unwrap().success());
        self.source_proof();
        println!("readonly repair killed at {point}: {}", self.root.display());
    }
}

// Retain synthetic fixtures and child logs for inspection, like the existing crash tests.
struct OwnedChild(Child);
impl Drop for OwnedChild {
    fn drop(&mut self) {
        if self.0.try_wait().is_ok_and(|status| status.is_none()) {
            let _ = self.0.kill();
            let _ = self.0.wait();
        }
    }
}

#[test]
fn readonly_hardlink_repair_preserves_exact_source_and_backup_then_prepares_and_retries() {
    let fixture = Fixture::new();
    let changed = change_configs(&fixture.source, &fixture.home).unwrap();
    assert_eq!(changed.backup_paths.len(), 1);
    assert!(Path::new(&changed.backup_path)
        .canonicalize()
        .unwrap()
        .starts_with(&fixture.home));
    assert_eq!(std::fs::read(&changed.backup_path).unwrap(), ORIGINAL);
    fixture.source_proof();
    fixture.original_backup();
    fixture.clean();
    let private = std::fs::read(fixture.home.join("config.toml")).unwrap();
    super::super::transactions::reconcile(&fixture.home).unwrap();
    for _ in 0..2 {
        super::super::prepare_files(&fixture.source, &fixture.home).unwrap();
    }
    assert_eq!(
        std::fs::read(fixture.home.join("config.toml")).unwrap(),
        private
    );
    fixture.prepare_twice_and_retry();
    fixture.original_backup();
}

#[test]
fn unsupported_readonly_claim_cleanup_refuses_before_publication_and_keeps_retry_usable() {
    let fixture = Fixture::new();
    FAIL_NEXT_CLAIM_DISCARD.with(|flag| flag.set(true));
    let error = change_configs(&fixture.source, &fixture.home)
        .err()
        .unwrap();
    assert!(error.contains("unsupported claim cleanup"));
    assert!(error.contains("Config backups preserved at"));
    assert_eq!(
        std::fs::read(fixture.home.join("config.toml")).unwrap(),
        ORIGINAL
    );
    assert!(super::super::same_entry(
        &fixture.source.join("config.toml"),
        &fixture.home.join("config.toml")
    ));
    fixture.source_proof();
    fixture.original_backup();
    fixture.clean();
    fixture.prepare_twice_and_retry();
}

#[test]
fn failed_private_snapshot_keeps_journal_for_reconciliation() {
    let fixture = Fixture::new();
    FAIL_NEXT_SNAPSHOT_WRITE.with(|flag| flag.set(true));
    assert!(change_configs(&fixture.source, &fixture.home).is_err());
    let journals = std::fs::read_dir(&fixture.home)
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .filter(|path| {
            path.file_name()
                .unwrap()
                .to_string_lossy()
                .starts_with(".monocode-txn-")
        })
        .collect::<Vec<_>>();
    assert_eq!(journals.len(), 2);
    let initial = journals
        .iter()
        .find(|path| {
            !path
                .file_name()
                .unwrap()
                .to_string_lossy()
                .ends_with(".verified.json")
        })
        .unwrap();
    let verified = journals
        .iter()
        .find(|path| {
            path.file_name()
                .unwrap()
                .to_string_lossy()
                .ends_with(".verified.json")
        })
        .unwrap();
    let initial_name = initial.file_name().unwrap().to_str().unwrap();
    let id = initial_name
        .strip_prefix(".monocode-txn-")
        .unwrap()
        .strip_suffix(".json")
        .unwrap();
    uuid::Uuid::parse_str(id).unwrap();
    assert_eq!(
        verified.file_name().unwrap().to_str().unwrap(),
        format!(".monocode-txn-{id}.verified.json")
    );
    let initial_value: serde_json::Value =
        serde_json::from_slice(&std::fs::read(initial).unwrap()).unwrap();
    let verified_value: serde_json::Value =
        serde_json::from_slice(&std::fs::read(verified).unwrap()).unwrap();
    assert_eq!(initial_value["entry"], "config.toml");
    assert_eq!(initial_value["intent"], "private_config");
    assert_eq!(initial_value["verified"], false);
    assert_eq!(verified_value["verified"], true);
    assert_eq!(
        initial_value["claim"]["name"],
        format!(".monocode-claim-{id}")
    );
    for field in ["entry", "intent", "claim", "staged"] {
        assert_eq!(verified_value[field], initial_value[field]);
    }
    assert_eq!(verified_value["authority"]["name"], initial_name);
    assert_eq!(
        verified_value["authority"]["identity"],
        serde_json::json!(super::super::entry_identity(initial).unwrap())
    );
    assert_eq!(
        verified_value["authority"]["fingerprint"],
        super::super::fingerprint(initial).unwrap()
    );
    fixture.source_proof();
    fixture.original_backup();
    fixture.prepare_twice_and_retry();
}

#[test]
#[ignore = "subprocess entry point; readonly repair crash tests invoke it with synthetic paths"]
fn readonly_repair_child() {
    let root = PathBuf::from(std::env::var_os("CC6J_REPAIR_FIXTURE").unwrap())
        .canonicalize()
        .unwrap();
    assert!(root.starts_with(std::env::temp_dir().canonicalize().unwrap()));
    assert!(root
        .file_name()
        .unwrap()
        .to_string_lossy()
        .starts_with("monocode-cc6j-repair-"));
    let (source, home) =
        super::super::storage_roots(&root.join("account"), &root.join("codex-monos/default"))
            .unwrap();
    change_configs(&source, &home).unwrap();
}

#[test]
fn killed_readonly_repair_reconciles_every_completion_boundary_and_retries() {
    for point in [
        "after-journal",
        "after-claim",
        "sandbox-before-discard",
        "sandbox-after-discard",
        "sandbox-after-publish",
        "sandbox-after-snapshot",
    ] {
        let fixture = Fixture::new();
        fixture.kill_at(point);
        super::super::transactions::reconcile(&fixture.home).unwrap();
        if point.starts_with("sandbox-after-") {
            assert_eq!(
                std::fs::metadata(fixture.home.join("config.toml"))
                    .unwrap()
                    .file_attributes(),
                fixture.attributes
            );
            assert!(std::fs::read_to_string(fixture.home.join("config.toml"))
                .unwrap()
                .contains("unelevated"));
            assert!(
                super::super::read_snapshot(&fixture.home, "config.toml")
                    .unwrap()
                    .unwrap()
                    .private_override
            );
        } else {
            assert_eq!(
                std::fs::read(fixture.home.join("config.toml")).unwrap(),
                ORIGINAL
            );
        }
        fixture.clean();
        fixture.prepare_twice_and_retry();
        fixture.original_backup();
    }
}

#[test]
fn interrupted_readonly_repair_preserves_concurrent_replacement_and_recoverable_bytes() {
    let fixture = Fixture::new();
    fixture.kill_at("sandbox-after-discard");
    let private = fixture.home.join("config.toml");
    let replacement = b"model='concurrent-choice'\n";
    std::fs::write(&private, replacement).unwrap();
    for _ in 0..2 {
        assert!(super::super::transactions::reconcile(&fixture.home).is_err());
    }
    assert!(change_configs(&fixture.source, &fixture.home).is_err());
    assert_eq!(std::fs::read(&private).unwrap(), replacement);
    fixture.source_proof();
    fixture.original_backup();
    assert!(std::fs::read_dir(&fixture.home).unwrap().any(|entry| entry
        .unwrap()
        .file_name()
        .to_string_lossy()
        .starts_with(".monocode-txn-")));
}

#[test]
fn interrupted_readonly_repair_refuses_changed_archive_or_stage_before_publication() {
    for changed in ["archive", "stage", "shared-stage"] {
        let fixture = Fixture::new();
        fixture.kill_at("sandbox-after-discard");
        let path = if changed == "archive" {
            fixture.backups().pop().unwrap()
        } else {
            std::fs::read_dir(&fixture.home)
                .unwrap()
                .map(|entry| entry.unwrap().path())
                .find(|path| {
                    path.file_name()
                        .unwrap()
                        .to_string_lossy()
                        .starts_with(".monocode-link-")
                })
                .unwrap()
        };
        let expected = if changed == "shared-stage" {
            std::fs::remove_file(&path).unwrap();
            std::fs::hard_link(fixture.source.join("config.toml"), &path).unwrap();
            ORIGINAL
        } else {
            let mut permissions = std::fs::metadata(&path).unwrap().permissions();
            permissions.set_readonly(false);
            std::fs::set_permissions(&path, permissions).unwrap();
            std::fs::write(&path, b"unfamiliar replacement bytes").unwrap();
            b"unfamiliar replacement bytes"
        };
        for _ in 0..2 {
            assert!(super::super::transactions::reconcile(&fixture.home).is_err());
        }
        assert!(!fixture.home.join("config.toml").exists());
        assert_eq!(std::fs::read(&path).unwrap(), expected);
        fixture.source_proof();
        if changed != "archive" {
            fixture.original_backup();
        }
        assert!(std::fs::read_dir(&fixture.home).unwrap().any(|entry| entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .starts_with(".monocode-txn-")));
    }
}

#[test]
fn legacy_published_readonly_repair_finishes_without_changing_shared_attributes() {
    let fixture = Fixture::new();
    let private = fixture.home.join("config.toml");
    let stage = fixture
        .home
        .join(format!(".monocode-link-{}", uuid::Uuid::new_v4()));
    std::fs::write(
        &stage,
        unelevated_config(std::str::from_utf8(ORIGINAL).unwrap()).unwrap(),
    )
    .unwrap();
    let record = super::super::transactions::RecordedEntry::new(&stage).unwrap();
    let claim = fixture
        .home
        .join(format!(".monocode-claim-{}", uuid::Uuid::new_v4()));
    let mut journal = super::super::ClaimJournal::new(
        &private,
        &claim,
        super::super::ClaimIntent::UseAccount,
        Some(&record),
        super::super::entry_identity(&private).unwrap(),
    )
    .unwrap();
    super::super::transactions::RecordedEntry::new(&private)
        .unwrap()
        .publish(&private, &claim)
        .unwrap();
    let mut original = std::fs::File::open(&claim).unwrap();
    let backup = super::super::archive_file(
        &fixture.home,
        "config.toml",
        &mut original,
        &super::super::fingerprint(&claim).unwrap(),
    )
    .unwrap();
    std::fs::set_permissions(&backup, original.metadata().unwrap().permissions()).unwrap();
    journal.verify(Some(&backup)).unwrap();
    record.publish(&stage, &private).unwrap();
    // Model the CC6I transaction left on disk after process exit.
    drop(original);
    super::super::transactions::reconcile(&fixture.home).unwrap();
    fixture.source_proof();
    fixture.original_backup();
    fixture.clean();
    fixture.prepare_twice_and_retry();
}
