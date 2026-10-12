use std::collections::BTreeMap;
use std::io::{Read, Write};
use std::path::Path;

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

#[cfg(test)]
thread_local! {
    static FAIL_NEXT_BACKUP_WRITE: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
    static FAIL_NEXT_CLAIM_DISCARD: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
    static FAIL_NEXT_SNAPSHOT_WRITE: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SandboxConfigChange {
    config_path: String,
    backup_path: String,
    backup_paths: Vec<String>,
}

#[derive(Deserialize, Default)]
struct WindowsConfig {
    sandbox: Option<toml::Spanned<String>>,
}

#[derive(Deserialize, Default)]
struct ProfileConfig {
    windows: Option<toml::Spanned<WindowsConfig>>,
}

#[derive(Deserialize)]
struct Config {
    windows: Option<toml::Spanned<WindowsConfig>>,
    profile: Option<String>,
    #[serde(default)]
    profiles: BTreeMap<String, ProfileConfig>,
}

fn unelevated_config(text: &str) -> Result<String, String> {
    let config: Config = toml::from_str(text)
        .map_err(|_| "Could not parse Codex account configuration".to_string())?;
    let mut edits = Vec::new();
    let mut set_windows = |windows: &toml::Spanned<WindowsConfig>, dotted_path: &str| {
        if let Some(sandbox) = &windows.get_ref().sandbox {
            edits.push((sandbox.span(), "\"unelevated\"".to_string()));
        } else {
            let start = windows.span().start;
            let rest = &text[start..];
            if rest.starts_with('{') {
                edits.push((start + 1..start + 1, "sandbox = \"unelevated\", ".into()));
            } else {
                if rest.starts_with('[') {
                    let offset = rest.find('\n').map_or(text.len(), |end| start + end + 1);
                    let prefix = if offset > 0 && !text[..offset].ends_with('\n') {
                        "\n"
                    } else {
                        ""
                    };
                    edits.push((
                        offset..offset,
                        format!("{prefix}sandbox = \"unelevated\"\n"),
                    ));
                } else {
                    edits.push((0..0, format!("{dotted_path}.sandbox = \"unelevated\"\n")));
                }
            }
        }
    };
    if let Some(windows) = &config.windows {
        set_windows(windows, "windows");
    }
    if let Some(windows) = config
        .profile
        .as_ref()
        .and_then(|profile| config.profiles.get(profile))
        .and_then(|profile| profile.windows.as_ref())
    {
        let profile = toml::Value::String(config.profile.clone().unwrap());
        set_windows(windows, &format!("profiles.{profile}.windows"));
    }
    edits.sort_by_key(|(span, _)| std::cmp::Reverse(span.start));
    let mut updated = text.to_string();
    for (span, replacement) in edits {
        updated.replace_range(span, &replacement);
    }
    if config.windows.is_none() {
        updated.push_str("\n[windows]\nsandbox = \"unelevated\"\n");
    }
    let checked: toml::Value = toml::from_str(&updated)
        .map_err(|_| "Could not safely update the Codex sandbox setting".to_string())?;
    if checked
        .get("windows")
        .and_then(|value| value.get("sandbox"))
        .and_then(toml::Value::as_str)
        != Some("unelevated")
    {
        return Err("Could not safely update the Codex sandbox setting".into());
    }
    if let Some(windows) = config
        .profile
        .as_ref()
        .and_then(|profile| checked.get("profiles")?.get(profile)?.get("windows"))
    {
        if windows.get("sandbox").and_then(toml::Value::as_str) != Some("unelevated") {
            return Err("Could not safely update the active Codex profile sandbox setting".into());
        }
    }
    Ok(updated)
}

pub(super) fn private_overrides(
    source: &Path,
    home: &Path,
) -> Result<Option<serde_json::Value>, String> {
    if !cfg!(windows) {
        return Ok(None);
    }
    let path = home.join("config.toml");
    if !path.is_file()
        || std::fs::symlink_metadata(&path)
            .map_err(|error| error.to_string())?
            .file_type()
            .is_symlink()
        || super::same_entry(&source.join("config.toml"), &path)
    {
        return Ok(None);
    }
    let config = super::skills::read_config(home)?;
    let Some(engine) = config
        .get("windows")
        .and_then(|windows| windows.get("sandbox"))
    else {
        return Ok(None);
    };
    let engine = engine
        .as_str()
        .ok_or("Private Mono Windows sandbox engine must be a string")?;
    // Keep config/read's resolved account paths and all unrelated project settings.
    Ok(Some(serde_json::json!({"windows": {"sandbox": engine}})))
}

fn change_configs(source: &Path, home: &Path) -> Result<SandboxConfigChange, String> {
    super::transactions::reconcile(home)?;
    let config_path = home.join("config.toml");
    let source_path = source.join("config.toml");
    let existing = match std::fs::symlink_metadata(&config_path) {
        Ok(metadata) => {
            if !metadata.is_file() && !metadata.file_type().is_symlink() {
                return Err("Mono Codex config must be a real file or an account file link".into());
            }
            true
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => false,
        Err(error) => return Err(error.to_string()),
    };
    let linked = existing && super::replaceable_link(&config_path)?;
    if linked && !super::same_entry(&source_path, &config_path) {
        return Err("Linked Mono Codex config no longer matches the selected account".into());
    }
    let original_path = if !existing || linked {
        &source_path
    } else {
        &config_path
    };
    let mut options = std::fs::OpenOptions::new();
    options.read(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        use windows_sys::Win32::Storage::FileSystem::{
            FILE_FLAG_OPEN_REPARSE_POINT, FILE_SHARE_DELETE, FILE_SHARE_READ,
        };
        // A private hardlink must be claimable without granting writes to the account file.
        options
            .share_mode(FILE_SHARE_READ | FILE_SHARE_DELETE)
            .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT);
    }
    let mut original_file = options.open(original_path).map_err(|error| {
        format!(
            "Could not open Codex config {}: {error}",
            original_path.display()
        )
    })?;
    let metadata = original_file
        .metadata()
        .map_err(|error| error.to_string())?;
    #[cfg(windows)]
    let is_reparse = super::handle_file_info(&original_file)?.dwFileAttributes
        & windows_sys::Win32::Storage::FileSystem::FILE_ATTRIBUTE_REPARSE_POINT
        != 0;
    #[cfg(not(windows))]
    let is_reparse = std::fs::symlink_metadata(original_path)
        .map_err(|error| error.to_string())?
        .file_type()
        .is_symlink();
    if !metadata.is_file() || is_reparse {
        return Err("Codex config must be a real file before switching the Mono sandbox".into());
    }
    let mut original = String::new();
    original_file
        .read_to_string(&mut original)
        .map_err(|error| format!("Could not read Codex config: {error}"))?;
    let updated = unelevated_config(&original)?;
    let original_id = super::file_identity(&original_file)?;
    let fingerprint = super::fingerprint_file(&mut original_file)?;
    super::snapshot_path(home, "config.toml")?;
    let temp = home.join(format!(".monocode-link-{}", uuid::Uuid::new_v4()));
    let mut staged = None;
    let mut backups = Vec::new();
    let result = (|| {
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(windows)]
        {
            use std::os::windows::fs::OpenOptionsExt;
            options.share_mode(windows_sys::Win32::Storage::FileSystem::FILE_SHARE_READ);
        }
        let mut file = options.open(&temp).map_err(|error| error.to_string())?;
        file.write_all(updated.as_bytes())
            .map_err(|error| error.to_string())?;
        file.sync_all().map_err(|error| error.to_string())?;
        #[cfg(not(windows))]
        file.set_permissions(metadata.permissions())
            .map_err(|error| error.to_string())?;
        staged = Some(super::transactions::RecordedEntry::new(&temp)?);
        drop(file);
        let stage = staged.as_ref().unwrap();
        #[cfg(test)]
        super::before_claim();
        let mut claimed = if existing {
            Some(super::ClaimedEntry::new(
                &config_path,
                super::ClaimIntent::PrivateConfig,
                Some(stage),
            )?)
        } else {
            None
        };
        #[cfg(windows)]
        let file = stage.pin_attributes(&temp)?;
        let result = (|| {
            if let Some(claimed) = &claimed {
                let current =
                    std::fs::File::open(&claimed.path).map_err(|error| error.to_string())?;
                if super::file_identity(&current)? != original_id
                    || super::fingerprint_file(&mut original_file)? != fingerprint
                {
                    return Err(
                        "Mono Codex config changed during sandbox repair; retry the action".into(),
                    );
                }
            }
            #[cfg(test)]
            if FAIL_NEXT_BACKUP_WRITE.with(|flag| flag.replace(false)) {
                return Err("Could not finish config backup: Synthetic backup write failure; original config files are unchanged".into());
            }
            let backup = super::archive_file(home, "config.toml", &mut original_file, &fingerprint)
                .map_err(|error| format!("Could not finish config backup: {error}; original config files are unchanged"))?;
            backups.push(crate::fs::path_to_js(&backup));
            std::fs::set_permissions(&backup, metadata.permissions())
                .map_err(|error| error.to_string())?;
            if let Some(claimed) = &mut claimed {
                claimed.journal.verify(Some(&backup))?;
                #[cfg(test)]
                super::crash_tests::checkpoint("sandbox-before-discard");
                #[cfg(test)]
                if FAIL_NEXT_CLAIM_DISCARD.with(|flag| flag.replace(false)) {
                    return Err(
                        "Synthetic unsupported claim cleanup; original config is unchanged".into(),
                    );
                }
                // Refuse unsupported cleanup while the original path can still be restored.
                claimed.discard()?;
                #[cfg(test)]
                super::crash_tests::checkpoint("sandbox-after-discard");
            }
            #[cfg(windows)]
            file.set_permissions(metadata.permissions())
                .map_err(|error| error.to_string())?;
            #[cfg(windows)]
            drop(file);
            stage.publish(&temp, &config_path)?;
            #[cfg(test)]
            super::crash_tests::checkpoint("sandbox-after-publish");
            #[cfg(test)]
            if FAIL_NEXT_SNAPSHOT_WRITE.with(|flag| flag.replace(false)) {
                return Err("Synthetic private snapshot write failure".into());
            }
            super::write_snapshot(
                home,
                "config.toml",
                &super::LinkSnapshot {
                    fingerprint: super::fingerprint(&config_path)?,
                    private_override: true,
                    invalid: false,
                },
            )?;
            #[cfg(test)]
            super::crash_tests::checkpoint("sandbox-after-snapshot");
            Ok(())
        })();
        match claimed {
            Some(mut claimed) => claimed.finish(result),
            None => result,
        }
    })();
    if let Some(staged) = staged {
        staged.cleanup(&temp)?;
    } else if temp.exists() {
        std::fs::remove_file(&temp).map_err(|error| error.to_string())?;
    }
    result.map_err(|error: String| {
        let saved = if backups.is_empty() {
            "No complete config backups were saved.".to_string()
        } else {
            format!("Config backups preserved at {}", backups.join(", "))
        };
        format!("{error}; no held turns resumed. {saved}")
    })?;
    Ok(SandboxConfigChange {
        config_path: crate::fs::path_to_js(&config_path),
        backup_path: backups[0].clone(),
        backup_paths: backups,
    })
}

pub fn codex_mono_use_unelevated_sandbox(
    app: AppHandle,
    provider_account_id: Option<String>,
) -> Result<SandboxConfigChange, String> {
    if !cfg!(windows) {
        return Err("Windows sandbox settings can only be changed on Windows".into());
    }
    let (source, home, _) = super::locations(&app, provider_account_id.as_deref())?;
    let _lock = super::STORAGE_LOCK
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let (source, home) = super::storage_roots(&source, &home)?;
    change_configs(&source, &home)
}

#[cfg(test)]
#[path = "sandbox_config_tests.rs"]
mod repair_tests;

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> (std::path::PathBuf, std::path::PathBuf, std::path::PathBuf) {
        let root =
            std::env::temp_dir().join(format!("monocode-sandbox-config-{}", uuid::Uuid::new_v4()));
        let source = root.join(".codex");
        let home = root.join("codex-monos/default");
        std::fs::create_dir_all(&source).unwrap();
        std::fs::create_dir_all(&home).unwrap();
        (root, source, home)
    }

    #[test]
    fn sandbox_config_repair_preserves_synthetic_codex_source_bytes() {
        let root = std::env::temp_dir().join(format!(
            "monocode-sandbox-source-preserved-{}",
            uuid::Uuid::new_v4()
        ));
        let source = root.join(".codex");
        let home = root.join("codex-monos/default");
        std::fs::create_dir_all(&source).unwrap();
        std::fs::create_dir_all(&home).unwrap();
        let original = b"# synthetic ordinary Codex account\r\nmodel = 'account-model'\r\n[windows]\r\nsandbox = 'elevated' # preserve source bytes\r\n";
        let source_path = source.join("config.toml");
        let private_path = home.join("config.toml");
        std::fs::write(&source_path, original).unwrap();
        super::super::create_link(&source_path, &private_path).unwrap();
        println!("synthetic sandbox repair fixture: {}", root.display());

        let changed = change_configs(&source, &home).unwrap();

        assert_eq!(std::fs::read(&source_path).unwrap(), original);
        assert_eq!(std::fs::read_dir(&source).unwrap().count(), 1);
        assert_eq!(changed.config_path, crate::fs::path_to_js(&private_path));
        assert_eq!(changed.backup_paths.len(), 1);
        assert_eq!(std::fs::read(&changed.backup_path).unwrap(), original);
        assert!(!super::super::same_entry(&source_path, &private_path));
        let private = std::fs::read_to_string(&private_path).unwrap();
        assert!(private.contains("sandbox = \"unelevated\""));
        assert!(private.contains("model = 'account-model'"));
        assert!(
            super::super::read_snapshot(&home, "config.toml")
                .unwrap()
                .unwrap()
                .private_override
        );
        super::super::prepare_files(&source, &home).unwrap();
        assert_eq!(std::fs::read(&source_path).unwrap(), original);
        assert_eq!(std::fs::read_to_string(&private_path).unwrap(), private);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn sandbox_config_preserves_comments_other_settings_and_inactive_profiles() {
        let original = "# keep this\nprofile = 'work'\nmodel = 'same'\n[windows]\nsandbox = 'elevated' # keep too\nother = true\n[profiles.work.windows]\nsandbox = 'elevated'\n[profiles.other.windows]\nsandbox = 'elevated'\n";
        let changed = unelevated_config(original).unwrap();
        assert!(changed.contains("# keep this"));
        assert!(changed.contains("sandbox = \"unelevated\" # keep too"));
        let parsed: toml::Value = toml::from_str(&changed).unwrap();
        assert_eq!(parsed["model"].as_str(), Some("same"));
        assert_eq!(parsed["windows"]["other"].as_bool(), Some(true));
        assert_eq!(
            parsed["profiles"]["work"]["windows"]["sandbox"].as_str(),
            Some("unelevated")
        );
        assert_eq!(
            parsed["profiles"]["other"]["windows"]["sandbox"].as_str(),
            Some("elevated")
        );
    }

    #[test]
    fn sandbox_config_inserts_missing_root_and_existing_table_settings() {
        for original in [
            "",
            "model = 'same'\n",
            "[windows]\nother = true\n",
            "windows = { other = true }\n",
            "[windows]",
            "windows.other = true\n",
            "profile = 'work'\n[windows]\nother = true\n[profiles.work.windows]\nother = true\n",
        ] {
            let changed = unelevated_config(original).unwrap();
            let parsed: toml::Value = toml::from_str(&changed).unwrap();
            assert_eq!(parsed["windows"]["sandbox"].as_str(), Some("unelevated"));
        }
    }

    #[test]
    fn sandbox_config_is_explicit_and_reversible_with_exact_original_backup() {
        let (root, source, home) = fixture();
        let path = home.join("config.toml");
        let original = "# synthetic account\n[windows]\nsandbox = 'elevated'\n";
        std::fs::write(&path, original).unwrap();
        let changed = change_configs(&source, &home).unwrap();
        assert_eq!(
            std::fs::read_to_string(&changed.backup_path).unwrap(),
            original
        );
        assert!(std::fs::read_to_string(&path)
            .unwrap()
            .contains("unelevated"));
        std::fs::copy(&changed.backup_path, &path).unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), original);
        assert_eq!(std::fs::read_dir(&source).unwrap().count(), 0);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn sandbox_config_invalid_config_is_preserved_without_a_backup_or_write() {
        let (root, source, home) = fixture();
        std::fs::write(source.join("config.toml"), "[broken").unwrap();
        assert!(change_configs(&source, &home).is_err());
        assert_eq!(
            std::fs::read_to_string(source.join("config.toml")).unwrap(),
            "[broken"
        );
        assert_eq!(std::fs::read_dir(&source).unwrap().count(), 1);
        assert_eq!(std::fs::read_dir(&home).unwrap().count(), 0);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn sandbox_config_validates_and_preserves_existing_private_settings() {
        let (root, source, home) = fixture();
        let original = "[windows]\nsandbox = 'elevated'\n";
        std::fs::write(source.join("config.toml"), original).unwrap();
        std::fs::write(home.join("config.toml"), "[broken").unwrap();
        assert!(change_configs(&source, &home).is_err());
        assert_eq!(
            std::fs::read_to_string(source.join("config.toml")).unwrap(),
            original
        );
        assert_eq!(std::fs::read_dir(&source).unwrap().count(), 1);
        assert_eq!(std::fs::read_dir(&home).unwrap().count(), 1);
        let private = "model = 'private-model'\n[windows]\nsandbox = 'elevated'\n";
        std::fs::write(home.join("config.toml"), private).unwrap();
        let changed = change_configs(&source, &home).unwrap();
        assert_eq!(changed.backup_paths.len(), 1);
        for path in &changed.backup_paths {
            assert_eq!(std::fs::read_to_string(path).unwrap(), private);
        }
        let changed = std::fs::read_to_string(home.join("config.toml")).unwrap();
        assert!(changed.contains("unelevated"));
        assert!(changed.contains("private-model"));
        assert_eq!(
            std::fs::read_to_string(source.join("config.toml")).unwrap(),
            original
        );
        assert_eq!(std::fs::read_dir(&source).unwrap().count(), 1);
        super::super::prepare_files(&source, &home).unwrap();
        assert_eq!(
            std::fs::read_to_string(home.join("config.toml")).unwrap(),
            changed
        );
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn sandbox_config_failed_backup_never_claims_saved_backups_or_changes_config() {
        let (root, source, home) = fixture();
        let original = "[windows]\nsandbox = 'elevated'\n";
        std::fs::write(source.join("config.toml"), original).unwrap();
        super::super::create_link(&source.join("config.toml"), &home.join("config.toml")).unwrap();
        FAIL_NEXT_BACKUP_WRITE.with(|flag| flag.set(true));
        let error = change_configs(&source, &home).err().unwrap();
        assert!(error.contains("Could not finish config backup"));
        assert!(error.contains("original config files are unchanged"));
        assert!(error.contains("No complete config backups were saved"));
        assert!(!error.contains("Config backups preserved at"));
        assert_eq!(
            std::fs::read_to_string(source.join("config.toml")).unwrap(),
            original
        );
        assert_eq!(std::fs::read_dir(&source).unwrap().count(), 1);
        assert!(super::super::same_entry(
            &source.join("config.toml"),
            &home.join("config.toml")
        ));
        assert!(!home.join(".monocode-conflicts").exists());
        assert!(!std::fs::read_dir(&home).unwrap().any(|entry| entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .starts_with(".monocode-claim-")));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn sandbox_config_pins_private_original_against_external_writes() {
        let (root, source, home) = fixture();
        let original = "[windows]\nsandbox = 'elevated'\n";
        let paths = vec![source.join("config.toml"), home.join("config.toml")];
        for path in &paths {
            std::fs::write(path, original).unwrap();
        }
        let pinned = home.join("config.toml");
        super::super::BEFORE_CLAIM.with(|hook| {
            *hook.borrow_mut() = Some(Box::new(move || {
                std::thread::spawn(move || {
                    assert_eq!(
                        std::fs::write(&pinned, "concurrent newer config")
                            .unwrap_err()
                            .raw_os_error(),
                        Some(32)
                    );
                    assert_eq!(std::fs::read_to_string(&pinned).unwrap(), original);
                })
                .join()
                .unwrap();
            }))
        });
        let changed = change_configs(&source, &home).unwrap();
        assert_eq!(changed.backup_paths.len(), 1);
        for backup in changed.backup_paths {
            assert_eq!(std::fs::read_to_string(backup).unwrap(), original);
        }
        assert_eq!(std::fs::read_to_string(&paths[0]).unwrap(), original);
        assert!(std::fs::read_to_string(&paths[1])
            .unwrap()
            .contains("unelevated"));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn sandbox_config_detaches_hardlinks_without_writing_the_account() {
        let (root, source, home) = fixture();
        let source_path = source.join("config.toml");
        let private = home.join("config.toml");
        let original = "model='account-model'\n[windows]\nsandbox='elevated'\n";
        std::fs::write(&source_path, original).unwrap();
        std::fs::hard_link(&source_path, &private).unwrap();
        let changed = change_configs(&source, &home).unwrap();
        assert_eq!(std::fs::read_to_string(&source_path).unwrap(), original);
        assert_eq!(std::fs::read_dir(&source).unwrap().count(), 1);
        assert_eq!(changed.backup_paths.len(), 1);
        assert!(!super::super::same_entry(&source_path, &private));
        assert!(!super::super::replaceable_link(&private).unwrap());
        assert!(std::fs::read_to_string(&private)
            .unwrap()
            .contains("unelevated"));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn sandbox_config_creates_missing_private_config_without_changing_source_readonly_attribute() {
        let (root, source, home) = fixture();
        let path = source.join("config.toml");
        let original = "model='account-model'\n[windows]\nsandbox='elevated'\n";
        std::fs::write(&path, original).unwrap();
        let mut permissions = std::fs::metadata(&path).unwrap().permissions();
        permissions.set_readonly(true);
        std::fs::set_permissions(&path, permissions.clone()).unwrap();
        let changed = change_configs(&source, &home).unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), original);
        assert!(std::fs::metadata(&path).unwrap().permissions().readonly());
        assert_eq!(std::fs::read_dir(&source).unwrap().count(), 1);
        assert_eq!(
            changed.config_path,
            crate::fs::path_to_js(&home.join("config.toml"))
        );
        for private in [
            &path,
            &home.join("config.toml"),
            Path::new(&changed.backup_path),
        ] {
            let mut permissions = std::fs::metadata(private).unwrap().permissions();
            permissions.set_readonly(false);
            std::fs::set_permissions(private, permissions).unwrap();
        }
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn sandbox_config_rejects_concurrent_private_replacement_without_overwriting_it() {
        let (root, source, home) = fixture();
        let original = "[windows]\nsandbox='elevated'\n";
        std::fs::write(source.join("config.toml"), original).unwrap();
        std::fs::write(home.join("config.toml"), original).unwrap();
        let private = home.join("config.toml");
        super::super::BEFORE_CLAIM.with(|hook| {
            *hook.borrow_mut() = Some(Box::new(move || {
                std::fs::rename(&private, private.with_extension("old")).unwrap();
                std::fs::write(&private, "model='concurrent-model'\n").unwrap();
            }))
        });
        let error = change_configs(&source, &home).err().unwrap();
        assert!(error.contains("config changed during sandbox repair"));
        assert_eq!(
            std::fs::read_to_string(source.join("config.toml")).unwrap(),
            original
        );
        assert_eq!(
            std::fs::read_to_string(home.join("config.toml")).unwrap(),
            "model='concurrent-model'\n"
        );
        assert_eq!(
            std::fs::read_to_string(home.join("config.old")).unwrap(),
            original
        );
        assert!(!home.join(".monocode-conflicts").exists());
        std::fs::remove_dir_all(root).unwrap();
    }
}
