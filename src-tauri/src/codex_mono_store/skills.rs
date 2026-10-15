use super::*;
use std::collections::{BTreeMap, BTreeSet};

#[cfg(test)]
#[path = "skills_tests.rs"]
mod tests;

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillsPolicy {
    #[serde(default)]
    pub mode: SkillsMode,
    #[serde(default)]
    pub enabled: Vec<String>,
    #[serde(default)]
    pub plugins: Vec<String>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SkillsMode {
    #[default]
    Role,
    Custom,
    All,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Skill {
    pub id: String,
    pub name: String,
    pub description: String,
    pub path: String,
    pub source: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plugin: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Catalog {
    pub skills: Vec<Skill>,
    pub role_defaults: BTreeMap<String, Vec<String>>,
    pub plugins: Vec<String>,
    #[serde(skip)]
    plugin_ids: Vec<String>,
}

// Defaults are names, never paths: account changes and absent skills resolve afresh.
const ROLE_DEFAULTS: &[(&str, &[&str])] = &[
    (
        "grand_orchestrator",
        &["orca-cli", "orchestration", "codebase-memory"],
    ),
    (
        "manager",
        &["orca-cli", "orchestration", "codebase-memory", "improve"],
    ),
    (
        "worker",
        &[
            "codebase-memory",
            "laravel-tdd",
            "frontend-design",
            "vercel-react-best-practices",
        ],
    ),
    (
        "reviewer",
        &[
            "codebase-memory",
            "ponytail-review",
            "laravel-tdd",
            "vercel-react-best-practices",
        ],
    ),
];

fn frontmatter(text: &str, key: &str) -> String {
    let mut lines = text.lines();
    if lines.next().map(str::trim) != Some("---") {
        return String::new();
    }
    let mut result = String::new();
    let mut collecting = false;
    for line in lines.take_while(|line| line.trim() != "---") {
        if let Some(value) = line.strip_prefix(&format!("{key}:")) {
            let value = value.trim().trim_matches(['\'', '"']);
            collecting = true;
            if !matches!(value, ">" | "|" | ">-" | "|-") {
                result.push_str(value);
            }
        } else if collecting && line.starts_with([' ', '\t']) {
            if !result.is_empty() {
                result.push(' ');
            }
            result.push_str(line.trim());
        } else if collecting {
            break;
        }
    }
    result
}

fn collect_skills(
    root: &Path,
    directory: &Path,
    source: &str,
    plugin: Option<&str>,
    depth: usize,
    seen: &mut HashSet<PathBuf>,
    skills: &mut Vec<Skill>,
) -> Result<(), String> {
    if depth > 10 || !directory.is_dir() {
        return Ok(());
    }
    let canonical = directory.canonicalize().map_err(|e| e.to_string())?;
    if !seen.insert(canonical) {
        return Ok(());
    }
    let skill_path = directory.join("SKILL.md");
    if skill_path.is_file() {
        let mut bytes = Vec::new();
        std::fs::File::open(&skill_path)
            .map_err(|e| e.to_string())?
            .take(64 * 1024)
            .read_to_end(&mut bytes)
            .map_err(|e| e.to_string())?;
        let text = String::from_utf8_lossy(&bytes);
        let mut name = frontmatter(&text, "name");
        if name.is_empty() {
            name = directory
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .into();
        }
        let relative = directory.strip_prefix(root).map_err(|e| e.to_string())?;
        skills.push(Skill {
            id: format!("{source}:{}", relative.to_string_lossy().replace('\\', "/")),
            name,
            description: frontmatter(&text, "description"),
            path: crate::fs::path_to_js(&skill_path),
            source: source.into(),
            plugin: plugin.map(String::from),
        });
        return Ok(());
    }
    let mut entries = std::fs::read_dir(directory)
        .map_err(|e| e.to_string())?
        .map(|entry| entry.map(|e| e.path()).map_err(|e| e.to_string()))
        .collect::<Result<Vec<_>, _>>()?;
    entries.sort();
    for path in entries {
        collect_skills(root, &path, source, plugin, depth + 1, seen, skills)?;
    }
    Ok(())
}

fn scan(
    root: &Path,
    source: &str,
    plugin: Option<&str>,
    skills: &mut Vec<Skill>,
) -> Result<(), String> {
    collect_skills(root, root, source, plugin, 0, &mut HashSet::new(), skills)
}

fn plugin_skills(
    home: &Path,
    skills: &mut Vec<Skill>,
    plugins: &mut BTreeSet<String>,
) -> Result<(), String> {
    let cache = home.join("plugins/cache");
    if !cache.is_dir() {
        return Ok(());
    }
    for marketplace in std::fs::read_dir(cache).map_err(|e| e.to_string())? {
        let marketplace = marketplace.map_err(|e| e.to_string())?.path();
        if !marketplace.is_dir() {
            continue;
        }
        for plugin in std::fs::read_dir(&marketplace).map_err(|e| e.to_string())? {
            let plugin = plugin.map_err(|e| e.to_string())?.path();
            if !plugin.is_dir() {
                continue;
            }
            let id = format!(
                "{}@{}",
                plugin.file_name().unwrap().to_string_lossy(),
                marketplace.file_name().unwrap().to_string_lossy()
            );
            plugins.insert(id.clone());
            let mut versions = std::fs::read_dir(&plugin)
                .map_err(|e| e.to_string())?
                .map(|entry| entry.map(|e| e.path()).map_err(|e| e.to_string()))
                .collect::<Result<Vec<_>, _>>()?;
            versions.sort_by_key(|path| {
                let version = path.file_name().unwrap_or_default().to_string_lossy();
                (
                    version == "local",
                    version
                        .split('.')
                        .map(|part| part.parse::<u64>().unwrap_or(0))
                        .collect::<Vec<_>>(),
                    version.into_owned(),
                )
            });
            if let Some(version) = versions.last() {
                scan(
                    &version.join("skills"),
                    &format!("plugin:{id}"),
                    Some(&id),
                    skills,
                )?;
            }
        }
    }
    Ok(())
}

pub(super) fn catalog(
    source: &Path,
    base: &Path,
    user_home: Option<&Path>,
    project: Option<&Path>,
) -> Result<Catalog, String> {
    let mut skills = Vec::new();
    scan(&source.join("skills"), "account", None, &mut skills)?;
    let private = base.join("skills");
    if private.is_dir() && !replaceable_link(&private)? {
        scan(&private, "mono", None, &mut skills)?;
    }
    let mut plugins = BTreeSet::new();
    plugin_skills(source, &mut skills, &mut plugins)?;
    if let Some(user) = user_home {
        scan(&user.join(".agents/skills"), "global", None, &mut skills)?;
        let global = user.join(".codex");
        if !same_entry(&global, source) {
            scan(&global.join("skills"), "global-codex", None, &mut skills)?;
            plugin_skills(&global, &mut skills, &mut BTreeSet::new())?;
        }
    }
    if let Some(project) = project {
        let markers = read_config(source)?
            .get("project_root_markers")
            .and_then(toml::Value::as_array)
            .map(|items| {
                items
                    .iter()
                    .filter_map(toml::Value::as_str)
                    .map(String::from)
                    .collect::<Vec<_>>()
            })
            .unwrap_or_else(|| vec![".git".into()]);
        scan(
            &project.join(".codex/skills"),
            "project-codex",
            None,
            &mut skills,
        )?;
        scan(
            &project.join(".claude/skills"),
            "project-claude",
            None,
            &mut skills,
        )?;
        for ancestor in project.ancestors() {
            let root = ancestor.join(".agents/skills");
            if !user_home.is_some_and(|home| same_entry(home, ancestor)) {
                let scope = format!(
                    "project-agents:{:x}",
                    Sha256::digest(ancestor.to_string_lossy().as_bytes())
                );
                scan(&root, &scope, None, &mut skills)?;
            }
            if markers.iter().any(|marker| ancestor.join(marker).exists()) {
                break;
            }
        }
        if let Some(root) = project
            .ancestors()
            .find(|path| markers.iter().any(|marker| path.join(marker).exists()))
            .filter(|path| *path != project)
        {
            scan(
                &root.join(".codex/skills"),
                "project-root-codex",
                None,
                &mut skills,
            )?;
            scan(
                &root.join(".claude/skills"),
                "project-root-claude",
                None,
                &mut skills,
            )?;
        }
    }
    #[cfg(unix)]
    scan(Path::new("/etc/codex/skills"), "admin", None, &mut skills)?;
    #[cfg(windows)]
    {
        let program_data = std::env::var_os("ProgramData")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("C:/ProgramData"));
        scan(
            &program_data.join("OpenAI/Codex/skills"),
            "admin",
            None,
            &mut skills,
        )?;
    }
    let discovered = skills
        .iter()
        .filter(|skill| skill.source != "mono")
        .map(|skill| canonical_skill_path(Path::new(&skill.path)))
        .collect::<HashSet<_>>();
    skills.retain(|skill| {
        skill.source != "mono"
            || !discovered.contains(&canonical_skill_path(Path::new(&skill.path)))
    });
    skills.sort_by(|a, b| a.id.cmp(&b.id));
    skills.dedup_by(|a, b| a.id == b.id);
    let disabled = disabled_skills(source, &skills)?;
    let mut plugin_ids = plugins.clone();
    if let Some(configured) = read_config(source)?
        .get("plugins")
        .and_then(toml::Value::as_table)
    {
        plugin_ids.extend(configured.keys().cloned());
    }
    let role_defaults = ROLE_DEFAULTS
        .iter()
        .map(|(role, candidates)| {
            let mut names = HashSet::new();
            let selected = skills
                .iter()
                .filter(|skill| {
                    !disabled.contains(&canonical_skill_path(Path::new(&skill.path)))
                        && (skill.source.starts_with("project-")
                            || (candidates.contains(&skill.name.as_str())
                                && names.insert(skill.name.clone())))
                })
                .map(|skill| skill.id.clone())
                .collect();
            (role.to_string(), selected)
        })
        .collect();
    Ok(Catalog {
        skills,
        role_defaults,
        plugins: plugins.into_iter().collect(),
        plugin_ids: plugin_ids.into_iter().collect(),
    })
}

fn canonical_skill_path(path: &Path) -> PathBuf {
    path.canonicalize().unwrap_or_else(|_| path.to_path_buf())
}

pub(super) fn read_config(source: &Path) -> Result<toml::Value, String> {
    let path = source.join("config.toml");
    let text = storage_io::run("read Codex configuration", &path, || match std::fs::read_to_string(&path) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        result => result,
    })?;
    toml::from_str(&text).map_err(|_| "Could not parse Codex account configuration".into())
}

fn disabled_skills(source: &Path, skills: &[Skill]) -> Result<HashSet<PathBuf>, String> {
    let value = read_config(source)?;
    let rules = value
        .get("skills")
        .and_then(|v| v.get("config"))
        .and_then(toml::Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mut disabled = HashSet::new();
    for skill in skills {
        let path = canonical_skill_path(Path::new(&skill.path));
        for rule in &rules {
            let matches = rule
                .get("name")
                .and_then(toml::Value::as_str)
                .is_some_and(|name| name == skill.name)
                || rule
                    .get("path")
                    .and_then(toml::Value::as_str)
                    .is_some_and(|entry| {
                        let entry = Path::new(entry);
                        canonical_skill_path(&if entry.is_absolute() {
                            entry.into()
                        } else {
                            source.join(entry)
                        }) == path
                    });
            if matches {
                if rule.get("enabled").and_then(toml::Value::as_bool) == Some(false) {
                    disabled.insert(path.clone());
                } else {
                    disabled.remove(&path);
                }
            }
        }
    }
    Ok(disabled)
}

fn selected<'a>(catalog: &'a Catalog, role: &str, policy: &SkillsPolicy) -> Vec<&'a Skill> {
    let ids = match policy.mode {
        SkillsMode::All => return catalog.skills.iter().collect(),
        SkillsMode::Custom => &policy.enabled,
        SkillsMode::Role => catalog
            .role_defaults
            .get(role)
            .unwrap_or(&catalog.role_defaults["worker"]),
    };
    catalog
        .skills
        .iter()
        .filter(|skill| ids.contains(&skill.id))
        .collect()
}

pub(super) fn private_skills(home: &Path) -> Result<PathBuf, String> {
    let target = home.join("skills");
    let existing = match std::fs::symlink_metadata(&target) {
        Ok(metadata) => {
            if metadata.is_dir() && !replaceable_link(&target)? {
                return Ok(target);
            }
            if !replaceable_link(&target)? || !target.is_dir() {
                return Err(format!(
                    "Mono skills must be a directory; user entry preserved: {}",
                    target.display()
                ));
            }
            true
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => false,
        Err(error) => return Err(error.to_string()),
    };
    if !existing {
        std::fs::create_dir(&target).map_err(|e| e.to_string())?;
        return Ok(target);
    }
    let inspected = entry_identity(&target)?;
    let temp = home.join(format!(".monocode-link-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir(&temp).map_err(|e| e.to_string())?;
    let stage = transactions::RecordedEntry::new(&temp)?;
    let result = (|| {
        #[cfg(test)]
        before_claim();
        let mut claimed = ClaimedEntry::new(&target, ClaimIntent::IsolateSkills, Some(&stage))?;
        let result = (|| {
            if entry_identity(&claimed.path)? != inspected
                || !replaceable_link(&claimed.path)?
                || !claimed.path.is_dir()
            {
                return Err(
                    "Mono skills changed during isolation; the original was preserved".into(),
                );
            }
            claimed.journal.verify(None)?;
            #[cfg(test)]
            crash_tests::checkpoint("before-publish");
            stage.publish(&temp, &target)?;
            #[cfg(test)]
            crash_tests::checkpoint("after-publish");
            claimed.discard()
        })();
        claimed.finish(result)
    })();
    stage.cleanup(&temp)?;
    result.map(|_| target)
}

fn alias(skill: &Skill) -> String {
    let source = canonical_skill_path(Path::new(&skill.path));
    format!(
        "cc6-{:x}",
        Sha256::digest(format!("{}\0{}", skill.id, source.display()).as_bytes())
    )
}

pub(super) fn prepare(
    source: &Path,
    home: &Path,
    project: Option<&Path>,
    role: &str,
    policy: &SkillsPolicy,
) -> Result<(String, PathBuf, serde_json::Value, Vec<String>), String> {
    let _lock = STORAGE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    transactions::reconcile(home)?;
    let user_home = crate::dirs_home().map(PathBuf::from);
    let catalog = catalog(source, home, user_home.as_deref(), project)?;
    let id = context_id(source, home, project, role, policy, &catalog)?;
    with_context_home(home, &id, |context| {
        prepare_context_files(source, home, context)?;
        let (config, args) = prepare_catalog(context, &catalog, role, policy)?;
        Ok((id.clone(), context.to_path_buf(), config, args))
    })
}

pub(super) fn context_id(
    source: &Path,
    base: &Path,
    project: Option<&Path>,
    role: &str,
    policy: &SkillsPolicy,
    catalog: &Catalog,
) -> Result<String, String> {
    let inventory = catalog
        .skills
        .iter()
        .map(|skill| (&skill.id, canonical_skill_path(Path::new(&skill.path))))
        .collect::<Vec<_>>();
    let selected = selected(catalog, role, policy)
        .into_iter()
        .map(|skill| skill.id.clone())
        .collect::<Vec<_>>();
    let mut private = BTreeMap::new();
    for name in ["config.toml", "AGENTS.md", "hooks.json"] {
        let path = base.join(name);
        if path.is_file() && !replaceable_link(&path)? {
            private.insert(name, fingerprint(&path)?);
        }
    }
    let value = serde_json::json!({"source":canonical_skill_path(source),"project":project.map(canonical_skill_path),"role":role,"policy":policy,"inventory":inventory,"selected":selected,"plugins":catalog.plugin_ids,"shareHooks":hooks_shared(base)?,"private":private});
    Ok(format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(&value).map_err(|e| e.to_string())?)
    ))
}

pub(super) fn with_context_home<T>(
    base: &Path,
    id: &str,
    operation: impl FnOnce(&Path) -> Result<T, String>,
) -> Result<T, String> {
    if id.len() != 64
        || !id
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
    {
        return Err("Invalid Mono skills context id".into());
    }
    let contexts = private_directory(base, ".monocode-skill-contexts")?;
    #[cfg(windows)]
    let _parent_guard = open_entry(&contexts, true)?;
    if replaceable_link(&contexts)? {
        return Err("Mono skills contexts must remain in a private directory".into());
    }
    let home = private_directory(&contexts, id)?;
    operation(&home)
}

pub(super) fn prepare_context_files(source: &Path, base: &Path, home: &Path) -> Result<(), String> {
    source_binding::ensure_context(source, base, home)?;
    transactions::reconcile(home)?;
    let share_hooks = hooks_shared(base)?;
    if !share_hooks {
        let source = base.join("hooks.json");
        let target = home.join("hooks.json");
        if source.is_file()
            && !replaceable_link(&source)?
            && std::fs::symlink_metadata(&target)
                .is_err_and(|e| e.kind() == std::io::ErrorKind::NotFound)
        {
            #[cfg(windows)]
            let mut original = open_entry(&source, true)?;
            #[cfg(unix)]
            let mut original = std::fs::File::open(&source).map_err(|e| e.to_string())?;
            if !original.metadata().map_err(|e| e.to_string())?.is_file()
                || replaceable_link(&source)?
            {
                return Err("Private Mono hooks must remain a real file".into());
            }
            let expected = fingerprint_file(&mut original)?;
            original.rewind().map_err(|e| e.to_string())?;
            let temp = home.join(format!(".monocode-link-{}", uuid::Uuid::new_v4()));
            let mut options = std::fs::OpenOptions::new();
            options.create_new(true).write(true);
            // shortcut: Unix named allocations survive a pre-journal kill; add native lifetime cleanup for Unix recovery.
            #[cfg(windows)]
            {
                use std::os::windows::fs::OpenOptionsExt;
                use windows_sys::Win32::{
                    Foundation::GENERIC_WRITE,
                    Storage::FileSystem::{DELETE, FILE_FLAG_DELETE_ON_CLOSE, FILE_SHARE_READ},
                };
                // The OS cleans a killed allocation until the durable journal owns recovery.
                options
                    .access_mode(GENERIC_WRITE | DELETE)
                    .share_mode(FILE_SHARE_READ)
                    .custom_flags(FILE_FLAG_DELETE_ON_CLOSE);
            }
            let mut copy = options.open(&temp).map_err(|e| e.to_string())?;
            #[cfg(all(test, windows))]
            crash_tests::checkpoint("skills-hooks-after-stage-create");
            let staged = transactions::RecordedEntry::new(&temp)?;
            let mut journal = match transactions::ClaimJournal::clone_hooks(&target, &staged) {
                Ok(journal) => journal,
                Err(error) => {
                    drop(copy);
                    staged.cleanup(&temp)?;
                    return Err(error);
                }
            };
            let result: Result<(), String> = (|| {
                #[cfg(all(test, windows))]
                crash_tests::checkpoint("skills-hooks-after-stage-journal");
                #[cfg(windows)]
                journal.keep_clone_on_close(&copy)?;
                #[cfg(test)]
                crash_tests::checkpoint("skills-hooks-before-copy");
                std::io::copy(&mut original, &mut copy).map_err(|e| e.to_string())?;
                copy.sync_all().map_err(|e| e.to_string())?;
                journal.verify_clone(&temp)?;
                drop(copy);
                if fingerprint(&temp)? != expected || fingerprint_file(&mut original)? != expected {
                    return Err("Private Mono hooks changed during preparation; retry with the preserved original".into());
                }
                #[cfg(test)]
                crash_tests::checkpoint("skills-hooks-before-publish");
                journal.publish_clone(&temp, &target)?;
                #[cfg(test)]
                crash_tests::checkpoint("skills-hooks-after-publish");
                Ok(())
            })();
            journal.finish()?;
            result?;
        }
    }
    set_hooks_shared(home, share_hooks)?;
    prepare_files_with_state_locked(source, home, Some(base))?;
    for entry in std::fs::read_dir(base).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name();
        let name = name.to_str().ok_or("Invalid Mono configuration filename")?;
        if let Some(private) = context_private_entry(base, name)? {
            link_context_private(&private, &home.join(name), &source.join(name))?;
        }
    }
    archive::prepare_memory_state(base, home)?;
    for name in [".sandbox", ".sandbox-bin", ".sandbox-secrets", "cap_sid"] {
        let entry = base.join(name);
        if std::fs::symlink_metadata(&entry).is_ok() {
            link_entry(&entry, &home.join(name))?;
        }
    }
    Ok(())
}

pub(super) fn find_mono_thread(base: &Path, id: &str) -> Result<Option<PathBuf>, String> {
    validate_thread_id(id)?;
    let mut homes = vec![base.to_path_buf()];
    let contexts = base.join(".monocode-skill-contexts");
    if contexts.exists() {
        let contexts = private_directory(base, ".monocode-skill-contexts")?;
        for entry in std::fs::read_dir(&contexts).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if name.len() == 64
                && name
                    .bytes()
                    .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
                && entry.file_type().map_err(|e| e.to_string())?.is_dir()
            {
                homes.push(entry.path());
            }
        }
    }
    homes.sort();
    for state in ["sessions", "archived_sessions"] {
        for home in &homes {
            let directory = home.join(state);
            if directory.is_dir() && !replaceable_link(&directory)? {
                if let Some(path) = find_thread(&directory, id)? {
                    let canonical = path.canonicalize().map_err(|e| e.to_string())?;
                    if canonical.starts_with(base.canonicalize().map_err(|e| e.to_string())?) {
                        return Ok(Some(canonical));
                    }
                }
            }
        }
    }
    Ok(None)
}

fn prepare_catalog(
    home: &Path,
    catalog: &Catalog,
    role: &str,
    policy: &SkillsPolicy,
) -> Result<(serde_json::Value, Vec<String>), String> {
    let directory = private_skills(home)?;
    #[cfg(windows)]
    let _directory_guard = open_entry(&directory, true)?;
    // shortcut: Unix directory paths can be replaced concurrently; add native directory writer exclusion before promising that guarantee.
    if replaceable_link(&directory)?
        || !std::fs::symlink_metadata(&directory)
            .map_err(|e| e.to_string())?
            .is_dir()
    {
        return Err("Mono skill links must remain inside a real private directory".into());
    }
    transactions::reconcile(&directory)?;
    let selected = selected(&catalog, role, policy);
    let selected_paths = selected
        .iter()
        .map(|skill| canonical_skill_path(Path::new(&skill.path)))
        .collect::<HashSet<_>>();
    for skill in &selected {
        let source = Path::new(&skill.path)
            .parent()
            .ok_or("Invalid skill path")?;
        link_entry(source, &directory.join(alias(skill)))?;
    }
    // Keep previous links while another server may still use them; each server receives its own allowlist.
    let mut paths = BTreeMap::new();
    for skill in &catalog.skills {
        paths.insert(
            skill.path.clone(),
            selected_paths.contains(&canonical_skill_path(Path::new(&skill.path))),
        );
    }
    let mut private_catalog = Vec::new();
    scan(&directory, "private", None, &mut private_catalog)?;
    for skill in private_catalog {
        let enabled = matches!(policy.mode, SkillsMode::All)
            || selected_paths.contains(&canonical_skill_path(Path::new(&skill.path)));
        paths.insert(skill.path, enabled);
    }
    for skill in selected {
        paths.insert(
            crate::fs::path_to_js(&directory.join(alias(skill)).join("SKILL.md")),
            true,
        );
    }
    let entries = paths
        .iter()
        .map(|(path, enabled)| serde_json::json!({"path":path,"enabled":enabled}))
        .collect::<Vec<_>>();
    let mut skills = serde_json::json!({"config":entries});
    let mut settings = serde_json::Map::new();
    // Skill paths travel over thread RPC; putting a global inventory in argv can exceed Windows' limit.
    let mut overrides = Vec::new();
    if !matches!(policy.mode, SkillsMode::All) {
        skills["bundled"] = serde_json::json!({"enabled":false});
        overrides.extend(["-c".into(), "skills.bundled.enabled=false".into()]);
    }
    settings.insert("skills".into(), skills);
    let mut plugins = serde_json::Map::new();
    let config = catalog
        .plugin_ids
        .iter()
        .map(|plugin| {
            let enabled = policy.plugins.contains(plugin);
            plugins.insert(plugin.clone(), serde_json::json!({"enabled":enabled}));
            format!(
                "{}={{enabled={enabled}}}",
                toml::Value::String(plugin.clone())
            )
        })
        .collect::<Vec<_>>()
        .join(",");
    settings.insert("plugins".into(), serde_json::Value::Object(plugins));
    overrides.extend(["-c".into(), format!("plugins={{{config}}}")]);
    Ok((serde_json::Value::Object(settings), overrides))
}
