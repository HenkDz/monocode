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

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectAddition {
    pub path: String,
    pub project: String,
    pub branch: Option<String>,
}

/// Resolve Git's registered main checkout, never infer ownership from folder names.
#[tauri::command(async)]
pub fn resolve_project_add(
    path: String,
    projects: Vec<String>,
    separate_projects: Option<Vec<String>>,
) -> Result<ProjectAddition, String> {
    let path = canonical(&path)?;
    let registered = projects
        .iter()
        .filter_map(|project| {
            canonical(project)
                .ok()
                .map(|canonical| (project, canonical))
        })
        .collect::<Vec<_>>();
    // Intentional separately registered checkouts retain their project identity.
    if let Some((project, _)) = registered.iter().find(|(_, root)| same(root, &path)) {
        return Ok(ProjectAddition {
            path: (*project).clone(),
            project: (*project).clone(),
            branch: None,
        });
    }
    // Archived separately registered projects restore their original identity too.
    for project in separate_projects.unwrap_or_default() {
        if canonical(&project).is_ok_and(|root| same(&root, &path)) {
            return Ok(ProjectAddition {
                path: project.clone(),
                project,
                branch: None,
            });
        }
    }
    let trees = match crate::worktrees::list(Path::new(&path)) {
        Ok(trees) => Some(trees),
        Err(error) if Path::new(&path).join(".git").exists() => return Err(error),
        Err(_) => None,
    };
    if let Some(trees) = trees {
        let linked = trees.iter().find(|tree| {
            !tree.is_main
                && !tree.prunable
                && canonical(&tree.path).is_ok_and(|root| same(&root, &path))
        });
        if let (Some(main), Some(linked)) = (trees.first(), linked) {
            if let Ok(main) = canonical(&main.path) {
                if let Some((project, _)) = registered.iter().find(|(_, root)| same(root, &main)) {
                    return Ok(ProjectAddition {
                        path,
                        project: (*project).clone(),
                        branch: linked.branch.clone(),
                    });
                }
            }
        }
    }
    Ok(ProjectAddition {
        project: path.clone(),
        path,
        branch: None,
    })
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
        let addition =
            resolve_project_add(worker.to_string_lossy().into(), vec![target.clone()], None)
                .unwrap();
        assert!(same(
            &addition.path,
            &canonical(worker.to_str().unwrap()).unwrap()
        ));
        assert_eq!(addition.project, target);
        assert_eq!(addition.branch.as_deref(), Some("worker"));
        let separate = resolve_project_add(
            worker.to_string_lossy().into(),
            vec![target.clone(), addition.path.clone()],
            None,
        )
        .unwrap();
        assert_eq!(separate.project, addition.path);
        let archived = resolve_project_add(
            worker.to_string_lossy().into(),
            vec![target.clone()],
            Some(vec![addition.path.clone()]),
        )
        .unwrap();
        assert_eq!(archived.project, addition.path);
        let ordinary =
            resolve_project_add(root.to_string_lossy().into(), vec![target.clone()], None).unwrap();
        assert_eq!(ordinary.project, ordinary.path);
        let unregistered =
            resolve_project_add(worker.to_string_lossy().into(), Vec::new(), None).unwrap();
        assert_eq!(unregistered.project, unregistered.path);
        if cfg!(windows) {
            let same_target = project_root(worker.to_string_lossy().to_uppercase()).unwrap();
            assert!(same(
                &same_target,
                &canonical(worker.to_str().unwrap()).unwrap()
            ));
            let upper = resolve_project_add(
                worker.to_string_lossy().to_uppercase(),
                vec![target.to_uppercase()],
                None,
            )
            .unwrap();
            assert!(same(&upper.project, &target));
        }
        git(&project, &["worktree", "remove", worker.to_str().unwrap()]);
        assert!(project_root(worker.to_str().unwrap().into()).is_err());
        // Only this test's UUID-owned temporary directory is removed.
        let _ = std::fs::remove_dir_all(root);
    }
}
