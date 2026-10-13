//! Process adapter for connected synthetic UI proofs. No app windows or provider processes.
use super::*;

#[test]
#[ignore = "CC0K isolated native command adapter; requires explicit synthetic fixture"]
fn native_command_child() {
    let Some(root) = std::env::var_os("CC0K_RUNTIME_ROOT") else {
        return;
    };
    let root = PathBuf::from(root).canonicalize().unwrap();
    assert!(root.starts_with(std::env::temp_dir().canonicalize().unwrap()));
    assert!(root
        .file_name()
        .unwrap()
        .to_string_lossy()
        .starts_with("monocode-cc0k-runtime-"));
    let mut context = tauri::generate_context!();
    // app_data_dir joins the identifier; this absolute, test-only identifier confines commands to the fixture.
    context.config_mut().identifier = root.join("app").to_string_lossy().into_owned();
    context.config_mut().app.windows.clear();
    let app = tauri::Builder::default()
        .any_thread()
        .build(context)
        .unwrap();
    let handle = app.handle().clone();
    assert!(handle.path().app_data_dir().unwrap().starts_with(&root));
    assert!(app.webview_windows().is_empty());
    handle.manage(
        crate::session_store::SessionStore::open(root.join("synthetic-sessions.db")).unwrap(),
    );
    let request: serde_json::Value =
        serde_json::from_str(&std::env::var("CC0K_RUNTIME_REQUEST").unwrap()).unwrap();
    let args = &request["args"];
    let account = args["providerAccountId"]
        .as_str()
        .unwrap_or("default")
        .to_owned();
    let (source, original, _) = unselected_locations(&handle, Some(&account)).unwrap();
    assert!(source.canonicalize().unwrap().starts_with(&root));
    std::fs::create_dir_all(&source).unwrap();
    let result = (|| -> Result<serde_json::Value, String> {
        match request["command"].as_str().unwrap() {
            "file-state" => {
                let path = PathBuf::from(args["path"].as_str().unwrap())
                    .canonicalize()
                    .map_err(|e| e.to_string())?;
                assert!(path.starts_with(&root));
                Ok(
                    serde_json::json!({"fingerprint":fingerprint(&path)?,"identity":entry_identity(&path)?}),
                )
            }
            "session_upsert" => Ok(serde_json::to_value(crate::session_store::session_upsert(
                handle.state(),
                serde_json::from_value(args["session"].clone()).unwrap(),
            ))
            .unwrap()),
            "mono_session_upsert" => Ok(serde_json::to_value(
                crate::mono_transcript::mono_session_upsert(
                    handle.state(),
                    serde_json::from_value(args["session"].clone()).unwrap(),
                    args["afterBlockId"].as_str().map(str::to_owned),
                    args["fromBlockId"].as_str().map(str::to_owned),
                    args["blocksChanged"].as_bool().unwrap(),
                    args["appendOnly"].as_bool().unwrap(),
                ),
            )
            .unwrap()),
            "session_get" => Ok(serde_json::to_value(crate::session_store::session_get(
                handle.state(),
                args["sessionId"].as_str().unwrap().into(),
            ))
            .unwrap()),
            "mono_session_get" => Ok(serde_json::to_value(
                crate::mono_transcript::mono_session_get(
                    handle.state(),
                    args["sessionId"].as_str().unwrap().into(),
                ),
            )
            .unwrap()),
            "preserve-home-threads" => Ok(serde_json::to_value(mono_session_preserve_home_threads(
                handle.clone(), handle.state(), args["expected"].clone(),
            )).unwrap()),
            "record-thread" => {
                let (source, home, _) = locations(&handle, Some(&account))?;
                source_binding::check_session_home(
                    &source,
                    &home,
                    args["expectedMonoHome"].as_str(),
                )?;
                let id = args["threadId"].as_str().unwrap();
                validate_thread_id(id)?;
                let dir = home.join("sessions/2026/10/13");
                std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
                let path = dir.join(format!("rollout-2026-10-13T00-00-00-{id}.jsonl"));
                if !path.exists() {
                    std::fs::write(
                        &path,
                        format!(
                            "{}\n",
                            serde_json::json!({"type":"session_meta","payload":{"id":id}})
                        ),
                    )
                    .map_err(|e| e.to_string())?;
                }
                std::fs::OpenOptions::new()
                    .append(true)
                    .open(&path)
                    .map_err(|e| e.to_string())?
                    .write_all(
                        format!(
                            "{}\n",
                            serde_json::json!({"MonoOnly":args["text"],"intent":args["intent"]})
                        )
                        .as_bytes(),
                    )
                    .map_err(|e| e.to_string())?;
                Ok(
                    serde_json::json!({"path":crate::fs::path_to_js(&path),"fingerprint":fingerprint(&path)?,"identity":entry_identity(&path)?}),
                )
            }
            "setup-migration" => {
                let (source, home, _) = locations(&handle, Some(&account))?;
                let dir = source.join("sessions/2026/10/13");
                std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
                for (id, base) in [
                    ("kroot", Some("kbase")),
                    ("kbase", None),
                    ("kchild", Some("kbase")),
                ] {
                    let mut payload = serde_json::json!({"id":id});
                    if let Some(base) = base {
                        payload["history_base"] = serde_json::json!({"thread_id":base});
                    }
                    std::fs::write(
                        dir.join(format!("rollout-2026-10-13T00-00-00-{id}.jsonl")),
                        format!(
                            "{}\n",
                            serde_json::json!({"type":"session_meta","payload":payload})
                        ),
                    )
                    .map_err(|e| e.to_string())?;
                }
                copy_rollouts(
                    &source,
                    &home,
                    "kroot",
                    &[dir.join("rollout-2026-10-13T00-00-00-kroot.jsonl")],
                )?;
                let private =
                    home.join("sessions/2026/10/13/rollout-2026-10-13T00-00-00-kbase.jsonl");
                std::fs::OpenOptions::new()
                    .append(true)
                    .open(&private)
                    .map_err(|e| e.to_string())?
                    .write_all(b"Mono-only fork-base continuation\n")
                    .map_err(|e| e.to_string())?;
                Ok(
                    serde_json::json!({"incoming":crate::fs::path_to_js(&dir.join("rollout-2026-10-13T00-00-00-kchild.jsonl")),"private":crate::fs::path_to_js(&private),"privateFingerprint":fingerprint(&private)?,"privateIdentity":entry_identity(&private)?}),
                )
            }
            "prepare" => Ok(serde_json::to_value(codex_mono_store_prepare(
                handle.clone(),
                Some(account),
                args["threadId"].as_str().map(str::to_owned),
                None,
                None,
                None,
                Some(false),
                None,
                None,
                args["expectedMonoHome"].as_str().map(str::to_owned),
                args.get("providerSessionIdByHome")
                    .map(|v| serde_json::from_value(v.clone()).unwrap()),
            ))
            .unwrap()),
            "separate" => Ok(serde_json::to_value(codex_mono_store_separate_source(
                handle.clone(),
                Some(account),
                args["sourceHome"].as_str().unwrap().into(),
                args["sourceIdentity"].as_str().unwrap().into(),
            ))
            .unwrap()),
            "reattach" => Ok(serde_json::to_value(codex_mono_store_reattach_source(
                handle.clone(),
                Some(account),
                args["sourceHome"].as_str().unwrap().into(),
                args["sourceIdentity"].as_str().unwrap().into(),
            ))
            .unwrap()),
            "bind" => Ok(serde_json::to_value(codex_mono_store_bind_source(
                handle.clone(),
                Some(account),
                args["sourceHome"].as_str().unwrap().into(),
            ))
            .unwrap()),
            "keep-private" => Ok(serde_json::to_value(codex_mono_store_keep_private_history(
                handle.clone(),
                Some(account),
                serde_json::from_value(args["migration"].clone()).unwrap(),
            ))
            .unwrap()),
            "copy" => Ok(serde_json::to_value(codex_mono_store_copy(
                handle.clone(),
                Some(account),
                args["threadId"].as_str().unwrap().into(),
                serde_json::from_value(args["paths"].clone()).unwrap(),
                None,
            ))
            .unwrap()),
            "recreate" => {
                std::fs::rename(
                    &source,
                    root.join(format!("old-source-{}", uuid::Uuid::new_v4())),
                )
                .map_err(|e| e.to_string())?;
                std::fs::create_dir(&source).map_err(|e| e.to_string())?;
                Ok(serde_json::Value::Null)
            }
            "state" => {
                let home = source_binding::selected_home(&source, &original, false)
                    .unwrap_or(original.clone());
                let source = source.canonicalize().map_err(|e| e.to_string())?;
                let id = entry_identity(&source)?;
                Ok(
                    serde_json::json!({"home":crate::fs::path_to_js(&home),"originalHome":crate::fs::path_to_js(&original),
                    "sourceHome":crate::fs::path_to_js(&source),"sourceIdentity":format!("{}:{}",id.0,id.1)}),
                )
            }
            unknown => Err(format!("Unknown synthetic command {unknown}")),
        }
    })();
    let receipt = PathBuf::from(std::env::var_os("CC0K_RUNTIME_RECEIPT").unwrap());
    assert_eq!(receipt.parent(), Some(root.as_path()));
    std::fs::write(receipt, serde_json::to_vec(&result).unwrap()).unwrap();
}
