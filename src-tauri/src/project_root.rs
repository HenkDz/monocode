//! Validate and canonicalize the registered project folder, including linked checkouts.
use std::path::Path;

fn canonical(path: &str) -> Result<String, String> {
    let path = std::fs::canonicalize(crate::fs::expand_home(path))
        .map_err(|_| "Project or checkout is missing".to_string())?;
    if !path.is_dir() {
        return Err("Choose an existing checkout directory".into());
    }
    let value = crate::fs::path_to_js(&path);
    // canonicalize adds a Win32 device prefix; renderer project keys use ordinary paths.
    if cfg!(windows) {
        if let Some(unc) = value.strip_prefix("//?/UNC/") {
            return Ok(format!("//{unc}"));
        }
        if let Some(drive) = value.strip_prefix("//?/") {
            if drive.as_bytes().get(1) == Some(&b':') {
                return Ok(drive.into());
            }
        }
    }
    Ok(value)
}

fn same(a: &str, b: &str) -> bool {
    if cfg!(windows) {
        a.eq_ignore_ascii_case(b)
    } else {
        a == b
    }
}

#[tauri::command(async)]
pub fn project_root(project: String) -> Result<String, String> {
    let project = canonical(&project)?;
    let trees = crate::worktrees::registered_checkouts(Path::new(&project))?;
    if !trees
        .iter()
        .any(|tree| canonical(tree).is_ok_and(|path| same(&path, &project)))
    {
        return Err("Project is not a registered Git checkout".into());
    }
    Ok(project)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn resolves_project_roots_with_spaces_and_rejects_non_git_or_removed_paths() {
        let root = std::env::temp_dir().join(format!(
            "monocode-coordination-test-{}",
            uuid::Uuid::new_v4()
        ));
        let project = root.join("project with spaces");
        let worker = root.join("worker checkout");
        let other = root.join("other project");
        std::fs::create_dir_all(&project).unwrap();
        std::fs::create_dir_all(&other).unwrap();
        let git = |cwd: &Path, args: &[&str]| {
            let output = std::process::Command::new("git")
                .current_dir(cwd)
                .args(args)
                .output()
                .unwrap();
            assert!(
                output.status.success(),
                "{}",
                String::from_utf8_lossy(&output.stderr)
            );
        };
        git(&project, &["init", "--initial-branch=main"]);
        git(
            &project,
            &[
                "-c",
                "user.name=Test",
                "-c",
                "user.email=test@example.invalid",
                "commit",
                "--allow-empty",
                "-m",
                "fixture",
            ],
        );
        git(&other, &["init", "--initial-branch=main"]);
        git(
            &project,
            &["worktree", "add", "-b", "worker", worker.to_str().unwrap()],
        );
        let target = project_root(project.to_str().unwrap().into()).unwrap();
        assert!(!target.starts_with("//?/"));
        assert!(same(
            &project_root(worker.to_str().unwrap().into()).unwrap(),
            &canonical(worker.to_str().unwrap()).unwrap()
        ));
        assert!(!same(
            &project_root(other.to_str().unwrap().into()).unwrap(),
            &target
        ));
        assert!(project_root(root.to_str().unwrap().into()).is_err());
        if cfg!(windows) {
            let same_target = project_root(worker.to_string_lossy().to_uppercase()).unwrap();
            assert!(same(
                &same_target,
                &canonical(worker.to_str().unwrap()).unwrap()
            ));
        }
        git(&project, &["worktree", "remove", worker.to_str().unwrap()]);
        assert!(project_root(worker.to_str().unwrap().into()).is_err());
        // Only this test's UUID-owned temporary directory is removed.
        let _ = std::fs::remove_dir_all(root);
    }
}
