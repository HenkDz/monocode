use super::*;

const BINDING: &str = ".monocode-source.json";
const LIMIT: u64 = 8192;

mod reattach;
pub(super) use reattach::confirm as reattach_home;

pub(super) fn confirm_home(
    source: &Path,
    home: &Path,
    expected_source: &str,
    expected_identity: &str,
) -> Result<PathBuf, String> {
    let source = source.canonicalize().map_err(|e| e.to_string())?;
    #[cfg(windows)]
    let _source_guard = archive::lock_directory(&source)?;
    let id = entry_identity(&source)?;
    if crate::fs::path_to_js(&source) != expected_source
        || format!("{}:{}", id.0, id.1) != expected_identity
    {
        return Err("The selected source changed. Refresh before choosing a separate home.".into());
    }
    selected_home(&source, home, true)
}

pub(super) fn selected_home(source: &Path, home: &Path, confirm: bool) -> Result<PathBuf, String> {
    if !source.exists() && !confirm {
        return Ok(home.to_path_buf());
    }
    let source = source.canonicalize().map_err(|e| e.to_string())?;
    let key = serde_json::to_vec(&(source.clone(), entry_identity(&source)?))
        .map_err(|e| e.to_string())?;
    let name = format!(
        "{}-source-{:x}",
        home.file_name()
            .and_then(|name| name.to_str())
            .ok_or("Missing Mono account home")?,
        Sha256::digest(key)
    );
    let selected = home
        .parent()
        .ok_or("Missing Mono homes directory")?
        .join(name);
    // Original ownership takes precedence over historical separate-home choices.
    let original_matches = home.join(BINDING).exists() && ensure(&source, home, false).is_ok();
    let selected = if original_matches {
        home.to_path_buf()
    } else if let Some(reattached) = reattach::selected(&source, home)? {
        reattached
    } else {
        selected
    };
    if !confirm {
        if !selected.join(BINDING).exists() {
            if let Some(original) = reattach::recreated(&source, home)? {
                ensure(&source, &original, false)?;
            }
            return Ok(home.to_path_buf());
        }
        ensure(&source, &selected, false)?;
        return Ok(selected);
    }
    let mut leases = Vec::new();
    for base in [home, selected.as_path()]
        .into_iter()
        .collect::<HashSet<_>>()
    {
        if !base.exists() {
            continue;
        }
        if replaceable_link(base)? {
            return Err("Private homes must remain real directories.".into());
        }
        let mut contexts = vec![base.to_path_buf()];
        let root = base.join(".monocode-skill-contexts");
        if root.exists() {
            if replaceable_link(&root)? {
                return Err("Private contexts must remain real directories.".into());
            }
            for entry in std::fs::read_dir(&root).map_err(|e| e.to_string())? {
                let path = entry.map_err(|e| e.to_string())?.path();
                if path.is_dir() {
                    if replaceable_link(&path)? {
                        return Err("Private contexts must remain real directories.".into());
                    }
                    contexts.push(path);
                }
            }
        }
        for context in contexts {
            if context.join(".monocode-credential-lease.json").exists() {
                leases.push(credential_lifetime::ContextLease::exclusive(&context)?);
            }
        }
    }
    ensure(&source, &selected, false)?;
    Ok(selected)
}

pub(super) fn check_session_home(
    source: &Path,
    home: &Path,
    expected: Option<&str>,
) -> Result<(), String> {
    if expected.is_none_or(|expected| expected == crate::fs::path_to_js(home)) {
        return Ok(());
    }
    let id = entry_identity(source)?;
    Err(serde_json::json!({"recovery":true,
        "reason":"This conversation's provider thread belongs to a different private home. Choose this source's separate home to retry as a new provider conversation; the transcript and queue are retained.",
        "paths":[crate::fs::path_to_js(home), expected],
        "sourceBinding":{"resolvedSourceHome":crate::fs::path_to_js(source),"boundSourceHome":null,"canBind":false,"canSeparate":true,"sourceIdentity":format!("{}:{}",id.0,id.1)}}).to_string())
}

pub(super) fn return_choice(
    source: &Path,
    original: &Path,
    selected: &Path,
) -> Result<Option<String>, String> {
    if let Some(candidate) = reattach::recreated(source, original)? {
        if candidate != selected && ensure(source, &candidate, false).is_err() {
            return Ok(Some(format!("Codex storage needs repair: {}", issue(&candidate, source, Some(source), false,
                "This source also has earlier private history. You can keep using the current separate home or explicitly re-attach the earlier home; both homes and their conversations are retained."))));
        }
    }
    Ok(None)
}

pub(super) fn ensure_context(source: &Path, base: &Path, home: &Path) -> Result<(), String> {
    if base.join(BINDING).exists() {
        ensure(source, base, false)?;
        // Existing contexts inherit the private home's explicitly confirmed ownership.
        ensure(source, home, true)?;
    }
    Ok(())
}

pub(super) fn session_thread(
    home: &Path,
    original_home: &Path,
    expected: Option<&str>,
    current: Option<String>,
    threads: &HashMap<String, String>,
) -> Result<Option<String>, String> {
    if threads.len() > 64
        || threads.iter().any(|(home, id)| {
            home.is_empty() || home.len() > 4096 || validate_thread_id(id).is_err()
        })
    {
        return Err(
            "Invalid per-home provider threads; preserve the conversation before retrying.".into(),
        );
    }
    if let Some(id) = &current {
        validate_thread_id(id)?;
    }
    let selected = crate::fs::path_to_js(home);
    let original = crate::fs::path_to_js(original_home);
    // An unmapped legacy thread can only enter the original home, never a foreign one.
    if expected.unwrap_or(&original) == selected {
        return Ok(current);
    }
    Ok(threads.get(&selected).cloned())
}

pub(super) fn guard_bound_contexts(base: &Path) -> Result<(), String> {
    if !base.join(BINDING).exists() {
        return Ok(());
    }
    let path = base.join(BINDING);
    #[cfg(windows)]
    let file = open_entry(&path, true)?;
    #[cfg(unix)]
    let file = std::fs::File::open(&path).map_err(|e| e.to_string())?;
    if !credential_lifetime::private_single_file(&file) {
        return Err("Source-account binding must remain a private single-link file".into());
    }
    let mut bytes = Vec::new();
    (&file)
        .take(LIMIT + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() as u64 > LIMIT {
        return Err("Source-account binding exceeds its size limit".into());
    }
    let binding: SourceBinding =
        serde_json::from_slice(&bytes).map_err(|_| "Invalid source-account binding")?;
    drop(file);
    ensure(&binding.source_home, base, false)?;
    let contexts = base.join(".monocode-skill-contexts");
    if !contexts.exists() {
        return Ok(());
    }
    if replaceable_link(&contexts)? {
        return Err("Private contexts must remain a real directory".into());
    }
    for entry in std::fs::read_dir(contexts).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        if entry.file_type().map_err(|e| e.to_string())?.is_dir()
            && entry.path().join(BINDING).exists()
        {
            ensure(&binding.source_home, &entry.path(), false)?;
        }
    }
    Ok(())
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct SourceBinding {
    version: u8,
    source_home: PathBuf,
    source_identity: (u64, u64),
}

fn issue(home: &Path, source: &Path, bound: Option<&Path>, can_bind: bool, reason: &str) -> String {
    serde_json::json!({
        "recovery": true, "reason": reason,
        "paths": [crate::fs::path_to_js(home), crate::fs::path_to_js(source)],
        "sourceBinding": {"resolvedSourceHome": crate::fs::path_to_js(source),
            "boundSourceHome": bound.map(crate::fs::path_to_js), "canBind": can_bind,
            "canSeparate": bound.is_some(), "canReturn": bound == Some(source),
            "sourceIdentity": entry_identity(source).ok().map(|id| format!("{}:{}",id.0,id.1))}
    })
    .to_string()
}

pub(super) fn ensure(source: &Path, home: &Path, confirm_legacy: bool) -> Result<(), String> {
    let (source, home) = storage_roots(source, home)?;
    #[cfg(windows)]
    let _home_guard = archive::lock_directory(&home)?;
    let path = home.join(BINDING);
    let identity = entry_identity(&source)?;
    match std::fs::symlink_metadata(&path) {
        Ok(metadata) => {
            let invalid = || {
                issue(&home, &source, None, false,
                "The source-account binding is invalid. Preserve it and review the private home before choosing an account.")
            };
            if !metadata.is_file() || replaceable_link(&path)? || metadata.len() > LIMIT {
                return Err(invalid());
            }
            #[cfg(windows)]
            let file = open_entry(&path, true)?;
            #[cfg(unix)]
            let file = std::fs::File::open(&path).map_err(|e| e.to_string())?;
            if !credential_lifetime::private_single_file(&file) {
                return Err(invalid());
            }
            let mut bytes = Vec::new();
            file.take(LIMIT + 1)
                .read_to_end(&mut bytes)
                .map_err(|e| e.to_string())?;
            if bytes.len() as u64 > LIMIT {
                return Err(invalid());
            }
            let binding: SourceBinding = serde_json::from_slice(&bytes).map_err(|_| invalid())?;
            if binding.version != 1
                || !binding.source_home.is_absolute()
                || binding.source_home.as_os_str().len() > 4096
            {
                return Err(invalid());
            }
            if binding.source_home == source
                && (binding.source_identity == identity
                    || reattach::approved(&source, &home, &binding)?)
            {
                return Ok(());
            }
            if binding.source_identity != identity || binding.source_home != source {
                return Err(issue(&home, &source, Some(&binding.source_home), false,
                    "This private Mono home belongs to a different source or an earlier source directory. Choose a separate Mono home for the selected source, or reopen with the original source. Existing private sessions and credentials stay in their original home."));
            }
            return Ok(());
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(error.to_string()),
    }
    if !confirm_legacy
        && std::fs::read_dir(&home)
            .map_err(|e| e.to_string())?
            .next()
            .is_some()
    {
        return Err(issue(&home, &source, None, true,
            "This existing private home has no source-account binding; its legacy contexts may refer to different accounts. Select the original Codex provider account or launch with its CODEX_HOME, then explicitly confirm that source. No existing link or credential was changed."));
    }
    let binding = SourceBinding {
        version: 1,
        source_home: source.clone(),
        source_identity: identity,
    };
    if serde_json::to_vec(&binding)
        .map_err(|e| e.to_string())?
        .len() as u64
        > LIMIT
    {
        return Err("Source-account binding exceeds its size limit".into());
    }
    let temp = home.join(format!(".monocode-source-{}.pending", uuid::Uuid::new_v4()));
    transactions::create_json(&temp, &binding)?;
    let record = transactions::RecordedEntry::new(&temp)?;
    #[cfg(test)]
    crash_tests::checkpoint("source-binding-before-publish");
    record.publish(&temp, &path)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recreated_existing_separate_home_remains_returnable_after_choosing_another_separate_home() {
        let root = std::env::temp_dir().join(format!(
            "monocode-cc0l-old-separate-{}",
            uuid::Uuid::new_v4()
        ));
        let (desktop, original) = storage_roots(&root.join("desktop"), &root.join("mono")).unwrap();
        ensure(&desktop, &original, false).unwrap();
        let source = root.join("orca");
        std::fs::create_dir(&source).unwrap();
        let source = source.canonicalize().unwrap();
        let old = selected_home(&source, &original, true).unwrap();
        std::fs::write(old.join("history.jsonl"), b"CC0J/CC0K separate history").unwrap();
        let binding = std::fs::read(old.join(BINDING)).unwrap();
        std::fs::rename(&source, root.join("old-orca")).unwrap();
        std::fs::create_dir(&source).unwrap();
        let new = selected_home(&source, &original, true).unwrap();
        assert_ne!(old, new);
        assert!(return_choice(&source, &original, &new).unwrap().is_some());
        let id = entry_identity(&source).unwrap();
        reattach_home(
            &source,
            &original,
            &crate::fs::path_to_js(&source),
            &format!("{}:{}", id.0, id.1),
        )
        .unwrap();
        assert_eq!(selected_home(&source, &original, false).unwrap(), old);
        assert_eq!(std::fs::read(old.join(BINDING)).unwrap(), binding);
        assert_eq!(
            std::fs::read(old.join("history.jsonl")).unwrap(),
            b"CC0J/CC0K separate history"
        );
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn separate_recreated_sources_keep_an_explicit_return_after_reload_in_both_launch_modes() {
        for mode in ["desktop", "orca"] {
            let root = std::env::temp_dir().join(format!(
                "monocode-cc0l-return-{mode}-{}",
                uuid::Uuid::new_v4()
            ));
            let (source, original) = storage_roots(&root.join(mode), &root.join("mono")).unwrap();
            ensure(&source, &original, false).unwrap();
            std::fs::write(original.join("history.jsonl"), b"original private history").unwrap();
            let binding = std::fs::read(original.join(BINDING)).unwrap();
            std::fs::rename(&source, root.join("old-source")).unwrap();
            std::fs::create_dir(&source).unwrap();
            let separate = selected_home(&source, &original, true).unwrap();
            std::fs::write(separate.join("history.jsonl"), b"separate history").unwrap();
            let reloaded = selected_home(&source, &original, false).unwrap();
            assert_eq!(reloaded, separate);
            let choice: serde_json::Value = serde_json::from_str(
                return_choice(&source, &original, &reloaded)
                    .unwrap()
                    .unwrap()
                    .strip_prefix("Codex storage needs repair: ")
                    .unwrap(),
            )
            .unwrap();
            assert_eq!(choice["sourceBinding"]["canReturn"], true);
            let identity = choice["sourceBinding"]["sourceIdentity"].as_str().unwrap();
            reattach_home(
                &source,
                &original,
                &crate::fs::path_to_js(&source),
                identity,
            )
            .unwrap();
            assert_eq!(selected_home(&source, &original, false).unwrap(), original);
            assert!(return_choice(&source, &original, &original)
                .unwrap()
                .is_none());
            assert_eq!(std::fs::read(original.join(BINDING)).unwrap(), binding);
            assert_eq!(
                std::fs::read(original.join("history.jsonl")).unwrap(),
                b"original private history"
            );
            assert_eq!(
                std::fs::read(separate.join("history.jsonl")).unwrap(),
                b"separate history"
            );
            std::fs::remove_dir_all(root).unwrap();
        }
    }

    #[test]
    fn source_transitions_refuse_before_relinking_and_aliases_reuse_binding() {
        let root =
            std::env::temp_dir().join(format!("monocode-cc0i-binding-{}", uuid::Uuid::new_v4()));
        let (desktop, home) = storage_roots(&root.join("desktop"), &root.join("mono")).unwrap();
        let (terminal, named) =
            storage_roots(&root.join("terminal"), &root.join("named-mono")).unwrap();
        ensure(&desktop, &home, false).unwrap();
        let original = std::fs::read(home.join(BINDING)).unwrap();
        let binding_identity = entry_identity(&home.join(BINDING)).unwrap();
        ensure(&desktop.join("."), &home, false).unwrap();
        for confirm in [false, true] {
            let error = ensure(&terminal, &home, confirm).unwrap_err();
            let value: serde_json::Value = serde_json::from_str(&error).unwrap();
            assert_eq!(value["sourceBinding"]["canBind"], false);
            assert_eq!(std::fs::read(home.join(BINDING)).unwrap(), original);
            assert_eq!(
                entry_identity(&home.join(BINDING)).unwrap(),
                binding_identity
            );
        }
        ensure(&terminal, &named, false).unwrap();
        assert_ne!(std::fs::read(named.join(BINDING)).unwrap(), original);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn unbound_mixed_contexts_require_an_explicit_source_choice_and_preserve_data() {
        let root = std::env::temp_dir().join(format!(
            "monocode-cc0i-legacy-binding-{}",
            uuid::Uuid::new_v4()
        ));
        let (source, home) = storage_roots(&root.join("source"), &root.join("mono")).unwrap();
        std::fs::write(source.join("AGENTS.md"), b"source").unwrap();
        std::fs::write(home.join("private.jsonl"), b"private session").unwrap();
        let context = private_directory(&home, ".monocode-skill-contexts").unwrap();
        std::fs::write(context.join("legacy-owner"), b"ambiguous legacy context").unwrap();
        let error = ensure(&source, &home, false).unwrap_err();
        let value: serde_json::Value = serde_json::from_str(&error).unwrap();
        assert_eq!(value["sourceBinding"]["canBind"], true);
        assert!(!home.join(BINDING).exists());
        ensure(&source, &home, true).unwrap();
        assert_eq!(
            std::fs::read(home.join("private.jsonl")).unwrap(),
            b"private session"
        );
        assert_eq!(
            std::fs::read(context.join("legacy-owner")).unwrap(),
            b"ambiguous legacy context"
        );
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn invalid_and_oversized_bindings_never_become_user_confirmable() {
        for bytes in [
            b"{}".to_vec(),
            vec![b' '; LIMIT as usize + 1],
            br#"{"version":1,"sourceHome":"relative","sourceIdentity":[1,2],"unknown":true}"#
                .to_vec(),
        ] {
            let root = std::env::temp_dir().join(format!(
                "monocode-cc0i-invalid-binding-{}",
                uuid::Uuid::new_v4()
            ));
            let (source, home) = storage_roots(&root.join("source"), &root.join("mono")).unwrap();
            std::fs::write(home.join(BINDING), &bytes).unwrap();
            for confirm in [false, true] {
                let error = ensure(&source, &home, confirm).unwrap_err();
                let value: serde_json::Value = serde_json::from_str(&error).unwrap();
                assert_eq!(value["sourceBinding"]["canBind"], false);
                assert_eq!(std::fs::read(home.join(BINDING)).unwrap(), bytes);
            }
            std::fs::remove_dir_all(root).unwrap();
        }
    }

    #[test]
    fn a_context_bound_to_another_source_blocks_before_retention_or_relinking() {
        let root = std::env::temp_dir().join(format!(
            "monocode-cc0i-context-binding-{}",
            uuid::Uuid::new_v4()
        ));
        let (source, home) = storage_roots(&root.join("source"), &root.join("mono")).unwrap();
        let other = root.join("other");
        std::fs::create_dir(&other).unwrap();
        ensure(&source, &home, false).unwrap();
        let context = private_directory(
            &private_directory(&home, ".monocode-skill-contexts").unwrap(),
            &"a".repeat(64),
        )
        .unwrap();
        ensure(&other, &context, false).unwrap();
        std::fs::write(
            context.join("private.jsonl"),
            b"other source's private turns",
        )
        .unwrap();
        assert!(ensure_context(&source, &home, &context).is_err());
        assert!(guard_bound_contexts(&home).is_err());
        assert_eq!(
            std::fs::read(context.join("private.jsonl")).unwrap(),
            b"other source's private turns"
        );
        std::fs::remove_dir_all(root).unwrap();
    }
}
