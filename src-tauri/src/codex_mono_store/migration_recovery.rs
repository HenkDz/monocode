use super::*;

#[cfg(test)]
#[path = "migration_recovery_tests.rs"]
mod tests;

#[derive(Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct MigrationChoice {
    source_path: String,
    mono_path: String,
    source_fingerprint: String,
    mono_fingerprint: String,
    source_identity: String,
    mono_identity: String,
}

fn choice(source: &Path, mono: &Path) -> Result<MigrationChoice, String> {
    let identity = |path: &Path| entry_identity(path).map(|id| format!("{}:{}", id.0, id.1));
    if replaceable_link(mono)? || !mono.is_file() {
        return Err(
            "Private history must remain a real file; the existing entry was preserved.".into(),
        );
    }
    Ok(MigrationChoice {
        source_path: crate::fs::path_to_js(source),
        mono_path: crate::fs::path_to_js(mono),
        source_fingerprint: fingerprint(source)?,
        mono_fingerprint: fingerprint(mono)?,
        source_identity: identity(source)?,
        mono_identity: identity(mono)?,
    })
}

fn receipt(home: &Path, choice: &MigrationChoice) -> Result<PathBuf, String> {
    let bytes = serde_json::to_vec(choice).map_err(|e| e.to_string())?;
    Ok(private_directory(home, ".monocode-migration-choices")?
        .join(format!("{:x}.json", Sha256::digest(bytes))))
}

fn approved(path: &Path, expected: &MigrationChoice) -> Result<bool, String> {
    if !path.exists() {
        return Ok(false);
    }
    if replaceable_link(path)? || std::fs::metadata(path).map_err(|e| e.to_string())?.len() > 16384
    {
        return Err("The private-history choice record changed; it was preserved.".into());
    }
    #[cfg(windows)]
    let file = open_entry(path, true)?;
    #[cfg(unix)]
    let file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    if !credential_lifetime::private_single_file(&file) {
        return Err("History choice must remain a private single-link file.".into());
    }
    let mut bytes = Vec::new();
    file.take(16385)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() > 16384 {
        return Err("Private-history choice exceeds its size limit.".into());
    }
    let actual: MigrationChoice =
        serde_json::from_slice(&bytes).map_err(|_| "Invalid private-history choice record")?;
    Ok(actual == *expected)
}

pub(super) fn retain_private(
    home: &Path,
    source: &Path,
    mono: &Path,
    preserved: &Path,
) -> Result<(), String> {
    let migration = choice(source, mono)?;
    if fingerprint(preserved)? != migration.source_fingerprint {
        return Err("The source history changed after archival. Both versions were preserved; refresh before choosing.".into());
    }
    if approved(&receipt(home, &migration)?, &migration)? {
        return Ok(());
    }
    Err(serde_json::json!({"recovery":true,
        "reason":"The incoming history was archived. Keep the private history to retry migration without replacing any private turns. This choice applies only to the displayed versions.",
        "paths":[crate::fs::path_to_js(mono),crate::fs::path_to_js(preserved),crate::fs::path_to_js(source)],
        "migration":migration}).to_string())
}

pub(super) fn keep(
    source_home: &Path,
    home: &Path,
    expected: &MigrationChoice,
) -> Result<(), String> {
    let source = PathBuf::from(&expected.source_path)
        .canonicalize()
        .map_err(|e| e.to_string())?;
    let supplied_mono = PathBuf::from(&expected.mono_path);
    if replaceable_link(&supplied_mono)? {
        return Err("Private history must remain a real file.".into());
    }
    let mono = supplied_mono.canonicalize().map_err(|e| e.to_string())?;
    let allowed = [
        source_home.join("sessions"),
        source_home.join("archived_sessions"),
    ];
    if !allowed
        .iter()
        .filter_map(|root| root.canonicalize().ok())
        .any(|root| source.starts_with(root))
    {
        return Err("The incoming history is outside the selected source account.".into());
    }
    let name = source
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or("Invalid rollout filename")?;
    let date = name.get(8..18).ok_or("Missing rollout date")?;
    if !name.starts_with("rollout-")
        || !(name.ends_with(".jsonl") || name.ends_with(".jsonl.zst"))
        || !date.bytes().enumerate().all(|(i, b)| {
            if i == 4 || i == 7 {
                b == b'-'
            } else {
                b.is_ascii_digit()
            }
        })
        || mono
            != home
                .join("sessions")
                .join(&date[..4])
                .join(&date[5..7])
                .join(&date[8..10])
                .join(name)
    {
        return Err("The history choice does not belong to this private home.".into());
    }
    let mut parent = private_directory(home, "sessions")?;
    for part in [&date[..4], &date[5..7], &date[8..10]] {
        parent = private_directory(&parent, part)?;
    }
    let actual = choice(&source, &mono)?;
    if actual != *expected {
        return Err("History changed since this issue was shown. Refresh before keeping its private version.".into());
    }
    let mut original = std::fs::File::open(&source).map_err(|e| e.to_string())?;
    archive_file(home, name, &mut original, &actual.source_fingerprint)?;
    if choice(&source, &mono)? != actual {
        return Err("History changed during confirmation; no private bytes were replaced.".into());
    }
    let path = receipt(home, &actual)?;
    if approved(&path, &actual)? {
        return Ok(());
    }
    let temp = path.with_file_name(format!(".monocode-choice-{}.pending", uuid::Uuid::new_v4()));
    transactions::create_json(&temp, &actual)?;
    transactions::RecordedEntry::new(&temp)?.publish(&temp, &path)
}
