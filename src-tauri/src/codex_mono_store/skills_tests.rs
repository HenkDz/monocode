use super::*;

struct Fixture(PathBuf);

impl Fixture {
    fn new() -> Self {
        let root =
            std::env::temp_dir().join(format!("monocode-cc6-skills-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(root.join("account")).unwrap();
        std::fs::create_dir_all(root.join("mono")).unwrap();
        Self(root.canonicalize().unwrap())
    }

    fn account(&self) -> PathBuf {
        self.0.join("account")
    }
    fn home(&self) -> PathBuf {
        self.0.join("mono")
    }

    fn skill(&self, home: &Path, folder: &str, name: &str) -> PathBuf {
        let path = home.join(folder);
        std::fs::create_dir_all(&path).unwrap();
        std::fs::write(path.join("SKILL.md"), format!("---\nname: {name}\ndescription: >\n  Synthetic {name}\n  for CC6 tests.\n---\nNever execute this test fixture.\n")).unwrap();
        path
    }

    fn catalog(&self) -> Catalog {
        catalog(&self.account(), None, None).unwrap()
    }
}

fn enabled(config: &serde_json::Value, path: &Path) -> bool {
    let canonical = canonical_skill_path(path);
    let values = config["skills"]["config"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|entry| {
            canonical_skill_path(Path::new(entry["path"].as_str().unwrap())) == canonical
        })
        .map(|entry| entry["enabled"].as_bool().unwrap())
        .collect::<Vec<_>>();
    assert!(!values.is_empty(), "missing config for {}", path.display());
    assert!(
        values.iter().all(|value| *value == values[0]),
        "canonical aliases disagree"
    );
    values[0]
}

#[test]
fn role_defaults_are_small_inventory_matched_and_project_skills_are_included() {
    let fixture = Fixture::new();
    for name in [
        "orca-cli",
        "orchestration",
        "codebase-memory",
        "improve",
        "frontend-design",
        "laravel-tdd",
        "vercel-react-best-practices",
        "ponytail-review",
        "hunt-rce",
        "hyperframes",
    ] {
        fixture.skill(&fixture.account(), &format!("skills/{name}"), name);
    }
    let repo = fixture.0.join("repo");
    fixture.skill(&repo, ".codex/skills/project-own", "project-own");
    fixture.skill(&repo, ".claude/skills/claude-own", "claude-own");
    std::fs::write(repo.join(".git"), "synthetic root marker").unwrap();
    let catalog = catalog(&fixture.account(), None, Some(&repo)).unwrap();
    for (role, count) in [
        ("grand_orchestrator", 5),
        ("manager", 6),
        ("worker", 6),
        ("reviewer", 6),
    ] {
        let selected = selected(&catalog, role, &SkillsPolicy::default());
        assert_eq!(selected.len(), count, "{role}");
        assert!(selected.iter().any(|s| s.name == "project-own"));
        assert!(selected.iter().any(|s| s.name == "claude-own"));
        assert!(!selected
            .iter()
            .any(|s| matches!(s.name.as_str(), "hunt-rce" | "hyperframes")));
    }
    assert!(catalog
        .skills
        .iter()
        .all(|s| s.description.ends_with("for CC6 tests.")));
}

#[test]
fn custom_and_all_policies_are_explicit_and_missing_ids_stay_disabled() {
    let fixture = Fixture::new();
    let selected_skill = fixture.skill(
        &fixture.account(),
        "skills/frontend-design",
        "frontend-design",
    );
    let unrelated = fixture.skill(&fixture.account(), "skills/hunt-rce", "hunt-rce");
    let catalog = fixture.catalog();
    let policy = SkillsPolicy {
        mode: SkillsMode::Custom,
        enabled: vec![
            "account:frontend-design".into(),
            "account:missing-or-renamed".into(),
        ],
        plugins: vec![],
    };
    let (config, args) = prepare_catalog(&fixture.home(), &catalog, "manager", &policy).unwrap();
    assert!(enabled(&config, &selected_skill.join("SKILL.md")));
    assert!(!enabled(&config, &unrelated.join("SKILL.md")));
    assert_eq!(config["skills"]["bundled"]["enabled"], false);
    assert_eq!(args[0], "-c");
    for pair in args.chunks_exact(2) {
        assert_eq!(pair[0], "-c");
        toml::from_str::<toml::Value>(&pair[1]).unwrap();
    }
    let all = SkillsPolicy {
        mode: SkillsMode::All,
        ..SkillsPolicy::default()
    };
    let (config, args) = prepare_catalog(&fixture.home(), &catalog, "manager", &all).unwrap();
    assert!(enabled(&config, &unrelated.join("SKILL.md")));
    assert!(config["skills"].get("bundled").is_none());
    assert!(!args.iter().any(|arg| arg == "skills.bundled.enabled=false"));
}

#[test]
fn role_defaults_honor_relative_account_disables_and_custom_can_opt_in() {
    let fixture = Fixture::new();
    let path = fixture.skill(
        &fixture.account(),
        "skills/frontend-design",
        "frontend-design",
    );
    std::fs::write(
        fixture.account().join("config.toml"),
        "[[skills.config]]\npath='skills/frontend-design/SKILL.md'\nenabled=false\n",
    )
    .unwrap();
    let catalog = fixture.catalog();
    assert!(catalog.role_defaults["worker"].is_empty());
    let (config, _) = prepare_catalog(
        &fixture.home(),
        &catalog,
        "worker",
        &SkillsPolicy::default(),
    )
    .unwrap();
    assert!(!enabled(&config, &path.join("SKILL.md")));
    let policy = SkillsPolicy {
        mode: SkillsMode::Custom,
        enabled: vec!["account:frontend-design".into()],
        ..SkillsPolicy::default()
    };
    let (config, _) = prepare_catalog(&fixture.home(), &catalog, "worker", &policy).unwrap();
    assert!(enabled(&config, &path.join("SKILL.md")));
}

#[test]
fn account_switch_adds_selected_source_without_redirecting_previous_links() {
    let fixture = Fixture::new();
    let first = fixture.skill(&fixture.account(), "skills/orca-cli", "orca-cli");
    let catalog = fixture.catalog();
    prepare_catalog(
        &fixture.home(),
        &catalog,
        "manager",
        &SkillsPolicy::default(),
    )
    .unwrap();
    let linked = fixture
        .home()
        .join("skills")
        .join(alias(&catalog.skills[0]));
    assert!(same_entry(&linked, &first));
    let other = fixture.0.join("other-account");
    let second = fixture.skill(&other, "skills/orca-cli", "orca-cli");
    let next = super::catalog(&other, None, None).unwrap();
    prepare_catalog(&fixture.home(), &next, "manager", &SkillsPolicy::default()).unwrap();
    let next_link = fixture.home().join("skills").join(alias(&next.skills[0]));
    assert!(same_entry(&linked, &first));
    assert!(same_entry(&next_link, &second));
    assert_ne!(linked, next_link);
    assert!(first.join("SKILL.md").is_file());
    assert!(second.join("SKILL.md").is_file());
}

#[test]
fn removed_skill_is_not_replaced_by_a_similar_name_and_links_are_not_pruned() {
    let fixture = Fixture::new();
    let path = fixture.skill(&fixture.account(), "skills/orca-cli", "orca-cli");
    let catalog = fixture.catalog();
    prepare_catalog(
        &fixture.home(),
        &catalog,
        "manager",
        &SkillsPolicy::default(),
    )
    .unwrap();
    let linked = fixture
        .home()
        .join("skills")
        .join(alias(&catalog.skills[0]));
    std::fs::rename(&path, fixture.account().join("skills/renamed-cli")).unwrap();
    let next = fixture.catalog();
    let custom = SkillsPolicy {
        mode: SkillsMode::Custom,
        enabled: vec!["account:orca-cli".into()],
        ..SkillsPolicy::default()
    };
    assert!(selected(&next, "manager", &custom).is_empty());
    prepare_catalog(&fixture.home(), &next, "manager", &custom).unwrap();
    assert!(std::fs::symlink_metadata(linked).is_ok());
    assert!(fixture
        .account()
        .join("skills/renamed-cli/SKILL.md")
        .is_file());
}

#[test]
fn shared_links_do_not_make_one_roles_config_enable_another_roles_skills() {
    let fixture = Fixture::new();
    let manager = fixture.skill(&fixture.account(), "skills/orca-cli", "orca-cli");
    let worker = fixture.skill(
        &fixture.account(),
        "skills/frontend-design",
        "frontend-design",
    );
    let catalog = fixture.catalog();
    let (first, _) = prepare_catalog(
        &fixture.home(),
        &catalog,
        "manager",
        &SkillsPolicy::default(),
    )
    .unwrap();
    let (second, _) = prepare_catalog(
        &fixture.home(),
        &catalog,
        "worker",
        &SkillsPolicy::default(),
    )
    .unwrap();
    assert!(enabled(&first, &manager.join("SKILL.md")));
    assert!(!enabled(&first, &worker.join("SKILL.md")));
    assert!(!enabled(&second, &manager.join("SKILL.md")));
    assert!(enabled(&second, &worker.join("SKILL.md")));
    assert_eq!(
        std::fs::read_dir(fixture.home().join("skills"))
            .unwrap()
            .count(),
        2
    );
}

#[test]
fn plugin_injection_is_opt_in_and_cache_version_order_is_numeric() {
    let fixture = Fixture::new();
    let root = "plugins/cache/ponytail/ponytail";
    fixture.skill(
        &fixture.account(),
        &format!("{root}/5.9.0/skills/ponytail-review"),
        "ponytail-review",
    );
    let latest = fixture.skill(
        &fixture.account(),
        &format!("{root}/5.10.0/skills/ponytail-review"),
        "ponytail-review",
    );
    let catalog = fixture.catalog();
    assert_eq!(catalog.plugins, vec!["ponytail@ponytail"]);
    assert_eq!(catalog.skills.len(), 1);
    assert_eq!(
        canonical_skill_path(Path::new(&catalog.skills[0].path)),
        latest.join("SKILL.md").canonicalize().unwrap()
    );
    let (config, args) = prepare_catalog(
        &fixture.home(),
        &catalog,
        "reviewer",
        &SkillsPolicy::default(),
    )
    .unwrap();
    assert_eq!(config["plugins"]["ponytail@ponytail"]["enabled"], false);
    let value = args.iter().find(|arg| arg.starts_with("plugins=")).unwrap();
    let value: toml::Value = toml::from_str(value).unwrap();
    assert_eq!(
        value["plugins"]["ponytail@ponytail"]["enabled"].as_bool(),
        Some(false)
    );
    let custom = SkillsPolicy {
        plugins: vec!["ponytail@ponytail".into()],
        ..SkillsPolicy::default()
    };
    let (config, _) = prepare_catalog(&fixture.home(), &catalog, "reviewer", &custom).unwrap();
    assert_eq!(config["plugins"]["ponytail@ponytail"]["enabled"], true);
}

#[test]
fn private_directory_and_user_files_are_preserved_and_link_migration_is_additive() {
    let fixture = Fixture::new();
    let home = fixture.home();
    std::fs::create_dir(home.join("skills")).unwrap();
    std::fs::write(home.join("skills/keep"), "user private skill").unwrap();
    let identity = entry_identity(&home.join("skills")).unwrap();
    private_skills(&home).unwrap();
    assert_eq!(entry_identity(&home.join("skills")).unwrap(), identity);
    assert_eq!(
        std::fs::read(home.join("skills/keep")).unwrap(),
        b"user private skill"
    );
    let other = fixture.0.join("migration-home");
    std::fs::create_dir(&other).unwrap();
    let original = fixture.skill(&fixture.account(), "skills/keep", "keep");
    #[cfg(windows)]
    junction::create(fixture.account().join("skills"), other.join("skills")).unwrap();
    #[cfg(unix)]
    std::os::unix::fs::symlink(fixture.account().join("skills"), other.join("skills")).unwrap();
    private_skills(&other).unwrap();
    assert!(!replaceable_link(&other.join("skills")).unwrap());
    assert!(original.join("SKILL.md").is_file());
    assert_eq!(std::fs::read_dir(&other).unwrap().count(), 1);
}

#[test]
fn project_ancestor_skills_stop_at_configured_root_marker() {
    let fixture = Fixture::new();
    let root = fixture.0.join("repo");
    let cwd = root.join("packages/app");
    std::fs::create_dir_all(&cwd).unwrap();
    std::fs::write(root.join(".mono-root"), "").unwrap();
    std::fs::write(
        fixture.account().join("config.toml"),
        "project_root_markers=['.mono-root']\n",
    )
    .unwrap();
    fixture.skill(&fixture.0, ".agents/skills/outside", "outside");
    fixture.skill(&root, ".agents/skills/root-own", "root-own");
    fixture.skill(&cwd, ".agents/skills/app-own", "app-own");
    let catalog = catalog(&fixture.account(), None, Some(&cwd)).unwrap();
    assert_eq!(catalog.skills.len(), 2);
    assert!(!catalog.skills.iter().any(|skill| skill.name == "outside"));
    assert_eq!(catalog.role_defaults["manager"].len(), 2);
}

#[test]
fn large_skill_inventory_stays_out_of_windows_launch_arguments() {
    let fixture = Fixture::new();
    let folder = fixture.skill(&fixture.account(), "skills/test", "test");
    let mut catalog = fixture.catalog();
    let prototype = catalog.skills[0].clone();
    catalog.skills = (0..300)
        .map(|index| Skill {
            id: format!("account:synthetic-{index}"),
            name: format!("synthetic-{index}"),
            path: format!(
                "{}/{index}/{}/SKILL.md",
                folder.display(),
                "long-name".repeat(25)
            ),
            ..prototype.clone()
        })
        .collect();
    let (config, args) = prepare_catalog(
        &fixture.home(),
        &catalog,
        "manager",
        &SkillsPolicy::default(),
    )
    .unwrap();
    assert!(serde_json::to_vec(&config).unwrap().len() > 32767);
    assert!(args.iter().map(String::len).sum::<usize>() < 1024);
    assert!(!args.iter().any(|arg| arg.starts_with("skills.config=")));
    assert_eq!(config["skills"]["config"].as_array().unwrap().len(), 300);
}

#[test]
fn non_git_project_under_user_home_does_not_promote_global_skills_to_project_defaults() {
    let fixture = Fixture::new();
    let user = fixture.0.join("user");
    let cwd = user.join("scratch/project");
    std::fs::create_dir_all(&cwd).unwrap();
    std::fs::write(fixture.0.join(".git"), "synthetic enclosing marker").unwrap();
    fixture.skill(&user, ".agents/skills/hunt-rce", "hunt-rce");
    fixture.skill(&cwd, ".agents/skills/local", "local");
    let catalog = catalog(&fixture.account(), Some(&user), Some(&cwd)).unwrap();
    assert_eq!(catalog.skills.len(), 2);
    assert_eq!(catalog.role_defaults["manager"].len(), 1);
    assert_eq!(
        selected(&catalog, "manager", &SkillsPolicy::default())[0].name,
        "local"
    );
}

#[test]
fn concurrent_real_skill_directory_replacement_is_preserved() {
    let fixture = Fixture::new();
    let source = fixture.skill(&fixture.account(), "skills/orca-cli", "orca-cli");
    let target = fixture.home().join("skills");
    #[cfg(windows)]
    junction::create(fixture.account().join("skills"), &target).unwrap();
    #[cfg(unix)]
    std::os::unix::fs::symlink(fixture.account().join("skills"), &target).unwrap();
    let concurrent = target.clone();
    BEFORE_CLAIM.with(|hook| {
        *hook.borrow_mut() = Some(Box::new(move || {
            remove_link(&concurrent).unwrap();
            std::fs::create_dir(&concurrent).unwrap();
            std::fs::write(concurrent.join("keep"), "concurrent private skill").unwrap();
        }));
    });
    assert!(private_skills(&fixture.home())
        .unwrap_err()
        .contains("preserved"));
    assert_eq!(
        std::fs::read(target.join("keep")).unwrap(),
        b"concurrent private skill"
    );
    assert!(source.join("SKILL.md").is_file());
    transactions::reconcile(&fixture.home()).unwrap();
    assert_eq!(std::fs::read_dir(fixture.home()).unwrap().count(), 1);
}

#[cfg(windows)]
#[test]
fn private_skill_directory_guard_blocks_replacement_and_allows_child_links() {
    let fixture = Fixture::new();
    let source = fixture.skill(&fixture.account(), "skills/orca-cli", "orca-cli");
    let directory = private_skills(&fixture.home()).unwrap();
    let identity = entry_identity(&directory).unwrap();
    let guard = open_entry(&directory, true).unwrap();
    assert!(std::fs::rename(&directory, fixture.home().join("moved-skills")).is_err());
    assert!(std::fs::remove_dir(&directory).is_err());
    assert!(junction::create(fixture.account().join("skills"), &directory).is_err());
    assert_eq!(entry_identity(&directory).unwrap(), identity);
    assert!(!replaceable_link(&directory).unwrap());
    link_entry(&source, &directory.join("allowed-child")).unwrap();
    assert!(same_entry(&source, &directory.join("allowed-child")));
    assert!(!source.join("allowed-child").exists());
    drop(guard);
}

fn fixture_context(
    fixture: &Fixture,
    project: Option<&Path>,
    role: &str,
    policy: &SkillsPolicy,
) -> (String, PathBuf, serde_json::Value) {
    prepare_files(&fixture.account(), &fixture.home()).unwrap();
    let catalog = catalog(&fixture.account(), None, project).unwrap();
    let id = context_id(
        &fixture.account(),
        &fixture.home(),
        project,
        role,
        policy,
        &catalog,
    )
    .unwrap();
    let (home, config) = with_context_home(&fixture.home(), &id, |home| {
        prepare_context_files(&fixture.account(), &fixture.home(), home)?;
        let (config, _) = prepare_catalog(home, &catalog, role, policy)?;
        Ok((home.to_path_buf(), config))
    })
    .unwrap();
    (id, home, config)
}

#[test]
fn different_project_contexts_cannot_grow_one_anothers_skill_roots() {
    let fixture = Fixture::new();
    let first = fixture.0.join("first-repo");
    let second = fixture.0.join("second-repo");
    fixture.skill(&first, ".claude/skills/first-own", "first-own");
    fixture.skill(&second, ".claude/skills/second-own", "second-own");
    std::fs::write(first.join(".git"), "fixture").unwrap();
    std::fs::write(second.join(".git"), "fixture").unwrap();
    let policy = SkillsPolicy::default();
    let (id_a, home_a, config_a) = fixture_context(&fixture, Some(&first), "worker", &policy);
    let (_, home_b, _) = fixture_context(&fixture, Some(&second), "worker", &policy);
    fixture.skill(&second, ".claude/skills/late-foreign", "late-foreign");
    let (_, later_b, _) = fixture_context(&fixture, Some(&second), "worker", &policy);
    assert_ne!(home_a, home_b);
    assert_ne!(home_b, later_b);
    let mut skills = Vec::new();
    scan(&home_a.join("skills"), "private", None, &mut skills).unwrap();
    assert_eq!(skills.len(), 1);
    assert_eq!(skills[0].name, "first-own");
    let (again, same_home, same_config) =
        fixture_context(&fixture, Some(&first), "worker", &policy);
    assert_eq!(again, id_a);
    assert_eq!(same_home, home_a);
    assert_eq!(same_config, config_a);
    assert_eq!(
        std::fs::read_dir(fixture.home().join("skills"))
            .unwrap()
            .count(),
        0
    );
}

#[test]
fn context_ids_reject_arbitrary_paths_and_source_account_changes_resolve_separately() {
    let fixture = Fixture::new();
    for id in [
        "../account",
        "",
        "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        "123",
    ] {
        assert!(with_context_home(&fixture.home(), id, |_| Ok(())).is_err());
    }
    fixture.skill(&fixture.account(), "skills/orca-cli", "orca-cli");
    let (first, _, _) = fixture_context(&fixture, None, "manager", &SkillsPolicy::default());
    let account_b = fixture.0.join("other-account");
    fixture.skill(&account_b, "skills/orca-cli", "orca-cli");
    let catalog_b = catalog(&account_b, None, None).unwrap();
    let second = context_id(
        &account_b,
        &fixture.home(),
        None,
        "manager",
        &SkillsPolicy::default(),
        &catalog_b,
    )
    .unwrap();
    assert_ne!(first, second);
}

#[test]
fn contexts_inherit_private_hooks_without_changing_original_or_previous_context() {
    let fixture = Fixture::new();
    prepare_files(&fixture.account(), &fixture.home()).unwrap();
    let hooks = fixture.home().join("hooks.json");
    let chosen = br#"{"hooks":{"Stop":[{"command":"synthetic-private-hook"}]}}"#;
    std::fs::write(&hooks, chosen).unwrap();
    let identity = entry_identity(&hooks).unwrap();
    let (first, home_a, _) = fixture_context(&fixture, None, "worker", &SkillsPolicy::default());
    assert_eq!(std::fs::read(home_a.join("hooks.json")).unwrap(), chosen);
    assert!(!replaceable_link(&home_a.join("hooks.json")).unwrap());
    assert!(!same_entry(&hooks, &home_a.join("hooks.json")));
    assert_eq!(entry_identity(&hooks).unwrap(), identity);
    let changed = br#"{"hooks":{"Stop":[{"command":"second-synthetic-hook"}]}}"#;
    std::fs::write(&hooks, changed).unwrap();
    let (second, home_b, _) = fixture_context(&fixture, None, "worker", &SkillsPolicy::default());
    assert_ne!(first, second);
    assert_eq!(std::fs::read(home_a.join("hooks.json")).unwrap(), chosen);
    assert_eq!(std::fs::read(home_b.join("hooks.json")).unwrap(), changed);
    assert_eq!(std::fs::read(hooks).unwrap(), changed);
}

#[test]
fn contexts_follow_explicit_shared_hooks_and_kept_private_configuration() {
    let fixture = Fixture::new();
    std::fs::write(
        fixture.account().join("config.toml"),
        "model='account-model'\n",
    )
    .unwrap();
    std::fs::write(fixture.account().join("AGENTS.md"), "account instructions").unwrap();
    std::fs::write(
        fixture.account().join("hooks.json"),
        r#"{"hooks":{"Stop":[{"command":"synthetic-account-hook"}]}}"#,
    )
    .unwrap();
    prepare_files(&fixture.account(), &fixture.home()).unwrap();
    let agents = fixture.home().join("AGENTS.md");
    remove_link(&agents).unwrap();
    std::fs::write(&agents, "kept Mono instructions").unwrap();
    write_snapshot(
        &fixture.home(),
        "AGENTS.md",
        &LinkSnapshot {
            fingerprint: fingerprint(&agents).unwrap(),
            private_override: true,
            invalid: false,
        },
    )
    .unwrap();
    let config = fixture.home().join("config.toml");
    remove_link(&config).unwrap();
    std::fs::write(&config, "model='private-model'\n").unwrap();
    write_snapshot(
        &fixture.home(),
        "config.toml",
        &LinkSnapshot {
            fingerprint: fingerprint(&config).unwrap(),
            private_override: true,
            invalid: false,
        },
    )
    .unwrap();
    set_hooks_shared(&fixture.home(), true).unwrap();
    let (_, home, _) = fixture_context(&fixture, None, "manager", &SkillsPolicy::default());
    assert!(hooks_shared(&home).unwrap());
    assert!(same_entry(
        &fixture.account().join("hooks.json"),
        &home.join("hooks.json")
    ));
    assert_eq!(
        std::fs::read(home.join("AGENTS.md")).unwrap(),
        b"kept Mono instructions"
    );
    assert_eq!(
        std::fs::read(home.join("config.toml")).unwrap(),
        b"model='private-model'\n"
    );
    assert_eq!(
        std::fs::read(fixture.account().join("AGENTS.md")).unwrap(),
        b"account instructions"
    );
}

#[test]
fn historical_rollouts_are_located_across_contexts_without_state_links_or_moves() {
    let fixture = Fixture::new();
    let (_, first, _) = fixture_context(&fixture, None, "manager", &SkillsPolicy::default());
    let (_, second, _) = fixture_context(&fixture, None, "reviewer", &SkillsPolicy::default());
    let legacy = fixture
        .home()
        .join("sessions/rollout-2026-10-11T12-00-00-legacy.jsonl");
    let prior = first.join("sessions/rollout-2026-10-11T12-00-00-prior.jsonl");
    std::fs::write(&legacy, "legacy native rollout bytes").unwrap();
    std::fs::write(&prior, "prior context native rollout bytes").unwrap();
    assert_eq!(
        find_mono_thread(&fixture.home(), "legacy").unwrap(),
        Some(legacy.canonicalize().unwrap())
    );
    assert_eq!(
        find_mono_thread(&fixture.home(), "prior").unwrap(),
        Some(prior.canonicalize().unwrap())
    );
    assert!(find_mono_thread(&fixture.home(), "../account").is_err());
    assert_eq!(
        std::fs::read(&prior).unwrap(),
        b"prior context native rollout bytes"
    );
    assert!(!second
        .join("sessions")
        .join(prior.file_name().unwrap())
        .exists());
    for home in [first, second] {
        for state in ["sessions", "skills"] {
            assert!(!replaceable_link(&home.join(state)).unwrap());
        }
    }
}

#[test]
fn plugin_local_cache_matches_codex_preference_over_numeric_releases() {
    let fixture = Fixture::new();
    let root = "plugins/cache/ponytail/ponytail";
    fixture.skill(
        &fixture.account(),
        &format!("{root}/5.10.0/skills/ponytail-review"),
        "ponytail-review",
    );
    let local = fixture.skill(
        &fixture.account(),
        &format!("{root}/local/skills/ponytail-review"),
        "ponytail-review",
    );
    let catalog = fixture.catalog();
    assert_eq!(catalog.skills.len(), 1);
    assert_eq!(
        canonical_skill_path(Path::new(&catalog.skills[0].path)),
        local.join("SKILL.md").canonicalize().unwrap()
    );
}
