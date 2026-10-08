use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::{Component, Path, PathBuf};

use crate::fs::{expand_home, path_to_js};

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Leftover {
    path: String,
    digest: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NestedWorktree {
    path: String,
    leftovers: Vec<Leftover>,
}

fn git(root: &Path, args: &[&str]) -> Result<String, String> {
    let mut command = std::process::Command::new("git");
    crate::hide_window_console(&mut command);
    let output = command
        .arg("-C")
        .arg(root)
        .args(args)
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .map_err(|error| error.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().into());
    }
    String::from_utf8(output.stdout).map_err(|_| "Git returned a non-UTF-8 path".into())
}

fn root(cwd: &str) -> Result<PathBuf, String> {
    let path = git(&expand_home(cwd), &["rev-parse", "--show-toplevel"])?;
    std::fs::canonicalize(path.trim()).map_err(|error| error.to_string())
}

fn linked(info: &std::fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if info.file_attributes() & 0x400 != 0 {
            return true;
        }
    }
    info.file_type().is_symlink()
}

fn safe_path(root: &Path, relative: &Path) -> Result<PathBuf, String> {
    let mut path = root.to_path_buf();
    for component in relative.components() {
        let Component::Normal(part) = component else {
            return Err("Choose a path inside the nested worktree".into());
        };
        path.push(part);
        let info = std::fs::symlink_metadata(&path).map_err(|error| error.to_string())?;
        if linked(&info) {
            return Err("Cleanup refuses symbolic links and junctions".into());
        }
    }
    if path == root || !path.starts_with(root) {
        return Err("Choose a file inside the nested worktree".into());
    }
    Ok(path)
}

fn leftover(root: &Path, relative: &str) -> Result<Leftover, String> {
    if !(relative.starts_with("tmp/") || relative.starts_with("temp/")) {
        return Err("Only untracked temporary files can be cleaned up".into());
    }
    let path = safe_path(root, Path::new(relative))?;
    let info = std::fs::metadata(&path).map_err(|error| error.to_string())?;
    if !info.is_file() || info.len() > 1024 * 1024 {
        return Err("Cleanup only supports regular temporary files under 1 MiB".into());
    }
    let bytes = std::fs::read(path).map_err(|error| error.to_string())?;
    Ok(Leftover {
        path: relative.into(),
        digest: format!("{:x}", Sha256::digest(bytes)),
    })
}

fn scan(root: &Path) -> Result<Vec<NestedWorktree>, String> {
    let untracked = git(
        root,
        &[
            "ls-files",
            "--others",
            "--exclude-standard",
            "--directory",
            "-z",
        ],
    )?;
    let mut result = Vec::new();
    for field in git(root, &["worktree", "list", "--porcelain", "-z"])?.split('\0') {
        let Some(raw) = field.strip_prefix("worktree ") else {
            continue;
        };
        let path = Path::new(raw);
        let Ok(canonical) = std::fs::canonicalize(path) else {
            continue;
        };
        let Ok(relative) = canonical.strip_prefix(root) else {
            continue;
        };
        if relative.as_os_str().is_empty() || safe_path(root, relative).is_err() {
            continue;
        }
        let name = path_to_js(relative);
        if !untracked.split('\0').any(|entry| {
            !entry.is_empty()
                && (name == entry.trim_end_matches('/')
                    || (entry.ends_with('/') && name.starts_with(entry)))
        }) {
            continue;
        }
        let leftovers = git(
            &canonical,
            &["ls-files", "--others", "--exclude-standard", "-z"],
        )?
        .split('\0')
        .filter_map(|name| leftover(&canonical, name).ok())
        .collect();
        result.push(NestedWorktree {
            path: name,
            leftovers,
        });
    }
    Ok(result)
}

#[tauri::command]
pub async fn git_nested_worktrees(cwd: String) -> Result<Vec<NestedWorktree>, String> {
    tauri::async_runtime::spawn_blocking(move || scan(&root(&cwd)?))
        .await
        .map_err(|error| error.to_string())?
}

fn cleanup(root: &Path, path: &str, files: &[Leftover]) -> Result<(), String> {
    let nested = scan(root)?
        .into_iter()
        .find(|tree| tree.path == path)
        .ok_or("This directory is no longer an untracked nested worktree")?;
    if files.is_empty() || files.iter().any(|file| !nested.leftovers.contains(file)) {
        return Err("Temporary files changed; review the cleanup list again".into());
    }
    let nested_root = safe_path(root, Path::new(path))?;
    // Revalidate the entire confirmed list before deleting any file.
    for file in files {
        if leftover(&nested_root, &file.path)? != *file {
            return Err("Temporary files changed; review the cleanup list again".into());
        }
    }
    for file in files {
        let target = safe_path(&nested_root, Path::new(&file.path))?;
        if leftover(&nested_root, &file.path)? != *file {
            return Err("Temporary files changed; review the cleanup list again".into());
        }
        std::fs::remove_file(target).map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn git_cleanup_nested_leftovers(
    cwd: String,
    path: String,
    files: Vec<Leftover>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || cleanup(&root(&cwd)?, &path, &files))
        .await
        .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> (PathBuf, PathBuf) {
        let base = std::env::temp_dir().join(format!("monocode-nested-{}", uuid::Uuid::new_v4()));
        let repo = base.join("repo");
        std::fs::create_dir_all(&repo).unwrap();
        git(&repo, &["init", "-b", "main"]).unwrap();
        std::fs::write(repo.join("tracked.txt"), "keep").unwrap();
        git(&repo, &["add", "."]).unwrap();
        git(
            &repo,
            &[
                "-c",
                "user.name=Test",
                "-c",
                "user.email=test@example.invalid",
                "commit",
                "-m",
                "initial",
            ],
        )
        .unwrap();
        let nested = repo.join(".codex-worktrees/fix");
        git(
            &repo,
            &["worktree", "add", "-b", "fix", nested.to_str().unwrap()],
        )
        .unwrap();
        std::fs::create_dir_all(nested.join("tmp")).unwrap();
        std::fs::write(nested.join("tmp/pr.md"), "agent scratch").unwrap();
        std::fs::write(nested.join("user.txt"), "keep user data").unwrap();
        (base, repo)
    }

    #[test]
    fn detects_nested_checkout_and_cleans_only_confirmed_untracked_temp_files() {
        let (base, repo) = fixture();
        let canonical = std::fs::canonicalize(&repo).unwrap();
        let trees = scan(&canonical).unwrap();
        assert_eq!(trees.len(), 1);
        assert_eq!(trees[0].leftovers.len(), 1);
        assert!(repo.join(".codex-worktrees/fix/tmp/pr.md").exists());
        cleanup(&canonical, &trees[0].path, &trees[0].leftovers).unwrap();
        assert!(!repo.join(".codex-worktrees/fix/tmp/pr.md").exists());
        assert!(repo.join(".codex-worktrees/fix/user.txt").exists());
        assert!(repo.join(".codex-worktrees/fix/tracked.txt").exists());
        assert!(!repo.join(".gitignore").exists());
        std::fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn refuses_changed_files_traversal_and_tracked_temp_files() {
        let (base, repo) = fixture();
        let canonical = std::fs::canonicalize(&repo).unwrap();
        let trees = scan(&canonical).unwrap();
        let nested = repo.join(".codex-worktrees/fix");
        assert!(safe_path(&canonical, Path::new("../outside")).is_err());
        assert!(safe_path(&canonical, &nested).is_err());
        std::fs::write(nested.join("tmp/pr.md"), "edited after confirmation").unwrap();
        assert!(cleanup(&canonical, &trees[0].path, &trees[0].leftovers).is_err());
        git(&nested, &["add", "tmp/pr.md"]).unwrap();
        assert!(scan(&canonical).unwrap()[0].leftovers.is_empty());
        assert!(cleanup(&canonical, &trees[0].path, &trees[0].leftovers).is_err());
        assert!(nested.join("tmp/pr.md").exists());
        std::fs::remove_dir_all(base).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn refuses_symlinked_temp_files() {
        let (base, repo) = fixture();
        let nested = repo.join(".codex-worktrees/fix");
        std::os::unix::fs::symlink(nested.join("user.txt"), nested.join("tmp/link")).unwrap();
        assert!(leftover(&nested, "tmp/link").is_err());
        assert_eq!(
            scan(&std::fs::canonicalize(&repo).unwrap()).unwrap()[0]
                .leftovers
                .len(),
            1
        );
        std::fs::remove_dir_all(base).unwrap();
    }
}
