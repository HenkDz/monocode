use super::*;

#[test]
fn cc0j_history_confirmation_rechecks_both_versions_and_rejects_foreign_paths() {
    let root = std::env::temp_dir().join(format!(
        "monocode-cc0j-history-choice-{}",
        uuid::Uuid::new_v4()
    ));
    let (source, home) = storage_roots(&root.join("source"), &root.join("mono")).unwrap();
    let day = source.join("sessions/2026/10/12");
    let mono_day = home.join("sessions/2026/10/12");
    std::fs::create_dir_all(&day).unwrap();
    std::fs::create_dir_all(&mono_day).unwrap();
    let name = "rollout-2026-10-12T00-00-00-a.jsonl";
    let incoming = day.join(name);
    let private = mono_day.join(name);
    std::fs::write(&incoming, b"incoming history").unwrap();
    std::fs::write(&private, b"private history").unwrap();
    let expected = choice(&incoming, &private).unwrap();
    std::fs::write(&private, b"new private history").unwrap();
    assert!(keep(&source, &home, &expected).is_err());
    let mut foreign = choice(&incoming, &private).unwrap();
    foreign.mono_path = crate::fs::path_to_js(&incoming);
    assert!(keep(&source, &home, &foreign).is_err());
    let current = choice(&incoming, &private).unwrap();
    let identity = entry_identity(&private).unwrap();
    keep(&source, &home, &current).unwrap();
    assert!(approved(&receipt(&home, &current).unwrap(), &current).unwrap());
    assert_eq!(std::fs::read(&incoming).unwrap(), b"incoming history");
    assert_eq!(std::fs::read(&private).unwrap(), b"new private history");
    assert_eq!(entry_identity(&private).unwrap(), identity);
    std::fs::remove_dir_all(root).unwrap();
}
