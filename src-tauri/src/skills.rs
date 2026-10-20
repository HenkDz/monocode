use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::dirs_home;
use crate::fs::expand_home;

const MAX_SKILLS: usize = 5_000;
const MAX_FRONTMATTER_BYTES: usize = 16 * 1024;

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSkillFile {
    path: String,
    bytes: u64,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSkillInspection {
    name: String,
    declared_name: String,
    description: String,
    project: String,
    project_identity: String,
    source: String,
    fingerprint: String,
    files: Vec<ProjectSkillFile>,
    total_bytes: u64,
}

#[tauri::command(async)]
pub fn inspect_project_skill(project: String, source: String, name: String) -> Result<ProjectSkillInspection, String> {
    #[cfg(windows)]
    return project_install::inspect(Path::new(&project), Path::new(&source), &name).map(|snapshot| snapshot.inspection);
    #[cfg(not(windows))]
    { let _ = (project, source, name); Err("Project skill installation is unavailable on this platform".into()) }
}

#[tauri::command(async)]
pub fn install_project_skill(project: String, source: String, name: String, expected_project_identity: String, expected_fingerprint: String) -> Result<ProjectSkillInspection, String> {
    #[cfg(windows)]
    return project_install::install(Path::new(&project), Path::new(&source), &name, &expected_project_identity, &expected_fingerprint);
    #[cfg(not(windows))]
    { let _ = (project, source, name, expected_project_identity, expected_fingerprint); Err("Project skill installation is unavailable on this platform".into()) }
}

#[tauri::command(async)]
pub fn archive_project_skill(project: String, name: String, expected_project_identity: String, expected_fingerprint: String) -> Result<String, String> {
    #[cfg(windows)]
    return project_install::archive(Path::new(&project), &name, &expected_project_identity, &expected_fingerprint);
    #[cfg(not(windows))]
    { let _ = (project, name, expected_project_identity, expected_fingerprint); Err("Project skill archive is unavailable on this platform".into()) }
}

// shortcut: Windows handle pins only; add descriptor-relative publication before enabling other platforms.
#[cfg(windows)]
mod project_install {
    use super::*;
    use std::fs::{File, OpenOptions};
    use std::io::{Read, Write};
    use std::os::windows::fs::{MetadataExt, OpenOptionsExt};
    use std::path::{Component, Prefix};
    use sha2::{Digest, Sha256};
    use crate::codex_mono_store::{file_identity, handle_file_info, open_entry, rename_handle};
    use windows_sys::Win32::Storage::FileSystem::{FILE_ATTRIBUTE_REPARSE_POINT, FILE_FLAG_BACKUP_SEMANTICS, FILE_FLAG_OPEN_REPARSE_POINT, FILE_SHARE_READ, FILE_SHARE_WRITE};

    const MAX_FILES: usize = 128;
    const MAX_PACKAGE_BYTES: u64 = 4 * 1024 * 1024;
    const MAX_FILE_BYTES: u64 = 1024 * 1024;

    pub(super) struct Snapshot {
        pub(super) inspection: ProjectSkillInspection,
        source_identity: (u64, u64),
        files: Vec<(String, Vec<u8>)>,
        _pins: Vec<File>,
    }

    fn safe_name(name: &str) -> bool {
        let stem = name.split('.').next().unwrap_or("").to_ascii_lowercase();
        !name.is_empty() && name.len() <= 128 && !name.ends_with(['.', ' ']) &&
            name.chars().all(|c| c.is_ascii_alphanumeric() || "-_.".contains(c)) &&
            ![".", ".."].contains(&name) && !["con", "prn", "aux", "nul"].contains(&stem.as_str()) &&
            !(stem.len() == 4 && (stem.starts_with("com") || stem.starts_with("lpt")) && matches!(stem.as_bytes()[3], b'1'..=b'9'))
    }

    fn skill_name(name: &str) -> Result<(), String> {
        if !is_valid_skill_name(name) || !safe_name(name) { return Err("Choose a lowercase skill name; use a new versioned name if it exists".into()); }
        Ok(())
    }

    fn pin(path: &Path, directory: bool) -> Result<File, String> {
        let file = OpenOptions::new().read(true)
            .share_mode(FILE_SHARE_READ | if directory { FILE_SHARE_WRITE } else { 0 })
            .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT | if directory { FILE_FLAG_BACKUP_SEMANTICS } else { 0 })
            .open(path).map_err(|e| format!("Cannot pin {}: {e}", path.display()))?;
        let meta = file.metadata().map_err(|e| e.to_string())?;
        if meta.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 || meta.is_dir() != directory ||
            !directory && (!meta.is_file() || handle_file_info(&file)?.nNumberOfLinks != 1) {
            return Err("Skill paths cannot contain links, reparse points or special files".into());
        }
        Ok(file)
    }

    fn readonly_directory(path: &Path) -> Result<File, String> {
        let file = OpenOptions::new().read(true).share_mode(FILE_SHARE_READ)
            .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_BACKUP_SEMANTICS).open(path).map_err(|e| e.to_string())?;
        let metadata = file.metadata().map_err(|e| e.to_string())?;
        if !metadata.is_dir() || metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 { return Err("Skill directory changed or is linked".into()); }
        Ok(file)
    }

    fn pin_path(path: &Path, pins: &mut Vec<File>) -> Result<PathBuf, String> {
        if !path.is_absolute() { return Err("Use an absolute local project or source directory".into()); }
        let mut current = PathBuf::new();
        for part in path.components() {
            match part {
                Component::Prefix(prefix) if matches!(prefix.kind(), Prefix::Disk(_) | Prefix::VerbatimDisk(_)) => current.push(part.as_os_str()),
                Component::RootDir => current.push(part.as_os_str()),
                Component::Normal(name) if name.to_str().is_some_and(|name| !name.is_empty() && name != "." && name != ".." &&
                    !name.ends_with(['.', ' ']) && !name.chars().any(|c| c.is_control() || "<>:\"/\\|?*".contains(c))) => current.push(name),
                _ => return Err("Skill directories must use contained local paths without traversal".into()),
            }
            if current.is_absolute() && !matches!(part, Component::Prefix(_)) { pins.push(pin(&current, true)?); }
        }
        pins.push(readonly_directory(&current)?);
        std::fs::canonicalize(&current).map_err(|e| e.to_string())
    }

    fn identity(file: &File) -> Result<String, String> {
        let (volume, index) = file_identity(file)?;
        Ok(format!("windows:{volume}:{index}"))
    }

    fn read_package(root: &Path, relative: &Path, depth: usize, files: &mut Vec<(String, Vec<u8>)>, total: &mut u64, pins: &mut Vec<File>) -> Result<(), String> {
        if depth > 8 { return Err("Skill package exceeds eight directory levels".into()); }
        let mut entries = std::fs::read_dir(root.join(relative)).map_err(|e| e.to_string())?.take(257).collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
        if entries.len() + pins.len() > 256 { return Err("Skill package exceeds the directory and file entry limit".into()); }
        entries.sort_by_key(|entry| entry.file_name());
        for entry in entries {
            if pins.len() >= 256 { return Err("Skill package exceeds the directory and file entry limit".into()); }
            let name = entry.file_name();
            if !name.to_str().is_some_and(safe_name) { return Err("Unsupported skill package file name".into()); }
            let child = relative.join(name);
            let metadata = std::fs::symlink_metadata(entry.path()).map_err(|e| e.to_string())?;
            let directory = metadata.is_dir();
            if !directory && crate::mcp::project_secret_filename(&child.to_string_lossy().replace('\\', "/")) {
                return Err(format!("Skill package contains a protected secret filename: {}", child.display()));
            }
            let mut file = if directory { readonly_directory(&entry.path())? } else { pin(&entry.path(), false)? };
            if directory {
                pins.push(file);
                read_package(root, &child, depth + 1, files, total, pins)?;
            } else {
                if files.len() >= MAX_FILES || metadata.len() > MAX_FILE_BYTES { return Err("Skill package exceeds 128 files or 1 MiB per file".into()); }
                let mut bytes = Vec::new();
                Read::by_ref(&mut file).take(MAX_FILE_BYTES + 1).read_to_end(&mut bytes).map_err(|e| e.to_string())?;
                *total += bytes.len() as u64;
                if bytes.len() as u64 > MAX_FILE_BYTES || *total > MAX_PACKAGE_BYTES { return Err("Skill package exceeds 4 MiB".into()); }
                files.push((child.to_string_lossy().replace('\\', "/"), bytes));
                pins.push(file);
            }
        }
        Ok(())
    }

    pub(super) fn inspect(project: &Path, source: &Path, name: &str) -> Result<Snapshot, String> {
        skill_name(name)?;
        let mut pins = Vec::new();
        let project = pin_path(project, &mut pins)?;
        let project_identity = identity(pins.last().ok_or("Missing project pin")?)?;
        let source = pin_path(source, &mut pins)?;
        let source_identity = file_identity(pins.last().ok_or("Missing source pin")?)?;
        let mut files = Vec::new(); let mut total = 0;
        read_package(&source, Path::new(""), 0, &mut files, &mut total, &mut pins)?;
        files.sort_by(|a, b| a.0.cmp(&b.0));
        let skill = files.iter().find(|(path, _)| path == "SKILL.md").ok_or("A local skill requires SKILL.md")?;
        let text = std::str::from_utf8(&skill.1).map_err(|_| "SKILL.md must be UTF-8")?;
        let prefix = utf8_prefix(skill.1[..skill.1.len().min(MAX_FRONTMATTER_BYTES)].to_vec()).ok_or("SKILL.md frontmatter must be UTF-8")?;
        if !text.trim_start_matches('\u{feff}').starts_with("---\n") && !text.trim_start_matches('\u{feff}').starts_with("---\r\n") ||
            !prefix.lines().skip(1).any(|line| line == "---") {
            return Err("Skill frontmatter must close within 16 KiB".into());
        }
        let (parsed_name, description) = parse_frontmatter(&prefix, "");
        if parsed_name.is_empty() || description.is_empty() { return Err("SKILL.md requires a valid name and description".into()); }
        if !parsed_name.trim().eq_ignore_ascii_case(name) { return Err("The declared skill name must match the approved install name".into()); }
        let mut hash = Sha256::new();
        for (path, bytes) in &files { hash.update((path.len() as u64).to_le_bytes()); hash.update(path.as_bytes()); hash.update((bytes.len() as u64).to_le_bytes()); hash.update(bytes); }
        let inspection = ProjectSkillInspection { name: name.into(), declared_name: parsed_name, description, project: crate::fs::path_to_js(&project), project_identity,
            source: crate::fs::path_to_js(&source), fingerprint: format!("{:x}", hash.finalize()),
            files: files.iter().map(|(path, bytes)| ProjectSkillFile { path: path.clone(), bytes: bytes.len() as u64 }).collect(), total_bytes: total };
        Ok(Snapshot { inspection, source_identity, files, _pins: pins })
    }

    fn directory(parent: &Path, name: &str, pins: &mut Vec<File>) -> Result<PathBuf, String> {
        let path = parent.join(name);
        match std::fs::create_dir(&path) {
            Ok(()) => (),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => (),
            Err(e) => return Err(e.to_string()),
        }
        // Rename opens its target parent for writing; deletion and rename sharing stay denied.
        pins.push(pin(&path, true)?);
        Ok(path)
    }

    fn claim_stage(path: &Path) -> Result<File, String> {
        let file = open_entry(path, true)?;
        let metadata = file.metadata().map_err(|e| e.to_string())?;
        if !metadata.is_dir() || metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
            return Err("Skill stage must remain an ordinary directory".into());
        }
        Ok(file)
    }

    fn stage_matches(stage: &Path, expected: &[(String, Vec<u8>)]) -> Result<(), String> {
        let mut files = Vec::new(); let mut bytes = 0; let mut pins = Vec::new();
        read_package(stage, Path::new(""), 0, &mut files, &mut bytes, &mut pins)?;
        files.sort_by(|a, b| a.0.cmp(&b.0));
        if files != expected { return Err("Skill stage differs from the approved file set or bytes; preserved for inspection".into()); }
        Ok(())
    }

    fn handle_path(file: &File) -> Result<PathBuf, String> {
        use std::os::windows::{ffi::OsStringExt, io::AsRawHandle};
        use windows_sys::Win32::Storage::FileSystem::GetFinalPathNameByHandleW;
        let mut path = vec![0u16; 32_768];
        let length = unsafe { GetFinalPathNameByHandleW(file.as_raw_handle() as _, path.as_mut_ptr(), path.len() as u32, 0) } as usize;
        if length == 0 || length >= path.len() { return Err("Cannot resolve the pinned skill stage path".into()); }
        Ok(PathBuf::from(std::ffi::OsString::from_wide(&path[..length])))
    }

    pub(super) fn install(project: &Path, source: &Path, name: &str, expected_identity: &str, expected_fingerprint: &str) -> Result<ProjectSkillInspection, String> {
        let mut snapshot = inspect(project, source, name)?;
        if snapshot.inspection.project_identity != expected_identity || snapshot.inspection.fingerprint != expected_fingerprint {
            return Err("Project or skill source changed; inspect it again before approving".into());
        }
        let project = PathBuf::from(&snapshot.inspection.project);
        let agents = directory(&project, ".agents", &mut snapshot._pins)?;
        let skills = directory(&agents, "skills", &mut snapshot._pins)?;
        let target = skills.join(name);
        if std::fs::symlink_metadata(&target).is_ok() { return Err("This skill already exists; choose a versioned name".into()); }
        let stage = skills.join(format!(".{name}.monocode-stage-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&stage).map_err(|e| e.to_string())?;
        let stage_pin = claim_stage(&stage)?;
        let result = (|| {
            for (relative, bytes) in &snapshot.files {
                let dest = stage.join(relative);
                let mut parent = stage.clone();
                let mut stage_pins = Vec::new();
                if let Some(relative_parent) = Path::new(relative).parent() {
                    for part in relative_parent.components() { parent = directory(&parent, part.as_os_str().to_str().ok_or("Invalid file path")?, &mut stage_pins)?; }
                }
                let mut file = OpenOptions::new().write(true).create_new(true).open(&dest).map_err(|e| e.to_string())?;
                file.write_all(bytes).map_err(|e| e.to_string())?;
                file.sync_all().map_err(|e| e.to_string())?;
            }
            for pinned in &snapshot._pins {
                if pinned.metadata().map_err(|e| e.to_string())?.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 { return Err("A pinned skill path became linked".into()); }
            }
            let pinned_stage = handle_path(&stage_pin)?;
            if pinned_stage.parent() != Some(std::fs::canonicalize(&skills).map_err(|e| e.to_string())?.as_path()) { return Err("Skill stage left the pinned destination".into()); }
            stage_matches(&pinned_stage, &snapshot.files)?;
            rename_handle(&stage_pin, &target, false)?;
            Ok(snapshot.inspection.clone())
        })();
        result.map_err(|error: String| format!("{error}; staged bytes preserved at {}", stage.display()))
    }

    pub(super) fn archive(project: &Path, name: &str, expected_identity: &str, expected_fingerprint: &str) -> Result<String, String> {
        skill_name(name)?;
        let mut pins = Vec::new();
        let project = pin_path(project, &mut pins)?;
        if identity(pins.last().ok_or("Missing project pin")?)? != expected_identity { return Err("Project identity changed".into()); }
        let agents = pin_path(&project.join(".agents"), &mut pins)?;
        let skills = pin_path(&agents.join("skills"), &mut pins)?;
        let source = skills.join(name);
        let inspected = inspect(&project, &source, name)?;
        if inspected.inspection.fingerprint != expected_fingerprint { return Err("Skill changed; inspect current bytes before removing".into()); }
        let source_identity = inspected.source_identity;
        let expected_files = inspected.files.clone();
        drop(inspected);
        let moving = open_entry(&source, true)?;
        if moving.metadata().map_err(|e| e.to_string())?.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 ||
            file_identity(&moving)? != source_identity { return Err("Cannot archive a linked or replaced skill".into()); }
        let mut files = Vec::new(); let mut bytes = 0; let mut content_pins = Vec::new();
        read_package(&source, Path::new(""), 0, &mut files, &mut bytes, &mut content_pins)?;
        files.sort_by(|a, b| a.0.cmp(&b.0));
        if files != expected_files { return Err("Skill changed before archive; current bytes preserved".into()); }
        drop(content_pins);
        let archive = directory(&agents, "skill-archive", &mut pins)?;
        let target = archive.join(format!("{name}-{}", uuid::Uuid::new_v4()));
        rename_handle(&moving, &target, false)?;
        Ok(crate::fs::path_to_js(&target))
    }

    #[cfg(test)]
    mod stage_tests {
        use super::*;

        #[test]
        fn skill_stage_validation_refuses_extra_files_or_changed_bytes() {
            let root = std::env::temp_dir().join(format!("monocode-skill-stage-content-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir(&root).unwrap();
            std::fs::write(root.join("SKILL.md"), b"synthetic").unwrap();
            let stage = claim_stage(&root).unwrap();
            assert_eq!(handle_path(&stage).unwrap(), std::fs::canonicalize(&root).unwrap());
            let expected = vec![("SKILL.md".to_string(), b"synthetic".to_vec())];
            stage_matches(&root, &expected).unwrap();
            std::fs::write(root.join("extra.txt"), b"unapproved").unwrap();
            assert!(stage_matches(&root, &expected).is_err());
            std::fs::remove_file(root.join("extra.txt")).unwrap();
            std::fs::write(root.join("SKILL.md"), b"changed").unwrap();
            assert!(stage_matches(&root, &expected).is_err());
            drop(stage);
            std::fs::remove_dir_all(root).unwrap();
        }

        #[test]
        fn skill_stage_claim_refuses_reparse_or_file_substitution() {
            let root = std::env::temp_dir().join(format!("monocode-skill-stage-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir(&root).unwrap();
            std::fs::create_dir(root.join("ordinary")).unwrap();
            std::fs::write(root.join("file"), b"synthetic").unwrap();
            junction::create(root.join("ordinary"), root.join("linked")).unwrap();
            assert!(claim_stage(&root.join("linked")).is_err());
            assert!(claim_stage(&root.join("file")).is_err());
            assert!(claim_stage(&root.join("ordinary")).is_ok());
            assert_eq!(std::fs::read(root.join("file")).unwrap(), b"synthetic");
            junction::delete(root.join("linked")).unwrap();
            std::fs::remove_dir_all(root).unwrap();
        }
    }
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredSkill {
    pub name: String,
    pub description: String,
    pub path: String,
    pub scope: String,
    pub source: String,
}

struct DisabledFilter {
    normalized: HashSet<String>,
    canonical: HashSet<PathBuf>,
}

impl DisabledFilter {
    fn new(paths: Option<&[String]>) -> Option<Self> {
        let paths = paths?;
        if paths.is_empty() {
            return None;
        }
        let normalized = paths
            .iter()
            .map(|p| normalize_path_for_compare(p))
            .collect();
        let canonical = paths
            .iter()
            .filter_map(|p| std::fs::canonicalize(expand_home(p)).ok())
            .collect();
        Some(Self {
            normalized,
            canonical,
        })
    }

    fn is_disabled(&self, path: &str) -> bool {
        let normalized = normalize_path_for_compare(path);
        if self.normalized.contains(&normalized) {
            return true;
        }
        if !self.canonical.is_empty() {
            if let Ok(canon) = std::fs::canonicalize(path) {
                if self.canonical.contains(&canon) {
                    return true;
                }
            }
        }
        false
    }
}

#[cfg(windows)]
fn normalize_path_for_compare(path: &str) -> String {
    let mut s = path.replace('\\', "/");
    if let Some(stripped) = s.strip_prefix("//?/") {
        s = stripped.to_string();
    }
    while s.contains("//") {
        s = s.replace("//", "/");
    }
    s.to_lowercase()
}

#[cfg(not(windows))]
fn normalize_path_for_compare(path: &str) -> String {
    path.to_string()
}

/// Skills visible for the open project: `.agents/skills` first, then native
/// harness folders. Same name: earlier roots win.
/// Excludes disabled paths before deduplication so lower-priority enabled
/// same-name files can fall through.
#[tauri::command(async)]
pub fn list_skills(
    cwd: String,
    disabled_paths: Option<Vec<String>>,
) -> Result<Vec<DiscoveredSkill>, String> {
    let project = expand_home(&cwd);
    let home = dirs_home().map(PathBuf::from);
    Ok(list_skills_from(
        &project,
        home.as_deref(),
        disabled_paths.as_deref(),
    ))
}

pub(crate) fn list_skills_from(
    project: &Path,
    home: Option<&Path>,
    disabled_paths: Option<&[String]>,
) -> Vec<DiscoveredSkill> {
    let disabled_filter = DisabledFilter::new(disabled_paths);
    let mut by_name: HashMap<String, DiscoveredSkill> = HashMap::new();
    let mut seen_roots: HashSet<PathBuf> = HashSet::new();

    let mut add_root = |root: PathBuf, scope: &str, source: &str| {
        if by_name.len() >= MAX_SKILLS {
            return;
        }
        let key = std::fs::canonicalize(&root).unwrap_or(root.clone());
        if !seen_roots.insert(key) {
            return;
        }
        for skill in scan_root(&root, scope, source) {
            if disabled_filter
                .as_ref()
                .is_some_and(|f| f.is_disabled(&skill.path))
            {
                continue;
            }
            if by_name.len() >= MAX_SKILLS {
                break;
            }
            by_name.entry(skill.name.clone()).or_insert(skill);
        }
    };

    // Highest priority first so later roots cannot replace a name.
    add_root(project.join(".agents/skills"), "project", "agents");
    if let Some(home) = home {
        add_root(home.join(".agents/skills"), "user", "agents");
    }

    for (dir, source) in [
        (".claude/skills", "claude"),
        (".cursor/skills", "cursor"),
        (".codex/skills", "codex"),
        (".opencode/skills", "opencode"),
        (".pi/skills", "pi"),
        (".omp/skills", "omp"),
        (".fx/skills", "fx"),
        (".grok/skills", "grok"),
        (".hermes/skills", "hermes"),
    ] {
        add_root(project.join(dir), "project", source);
        if let Some(home) = home {
            add_root(home.join(dir), "user", source);
        }
    }
    if let Some(home) = home {
        add_root(home.join(".pi/agent/skills"), "user", "pi");
        add_root(home.join(".omp/agent/skills"), "user", "omp");
        // New-provider roots come after every pre-existing root so an
        // identically named skill can never shadow an established provider.
        let root = home.join(".gemini/antigravity/skills");
        if root.is_dir() {
            add_root(root, "user", "antigravity");
        }
        add_root(home.join(".config/devin/skills"), "user", "devin");
        // Windows keeps Devin's user config under %APPDATA% instead.
        #[cfg(windows)]
        add_root(
            std::env::var_os("APPDATA")
                .map(PathBuf::from)
                .unwrap_or_else(|| home.join("AppData/Roaming"))
                .join("devin/skills"),
            "user",
            "devin",
        );
        add_root(project.join(".devin/skills"), "project", "devin");
        for (root, scope, namespace) in claude_plugin_skill_roots(home, project) {
            add_namespaced_root(
                &mut by_name,
                root,
                scope,
                "claude",
                &namespace,
                disabled_filter.as_ref(),
            );
        }
    }

    let mut out: Vec<DiscoveredSkill> = by_name.into_values().collect();
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

fn add_namespaced_root(
    by_name: &mut HashMap<String, DiscoveredSkill>,
    root: PathBuf,
    scope: &str,
    source: &str,
    namespace: &str,
    disabled_filter: Option<&DisabledFilter>,
) {
    if by_name.len() >= MAX_SKILLS {
        return;
    }
    for mut skill in scan_root(&root, scope, source) {
        if disabled_filter.is_some_and(|f| f.is_disabled(&skill.path)) {
            continue;
        }
        if by_name.len() >= MAX_SKILLS {
            break;
        }
        skill.name = format!("{namespace}:{}", skill.name);
        by_name.entry(skill.name.clone()).or_insert(skill);
    }
}

fn claude_plugin_skill_roots(home: &Path, project: &Path) -> Vec<(PathBuf, &'static str, String)> {
    let registry = home.join(".claude/plugins/installed_plugins.json");
    let Ok(raw) = std::fs::read_to_string(registry) else {
        return Vec::new();
    };
    let Ok(value) = serde_json::from_str::<serde_json::Value>(&raw) else {
        return Vec::new();
    };
    let Some(plugins) = value.get("plugins").and_then(|value| value.as_object()) else {
        return Vec::new();
    };

    let mut roots = Vec::new();
    for (plugin_id, installed) in plugins {
        if !claude_plugin_enabled(home, project, plugin_id) {
            continue;
        }
        let namespace = plugin_id
            .rsplit_once('@')
            .map(|(name, _)| name)
            .unwrap_or(plugin_id);
        if !is_valid_skill_name(namespace) {
            continue;
        }
        let entries: Vec<&serde_json::Value> = match installed.as_array() {
            Some(entries) => entries.iter().collect(),
            None if installed.is_object() => vec![installed],
            None => continue,
        };
        for entry in entries {
            let Some(install_path) = entry.get("installPath").and_then(|value| value.as_str())
            else {
                continue;
            };
            let scope = match entry.get("scope").and_then(|value| value.as_str()) {
                Some("project" | "local") => {
                    let Some(project_path) =
                        entry.get("projectPath").and_then(|value| value.as_str())
                    else {
                        continue;
                    };
                    if !path_is_within(project, &resolve_home_path(project_path, home)) {
                        continue;
                    }
                    "project"
                }
                Some("user") | None => "user",
                Some(_) => continue,
            };
            roots.push((
                resolve_home_path(install_path, home).join("skills"),
                scope,
                namespace.to_string(),
            ));
        }
    }
    roots.sort_by_key(|(_, scope, _)| if *scope == "project" { 0 } else { 1 });
    roots
}

fn resolve_home_path(raw: &str, home: &Path) -> PathBuf {
    if raw == "~" {
        return home.to_path_buf();
    }
    if let Some(rest) = raw.strip_prefix("~/") {
        return home.join(rest);
    }
    let path = PathBuf::from(raw);
    if path.is_absolute() {
        path
    } else {
        home.join(path)
    }
}

fn claude_plugin_enabled(home: &Path, project: &Path, plugin_id: &str) -> bool {
    if let Some(enabled) = managed_plugin_setting(plugin_id) {
        return enabled;
    }
    let project_root = claude_settings_project_root(project);
    for settings in [
        project_root.join(".claude/settings.local.json"),
        project_root.join(".claude/settings.json"),
        home.join(".claude/settings.json"),
    ] {
        if let Some(enabled) = plugin_setting(&settings, plugin_id) {
            return enabled;
        }
    }
    true
}

fn claude_settings_project_root(project: &Path) -> PathBuf {
    for candidate in project.ancestors() {
        let claude = candidate.join(".claude");
        if claude.join("settings.local.json").is_file() || claude.join("settings.json").is_file() {
            return candidate.to_path_buf();
        }
    }
    project.to_path_buf()
}

fn plugin_setting(path: &Path, plugin_id: &str) -> Option<bool> {
    let raw = std::fs::read_to_string(path).ok()?;
    let value = serde_json::from_str::<serde_json::Value>(&raw).ok()?;
    value.get("enabledPlugins")?.get(plugin_id)?.as_bool()
}

fn managed_plugin_setting(plugin_id: &str) -> Option<bool> {
    let root = managed_settings_root()?;
    managed_plugin_setting_from_root(&root, plugin_id)
}

fn managed_plugin_setting_from_root(root: &Path, plugin_id: &str) -> Option<bool> {
    let mut value = plugin_setting(&root.join("managed-settings.json"), plugin_id);
    let dir = root.join("managed-settings.d");
    let mut files: Vec<PathBuf> = std::fs::read_dir(dir)
        .ok()
        .into_iter()
        .flatten()
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| {
            path.extension().and_then(|ext| ext.to_str()) == Some("json")
                && path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .is_some_and(|name| !name.starts_with('.'))
        })
        .collect();
    files.sort();
    for file in files {
        if let Some(enabled) = plugin_setting(&file, plugin_id) {
            value = Some(enabled);
        }
    }
    value
}

fn managed_settings_root() -> Option<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        return Some(PathBuf::from("/Library/Application Support/ClaudeCode"));
    }
    #[cfg(any(target_os = "linux", target_os = "android"))]
    {
        return Some(PathBuf::from("/etc/claude-code"));
    }
    #[cfg(target_os = "windows")]
    {
        return Some(PathBuf::from(r"C:\Program Files\ClaudeCode"));
    }
    #[allow(unreachable_code)]
    None
}

fn path_is_within(path: &Path, root: &Path) -> bool {
    let Ok(path) = std::fs::canonicalize(path) else {
        return false;
    };
    let Ok(root) = std::fs::canonicalize(root) else {
        return false;
    };
    path == root || path.starts_with(root)
}

fn scan_root(root: &Path, scope: &str, source: &str) -> Vec<DiscoveredSkill> {
    let Ok(reader) = std::fs::read_dir(root) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for ent in reader.flatten() {
        let dir = ent.path();
        if !dir.is_dir() {
            continue;
        }
        let Some(folder) = dir.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        if folder.starts_with('.') || folder == "skills-cursor" {
            continue;
        }
        let skill_md = skill_md_path(&dir);
        let Some(skill_md) = skill_md else { continue };
        let Ok(bytes) = read_prefix(&skill_md, MAX_FRONTMATTER_BYTES) else {
            continue;
        };
        let Some(text) = utf8_prefix(bytes) else {
            continue;
        };
        let fallback = slug_name(folder);
        if fallback.is_empty() {
            continue;
        }
        let (name, description) = parse_frontmatter(&text, &fallback);
        if name.is_empty() {
            continue;
        }
        out.push(DiscoveredSkill {
            name,
            description,
            path: crate::fs::path_to_js(&skill_md),
            scope: scope.to_string(),
            source: source.to_string(),
        });
    }
    out
}

fn skill_md_path(dir: &Path) -> Option<PathBuf> {
    let upper = dir.join("SKILL.md");
    if upper.is_file() {
        return Some(upper);
    }
    let lower = dir.join("skill.md");
    if lower.is_file() {
        return Some(lower);
    }
    None
}

fn read_prefix(path: &Path, max: usize) -> std::io::Result<Vec<u8>> {
    use std::io::Read;
    let file = std::fs::File::open(path)?;
    let mut buf = Vec::with_capacity(max.min(4096));
    file.take(max as u64).read_to_end(&mut buf)?;
    Ok(buf)
}

/// Decodes the bytes from `read_prefix`, which can stop in the middle of a
/// multi-byte character. Removes an incomplete character at the end.
/// Rejects other invalid UTF-8.
fn utf8_prefix(bytes: Vec<u8>) -> Option<String> {
    match String::from_utf8(bytes) {
        Ok(text) => Some(text),
        Err(err) if err.utf8_error().error_len().is_none() => {
            let valid = err.utf8_error().valid_up_to();
            let mut bytes = err.into_bytes();
            bytes.truncate(valid);
            String::from_utf8(bytes).ok()
        }
        Err(_) => None,
    }
}

fn parse_frontmatter(text: &str, fallback: &str) -> (String, String) {
    let trimmed = text.trim_start_matches('\u{feff}');
    let Some(rest) = trimmed.strip_prefix("---") else {
        return (fallback.to_string(), String::new());
    };
    let rest = rest.strip_prefix('\r').unwrap_or(rest);
    let rest = rest.strip_prefix('\n').unwrap_or(rest);
    let end = rest
        .find("\n---")
        .or_else(|| rest.find("\r\n---"))
        .unwrap_or(rest.len());
    let yaml = &rest[..end];

    let mut name: Option<String> = None;
    let mut description = String::new();
    let mut in_desc = false;
    let mut fold_desc = false;

    for raw in yaml.lines() {
        if in_desc {
            if is_yaml_indent(raw) {
                let piece = raw.trim();
                if piece.is_empty() {
                    continue;
                }
                if !description.is_empty() {
                    description.push(if fold_desc { ' ' } else { '\n' });
                }
                description.push_str(piece);
                continue;
            }
            in_desc = false;
        }

        let line = raw.trim_end();
        if let Some(value) = yaml_value(line, "name") {
            name = Some(unquote(&value));
        } else if let Some(value) = yaml_value(line, "description") {
            let value = value.trim();
            if is_folded_scalar(value) {
                in_desc = true;
                fold_desc = value.starts_with('>');
                description.clear();
            } else {
                description = unquote(value);
            }
        }
    }

    let folder = fallback.to_string();
    let name = name.filter(|n| is_valid_skill_name(n)).unwrap_or(folder);
    (name, description.trim().to_string())
}

fn yaml_value(line: &str, key: &str) -> Option<String> {
    let line = line.trim_start();
    let prefix = format!("{key}:");
    line.strip_prefix(&prefix)
        .map(|rest| rest.trim().to_string())
}

fn is_folded_scalar(value: &str) -> bool {
    value.starts_with('>') || value.starts_with('|')
}

fn is_yaml_indent(line: &str) -> bool {
    line.starts_with(' ') || line.starts_with('\t')
}

fn unquote(value: &str) -> String {
    let value = value.trim();
    let bytes = value.as_bytes();
    if bytes.len() >= 2 {
        let first = bytes[0];
        let last = bytes[bytes.len() - 1];
        if (first == b'"' && last == b'"') || (first == b'\'' && last == b'\'') {
            return value[1..value.len() - 1].to_string();
        }
    }
    value.to_string()
}

fn is_valid_skill_name(name: &str) -> bool {
    if name.is_empty() || name.len() > 64 {
        return false;
    }
    let mut prev_dash = true;
    for (i, ch) in name.chars().enumerate() {
        if ch.is_ascii_lowercase() || ch.is_ascii_digit() {
            prev_dash = false;
            continue;
        }
        if ch == '-' && i > 0 && !prev_dash {
            prev_dash = true;
            continue;
        }
        return false;
    }
    !prev_dash
}

fn slug_name(raw: &str) -> String {
    let mut out = String::new();
    let mut dash = false;
    for ch in raw.chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch.to_ascii_lowercase());
            dash = false;
        } else if !out.is_empty() && !dash {
            out.push('-');
            dash = true;
        }
    }
    while out.ends_with('-') {
        out.pop();
    }
    if out.len() > 64 {
        out.truncate(64);
        while out.ends_with('-') {
            out.pop();
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::ErrorKind;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    static TMP_SEQ: AtomicU64 = AtomicU64::new(0);

    struct Tmp(PathBuf);
    impl Drop for Tmp {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn tmp(label: &str) -> Tmp {
        loop {
            let stamp = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let seq = TMP_SEQ.fetch_add(1, Ordering::Relaxed);
            let dir = std::env::temp_dir().join(format!(
                "monocode-skills-{label}-{}-{stamp}-{seq}",
                std::process::id()
            ));
            match std::fs::create_dir(&dir) {
                Ok(()) => return Tmp(dir),
                Err(error) if error.kind() == ErrorKind::AlreadyExists => continue,
                Err(error) => panic!("{}", error),
            }
        }
    }

    fn write_skill(root: &Path, folder: &str, body: &str) {
        let dir = root.join(folder);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("SKILL.md"), body).unwrap();
    }

    fn write_plugin_setting(root: &Path, file: &str, plugin_id: &str, enabled: bool) {
        let dir = root.join(".claude");
        std::fs::create_dir_all(&dir).unwrap();
        let settings = serde_json::json!({
            "enabledPlugins": { plugin_id: enabled }
        });
        std::fs::write(dir.join(file), serde_json::to_vec(&settings).unwrap()).unwrap();
    }

    #[test]
    fn parse_frontmatter_reads_name_and_folded_description() {
        let (name, desc) = parse_frontmatter(
            "---\nname: review-pr\ndescription: >\n  Review pull requests.\n  Use when asked to review.\n---\n\n# hi\n",
            "fallback",
        );
        assert_eq!(name, "review-pr");
        assert_eq!(desc, "Review pull requests. Use when asked to review.");
    }

    #[cfg(windows)]
    fn local_package(source: &Path) {
        std::fs::write(source.join("SKILL.md"), "---\nname: fixture\ndescription: Synthetic fixture\n---\nRead helpers on demand.\n").unwrap();
        std::fs::create_dir(source.join("scripts")).unwrap();
        std::fs::write(source.join("scripts/check.ps1"), b"throw 'must never execute'\r\n").unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn project_skill_install_and_archive_preserve_all_bytes_and_source() {
        let project = tmp("install-project"); let source = tmp("install-source");
        local_package(&source.0);
        let inspected = inspect_project_skill(project.0.to_string_lossy().into(), source.0.to_string_lossy().into(), "fixture".into()).unwrap();
        assert_eq!(inspected.files.len(), 2);
        assert_eq!(inspected.declared_name, "fixture");
        assert_eq!(inspected.description, "Synthetic fixture");
        let installed = install_project_skill(project.0.to_string_lossy().into(), source.0.to_string_lossy().into(), "fixture".into(), inspected.project_identity.clone(), inspected.fingerprint.clone()).unwrap();
        assert_eq!(installed, inspected);
        let target = project.0.join(".agents/skills/fixture");
        let discovered = list_skills_from(&project.0, None, None);
        assert!(discovered.iter().any(|skill| skill.scope == "project" && skill.name == "fixture" && Path::new(&skill.path).ends_with(".agents/skills/fixture/SKILL.md")));
        assert_eq!(std::fs::read(target.join("scripts/check.ps1")).unwrap(), std::fs::read(source.0.join("scripts/check.ps1")).unwrap());
        let archived = archive_project_skill(project.0.to_string_lossy().into(), "fixture".into(), inspected.project_identity, inspected.fingerprint).unwrap();
        assert!(!target.exists());
        assert_eq!(std::fs::read(Path::new(&archived).join("SKILL.md")).unwrap(), std::fs::read(source.0.join("SKILL.md")).unwrap());
        assert_eq!(std::fs::read(Path::new(&archived).join("scripts/check.ps1")).unwrap(), b"throw 'must never execute'\r\n");
        assert!(source.0.join("SKILL.md").is_file());
    }

    #[cfg(windows)]
    #[test]
    fn project_skill_inspection_refuses_mismatched_frontmatter_name() {
        let project = tmp("declared-name-project"); let source = tmp("declared-name-source"); local_package(&source.0);
        std::fs::write(source.0.join("SKILL.md"), "---\nname: commit\ndescription: Synthetic unapproved name\n---\n").unwrap();
        let error = inspect_project_skill(project.0.to_string_lossy().into(), source.0.to_string_lossy().into(), "fixture".into()).expect_err("An unapproved frontmatter name must be refused");
        assert!(error.contains("declared skill name"), "{error}");
        assert!(!project.0.join(".agents").exists());
        let incomplete = format!("---\nname: commit\ndescription: Synthetic incomplete header\n{}\nname: fixture\n", "x".repeat(MAX_FRONTMATTER_BYTES));
        std::fs::write(source.0.join("SKILL.md"), incomplete).unwrap();
        assert!(inspect_project_skill(project.0.to_string_lossy().into(), source.0.to_string_lossy().into(), "fixture".into()).unwrap_err().contains("16 KiB"));
    }

    #[cfg(windows)]
    #[test]
    fn project_skill_inspection_refuses_secret_named_files_without_copying() {
        let project = tmp("secret-file-project"); let source = tmp("secret-file-source"); local_package(&source.0);
        for name in [".npmrc", "id_rsa", "secret.pem", "service-credentials.json", "id_ecdsa", "key.ppk", "state.tfstate", ".env.example"] {
            std::fs::write(source.0.join(name), b"synthetic secret fixture").unwrap();
            let error = inspect_project_skill(project.0.to_string_lossy().into(), source.0.to_string_lossy().into(), "fixture".into()).unwrap_err();
            assert!(error.contains("protected secret filename"), "{name}: {error}");
            assert!(!project.0.join(".agents").exists());
            assert_eq!(std::fs::read(source.0.join(name)).unwrap(), b"synthetic secret fixture");
            std::fs::remove_file(source.0.join(name)).unwrap();
        }
    }

    #[cfg(windows)]
    #[test]
    fn project_skill_install_refuses_changed_source_identity_and_existing_target() {
        let project = tmp("refusal-project"); let source = tmp("refusal-source"); local_package(&source.0);
        let inspected = inspect_project_skill(project.0.to_string_lossy().into(), source.0.to_string_lossy().into(), "fixture".into()).unwrap();
        let attempt = |identity: String, hash: String| install_project_skill(project.0.to_string_lossy().into(), source.0.to_string_lossy().into(), "fixture".into(), identity, hash);
        assert!(attempt("different".into(), inspected.fingerprint.clone()).is_err());
        std::fs::write(source.0.join("scripts/check.ps1"), b"changed").unwrap();
        assert!(attempt(inspected.project_identity.clone(), inspected.fingerprint).is_err());
        let fresh = inspect_project_skill(project.0.to_string_lossy().into(), source.0.to_string_lossy().into(), "fixture".into()).unwrap();
        attempt(fresh.project_identity.clone(), fresh.fingerprint.clone()).unwrap();
        assert!(attempt(fresh.project_identity, fresh.fingerprint).unwrap_err().contains("already exists"));
        assert_eq!(std::fs::read(project.0.join(".agents/skills/fixture/scripts/check.ps1")).unwrap(), b"changed");
    }

    #[cfg(windows)]
    #[test]
    fn project_skill_install_refuses_source_and_destination_junctions() {
        let project = tmp("links-project"); let source = tmp("links-source"); let foreign = tmp("links-foreign"); local_package(&source.0);
        junction::create(&foreign.0, source.0.join("escape")).unwrap();
        assert!(inspect_project_skill(project.0.to_string_lossy().into(), source.0.to_string_lossy().into(), "fixture".into()).is_err());
        junction::delete(source.0.join("escape")).unwrap();
        let inspected = inspect_project_skill(project.0.to_string_lossy().into(), source.0.to_string_lossy().into(), "fixture".into()).unwrap();
        junction::create(&foreign.0, project.0.join(".agents")).unwrap();
        assert!(install_project_skill(project.0.to_string_lossy().into(), source.0.to_string_lossy().into(), "fixture".into(), inspected.project_identity, inspected.fingerprint).is_err());
        assert!(!foreign.0.join("skills").exists());
        junction::delete(project.0.join(".agents")).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn project_skill_inspection_refuses_hardlinks_oversize_and_path_names() {
        let project = tmp("bounds-project"); let source = tmp("bounds-source"); local_package(&source.0);
        for name in ["../other", "con", "nul", "fixture.", "a/b"] {
            assert!(inspect_project_skill(project.0.to_string_lossy().into(), source.0.to_string_lossy().into(), name.into()).is_err());
        }
        std::fs::hard_link(source.0.join("SKILL.md"), source.0.join("alias.md")).unwrap();
        assert!(inspect_project_skill(project.0.to_string_lossy().into(), source.0.to_string_lossy().into(), "fixture".into()).is_err());
        std::fs::remove_file(source.0.join("alias.md")).unwrap();
        std::fs::write(source.0.join("large.bin"), vec![0; 1024 * 1024 + 1]).unwrap();
        assert!(inspect_project_skill(project.0.to_string_lossy().into(), source.0.to_string_lossy().into(), "fixture".into()).is_err());
        std::fs::remove_file(source.0.join("large.bin")).unwrap();
        for index in 0..257 { std::fs::create_dir(source.0.join(format!("part-{index}"))).unwrap(); }
        assert!(inspect_project_skill(project.0.to_string_lossy().into(), source.0.to_string_lossy().into(), "fixture".into()).unwrap_err().contains("directory and file entry limit"));
        assert!(!project.0.join(".agents").exists());
    }

    #[test]
    fn parse_frontmatter_falls_back_to_folder_name() {
        let (name, desc) = parse_frontmatter("# no yaml\n", "create-skill");
        assert_eq!(name, "create-skill");
        assert_eq!(desc, "");
    }

    #[test]
    fn utf8_prefix_drops_only_a_cut_character() {
        // 2-byte, 3-byte and 4-byte characters, with each possible cut.
        for text in ["abж", "ab€", "ab😀"] {
            let bytes = text.as_bytes();
            let last = text.chars().last().unwrap().len_utf8();
            for removed in 1..last {
                let cut = bytes[..bytes.len() - removed].to_vec();
                assert_eq!(utf8_prefix(cut).as_deref(), Some("ab"));
            }
            assert_eq!(utf8_prefix(bytes.to_vec()).as_deref(), Some(text));
        }
        assert_eq!(utf8_prefix(vec![b'a', 0xff, b'b']), None);
    }

    #[test]
    fn lists_large_skill_when_prefix_cuts_a_character() {
        let project = tmp("proj");
        let home = tmp("home");
        let mut body = String::from("---\nname: big-cyrillic\ndescription: Big skill\n---\n");
        // Put the first byte of a 2-byte character at the last byte of the prefix.
        while body.len() < MAX_FRONTMATTER_BYTES - 1 {
            body.push('x');
        }
        body.push_str(&"ж".repeat(1_000));
        write_skill(&home.0.join(".agents/skills"), "big-cyrillic", &body);

        let skills = list_skills_from(&project.0, Some(&home.0), None);
        let skill = skills.iter().find(|s| s.name == "big-cyrillic").unwrap();
        assert_eq!(skill.description, "Big skill");
    }

    #[test]
    fn agents_skills_win_over_provider_dirs() {
        let project = tmp("proj");
        let home = tmp("home");
        write_skill(
            &project.0.join(".agents/skills"),
            "ship",
            "---\nname: ship\ndescription: MonoCode ship\n---\n",
        );
        write_skill(
            &project.0.join(".claude/skills"),
            "ship",
            "---\nname: ship\ndescription: Claude ship\n---\n",
        );
        write_skill(
            &home.0.join(".agents/skills"),
            "greet",
            "---\nname: greet\ndescription: Hello\n---\n",
        );
        write_skill(
            &project.0.join(".cursor/skills"),
            "cursor-only",
            "---\nname: cursor-only\ndescription: Cursor native\n---\n",
        );

        let skills = list_skills_from(&project.0, Some(&home.0), None);
        let ship = skills.iter().find(|s| s.name == "ship").unwrap();
        assert_eq!(ship.description, "MonoCode ship");
        assert_eq!(ship.source, "agents");
        assert_eq!(ship.scope, "project");

        let greet = skills.iter().find(|s| s.name == "greet").unwrap();
        assert_eq!(greet.scope, "user");
        assert_eq!(greet.source, "agents");

        let native = skills.iter().find(|s| s.name == "cursor-only").unwrap();
        assert_eq!(native.source, "cursor");
        assert_eq!(native.scope, "project");
    }

    #[test]
    fn lists_large_catalogs_from_every_root() {
        let project = tmp("proj");
        let home = tmp("home");
        for index in 0..1_400 {
            let name = format!("shared-{index:04}");
            write_skill(
                &home.0.join(".agents/skills"),
                &name,
                &format!("---\nname: {name}\ndescription: Shared skill {index}\n---\n"),
            );
        }
        write_skill(
            &home.0.join(".codex/skills"),
            "codex-only",
            "---\nname: codex-only\ndescription: Codex native\n---\n",
        );

        let skills = list_skills_from(&project.0, Some(&home.0), None);
        assert_eq!(skills.len(), 1_401);
        assert!(skills.iter().any(|s| s.name == "shared-1399"));
        let codex = skills.iter().find(|s| s.name == "codex-only").unwrap();
        assert_eq!(codex.source, "codex");
    }

    #[test]
    fn discovers_pi_project_and_user_skills() {
        let project = tmp("proj-pi");
        let home = tmp("home-pi");
        write_skill(
            &project.0.join(".pi/skills"),
            "pi-review",
            "---\nname: pi-review\ndescription: Pi project skill\n---\n",
        );
        write_skill(
            &home.0.join(".pi/agent/skills"),
            "pi-global",
            "---\nname: pi-global\ndescription: Pi user skill\n---\n",
        );

        let skills = list_skills_from(&project.0, Some(&home.0), None);
        let project_skill = skills.iter().find(|s| s.name == "pi-review").unwrap();
        assert_eq!(project_skill.source, "pi");
        assert_eq!(project_skill.scope, "project");
        let user_skill = skills.iter().find(|s| s.name == "pi-global").unwrap();
        assert_eq!(user_skill.source, "pi");
        assert_eq!(user_skill.scope, "user");
    }

    #[test]
    fn discovers_fx_project_and_user_skills() {
        let project = tmp("proj-fx");
        let home = tmp("home-fx");
        write_skill(
            &project.0.join(".fx/skills"),
            "fx-review",
            "---\nname: fx-review\ndescription: fx project skill\n---\n",
        );
        write_skill(
            &home.0.join(".fx/skills"),
            "fx-global",
            "---\nname: fx-global\ndescription: fx user skill\n---\n",
        );

        let skills = list_skills_from(&project.0, Some(&home.0), None);
        let project_skill = skills.iter().find(|s| s.name == "fx-review").unwrap();
        assert_eq!(project_skill.source, "fx");
        assert_eq!(project_skill.scope, "project");
        let user_skill = skills.iter().find(|s| s.name == "fx-global").unwrap();
        assert_eq!(user_skill.source, "fx");
        assert_eq!(user_skill.scope, "user");
    }

    #[test]
    fn discovers_grok_project_and_user_skills() {
        let project = tmp("proj-grok");
        let home = tmp("home-grok");
        write_skill(
            &project.0.join(".grok/skills"),
            "grok-review",
            "---\nname: grok-review\ndescription: grok project skill\n---\n",
        );
        write_skill(
            &home.0.join(".grok/skills"),
            "grok-global",
            "---\nname: grok-global\ndescription: grok user skill\n---\n",
        );

        let skills = list_skills_from(&project.0, Some(&home.0), None);
        let project_skill = skills.iter().find(|s| s.name == "grok-review").unwrap();
        assert_eq!(project_skill.source, "grok");
        assert_eq!(project_skill.scope, "project");
        let user_skill = skills.iter().find(|s| s.name == "grok-global").unwrap();
        assert_eq!(user_skill.source, "grok");
        assert_eq!(user_skill.scope, "user");
    }

    #[test]
    fn discovers_hermes_project_and_user_skills() {
        let project = tmp("proj-hermes");
        let home = tmp("home-hermes");
        write_skill(
            &project.0.join(".hermes/skills"),
            "hermes-review",
            "---\nname: hermes-review\ndescription: Hermes project skill\n---\n",
        );
        write_skill(
            &home.0.join(".hermes/skills"),
            "hermes-global",
            "---\nname: hermes-global\ndescription: Hermes user skill\n---\n",
        );

        let skills = list_skills_from(&project.0, Some(&home.0), None);
        let project_skill = skills.iter().find(|s| s.name == "hermes-review").unwrap();
        assert_eq!(project_skill.source, "hermes");
        assert_eq!(project_skill.scope, "project");
        let user_skill = skills.iter().find(|s| s.name == "hermes-global").unwrap();
        assert_eq!(user_skill.source, "hermes");
        assert_eq!(user_skill.scope, "user");
    }

    #[test]
    fn discovers_devin_project_and_user_skills() {
        let project = tmp("proj-devin");
        let home = tmp("home-devin");
        write_skill(
            &project.0.join(".devin/skills"),
            "devin-review",
            "---\nname: devin-review\ndescription: Devin project skill\n---\n",
        );
        write_skill(
            &home.0.join(".config/devin/skills"),
            "devin-global",
            "---\nname: devin-global\ndescription: Devin user skill\n---\n",
        );

        let skills = list_skills_from(&project.0, Some(&home.0), None);
        let project_skill = skills.iter().find(|s| s.name == "devin-review").unwrap();
        assert_eq!(project_skill.source, "devin");
        assert_eq!(project_skill.scope, "project");
        let user_skill = skills.iter().find(|s| s.name == "devin-global").unwrap();
        assert_eq!(user_skill.source, "devin");
        assert_eq!(user_skill.scope, "user");
    }

    #[test]
    fn discovers_antigravity_user_skills() {
        let project = tmp("proj-agy");
        let home = tmp("home-agy");
        write_skill(
            &home.0.join(".gemini/antigravity/skills"),
            "agy-review",
            "---\nname: agy-review\ndescription: Antigravity user skill\n---\n",
        );
        let skills = list_skills_from(&project.0, Some(&home.0), None);
        let agy = skills.iter().find(|s| s.name == "agy-review").unwrap();
        assert_eq!(agy.source, "antigravity");
        assert_eq!(agy.scope, "user");
    }

    #[test]
    fn antigravity_skills_do_not_shadow_existing_providers() {
        let project = tmp("proj-agy-shadow");
        let home = tmp("home-agy-shadow");
        for (root, desc) in [
            (home.0.join(".omp/agent/skills"), "OMP agent skill"),
            (
                home.0.join(".gemini/antigravity/skills"),
                "Antigravity user skill",
            ),
        ] {
            write_skill(
                &root,
                "shared-name",
                &format!("---\nname: shared-name\ndescription: {desc}\n---\n"),
            );
        }
        let skills = list_skills_from(&project.0, Some(&home.0), None);
        let skill = skills.iter().find(|s| s.name == "shared-name").unwrap();
        assert_eq!(skill.description, "OMP agent skill");
        assert_eq!(skill.source, "omp");
    }

    #[test]
    fn discovers_installed_claude_plugin_skills() {
        let project = tmp("proj-claude-plugin");
        let home = tmp("home-claude-plugin");
        let plugin = home
            .0
            .join(".claude/plugins/cache/community/workflow-kit/1.2.3");
        write_skill(
            &plugin.join("skills"),
            "quick-plan",
            "---\nname: quick-plan\ndescription: Plan from plugin\n---\n",
        );
        write_skill(
            &home.0.join(".claude/skills"),
            "quick-plan",
            "---\nname: quick-plan\ndescription: Personal plan\n---\n",
        );
        std::fs::create_dir_all(home.0.join(".claude/plugins")).unwrap();
        std::fs::write(
            home.0.join(".claude/plugins/installed_plugins.json"),
            r#"{"version":2,"plugins":{"workflow-kit@community":[{"scope":"user","installPath":"~/.claude/plugins/cache/community/workflow-kit/1.2.3","version":"1.2.3"}]}}"#,
        )
        .unwrap();

        let skills = list_skills_from(&project.0, Some(&home.0), None);
        let skill = skills
            .iter()
            .find(|skill| skill.name == "workflow-kit:quick-plan")
            .unwrap();
        assert_eq!(skill.description, "Plan from plugin");
        assert_eq!(skill.source, "claude");
        assert_eq!(skill.scope, "user");
        assert!(skill
            .path
            .ends_with("workflow-kit/1.2.3/skills/quick-plan/SKILL.md"));
        assert!(skills.iter().any(|skill| skill.name == "quick-plan"));
    }

    #[test]
    fn claude_project_plugins_only_apply_to_their_project() {
        let project = tmp("proj-claude-scoped");
        let other = tmp("other-claude-scoped");
        let home = tmp("home-claude-scoped");
        let plugin = home
            .0
            .join(".claude/plugins/cache/community/workflow-kit/2.0.0");
        write_skill(
            &plugin.join("skills"),
            "feature-delivery",
            "---\nname: feature-delivery\ndescription: Deliver feature\n---\n",
        );
        std::fs::create_dir_all(home.0.join(".claude/plugins")).unwrap();
        let registry = serde_json::json!({
            "version": 2,
            "plugins": {
                "workflow-kit@community": [{
                    "scope": "project",
                    "projectPath": project.0.to_string_lossy(),
                    "installPath": plugin.to_string_lossy(),
                    "version": "2.0.0"
                }]
            }
        });
        std::fs::write(
            home.0.join(".claude/plugins/installed_plugins.json"),
            serde_json::to_vec(&registry).unwrap(),
        )
        .unwrap();

        let nested = project.0.join("src");
        std::fs::create_dir_all(&nested).unwrap();
        let matching = list_skills_from(&nested, Some(&home.0), None);
        let skill = matching
            .iter()
            .find(|skill| skill.name == "workflow-kit:feature-delivery")
            .unwrap();
        assert_eq!(skill.scope, "project");

        let unrelated = list_skills_from(&other.0, Some(&home.0), None);
        assert!(!unrelated
            .iter()
            .any(|skill| skill.name == "workflow-kit:feature-delivery"));
    }

    #[test]
    fn disabled_claude_plugin_skills_are_hidden() {
        let project = tmp("proj-claude-disabled");
        let home = tmp("home-claude-disabled");
        let plugin = home
            .0
            .join(".claude/plugins/cache/community/workflow-kit/1.2.3");
        write_skill(
            &plugin.join("skills"),
            "quick-plan",
            "---\nname: quick-plan\ndescription: Plan from plugin\n---\n",
        );
        std::fs::create_dir_all(home.0.join(".claude/plugins")).unwrap();
        std::fs::write(
            home.0.join(".claude/plugins/installed_plugins.json"),
            r#"{"version":2,"plugins":{"workflow-kit@community":[{"scope":"user","installPath":"~/.claude/plugins/cache/community/workflow-kit/1.2.3","version":"1.2.3"}]}}"#,
        )
        .unwrap();
        write_plugin_setting(&home.0, "settings.json", "workflow-kit@community", false);

        let skills = list_skills_from(&project.0, Some(&home.0), None);
        assert!(!skills
            .iter()
            .any(|skill| skill.name == "workflow-kit:quick-plan"));
    }

    #[test]
    fn claude_plugin_enablement_uses_local_project_user_precedence() {
        let project = tmp("proj-claude-precedence");
        let nested = project.0.join("src");
        let home = tmp("home-claude-precedence");
        std::fs::create_dir_all(&nested).unwrap();
        write_plugin_setting(&home.0, "settings.json", "workflow-kit@community", false);
        write_plugin_setting(&project.0, "settings.json", "workflow-kit@community", true);
        assert!(claude_plugin_enabled(
            &home.0,
            &nested,
            "workflow-kit@community"
        ));
        write_plugin_setting(
            &project.0,
            "settings.local.json",
            "workflow-kit@community",
            false,
        );
        assert!(!claude_plugin_enabled(
            &home.0,
            &nested,
            "workflow-kit@community"
        ));
    }

    #[test]
    fn managed_plugin_settings_apply_dropins_in_order() {
        let root = tmp("managed-settings");
        let plugin_id = "workflow-kit@community";
        let base = serde_json::json!({ "enabledPlugins": { plugin_id: true } });
        std::fs::write(
            root.0.join("managed-settings.json"),
            serde_json::to_vec(&base).unwrap(),
        )
        .unwrap();
        let dropins = root.0.join("managed-settings.d");
        std::fs::create_dir_all(&dropins).unwrap();
        let earlier = serde_json::json!({ "enabledPlugins": { plugin_id: true } });
        let later = serde_json::json!({ "enabledPlugins": { plugin_id: false } });
        std::fs::write(
            dropins.join("10-enable.json"),
            serde_json::to_vec(&earlier).unwrap(),
        )
        .unwrap();
        std::fs::write(
            dropins.join("20-disable.json"),
            serde_json::to_vec(&later).unwrap(),
        )
        .unwrap();

        assert_eq!(
            managed_plugin_setting_from_root(&root.0, plugin_id),
            Some(false)
        );
    }

    #[test]
    fn path_is_within_fails_closed_when_either_path_is_missing() {
        let root = tmp("path-root");
        let nested = root.0.join("src");
        std::fs::create_dir_all(&nested).unwrap();
        assert!(path_is_within(&nested, &root.0));
        assert!(!path_is_within(&root.0.join("missing"), &root.0));
        assert!(!path_is_within(&nested, &root.0.join("missing")));
    }

    #[test]
    fn ignores_unregistered_claude_plugin_cache_versions() {
        let project = tmp("proj-claude-stale");
        let home = tmp("home-claude-stale");
        let stale = home
            .0
            .join(".claude/plugins/cache/community/workflow-kit/0.9.0");
        write_skill(
            &stale.join("skills"),
            "stale-skill",
            "---\nname: stale-skill\ndescription: Old cached skill\n---\n",
        );
        std::fs::create_dir_all(home.0.join(".claude/plugins")).unwrap();
        std::fs::write(
            home.0.join(".claude/plugins/installed_plugins.json"),
            r#"{"version":2,"plugins":{}}"#,
        )
        .unwrap();

        let skills = list_skills_from(&project.0, Some(&home.0), None);
        assert!(!skills.iter().any(|skill| skill.name == "stale-skill"));
    }

    #[test]
    fn skips_dirs_without_skill_md() {
        let project = tmp("empty");
        std::fs::create_dir_all(project.0.join(".agents/skills/nope")).unwrap();
        let skills = list_skills_from(&project.0, None, None);
        assert!(skills.is_empty());
    }
    #[test]
    fn disabled_project_skill_falls_back_to_same_name_personal_skill() {
        let project = tmp("proj-fallback");
        let home = tmp("home-fallback");
        write_skill(
            &project.0.join(".agents/skills"),
            "review",
            "---\nname: review\ndescription: Project review\n---\n",
        );
        write_skill(
            &home.0.join(".agents/skills"),
            "review",
            "---\nname: review\ndescription: Personal review\n---\n",
        );

        let project_skill_path =
            crate::fs::path_to_js(&project.0.join(".agents/skills/review/SKILL.md"));
        let personal_skill_path =
            crate::fs::path_to_js(&home.0.join(".agents/skills/review/SKILL.md"));

        // 1. When neither is disabled, project skill wins.
        let enabled_skills = list_skills_from(&project.0, Some(&home.0), None);
        let review = enabled_skills.iter().find(|s| s.name == "review").unwrap();
        assert_eq!(review.description, "Project review");
        assert_eq!(review.path, project_skill_path);
        assert_eq!(review.scope, "project");

        // 2. When only project skill is disabled, personal skill is active fallback.
        let fallback_skills = list_skills_from(
            &project.0,
            Some(&home.0),
            Some(std::slice::from_ref(&project_skill_path)),
        );
        let review = fallback_skills.iter().find(|s| s.name == "review").unwrap();
        assert_eq!(review.description, "Personal review");
        assert_eq!(review.path, personal_skill_path);
        assert_eq!(review.scope, "user");

        // 3. When project skill is re-enabled, project skill wins again.
        let restored_skills = list_skills_from(&project.0, Some(&home.0), Some(&[]));
        let review = restored_skills.iter().find(|s| s.name == "review").unwrap();
        assert_eq!(review.description, "Project review");
        assert_eq!(review.path, project_skill_path);

        // 4. When both are disabled, skill is omitted from catalog.
        let none_skills = list_skills_from(
            &project.0,
            Some(&home.0),
            Some(&[project_skill_path.clone(), personal_skill_path.clone()]),
        );
        assert!(none_skills.iter().all(|s| s.name != "review"));

        // 5. When lower-priority personal skill is disabled, project winner is unaffected.
        let winner_skills = list_skills_from(
            &project.0,
            Some(&home.0),
            Some(std::slice::from_ref(&personal_skill_path)),
        );
        let review = winner_skills.iter().find(|s| s.name == "review").unwrap();
        assert_eq!(review.description, "Project review");
        assert_eq!(review.path, project_skill_path);
    }

    #[cfg(windows)]
    #[test]
    fn disabled_skill_matching_handles_windows_separators_and_case() {
        let project = tmp("proj-sep");
        let home = tmp("home-sep");
        write_skill(
            &project.0.join(".agents/skills"),
            "fmt",
            "---\nname: fmt\ndescription: Project fmt\n---\n",
        );
        write_skill(
            &home.0.join(".agents/skills"),
            "fmt",
            "---\nname: fmt\ndescription: Personal fmt\n---\n",
        );

        // Windows: verify both backslash separator handling and case-insensitivity
        let raw_project_path = project
            .0
            .join(".agents/skills/fmt/SKILL.md")
            .to_string_lossy()
            .replace('/', "\\")
            .to_uppercase();
        let skills = list_skills_from(&project.0, Some(&home.0), Some(&[raw_project_path]));
        let fmt = skills.iter().find(|s| s.name == "fmt").unwrap();
        assert_eq!(fmt.description, "Personal fmt");
        assert_eq!(fmt.scope, "user");
    }

    #[cfg(unix)]
    #[test]
    fn disabled_skill_matching_preserves_distinct_unix_paths_with_backslashes() {
        let project = tmp("proj-unix-bs");
        let skill_with_bs_dir = project.0.join(".agents/skills/a\\b");
        write_skill(
            skill_with_bs_dir.parent().unwrap(),
            "a\\b",
            "---\nname: slash-skill\ndescription: Slash skill\n---\n",
        );
        let nested_file = project.0.join(".agents/skills/a/b/SKILL.md");
        std::fs::create_dir_all(nested_file.parent().unwrap()).unwrap();
        std::fs::write(
            &nested_file,
            "---\nname: nested-skill\ndescription: Nested\n---\n",
        )
        .unwrap();

        assert!(skill_with_bs_dir.join("SKILL.md").exists());
        assert!(nested_file.exists());

        let nested_path = crate::fs::path_to_js(&nested_file);
        let skills = list_skills_from(&project.0, None, Some(&[nested_path]));
        let slash_skill = skills.iter().find(|s| s.name == "slash-skill");
        assert!(
            slash_skill.is_some(),
            "distinct backslash path on Unix must not be disabled by colliding slash path"
        );
    }
}
