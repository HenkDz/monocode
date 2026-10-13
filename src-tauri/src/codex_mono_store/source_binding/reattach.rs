use super::*;

#[derive(Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
struct Receipt {
    version: u8,
    binding_identity: (u64, u64),
    binding_fingerprint: String,
    source_identity: (u64, u64),
}

fn read<T: serde::de::DeserializeOwned>(path: &Path) -> Result<T, String> {
    #[cfg(windows)]
    let file = open_entry(path, true)?;
    #[cfg(unix)]
    let file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    if !credential_lifetime::private_single_file(&file) {
        return Err("Source confirmation must remain a private single-link file.".into());
    }
    let mut bytes = Vec::new();
    file.take(LIMIT + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() as u64 > LIMIT {
        return Err("Source confirmation exceeds its size limit.".into());
    }
    serde_json::from_slice(&bytes)
        .map_err(|_| "Invalid source confirmation; preserve it before retrying.".into())
}

fn binding(home: &Path) -> Result<SourceBinding, String> {
    let value: SourceBinding = read(&home.join(BINDING))?;
    if value.version != 1
        || !value.source_home.is_absolute()
        || value.source_home.as_os_str().len() > 4096
    {
        return Err("Invalid source-account binding.".into());
    }
    Ok(value)
}

fn receipt(source: &Path, home: &Path) -> Result<(PathBuf, Receipt), String> {
    let identity = entry_identity(source)?;
    let path = home.join(format!(
        ".monocode-source-reattach-{:x}.json",
        Sha256::digest(serde_json::to_vec(&identity).map_err(|e| e.to_string())?)
    ));
    Ok((
        path,
        Receipt {
            version: 1,
            binding_identity: entry_identity(&home.join(BINDING))?,
            binding_fingerprint: fingerprint(&home.join(BINDING))?,
            source_identity: identity,
        },
    ))
}

pub(super) fn approved(source: &Path, home: &Path, old: &SourceBinding) -> Result<bool, String> {
    if old.source_home != source {
        return Ok(false);
    }
    let (path, expected) = receipt(source, home)?;
    match std::fs::symlink_metadata(&path) {
        Ok(_) => Ok(read::<Receipt>(&path)? == expected),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(e) => Err(e.to_string()),
    }
}

fn candidates(home: &Path) -> Result<Vec<PathBuf>, String> {
    let mut result = vec![home.to_path_buf()];
    let prefix = format!(
        "{}-source-",
        home.file_name()
            .and_then(|n| n.to_str())
            .ok_or("Missing account home")?
    );
    let parent = home.parent().ok_or("Missing account homes")?;
    if !parent.exists() {
        return Ok(result);
    }
    for entry in std::fs::read_dir(parent).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name.strip_prefix(&prefix).is_some_and(|key| {
            key.len() == 64
                && key
                    .bytes()
                    .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
        }) {
            if replaceable_link(&entry.path())? {
                return Err("Private homes must remain real directories.".into());
            }
            result.push(entry.path());
        }
    }
    Ok(result)
}

pub(super) fn selected(source: &Path, home: &Path) -> Result<Option<PathBuf>, String> {
    let mut matches = Vec::new();
    for candidate in candidates(home)? {
        if !candidate.join(BINDING).exists() {
            continue;
        }
        let old = binding(&candidate)?;
        if old.source_home == source && approved(source, &candidate, &old)? {
            matches.push(candidate);
        }
    }
    if matches.len() > 1 {
        return Err("Multiple reattached homes match this source; preserve them and review their ownership.".into());
    }
    Ok(matches.pop())
}

pub(super) fn recreated(source: &Path, home: &Path) -> Result<Option<PathBuf>, String> {
    let mut matches = Vec::new();
    let identity = entry_identity(source)?;
    for candidate in candidates(home)? {
        if candidate.join(BINDING).exists() {
            let old = binding(&candidate)?;
            if old.source_home == source && old.source_identity != identity {
                matches.push(candidate);
            }
        }
    }
    if matches.contains(&home.to_path_buf()) {
        return Ok(Some(home.to_path_buf()));
    }
    if matches.len() > 1 {
        return Err(
            "Multiple original homes match this recreated source; preserve them before choosing."
                .into(),
        );
    }
    Ok(matches.pop())
}

pub(in crate::codex_mono_store) fn confirm(
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
        return Err(
            "The selected source changed. Refresh before returning to its original home.".into(),
        );
    }
    let selected = recreated(&source, home)?.ok_or("The original private home cannot be identified safely. Preserve the source choices before retrying.")?;
    let mut contexts = vec![selected.clone()];
    let root = selected.join(".monocode-skill-contexts");
    if root.exists() {
        if replaceable_link(&root)? {
            return Err("Private contexts must remain real directories.".into());
        }
        for entry in std::fs::read_dir(&root).map_err(|e| e.to_string())? {
            let path = entry.map_err(|e| e.to_string())?.path();
            if replaceable_link(&path)? {
                return Err("Private contexts must remain real directories.".into());
            }
            if path.is_dir() && path.join(BINDING).exists() {
                contexts.push(path);
            }
        }
    }
    let mut leases = Vec::new();
    for context in &contexts {
        if binding(context)?.source_home != source {
            return Err("A private context belongs to another source; it was preserved.".into());
        }
        if context.join(".monocode-credential-lease.json").exists() {
            leases.push(credential_lifetime::ContextLease::exclusive(context)?);
        }
    }
    for context in &contexts {
        #[cfg(windows)]
        let _guard = archive::lock_directory(context)?;
        #[cfg(windows)]
        let _binding_guard = open_entry(&context.join(BINDING), true)?;
        let (path, expected) = receipt(&source, context)?;
        if path.exists() {
            if read::<Receipt>(&path)? != expected {
                return Err("The source confirmation changed; it was preserved.".into());
            }
            continue;
        }
        if entry_identity(&source)? != id {
            return Err("The selected source changed during confirmation.".into());
        }
        let temp = context.join(format!(".monocode-source-{}.pending", uuid::Uuid::new_v4()));
        transactions::create_json(&temp, &expected)?;
        transactions::RecordedEntry::new(&temp)?.publish(&temp, &path)?;
    }
    ensure(&source, &selected, false)?;
    Ok(selected)
}
