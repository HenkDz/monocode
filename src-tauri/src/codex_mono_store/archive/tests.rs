use super::*;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

const ACTIVE: &str = "rollout-2026-10-11T12-00-00-root.jsonl";
const ARCHIVED: &str = "rollout-2026-10-11T12-00-00-child.jsonl.zst";
const CHILD: &str = "codex_mono_store::archive::tests::archive_crash_child";

struct Fixture(PathBuf);
impl Fixture {
    fn new() -> Self {
        let root =
            std::env::temp_dir().join(format!("monocode-cc6f-archive-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(root.join("account")).unwrap();
        std::fs::create_dir_all(root.join("mono")).unwrap();
        Self(root.canonicalize().unwrap())
    }
    fn base(&self) -> PathBuf {
        self.0.join("mono")
    }
    fn context(&self, id: char) -> PathBuf {
        let base = self.base();
        skills::with_context_home(&base, &id.to_string().repeat(64), |home| {
            Ok(home.to_path_buf())
        })
        .unwrap()
    }
    fn populate(&self) -> PathBuf {
        let home = self.context('a');
        let active = home.join("sessions/2026/10/11");
        std::fs::create_dir_all(&active).unwrap();
        std::fs::write(active.join(ACTIVE), b"native root history").unwrap();
        let archived = home.join("archived_sessions");
        std::fs::create_dir_all(&archived).unwrap();
        std::fs::write(archived.join(ARCHIVED), b"compressed native child history").unwrap();
        std::fs::write(
            archived.join(ARCHIVED).with_extension(""),
            b"native child append tail",
        )
        .unwrap();
        home
    }
    fn assert_history(&self) {
        assert_eq!(
            std::fs::read(self.base().join("sessions/2026/10/11").join(ACTIVE)).unwrap(),
            b"native root history"
        );
        assert_eq!(
            std::fs::read(self.base().join("archived_sessions").join(ARCHIVED)).unwrap(),
            b"compressed native child history"
        );
        assert_eq!(
            std::fs::read(
                self.base()
                    .join("archived_sessions")
                    .join(ARCHIVED)
                    .with_extension("")
            )
            .unwrap(),
            b"native child append tail"
        );
        for home in [self.context('a'), self.context('b')] {
            for name in ROOTS {
                assert!(same_entry(&self.base().join(name), &home.join(name)));
            }
        }
        let context = self.context('a');
        let retained = std::fs::read_dir(&context)
            .unwrap()
            .map(|e| e.unwrap().path())
            .filter(|p| {
                p.file_name()
                    .unwrap()
                    .to_string_lossy()
                    .starts_with(".monocode-retained-")
            })
            .collect::<Vec<_>>();
        assert_eq!(retained.len(), 2);
        assert!(retained
            .iter()
            .any(|p| std::fs::read(p.join("2026/10/11").join(ACTIVE))
                .is_ok_and(|b| b == b"native root history")));
        assert!(retained.iter().any(|p| std::fs::read(p.join(ARCHIVED))
            .is_ok_and(|b| b == b"compressed native child history")));
    }
}

#[test]
fn previous_context_rollouts_share_native_archive_ownership_without_losing_originals() {
    let fixture = Fixture::new();
    let home = fixture.populate();
    let other = fixture.context('b');
    let db = rusqlite::Connection::open(fixture.base().join("state_5.sqlite")).unwrap();
    db.execute_batch(
        "CREATE TABLE threads(id TEXT PRIMARY KEY, rollout_path TEXT, archived INTEGER);",
    )
    .unwrap();
    let old = home.join("sessions/2026/10/11").join(ACTIVE);
    db.execute(
        "INSERT INTO threads VALUES ('root', ?1, 0)",
        [old.to_string_lossy()],
    )
    .unwrap();
    db.execute(
        "INSERT INTO threads VALUES ('foreign', '/another-account/rollout.jsonl', 1)",
        [],
    )
    .unwrap();
    drop(db);
    prepare_base_state(&fixture.base()).unwrap();
    prepare_context_state(&fixture.base(), &other).unwrap();
    prepare_base_state(&fixture.base()).unwrap();
    fixture.assert_history();
    let db = rusqlite::Connection::open(fixture.base().join("state_5.sqlite")).unwrap();
    let path: String = db
        .query_row(
            "SELECT rollout_path FROM threads WHERE id='root'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(
        PathBuf::from(path),
        fixture
            .base()
            .join("sessions/2026/10/11")
            .join(ACTIVE)
            .canonicalize()
            .unwrap()
    );
    assert_eq!(
        db.query_row("SELECT archived FROM threads WHERE id='root'", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        0
    );
    assert_eq!(
        db.query_row(
            "SELECT rollout_path FROM threads WHERE id='foreign'",
            [],
            |r| r.get::<_, String>(0)
        )
        .unwrap(),
        "/another-account/rollout.jsonl"
    );
}

#[test]
fn divergent_rollouts_fail_closed_and_preserve_both_copies() {
    let fixture = Fixture::new();
    let home = fixture.populate();
    let original = home.join("sessions/2026/10/11").join(ACTIVE);
    let identity = entry_identity(&original).unwrap();
    let common = fixture.base().join("sessions/2026/10/11").join(ACTIVE);
    std::fs::create_dir_all(common.parent().unwrap()).unwrap();
    std::fs::write(&common, b"different history").unwrap();
    assert!(prepare_base_state(&fixture.base())
        .unwrap_err()
        .contains("Conflicting native state"));
    assert_eq!(std::fs::read(&original).unwrap(), b"native root history");
    assert_eq!(entry_identity(&original).unwrap(), identity);
    assert_eq!(std::fs::read(common).unwrap(), b"different history");
    transactions::reconcile(&home).unwrap();
    assert!(!replaceable_link(&home.join("sessions")).unwrap());
}

#[test]
fn linked_or_unfamiliar_rollout_state_is_never_migrated() {
    let fixture = Fixture::new();
    let home = fixture.populate();
    let outside = fixture.0.join("outside");
    std::fs::create_dir(&outside).unwrap();
    create_link(&outside, &home.join("sessions/escape")).unwrap();
    assert!(prepare_base_state(&fixture.base()).is_err());
    assert!(home.join("sessions/escape").exists());
    assert_eq!(
        std::fs::read(home.join("sessions/2026/10/11").join(ACTIVE)).unwrap(),
        b"native root history"
    );
    remove_link(&home.join("sessions/escape")).unwrap();
    std::fs::write(home.join("sessions/unfamiliar-file"), b"keep me").unwrap();
    assert!(prepare_base_state(&fixture.base()).is_err());
    assert_eq!(
        std::fs::read(home.join("sessions/unfamiliar-file")).unwrap(),
        b"keep me"
    );
}

#[cfg(windows)]
#[test]
fn running_native_append_writer_blocks_migration_without_changing_history() {
    let fixture = Fixture::new();
    let home = fixture.populate();
    let original = home.join("sessions/2026/10/11").join(ACTIVE);
    let _writer = std::fs::OpenOptions::new()
        .append(true)
        .open(&original)
        .unwrap();
    assert!(prepare_base_state(&fixture.base()).is_err());
    assert_eq!(std::fs::read(original).unwrap(), b"native root history");
    assert!(!replaceable_link(&home.join("sessions")).unwrap());
}

#[test]
fn only_the_real_mono_base_can_own_shared_state() {
    let fixture = Fixture::new();
    let home = fixture.context('a');
    let account = fixture.0.join("account");
    let outside = fixture.0.join("outside");
    std::fs::create_dir(&outside).unwrap();
    create_link(&outside, &home.join("sessions")).unwrap();
    assert!(prepare_context_state(&fixture.base(), &home).is_err());
    remove_link(&home.join("sessions")).unwrap();
    prepare_context_state(&fixture.base(), &home).unwrap();
    prepare_files_with_state_locked(&account, &home, Some(&fixture.base())).unwrap();
    assert!(prepare_files_locked(&account, &home).is_err());
    std::fs::remove_dir(fixture.base().join("archived_sessions")).unwrap();
    create_link(&outside, &fixture.base().join("archived_sessions")).unwrap();
    assert!(prepare_context_state(&fixture.base(), &home).is_err());
}

#[test]
#[ignore = "Synthetic archive crash child only"]
fn archive_crash_child() {
    let root = PathBuf::from(std::env::var_os("CC0G_CRASH_FIXTURE").unwrap());
    let result = prepare_base_state(&root.join("mono"));
    std::fs::write(
        root.join("result.json"),
        serde_json::to_vec(&result).unwrap(),
    )
    .unwrap();
}

#[test]
#[ignore = "Synthetic installed-runtime probe preparation only"]
fn archive_native_rpc_prepare() {
    let root = PathBuf::from(std::env::var_os("CC6F_PREPARE_ROOT").unwrap())
        .canonicalize()
        .unwrap();
    assert!(root.starts_with(std::env::temp_dir().canonicalize().unwrap()));
    let base = root.join("base");
    prepare_base_state(&base).unwrap();
    let home = skills::with_context_home(&base, &"b".repeat(64), |home| {
        prepare_context_state(&base, home)?;
        Ok(home.to_path_buf())
    })
    .unwrap();
    let id = std::env::var("CC6F_THREAD_ID").unwrap();
    let path = skills::find_mono_thread(&base, &id).unwrap().unwrap();
    std::fs::write(
        root.join("native-preparation.json"),
        serde_json::to_vec(&serde_json::json!({"base":base,"home":home,"threadPath":path}))
            .unwrap(),
    )
    .unwrap();
}

#[test]
fn killed_rollout_migration_recovers_all_history_and_journals() {
    for point in [
        "after-journal",
        "after-claim",
        "rollouts-copy-before-publish",
        "rollouts-before-publish",
        "rollouts-after-publish",
        "rollouts-after-retain",
    ] {
        let fixture = Fixture::new();
        fixture.populate();
        fixture.context('b');
        let ready = fixture.0.join("ready");
        let mut child = Command::new(std::env::current_exe().unwrap())
            .args(["--exact", CHILD, "--ignored", "--nocapture"])
            .env("CC0G_CRASH_FIXTURE", &fixture.0)
            .env("CC0G_CRASH_READY", &ready)
            .env("CC0G_CRASH_POINT", point)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        let start = Instant::now();
        while std::fs::read_to_string(&ready).ok().as_deref() != Some(point) {
            assert!(
                child.try_wait().unwrap().is_none(),
                "child exited before {point}; {}",
                fixture.0.display()
            );
            if start.elapsed() > Duration::from_secs(20) {
                let _ = child.kill();
                panic!("{point} timed out; {}", fixture.0.display());
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        child.kill().unwrap();
        child.wait().unwrap();
        prepare_base_state(&fixture.base()).unwrap();
        prepare_base_state(&fixture.base()).unwrap();
        fixture.assert_history();
        for directory in [
            fixture.context('a'),
            fixture.base().join("sessions/2026/10/11"),
            fixture.base().join("archived_sessions"),
        ] {
            assert!(!std::fs::read_dir(directory).unwrap().any(|e| e
                .unwrap()
                .file_name()
                .to_string_lossy()
                .starts_with(".monocode-txn-")));
        }
    }
}
