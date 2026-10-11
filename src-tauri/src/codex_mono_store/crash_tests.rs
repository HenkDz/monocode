use super::*;
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

const CHILD_TEST: &str = "codex_mono_store::crash_tests::crash_child";
const MONO_BYTES: &[u8] = b"Unique Mono instruction explicitly chosen to KEEP";
const ACCOUNT_BYTES: &[u8] = b"Account instruction; never execute this synthetic text";
const ACCOUNT_HOOKS: &[u8] = br#"{"hooks":{"Stop":[{"command":"synthetic-account-command"}]}}"#;
const EMPTY_HOOKS: &[u8] = b"{\n  \"hooks\": {}\n}\n";
const CORRUPT_BYTES: &[u8] = b"{invalid-review-metadata";

pub(super) fn checkpoint(point: &str) {
    if std::env::var("CC0G_CRASH_POINT").ok().as_deref() != Some(point) {
        return;
    }
    let fixture = PathBuf::from(std::env::var_os("CC0G_CRASH_FIXTURE").unwrap());
    let ready = PathBuf::from(std::env::var_os("CC0G_CRASH_READY").unwrap());
    assert_eq!(ready.parent(), Some(fixture.as_path()));
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(ready)
        .unwrap();
    file.write_all(point.as_bytes()).unwrap();
    file.sync_all().unwrap();
    loop {
        std::thread::sleep(Duration::from_millis(25));
    }
}

struct Fixture(PathBuf);

impl Fixture {
    fn new(case: &str) -> Self {
        let root = std::env::temp_dir().join(format!(
            "monocode-cc0g-crash-{case}-{}",
            uuid::Uuid::new_v4()
        ));
        for dir in [
            "account",
            "mono",
            "environment/AppData/Roaming",
            "environment/AppData/Local",
        ] {
            std::fs::create_dir_all(root.join(dir)).unwrap();
        }
        Self(root.canonicalize().unwrap())
    }

    fn source(&self) -> PathBuf {
        self.0.join("account")
    }

    fn home(&self) -> PathBuf {
        self.0.join("mono")
    }

    fn command(&self, operation: &str, entry: &str, label: &str) -> Command {
        let mut command = Command::new(std::env::current_exe().unwrap());
        command
            .args(["--exact", CHILD_TEST, "--ignored", "--nocapture"])
            .env("CC0G_CRASH_FIXTURE", &self.0)
            .env("CC0G_CRASH_OPERATION", operation)
            .env("CC0G_CRASH_ENTRY", entry)
            .env("CC0G_CRASH_RECEIPT", self.0.join(format!("{label}.json")))
            .env("HOME", self.0.join("environment"))
            .env("USERPROFILE", self.0.join("environment"))
            .env("APPDATA", self.0.join("environment/AppData/Roaming"))
            .env("LOCALAPPDATA", self.0.join("environment/AppData/Local"))
            .env_remove("CODEX_HOME")
            .env_remove("CC0G_CRASH_POINT")
            .env_remove("CC0G_CRASH_READY")
            .stdout(Stdio::from(
                std::fs::File::create(self.0.join(format!("{label}.stdout.log"))).unwrap(),
            ))
            .stderr(Stdio::from(
                std::fs::File::create(self.0.join(format!("{label}.stderr.log"))).unwrap(),
            ));
        for (name, _) in std::env::vars_os() {
            if name.to_string_lossy().starts_with("ORCA_") {
                command.env_remove(name);
            }
        }
        command
    }

    fn kill_at(&self, operation: &str, entry: &str, point: &str) {
        let ready = self.0.join("checkpoint");
        let mut command = self.command(operation, entry, "killed");
        command
            .env("CC0G_CRASH_POINT", point)
            .env("CC0G_CRASH_READY", &ready);
        let mut child = TestChild(command.spawn().unwrap());
        let started = Instant::now();
        while std::fs::read_to_string(&ready).ok().as_deref() != Some(point) {
            assert!(
                child.0.try_wait().unwrap().is_none(),
                "child exited before {point}; inspect {}",
                self.0.display()
            );
            assert!(
                started.elapsed() < Duration::from_secs(20),
                "checkpoint {point} timed out; inspect {}",
                self.0.display()
            );
            std::thread::sleep(Duration::from_millis(10));
        }
        child.0.kill().unwrap();
        assert!(!child.0.wait().unwrap().success());
        assert_eq!(std::fs::read_to_string(ready).unwrap(), point);
        assert!(!self.0.join("killed.json").exists());
    }

    fn run(&self, operation: &str, entry: &str, label: &str) -> Result<(), String> {
        let mut child = TestChild(self.command(operation, entry, label).spawn().unwrap());
        let started = Instant::now();
        loop {
            if let Some(status) = child.0.try_wait().unwrap() {
                assert!(
                    status.success(),
                    "child failed; inspect {}",
                    self.0.display()
                );
                break;
            }
            assert!(
                started.elapsed() < Duration::from_secs(20),
                "restart timed out; inspect {}",
                self.0.display()
            );
            std::thread::sleep(Duration::from_millis(10));
        }
        serde_json::from_slice(&std::fs::read(self.0.join(format!("{label}.json"))).unwrap())
            .unwrap()
    }

    fn assert_clean(&self) {
        let mut directories = vec![self.home(), self.home().join(".monocode-links")];
        if self.home().join(".monocode-skill-contexts").is_dir() {
            for entry in std::fs::read_dir(self.home().join(".monocode-skill-contexts")).unwrap() {
                let context = entry.unwrap().path();
                directories.extend([
                    context.clone(),
                    context.join(".monocode-links"),
                    context.join("skills"),
                ]);
            }
        }
        for directory in directories {
            let entries = match std::fs::read_dir(&directory) {
                Ok(entries) => entries,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
                Err(error) => panic!("{}: {error}", directory.display()),
            };
            for entry in entries {
                let entry = entry.unwrap();
                let name = entry.file_name();
                let name = name.to_string_lossy();
                assert!(
                    !name.starts_with(".monocode-claim-")
                        && !name.starts_with(".monocode-link-")
                        && !name.starts_with(".monocode-txn-"),
                    "orphan transaction entry {}; inspect {}",
                    name,
                    self.0.display()
                );
            }
        }
    }

    fn assert_archived(&self, entry: &str, expected: &[u8]) {
        let archives = std::fs::read_dir(self.home().join(".monocode-conflicts")).unwrap();
        let mut preserved = false;
        for archive in archives {
            let path = archive.unwrap().path().join(entry);
            if std::fs::read(&path).is_ok_and(|bytes| bytes == expected) {
                assert!(!replaceable_link(&path).unwrap());
                preserved = true;
            }
        }
        assert!(
            preserved,
            "original bytes missing from archive; inspect {}",
            self.0.display()
        );
    }
}

// Keep synthetic fixtures and child receipts for inspection, like the other native store tests.
struct TestChild(Child);

impl Drop for TestChild {
    fn drop(&mut self) {
        if self.0.try_wait().is_ok_and(|status| status.is_none()) {
            let _ = self.0.kill();
            let _ = self.0.wait();
        }
    }
}

#[test]
#[ignore = "subprocess entry point; the crash tests invoke it with synthetic paths"]
fn crash_child() {
    let Some(root) = std::env::var_os("CC0G_CRASH_FIXTURE") else {
        return;
    };
    let root = PathBuf::from(root).canonicalize().unwrap();
    assert!(root.starts_with(std::env::temp_dir().canonicalize().unwrap()));
    assert!(root
        .file_name()
        .unwrap()
        .to_string_lossy()
        .starts_with("monocode-cc0g-crash-"));
    let (source, home) = storage_roots(&root.join("account"), &root.join("mono")).unwrap();
    let entry = std::env::var("CC0G_CRASH_ENTRY").unwrap();
    let result = match std::env::var("CC0G_CRASH_OPERATION").unwrap().as_str() {
        "prepare" => prepare_files(&source, &home),
        "isolate-skills" => prepare_files(&source, &home),
        "skills-context" | "memory-context" => (|| {
            prepare_files(&source, &home)?;
            let catalog = skills::catalog(&source, &home, None, None)?;
            let policy = skills::SkillsPolicy::default();
            let id = skills::context_id(&source, &home, None, "worker", &policy, &catalog)?;
            skills::with_context_home(&home, &id, |context| {
                transactions::reconcile(context)?;
                if std::env::var("CC0G_CRASH_OPERATION").unwrap() == "memory-context"
                    && !context.join("memories").exists()
                {
                    std::fs::create_dir(context.join("memories")).map_err(|e| e.to_string())?;
                }
                skills::prepare_context_files(&source, &home, context)
            })
        })(),
        "keep" => file_conflict(&source, &home, &entry).and_then(|conflict| {
            resolve_files(
                &source,
                &home,
                &conflict,
                StorageResolution::KeepMonoVersion,
            )
        }),
        "use-account" => file_conflict(&source, &home, &entry).and_then(|conflict| {
            resolve_files(
                &source,
                &home,
                &conflict,
                StorageResolution::UseAccountVersion,
            )
        }),
        operation => panic!("unknown crash operation {operation}"),
    };
    let receipt = PathBuf::from(std::env::var_os("CC0G_CRASH_RECEIPT").unwrap());
    assert_eq!(receipt.parent(), Some(root.as_path()));
    std::fs::write(receipt, serde_json::to_vec(&result).unwrap()).unwrap();
}

#[test]
fn killed_keep_restores_private_bytes_before_preparation() {
    for point in [
        "after-journal",
        "after-claim",
        "before-publish",
        "after-publish",
    ] {
        let fixture = Fixture::new(&format!("keep-{point}"));
        std::fs::write(fixture.source().join("AGENTS.md"), ACCOUNT_BYTES).unwrap();
        std::fs::write(fixture.home().join("AGENTS.md"), MONO_BYTES).unwrap();
        fixture.kill_at("keep", "AGENTS.md", point);
        let restart = fixture.run("prepare", "AGENTS.md", "restart");
        assert_eq!(
            std::fs::read(fixture.home().join("AGENTS.md")).unwrap(),
            MONO_BYTES
        );
        if let Err(error) = restart {
            let conflict: StorageConflict = serde_json::from_str(&error).unwrap();
            assert_eq!(conflict.entry, "AGENTS.md");
            assert_eq!(
                conflict.mono_fingerprint,
                fingerprint(&fixture.home().join("AGENTS.md")).unwrap()
            );
            fixture.run("keep", "AGENTS.md", "resolved").unwrap();
        }
        fixture.run("prepare", "AGENTS.md", "prepared").unwrap();
        assert_eq!(
            std::fs::read(fixture.home().join("AGENTS.md")).unwrap(),
            MONO_BYTES
        );
        assert_eq!(
            std::fs::read(fixture.source().join("AGENTS.md")).unwrap(),
            ACCOUNT_BYTES
        );
        assert!(!replaceable_link(&fixture.home().join("AGENTS.md")).unwrap());
        fixture.assert_clean();
        println!("keep {point}: {}", fixture.0.display());
    }
}

#[test]
fn killed_skill_junction_migration_preserves_source_and_restarts() {
    for point in [
        "after-journal",
        "after-claim",
        "before-publish",
        "after-publish",
    ] {
        let fixture = Fixture::new(&format!("skills-{point}"));
        let source = fixture.source().join("skills");
        let target = fixture.home().join("skills");
        std::fs::create_dir(&source).unwrap();
        std::fs::write(source.join("original.txt"), ACCOUNT_BYTES).unwrap();
        let identity = entry_identity(&source).unwrap();
        #[cfg(windows)]
        junction::create(&source, &target).unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(&source, &target).unwrap();
        fixture.kill_at("isolate-skills", "skills", point);
        fixture.run("isolate-skills", "skills", "restart").unwrap();
        fixture.run("isolate-skills", "skills", "prepared").unwrap();
        assert_eq!(entry_identity(&source).unwrap(), identity);
        assert_eq!(
            std::fs::read(source.join("original.txt")).unwrap(),
            ACCOUNT_BYTES
        );
        assert!(target.is_dir());
        assert!(!replaceable_link(&target).unwrap());
        assert_eq!(std::fs::read_dir(&target).unwrap().count(), 0);
        fixture.assert_clean();
        println!("skill isolation {point}: {}", fixture.0.display());
    }
}

#[test]
fn killed_private_hook_context_copy_never_publishes_partial_hooks() {
    for point in [
        #[cfg(windows)]
        "skills-hooks-after-stage-create",
        #[cfg(windows)]
        "skills-hooks-after-stage-journal",
        "skills-hooks-before-copy",
        "skills-hooks-before-publish",
        "skills-hooks-after-publish",
    ] {
        let fixture = Fixture::new(&format!("context-hooks-{point}"));
        let hooks = fixture.home().join("hooks.json");
        let chosen = br#"{"hooks":{"Stop":[{"command":"synthetic-private-context-hook"}]}}"#;
        std::fs::write(&hooks, chosen).unwrap();
        let identity = entry_identity(&hooks).unwrap();
        fixture.kill_at("skills-context", "hooks.json", point);
        #[cfg(windows)]
        if point.starts_with("skills-hooks-after-stage-") {
            let contexts = std::fs::read_dir(fixture.home().join(".monocode-skill-contexts"))
                .unwrap()
                .map(|entry| entry.unwrap().path())
                .collect::<Vec<_>>();
            assert_eq!(contexts.len(), 1);
            let entries = std::fs::read_dir(&contexts[0])
                .unwrap()
                .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
                .collect::<Vec<_>>();
            assert!(!entries
                .iter()
                .any(|name| name.starts_with(".monocode-link-")));
            assert_eq!(
                entries
                    .iter()
                    .filter(|name| name.starts_with(".monocode-txn-"))
                    .count(),
                usize::from(point == "skills-hooks-after-stage-journal")
            );
        }
        fixture
            .run("skills-context", "hooks.json", "restart")
            .unwrap();
        fixture
            .run("skills-context", "hooks.json", "prepared")
            .unwrap();
        let contexts = std::fs::read_dir(fixture.home().join(".monocode-skill-contexts"))
            .unwrap()
            .map(|entry| entry.unwrap().path())
            .collect::<Vec<_>>();
        assert_eq!(contexts.len(), 1);
        let published = contexts[0].join("hooks.json");
        assert_eq!(std::fs::read(&published).unwrap(), chosen);
        assert!(!replaceable_link(&published).unwrap());
        assert!(!same_entry(&hooks, &published));
        assert_eq!(entry_identity(&hooks).unwrap(), identity);
        assert_eq!(std::fs::read(&hooks).unwrap(), chosen);
        fixture.assert_clean();
        println!("context private hooks {point}: {}", fixture.0.display());
    }
}

#[test]
fn killed_empty_legacy_memory_migration_preserves_shared_memory_and_restarts() {
    for point in [
        "after-journal",
        "after-claim",
        "memory-before-publish",
        "memory-after-publish",
    ] {
        let fixture = Fixture::new(&format!("context-memory-{point}"));
        let memory = fixture.home().join("memories");
        std::fs::create_dir(&memory).unwrap();
        std::fs::write(memory.join("memory_summary.md"), MONO_BYTES).unwrap();
        std::fs::write(fixture.home().join("hooks.json"), EMPTY_HOOKS).unwrap();
        fixture.kill_at("memory-context", "memories", point);
        fixture
            .run("memory-context", "memories", "restart")
            .unwrap();
        let contexts = std::fs::read_dir(fixture.home().join(".monocode-skill-contexts"))
            .unwrap()
            .map(|entry| entry.unwrap().path())
            .collect::<Vec<_>>();
        assert_eq!(contexts.len(), 1);
        assert!(same_entry(&memory, &contexts[0].join("memories")));
        assert_eq!(
            std::fs::read(contexts[0].join("memories/memory_summary.md")).unwrap(),
            MONO_BYTES
        );
        assert!(!replaceable_link(&memory).unwrap());
        fixture.assert_clean();
        println!("context native memory {point}: {}", fixture.0.display());
    }
}

#[test]
fn killed_account_choice_preserves_original_bytes_and_reconciles_claims() {
    for point in [
        "after-journal",
        "after-claim",
        "after-archive",
        "before-publish",
        "after-publish",
    ] {
        let fixture = Fixture::new(&format!("account-{point}"));
        std::fs::write(fixture.source().join("AGENTS.md"), ACCOUNT_BYTES).unwrap();
        std::fs::write(fixture.home().join("AGENTS.md"), MONO_BYTES).unwrap();
        fixture.kill_at("use-account", "AGENTS.md", point);
        let restart = fixture.run("prepare", "AGENTS.md", "restart");
        if let Err(error) = restart {
            let conflict: StorageConflict = serde_json::from_str(&error).unwrap();
            assert_eq!(conflict.entry, "AGENTS.md");
            assert_eq!(
                std::fs::read(fixture.home().join("AGENTS.md")).unwrap(),
                MONO_BYTES
            );
            fixture.run("use-account", "AGENTS.md", "resolved").unwrap();
        } else {
            assert_eq!(
                std::fs::read(fixture.home().join("AGENTS.md")).unwrap(),
                ACCOUNT_BYTES
            );
            fixture.assert_archived("AGENTS.md", MONO_BYTES);
        }
        fixture.run("prepare", "AGENTS.md", "prepared").unwrap();
        assert_eq!(
            std::fs::read(fixture.source().join("AGENTS.md")).unwrap(),
            ACCOUNT_BYTES
        );
        assert!(same_entry(
            &fixture.source().join("AGENTS.md"),
            &fixture.home().join("AGENTS.md")
        ));
        fixture.assert_archived("AGENTS.md", MONO_BYTES);
        fixture.assert_clean();
        println!("use-account {point}: {}", fixture.0.display());
    }
}

fn killed_hooks_isolation(link: fn(&Path, &Path), kind: &str) {
    for point in [
        "after-journal",
        "after-claim",
        "after-archive",
        "before-publish",
        "after-publish",
    ] {
        let fixture = Fixture::new(&format!("isolate-{kind}-{point}"));
        let source = fixture.source().join("hooks.json");
        let target = fixture.home().join("hooks.json");
        std::fs::write(&source, ACCOUNT_HOOKS).unwrap();
        let source_identity = entry_identity(&source).unwrap();
        let source_modified = std::fs::metadata(&source).unwrap().modified().unwrap();
        link(&source, &target);
        fixture.kill_at("prepare", "hooks.json", point);
        fixture.run("prepare", "hooks.json", "restart").unwrap();
        fixture.run("prepare", "hooks.json", "prepared").unwrap();
        assert_eq!(std::fs::read(&target).unwrap(), br#"{"hooks":{}}"#);
        assert!(!replaceable_link(&target).unwrap());
        assert_eq!(std::fs::read(&source).unwrap(), ACCOUNT_HOOKS);
        assert_eq!(entry_identity(&source).unwrap(), source_identity);
        assert_eq!(
            std::fs::metadata(&source).unwrap().modified().unwrap(),
            source_modified
        );
        fixture.assert_archived("hooks.json", ACCOUNT_HOOKS);
        fixture.assert_clean();
        std::fs::write(&source, b"later synthetic account hooks").unwrap();
        fixture.assert_archived("hooks.json", ACCOUNT_HOOKS);
        assert_eq!(std::fs::read(&target).unwrap(), br#"{"hooks":{}}"#);
        println!("isolate {kind} {point}: {}", fixture.0.display());
    }
}

#[test]
fn killed_hardlink_hooks_migration_retains_an_independent_archive() {
    killed_hooks_isolation(
        |source, target| std::fs::hard_link(source, target).unwrap(),
        "hardlink",
    );
}

#[test]
fn killed_symlink_hooks_migration_retains_an_independent_archive() {
    killed_hooks_isolation(
        |source, target| {
            #[cfg(windows)]
            std::os::windows::fs::symlink_file(source, target).unwrap();
            #[cfg(unix)]
            std::os::unix::fs::symlink(source, target).unwrap();
        },
        "symlink",
    );
}

#[test]
fn killed_ordinary_relink_preserves_the_previous_referent_and_reconciles_claims() {
    for point in [
        "after-journal",
        "after-claim",
        "before-publish",
        "after-publish",
    ] {
        let fixture = Fixture::new(&format!("relink-{point}"));
        let previous = fixture.0.join("previous-account.md");
        let source = fixture.source().join("AGENTS.md");
        let target = fixture.home().join("AGENTS.md");
        std::fs::write(&previous, MONO_BYTES).unwrap();
        std::fs::write(&source, ACCOUNT_BYTES).unwrap();
        std::fs::write(fixture.home().join("hooks.json"), EMPTY_HOOKS).unwrap();
        #[cfg(windows)]
        std::os::windows::fs::symlink_file(&previous, &target).unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(&previous, &target).unwrap();
        let previous_identity = entry_identity(&previous).unwrap();
        fixture.kill_at("prepare", "AGENTS.md", point);
        fixture.run("prepare", "AGENTS.md", "restart").unwrap();
        fixture.run("prepare", "AGENTS.md", "prepared").unwrap();
        assert!(same_entry(&source, &target));
        assert_eq!(std::fs::read(&target).unwrap(), ACCOUNT_BYTES);
        assert_eq!(std::fs::read(&source).unwrap(), ACCOUNT_BYTES);
        assert_eq!(std::fs::read(&previous).unwrap(), MONO_BYTES);
        assert_eq!(entry_identity(&previous).unwrap(), previous_identity);
        fixture.assert_clean();
        println!("relink {point}: {}", fixture.0.display());
    }
}

#[test]
fn killed_corrupt_snapshot_move_still_requires_an_explicit_choice() {
    for point in [
        "after-journal",
        "after-claim",
        "before-publish",
        "after-publish",
        "corrupt-after-move",
    ] {
        let fixture = Fixture::new(&format!("corrupt-{point}"));
        std::fs::write(fixture.source().join("hooks.json"), ACCOUNT_HOOKS).unwrap();
        std::fs::write(fixture.home().join("hooks.json"), EMPTY_HOOKS).unwrap();
        std::fs::write(
            fixture.home().join(".monocode-hooks-policy.json"),
            br#"{"shareHooks":true}"#,
        )
        .unwrap();
        let snapshot = snapshot_path(&fixture.home(), "hooks.json").unwrap();
        std::fs::write(&snapshot, CORRUPT_BYTES).unwrap();
        fixture.kill_at("prepare", "hooks.json", point);
        for label in ["restart", "retried"] {
            let error = fixture.run("prepare", "hooks.json", label).unwrap_err();
            let conflict: StorageConflict = serde_json::from_str(&error).unwrap();
            assert_eq!(conflict.entry, "hooks.json");
            assert_eq!(
                std::fs::read(fixture.home().join("hooks.json")).unwrap(),
                EMPTY_HOOKS
            );
            assert_eq!(
                std::fs::read(fixture.source().join("hooks.json")).unwrap(),
                ACCOUNT_HOOKS
            );
            assert!(
                read_snapshot(&fixture.home(), "hooks.json")
                    .unwrap()
                    .unwrap()
                    .invalid
            );
        }
        let preserved = std::fs::read_dir(snapshot.parent().unwrap())
            .unwrap()
            .any(|entry| {
                let path = entry.unwrap().path();
                path.file_name()
                    .unwrap()
                    .to_string_lossy()
                    .starts_with("hooks.json.json.corrupt-")
                    && std::fs::read(path).is_ok_and(|bytes| bytes == CORRUPT_BYTES)
            });
        assert!(preserved);
        fixture.run("keep", "hooks.json", "resolved").unwrap();
        fixture.run("prepare", "hooks.json", "prepared").unwrap();
        assert_eq!(
            std::fs::read(fixture.home().join("hooks.json")).unwrap(),
            EMPTY_HOOKS
        );
        assert!(
            !read_snapshot(&fixture.home(), "hooks.json")
                .unwrap()
                .unwrap()
                .invalid
        );
        fixture.assert_clean();
        println!("corrupt {point}: {}", fixture.0.display());
    }
}
