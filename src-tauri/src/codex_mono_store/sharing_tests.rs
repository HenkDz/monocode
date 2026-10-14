//! Real Windows sharing handles in disposable homes, without provider calls.
use super::*;
use std::os::windows::fs::OpenOptionsExt;
use windows_sys::Win32::Storage::FileSystem::{FILE_SHARE_READ, FILE_SHARE_WRITE};

fn fixture() -> (PathBuf, PathBuf, PathBuf) {
    let root = std::env::temp_dir().join(format!("monocode-cc0n-{}", uuid::Uuid::new_v4()));
    let source = root.join("account");
    let home = root.join("mono");
    std::fs::create_dir_all(&source).unwrap();
    std::fs::create_dir_all(&home).unwrap();
    (root, source, home)
}

fn hold(path: &Path) -> std::fs::File {
    std::fs::OpenOptions::new().read(true).write(true)
        .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE).open(path).unwrap()
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
        ("open_entry(delete access)", 32, open_entry(&path, true).map(|_| ())),
        ("replace_link(MoveFileExW)", 5, replace_link(&temp, &path)),
        ("remove_file", 32, std::fs::remove_file(&path).map_err(|e| e.to_string())),
    ] {
        let error = result.unwrap_err();
        assert!(error.contains(&format!("os error {expected_code}")), "{operation}: {error}");
        println!("DIAGNOSIS {operation} {}: {error}", path.display());
    }
    drop(held);
    let db = home.join("logs_2.sqlite");
    let conn = rusqlite::Connection::open(&db).unwrap();
    conn.execute_batch("PRAGMA journal_mode=WAL; CREATE TABLE synthetic(value); INSERT INTO synthetic VALUES (1);").unwrap();
    for name in ["logs_2.sqlite", "logs_2.sqlite-wal", "logs_2.sqlite-shm"] {
        let path = home.join(name);
        let result = open_entry(&path, true).map(|_| ());
        println!("DIAGNOSIS SQLite delete-access {}: {result:?}", path.display());
        assert!(result.unwrap_err().contains("os error 32"));
    }
    prepare_files(&source, &home).unwrap();
    println!("DIAGNOSIS held SQLite prepare succeeds {}", root.display());
    drop(conn);
}

#[test]
fn diagnosis_prepare_and_migration_contention() {
    let (root, source, home) = fixture();
    for name in ["AGENTS.md", ".codex-global-state.json", "..codex-global-state.json.tmp-1-synthetic"] {
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
        println!("DIAGNOSIS prepare held {name} {}: {result:?}", target.display());
        if required_entry(name) { assert!(result.unwrap_err().contains("os error 32")); }
        else { assert!(result.is_ok()); }
        assert_eq!(std::fs::read(&target).unwrap(), b"old bytes");
        drop(held);
        prepare_files(&source, &home).unwrap();
    }
    let dir = source.join("sessions/2026/10/14");
    std::fs::create_dir_all(&dir).unwrap();
    let rollout = dir.join("rollout-2026-10-14T00-00-00-lock-thread.jsonl");
    std::fs::write(&rollout, "{\"type\":\"session_meta\",\"payload\":{\"id\":\"lock-thread\"}}\n").unwrap();
    let held = hold(&rollout);
    let error = copy_rollouts(&source, &home, "lock-thread", &[rollout.clone()]).unwrap_err();
    assert!(error.contains("os error 32"));
    println!("DIAGNOSIS migration open(read excluding writer) {}: {error}", rollout.display());
    drop(held);
    copy_rollouts(&source, &home, "lock-thread", &[rollout]).unwrap();
    println!("DIAGNOSIS next migration succeeds {}", root.display());
}
