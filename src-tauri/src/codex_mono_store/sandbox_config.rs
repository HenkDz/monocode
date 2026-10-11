use std::collections::BTreeMap;
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::Path;

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

#[cfg(test)]
thread_local! {
    static FAIL_NEXT_BACKUP_WRITE: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
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

fn change_configs(source: &Path, home: Option<&Path>) -> Result<SandboxConfigChange, String> {
    let config_path = source.join("config.toml");
    let mut paths = vec![config_path.clone()];
    if let Some(home) = home {
        let private = home.join("config.toml");
        if std::fs::symlink_metadata(&private).is_ok() && !super::same_entry(&config_path, &private)
        {
            paths.push(private);
        }
    }
    // Pin every original before validation; Windows excludes external writers and deletion.
    let mut edits = paths
        .iter()
        .map(|path| {
            let mut options = std::fs::OpenOptions::new();
            options.read(true).write(true);
            #[cfg(windows)]
            {
                use std::os::windows::fs::OpenOptionsExt;
                use windows_sys::Win32::Storage::FileSystem::{
                    FILE_FLAG_OPEN_REPARSE_POINT, FILE_SHARE_READ,
                };
                options
                    .share_mode(FILE_SHARE_READ)
                    .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT);
            }
            let mut file = options.open(path).map_err(|error| {
                format!(
                    "Could not exclusively open Codex config {}: {error}",
                    path.display()
                )
            })?;
            let metadata = std::fs::symlink_metadata(path).map_err(|error| error.to_string())?;
            #[cfg(windows)]
            let is_reparse = super::handle_file_info(&file)?.dwFileAttributes
                & windows_sys::Win32::Storage::FileSystem::FILE_ATTRIBUTE_REPARSE_POINT
                != 0;
            #[cfg(not(windows))]
            let is_reparse = metadata.file_type().is_symlink();
            if !metadata.is_file() || metadata.file_type().is_symlink() || is_reparse {
                return Err(
                    "Codex account config must be a real file before switching its sandbox".into(),
                );
            }
            let mut original = String::new();
            file.read_to_string(&mut original)
                .map_err(|error| format!("Could not read Codex config: {error}"))?;
            let updated = unelevated_config(&original)?;
            Ok((
                path,
                original,
                updated,
                metadata.permissions(),
                path.with_file_name(format!(
                    "config.toml.monocode-sandbox-backup-{}",
                    uuid::Uuid::new_v4()
                )),
                file,
            ))
        })
        .collect::<Result<Vec<_>, String>>()?;
    let write_new =
        |target: &Path, bytes: &[u8], permissions: std::fs::Permissions| -> Result<(), String> {
            #[cfg(test)]
            if FAIL_NEXT_BACKUP_WRITE.with(|flag| flag.replace(false)) {
                return Err("Synthetic backup write failure".into());
            }
            let mut file = std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(target)
                .map_err(|error| error.to_string())?;
            std::fs::set_permissions(target, permissions).map_err(|error| error.to_string())?;
            file.write_all(bytes).map_err(|error| error.to_string())?;
            file.sync_all().map_err(|error| error.to_string())
        };
    let mut backups = Vec::new();
    let result = (|| {
        for (_, original, _, permissions, backup, _) in &edits {
            write_new(backup, original.as_bytes(), permissions.clone()).map_err(|error| format!(
                "Could not finish config backup at {}: {error}; original config files are unchanged", backup.display()
            ))?;
            backups.push(crate::fs::path_to_js(backup));
        }
        #[cfg(test)]
        super::before_claim();
        // In-place writes preserve pinned identities; complete backups cover failures and crashes.
        for (path, _, updated, _, _, file) in &mut edits {
            file.seek(SeekFrom::Start(0))
                .and_then(|_| file.write_all(updated.as_bytes()))
                .and_then(|_| file.set_len(updated.len() as u64))
                .and_then(|_| file.sync_all())
                .map_err(|error| {
                    format!(
                        "Could not finish config update at {}: {error}",
                        path.display()
                    )
                })?;
        }
        Ok(())
    })();
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
    change_configs(&source, Some(&home))
}

#[cfg(test)]
mod tests {
    use super::*;

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
        let source =
            std::env::temp_dir().join(format!("monocode-sandbox-choice-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&source).unwrap();
        let path = source.join("config.toml");
        let original = "# synthetic account\n[windows]\nsandbox = 'elevated'\n";
        std::fs::write(&path, original).unwrap();
        let changed = change_configs(&source, None).unwrap();
        assert_eq!(
            std::fs::read_to_string(&changed.backup_path).unwrap(),
            original
        );
        assert!(std::fs::read_to_string(&path)
            .unwrap()
            .contains("unelevated"));
        std::fs::copy(&changed.backup_path, &path).unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), original);
        std::fs::remove_dir_all(source).unwrap();
    }

    #[test]
    fn sandbox_config_invalid_config_is_preserved_without_a_backup_or_write() {
        let source =
            std::env::temp_dir().join(format!("monocode-sandbox-invalid-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&source).unwrap();
        std::fs::write(source.join("config.toml"), "[broken").unwrap();
        assert!(change_configs(&source, None).is_err());
        assert_eq!(
            std::fs::read_to_string(source.join("config.toml")).unwrap(),
            "[broken"
        );
        assert_eq!(std::fs::read_dir(&source).unwrap().count(), 1);
        std::fs::remove_dir_all(source).unwrap();
    }

    #[test]
    fn sandbox_config_validates_both_account_and_private_config_before_writing() {
        let source = std::env::temp_dir().join(format!(
            "monocode-sandbox-two-configs-{}",
            uuid::Uuid::new_v4()
        ));
        let home = source.join("private");
        std::fs::create_dir_all(&home).unwrap();
        let original = "[windows]\nsandbox = 'elevated'\n";
        std::fs::write(source.join("config.toml"), original).unwrap();
        std::fs::write(home.join("config.toml"), "[broken").unwrap();
        assert!(change_configs(&source, Some(&home)).is_err());
        assert_eq!(
            std::fs::read_to_string(source.join("config.toml")).unwrap(),
            original
        );
        assert_eq!(std::fs::read_dir(&source).unwrap().count(), 2);
        std::fs::write(home.join("config.toml"), original).unwrap();
        let changed = change_configs(&source, Some(&home)).unwrap();
        assert_eq!(changed.backup_paths.len(), 2);
        for path in &changed.backup_paths {
            assert_eq!(std::fs::read_to_string(path).unwrap(), original);
        }
        for dir in [&source, &home] {
            assert!(std::fs::read_to_string(dir.join("config.toml"))
                .unwrap()
                .contains("unelevated"));
        }
        std::fs::remove_dir_all(source).unwrap();
    }

    #[test]
    fn sandbox_config_failed_backup_never_claims_saved_backups_or_changes_config() {
        let source = std::env::temp_dir().join(format!(
            "monocode-sandbox-backup-failure-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir(&source).unwrap();
        let original = "[windows]\nsandbox = 'elevated'\n";
        std::fs::write(source.join("config.toml"), original).unwrap();
        FAIL_NEXT_BACKUP_WRITE.with(|flag| flag.set(true));
        let error = change_configs(&source, None).err().unwrap();
        assert!(error.contains("Could not finish config backup at"));
        assert!(error.contains("original config files are unchanged"));
        assert!(error.contains("No complete config backups were saved"));
        assert!(!error.contains("Config backups preserved at"));
        assert_eq!(
            std::fs::read_to_string(source.join("config.toml")).unwrap(),
            original
        );
        assert_eq!(std::fs::read_dir(&source).unwrap().count(), 1);
        std::fs::remove_dir_all(source).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn sandbox_config_pins_both_originals_against_external_writes_and_deletion() {
        let source =
            std::env::temp_dir().join(format!("monocode-sandbox-pinned-{}", uuid::Uuid::new_v4()));
        let home = source.join("private");
        std::fs::create_dir_all(&home).unwrap();
        let original = "[windows]\nsandbox = 'elevated'\n";
        let paths = vec![source.join("config.toml"), home.join("config.toml")];
        for path in &paths {
            std::fs::write(path, original).unwrap();
        }
        let pinned_paths = paths.clone();
        super::super::BEFORE_CLAIM.with(|hook| {
            *hook.borrow_mut() = Some(Box::new(move || {
                std::thread::spawn(move || {
                    for path in &pinned_paths {
                        assert_eq!(
                            std::fs::write(path, "concurrent newer config")
                                .unwrap_err()
                                .raw_os_error(),
                            Some(32)
                        );
                        assert_eq!(
                            std::fs::remove_file(path).unwrap_err().raw_os_error(),
                            Some(32)
                        );
                        assert_eq!(
                            std::fs::rename(path, path.with_extension("moved"))
                                .unwrap_err()
                                .raw_os_error(),
                            Some(32)
                        );
                        assert_eq!(std::fs::read_to_string(path).unwrap(), original);
                    }
                })
                .join()
                .unwrap();
            }))
        });
        let changed = change_configs(&source, Some(&home)).unwrap();
        assert_eq!(changed.backup_paths.len(), 2);
        for backup in changed.backup_paths {
            assert_eq!(std::fs::read_to_string(backup).unwrap(), original);
        }
        for path in paths {
            assert!(std::fs::read_to_string(&path)
                .unwrap()
                .contains("unelevated"));
            std::fs::write(&path, original).unwrap();
        }
        std::fs::remove_dir_all(source).unwrap();
    }
}
