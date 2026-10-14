//! Real Windows sharing handles in disposable homes, without provider calls.
use super::*;
use std::os::windows::fs::OpenOptionsExt;
use windows_sys::Win32::Storage::FileSystem::{FILE_SHARE_READ, FILE_SHARE_WRITE};

fn fixture() -> (PathBuf, PathBuf, PathBuf) {
    let root = if let Some(root) = std::env::var_os("CC0N_EXTERNAL_ROOT") {
        let root = PathBuf::from(root).canonicalize().unwrap();
        assert!(root.starts_with(std::env::temp_dir().canonicalize().unwrap()));
        assert!(root
            .file_name()
            .unwrap()
            .to_string_lossy()
            .starts_with("synthetic-runtime-"));
        assert_eq!(root.parent().unwrap().file_name().unwrap(), "cc0n");
        root
    } else {
        std::env::temp_dir().join(format!("monocode-cc0n-{}", uuid::Uuid::new_v4()))
    };
    let source = root.join("account");
    let home = root.join("mono");
    std::fs::create_dir_all(&source).unwrap();
    std::fs::create_dir_all(&home).unwrap();
    (root, source, home)
}

fn hold(path: &Path) -> std::fs::File {
    std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE)
        .open(path)
        .unwrap()
}

#[test]
fn diagnosis_windows_sharing_sites() {
    let (root, source, home) = fixture();
    let path = home.join("held.json");
    let temp = home.join("replacement");
    std::fs::write(&path, b"original").unwrap();
    std::fs::write(&temp, b"replacement").unwrap();
    let held = hold(&path);
    for (operation, expected_code, result) in [
        (
            "open_entry(delete access)",
            32,
            open_entry(&path, true).map(|_| ()),
        ),
        (
            "replace_link(sharing preflight)",
            32,
            replace_link(&temp, &path),
        ),
        (
            "remove_file",
            32,
            std::fs::remove_file(&path).map_err(|e| e.to_string()),
        ),
    ] {
        let error = result.unwrap_err();
        assert!(
            error.contains(&format!("os error {expected_code}")),
            "{operation}: {error}"
        );
        println!("DIAGNOSIS {operation} {}: {error}", path.display());
    }
    drop(held);
    let db = home.join("logs_2.sqlite");
    let conn = rusqlite::Connection::open(&db).unwrap();
    conn.execute_batch(
        "PRAGMA journal_mode=WAL; CREATE TABLE synthetic(value); INSERT INTO synthetic VALUES (1);",
    )
    .unwrap();
    for name in ["logs_2.sqlite", "logs_2.sqlite-wal", "logs_2.sqlite-shm"] {
        let path = home.join(name);
        let result = open_entry(&path, true).map(|_| ());
        println!(
            "DIAGNOSIS SQLite delete-access {}: {result:?}",
            path.display()
        );
        assert!(result.unwrap_err().contains("os error 32"));
    }
    prepare_files(&source, &home).unwrap();
    println!("DIAGNOSIS held SQLite prepare succeeds {}", root.display());
    drop(conn);
}

#[test]
fn diagnosis_prepare_and_migration_contention() {
    let (root, source, home) = fixture();
    for name in [
        "AGENTS.md",
        ".codex-global-state.json",
        "..codex-global-state.json.tmp-1-synthetic",
    ] {
        let original = source.join(name);
        let target = home.join(name);
        std::fs::write(&original, b"old bytes").unwrap();
        std::fs::hard_link(&original, &target).unwrap();
        prepare_files(&source, &home).unwrap();
        let replacement = source.join("replacement");
        std::fs::write(&replacement, b"new bytes").unwrap();
        replace_link(&replacement, &original).unwrap();
        let held = hold(&target);
        let result = prepare_files(&source, &home);
        println!(
            "DIAGNOSIS prepare held {name} {}: {result:?}",
            target.display()
        );
        if required_entry(name) {
            assert!(result.unwrap_err().contains("os error 32"));
        } else {
            assert!(result.is_ok());
        }
        assert_eq!(std::fs::read(&target).unwrap(), b"old bytes");
        drop(held);
        prepare_files(&source, &home).unwrap();
    }
    let dir = source.join("sessions/2026/10/14");
    std::fs::create_dir_all(&dir).unwrap();
    let rollout = dir.join("rollout-2026-10-14T00-00-00-lock-thread.jsonl");
    std::fs::write(
        &rollout,
        "{\"type\":\"session_meta\",\"payload\":{\"id\":\"lock-thread\"}}\n",
    )
    .unwrap();
    let held = hold(&rollout);
    let error = copy_rollouts(&source, &home, "lock-thread", &[rollout.clone()]).unwrap_err();
    assert!(error.contains("os error 32"));
    println!(
        "DIAGNOSIS migration open(read excluding writer) {}: {error}",
        rollout.display()
    );
    drop(held);
    copy_rollouts(&source, &home, "lock-thread", &[rollout]).unwrap();
    println!("DIAGNOSIS next migration succeeds {}", root.display());
}

#[test]
fn sharing_essential_envelope_and_short_lived_lock() {
    let (_, source, home) = fixture();
    let path = home.join("AGENTS.md");
    std::fs::write(&path, b"private instructions").unwrap();
    let held = hold(&path);
    let started = std::time::Instant::now();
    let error = open_entry(&path, true).unwrap_err();
    let value: serde_json::Value = serde_json::from_str(&error).unwrap();
    assert_eq!(value["recovery"], true);
    assert_eq!(
        value["io"]["operation"],
        "open storage entry with delete access"
    );
    assert_eq!(value["io"]["path"], crate::fs::path_to_js(&path));
    assert_eq!(value["io"]["osError"], 32);
    assert_eq!(value["io"]["retryable"], true);
    assert!(started.elapsed() >= std::time::Duration::from_secs(2));
    assert_eq!(std::fs::read(&path).unwrap(), b"private instructions");
    drop(held);
    let held = hold(&path);
    let release = std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(150));
        drop(held);
    });
    open_entry(&path, true).unwrap();
    release.join().unwrap();
    prepare_files(&source, &home).unwrap();
}

#[test]
fn sharing_optional_reconciliation_is_pending_then_completes_once() {
    let (_, source, home) = fixture();
    let name = ".codex-global-state.json";
    let original = source.join(name);
    let target = home.join(name);
    std::fs::write(&original, b"old desktop state").unwrap();
    std::fs::hard_link(&original, &target).unwrap();
    prepare_files(&source, &home).unwrap();
    let replacement = source.join("replacement");
    std::fs::write(&replacement, b"new desktop state").unwrap();
    replace_link(&replacement, &original).unwrap();
    let pending = home.join(".monocode-deferred").join(format!("{name}.json"));
    std::fs::create_dir_all(pending.parent().unwrap()).unwrap();
    std::fs::write(
        &pending,
        b"unfamiliar pending metadata; preserve these bytes",
    )
    .unwrap();
    let held = hold(&target);
    prepare_files(&source, &home).unwrap();
    assert!(std::fs::read_dir(home.join(".monocode-retired-links"))
        .unwrap()
        .any(|entry| std::fs::read(entry.unwrap().path()).unwrap()
            == b"unfamiliar pending metadata; preserve these bytes"));
    let record: serde_json::Value =
        serde_json::from_slice(&std::fs::read(&pending).unwrap()).unwrap();
    assert_eq!(record["entry"], name);
    assert!(storage_io::sharing(record["error"].as_str().unwrap()));
    assert_eq!(std::fs::read(&target).unwrap(), b"old desktop state");
    assert_eq!(std::fs::read(&original).unwrap(), b"new desktop state");
    drop(held);
    prepare_files(&source, &home).unwrap();
    assert!(same_entry(&original, &target));
    assert!(!pending.exists());
    let archives = std::fs::read_dir(home.join(".monocode-conflicts"))
        .unwrap()
        .count();
    assert_eq!(archives, 1);
    prepare_files(&source, &home).unwrap();
    assert_eq!(
        std::fs::read_dir(home.join(".monocode-conflicts"))
            .unwrap()
            .count(),
        1
    );
}

#[test]
fn sharing_transients_are_never_linked_and_legacy_records_keep_all_bytes() {
    let (_, source, home) = fixture();
    let names = [
        "..codex-global-state.json.tmp-1792000000000-00000000-0000-0000-0000-000000000001",
        ".codex-global-state.json.bak.tmp-legacy",
        "state_5.sqlite-wal",
        "state_5.sqlite-shm",
        "logs_2.db-journal",
    ];
    let records = home.join(".monocode-links");
    std::fs::create_dir_all(&records).unwrap();
    for name in names {
        std::fs::write(source.join(name), name).unwrap();
        std::fs::hard_link(source.join(name), home.join(name)).unwrap();
        std::fs::write(
            records.join(format!("{name}.json")),
            format!("opaque record for {name}"),
        )
        .unwrap();
    }
    let held = hold(&home.join(names[0]));
    prepare_files(&source, &home).unwrap();
    drop(held);
    for name in names {
        assert!(!records.join(format!("{name}.json")).exists());
        assert_eq!(std::fs::read(source.join(name)).unwrap(), name.as_bytes());
        assert_eq!(std::fs::read(home.join(name)).unwrap(), name.as_bytes());
        assert!(same_entry(&source.join(name), &home.join(name)));
    }
    let retired = std::fs::read_dir(home.join(".monocode-retired-links"))
        .unwrap()
        .map(|entry| std::fs::read(entry.unwrap().path()).unwrap())
        .collect::<Vec<_>>();
    assert_eq!(retired.len(), names.len());
    for name in names {
        assert!(retired.contains(&format!("opaque record for {name}").into_bytes()));
    }
    let new = "config.toml.tmp-1792000000000-00000000-0000-0000-0000-000000000002";
    std::fs::write(source.join(new), b"unpublished config").unwrap();
    prepare_files(&source, &home).unwrap();
    assert!(!home.join(new).exists());
    assert!(!records.join(format!("{new}.json")).exists());
    assert!(!storage_io::transient("config.toml.tmp-not-a-codex-write"));
}

#[test]
fn sharing_legacy_record_lock_retires_on_next_prepare() {
    let (_, source, home) = fixture();
    let records = home.join(".monocode-links");
    std::fs::create_dir_all(&records).unwrap();
    let path = records.join("global.json.bak.tmp-old.json");
    std::fs::write(&path, b"opaque metadata").unwrap();
    let held = hold(&path);
    prepare_files(&source, &home).unwrap();
    assert_eq!(std::fs::read(&path).unwrap(), b"opaque metadata");
    drop(held);
    prepare_files(&source, &home).unwrap();
    assert!(!path.exists());
    let archived = std::fs::read_dir(home.join(".monocode-retired-links"))
        .unwrap()
        .next()
        .unwrap()
        .unwrap()
        .path();
    assert_eq!(std::fs::read(archived).unwrap(), b"opaque metadata");
}

#[test]
fn sharing_optional_journal_cleanup_defers_without_losing_authority() {
    let (_, source, home) = fixture();
    let name = ".codex-global-state.json";
    let original = source.join(name);
    let target = home.join(name);
    std::fs::write(&original, b"native shared bytes").unwrap();
    std::fs::hard_link(&original, &target).unwrap();
    let temp = home.join(format!(".monocode-link-{}", uuid::Uuid::new_v4()));
    std::fs::hard_link(&original, &temp).unwrap();
    let staged = transactions::RecordedEntry::new(&temp).unwrap();
    let claim = home.join(format!(".monocode-claim-{}", uuid::Uuid::new_v4()));
    let journal = ClaimJournal::new(
        &target,
        &claim,
        ClaimIntent::Relink,
        Some(&staged),
        entry_identity(&target).unwrap(),
    )
    .unwrap();
    drop(journal);
    let held = hold(&original);
    prepare_files(&source, &home).unwrap();
    assert_eq!(std::fs::read(&target).unwrap(), b"native shared bytes");
    assert!(temp.exists());
    assert!(std::fs::read_dir(&home).unwrap().any(|e| e
        .unwrap()
        .file_name()
        .to_string_lossy()
        .starts_with(".monocode-txn-")));
    drop(held);
    prepare_files(&source, &home).unwrap();
    assert!(!temp.exists());
    assert!(!std::fs::read_dir(&home).unwrap().any(|e| e
        .unwrap()
        .file_name()
        .to_string_lossy()
        .starts_with(".monocode-txn-")));
}

#[test]
fn sharing_private_hook_and_snapshot_envelopes_stay_parseable_until_release() {
    let (_, source, home) = fixture();
    let hooks = source.join("hooks.json");
    std::fs::write(&hooks, br#"{"hooks":{"Stop":[]}}"#).unwrap();
    std::fs::hard_link(&hooks, home.join("hooks.json")).unwrap();
    let held = hold(&hooks);
    let error = prepare_files(&source, &home).unwrap_err();
    assert!(storage_io::sharing(&error), "{error}");
    let value: serde_json::Value = serde_json::from_str(&error).unwrap();
    assert!(value["io"]["path"]
        .as_str()
        .unwrap()
        .ends_with("hooks.json"));
    assert_eq!(std::fs::read(&hooks).unwrap(), br#"{"hooks":{"Stop":[]}}"#);
    drop(held);
    prepare_files(&source, &home).unwrap();
    assert!(!same_entry(&hooks, &home.join("hooks.json")));
    std::fs::write(source.join("AGENTS.md"), b"synthetic instructions").unwrap();
    prepare_files(&source, &home).unwrap();
    let snapshot = home.join(".monocode-links/AGENTS.md.json");
    let before = std::fs::read(&snapshot).unwrap();
    let held = hold(&snapshot);
    let error = prepare_files(&source, &home).unwrap_err();
    assert!(storage_io::sharing(&error), "{error}");
    let value: serde_json::Value = serde_json::from_str(&error).unwrap();
    assert!(value["io"]["path"]
        .as_str()
        .unwrap()
        .ends_with("AGENTS.md.json"));
    assert_eq!(std::fs::read(&snapshot).unwrap(), before);
    drop(held);
    prepare_files(&source, &home).unwrap();
}

#[test]
fn sharing_config_read_names_the_file_and_preserves_missing_config_default() {
    let (_, source, _) = fixture();
    assert!(skills::read_config(&source)
        .unwrap()
        .as_table()
        .unwrap()
        .is_empty());
    let path = source.join("config.toml");
    std::fs::write(&path, "model = \"synthetic\"\n").unwrap();
    let held = std::fs::OpenOptions::new()
        .read(true)
        .share_mode(0)
        .open(&path)
        .unwrap();
    let error = skills::read_config(&source).unwrap_err();
    let value: serde_json::Value = serde_json::from_str(&error).unwrap();
    assert_eq!(value["io"]["operation"], "read Codex configuration");
    assert_eq!(value["io"]["path"], crate::fs::path_to_js(&path));
    assert_eq!(value["io"]["osError"], 32);
    drop(held);
    assert_eq!(
        skills::read_config(&source).unwrap()["model"].as_str(),
        Some("synthetic")
    );
}
