use super::*;
use rusqlite::{Connection, OptionalExtension};

const MAP: &str = "__monocodeCodexHomeThreads";

fn opaque(settings: &serde_json::Value) -> bool {
    let Some(raw) = settings.get(MAP) else {
        return false;
    };
    let parsed = raw
        .as_str()
        .and_then(|s| serde_json::from_str::<serde_json::Value>(s).ok());
    !parsed
        .and_then(|v| v.as_object().cloned())
        .is_some_and(|map| {
            map.len() <= 64
                && map.iter().all(|(home, id)| {
                    !home.is_empty()
                        && home.encode_utf16().count() <= 4096
                        && id.as_str().is_some_and(|id| {
                            !id.is_empty()
                                && id.len() <= 512
                                && id
                                    .bytes()
                                    .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
                        })
                })
        })
}

pub(crate) fn descriptor(conn: &Connection, id: &str) -> Result<Option<serde_json::Value>, String> {
    let raw: Option<String> = conn.query_row("SELECT model_settings FROM sessions WHERE id=?1 AND inbox_ask IS NULL AND harness='codex'", [id], |r| r.get(0)).optional().map_err(|e| e.to_string())?;
    let Some(raw) = raw else { return Ok(None) };
    let settings: serde_json::Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    if !opaque(&settings) {
        return Ok(None);
    }
    let mut hash = Sha256::new();
    let mut statement = conn
        .prepare("SELECT rowid, * FROM sessions WHERE id=?1")
        .map_err(|e| e.to_string())?;
    let count = statement.column_count();
    let (identity, cwd, account): (String, String, Option<String>) =
        statement
            .query_row([id], |row| {
                for i in 0..count {
                    let bytes = format!("{:?}", row.get_ref(i)?);
                    hash.update((bytes.len() as u64).to_le_bytes());
                    hash.update(bytes.as_bytes());
                }
                Ok((
                    format!(
                        "{}:{}",
                        row.get::<_, i64>(0)?,
                        conn.query_row("SELECT created_at FROM sessions WHERE id=?1", [id], |r| r
                            .get::<_, i64>(0))?
                    ),
                    conn.query_row("SELECT cwd FROM sessions WHERE id=?1", [id], |r| r.get(0))?,
                    conn.query_row(
                        "SELECT provider_account_id FROM sessions WHERE id=?1",
                        [id],
                        |r| r.get(0),
                    )?,
                ))
            })
            .map_err(|e| e.to_string())?;
    let database: String = conn
        .query_row(
            "SELECT file FROM pragma_database_list WHERE name='main'",
            [],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    hash.update(database.as_bytes());
    if !database.is_empty() {
        hash.update(format!("{:?}", entry_identity(Path::new(&database))?).as_bytes());
    }
    let mut blocks = conn
        .prepare("SELECT seq, block_json FROM mono_blocks WHERE session_id=?1 ORDER BY seq")
        .map_err(|e| e.to_string())?;
    for row in blocks
        .query_map([id], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))
        .map_err(|e| e.to_string())?
    {
        let (seq, raw) = row.map_err(|e| e.to_string())?;
        hash.update(seq.to_le_bytes());
        hash.update((raw.len() as u64).to_le_bytes());
        hash.update(raw.as_bytes());
    }
    Ok(Some(
        serde_json::json!({"sessionId":id,"identity":identity,"fingerprint":format!("{:x}",hash.finalize()),
        "cwd":cwd,"providerAccountId":account,"home":settings.get("__monocodeCodexStorageHome")}),
    ))
}

pub(super) fn preserve(
    conn: &Connection,
    directory: &Path,
    expected: &serde_json::Value,
) -> Result<String, String> {
    let id = expected["sessionId"]
        .as_str()
        .ok_or("Missing conversation recovery identity")?;
    crate::session_store::validate_id(id, "session")?;
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    // Reserve the SQLite writer before validating the displayed record and archiving it.
    tx.execute("UPDATE sessions SET id=id WHERE id=?1", [id])
        .map_err(|e| e.to_string())?;
    if descriptor(&tx, id)?.as_ref() != Some(expected) {
        return Err("The stored conversation changed or belongs to another record. Reload its recovery notice; all unknown data was retained.".into());
    }
    let raw: String = tx
        .query_row(
            "SELECT model_settings FROM sessions WHERE id=?1",
            [id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    let mut settings: serde_json::Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    let root = directory.canonicalize().map_err(|e| e.to_string())?;
    if replaceable_link(&root)? {
        return Err("Recovery storage must remain a real directory".into());
    }
    #[cfg(windows)]
    let _guard = archive::lock_directory(&root)?;
    let archive = private_directory(
        &private_directory(&root, ".monocode-preserved-transactions")?,
        &format!("home-threads-{}", uuid::Uuid::new_v4()),
    )?;
    #[cfg(windows)]
    let _archive_guard = archive::lock_directory(&archive)?;
    let stage = archive.join("model-settings.pending");
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&stage)
        .map_err(|e| e.to_string())?;
    file.write_all(raw.as_bytes()).map_err(|e| e.to_string())?;
    file.sync_all().map_err(|e| e.to_string())?;
    drop(file);
    let target = archive.join("model-settings.json");
    transactions::RecordedEntry::new(&stage)?.publish(&stage, &target)?;
    if std::fs::read(&target).map_err(|e| e.to_string())? != raw.as_bytes() {
        return Err("The recovery archive changed; the stored map was retained".into());
    }
    settings
        .as_object_mut()
        .ok_or("Invalid model settings")?
        .remove(MAP);
    tx.execute(
        "UPDATE sessions SET model_settings=?2 WHERE id=?1",
        rusqlite::params![
            id,
            serde_json::to_string(&settings).map_err(|e| e.to_string())?
        ],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(crate::fs::path_to_js(&target))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn opaque_maps_preserve_exact_settings_before_reset_and_refuse_changed_foreign_or_valid_records(
    ) {
        for raw in [
            serde_json::json!("{bad"),
            serde_json::json!({"future":2}),
            serde_json::Value::Null,
            serde_json::json!("{\"future\":{\"format\":2}}"),
            serde_json::json!(serde_json::to_string(
                &(0..65)
                    .map(|i| (format!("home-{i}"), format!("thread-{i}")))
                    .collect::<HashMap<_, _>>()
            )
            .unwrap()),
        ] {
            let root =
                std::env::temp_dir().join(format!("monocode-cc0l-map-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir(&root).unwrap();
            let store = crate::session_store::SessionStore::open(root.join("sessions.db")).unwrap();
            let conn = store.lock_conn().unwrap();
            let seed: crate::session_store::SessionUpsert = serde_json::from_value(serde_json::json!({"id":"mono-map","cwd":"/synthetic","harness":"codex","model":"synthetic","runtimeMode":"default","title":"Original",
                "providerSessionId":"current-thread","providerAccountId":"account","modelSettings":{MAP:raw,"__monocodeCodexStorageHome":"private-home","effort":"high"},
                "blocks":[{"id":"u","role":"user","text":"History"}],"queuedMessages":[{"id":"q","text":"Queued Plan","intent":"plan","attachments":[]}]})).unwrap();
            crate::session_store::upsert_session(&conn, &seed).unwrap();
            crate::mono_transcript::migrate_transcript(&conn, &seed.id).unwrap();
            let before = crate::session_store::get_session(&conn, &seed.id)
                .unwrap()
                .unwrap();
            let expected = descriptor(&conn, &seed.id).unwrap().unwrap();
            let bytes: String = conn
                .query_row(
                    "SELECT model_settings FROM sessions WHERE id=?1",
                    [&seed.id],
                    |r| r.get(0),
                )
                .unwrap();
            let mut foreign = expected.clone();
            foreign["sessionId"] = serde_json::json!("other");
            assert!(preserve(&conn, &root, &foreign).is_err());
            conn.execute(
                "UPDATE sessions SET title='Changed' WHERE id=?1",
                [&seed.id],
            )
            .unwrap();
            assert!(preserve(&conn, &root, &expected).is_err());
            assert_eq!(
                conn.query_row(
                    "SELECT model_settings FROM sessions WHERE id=?1",
                    [&seed.id],
                    |r| r.get::<_, String>(0)
                )
                .unwrap(),
                bytes
            );
            let current = descriptor(&conn, &seed.id).unwrap().unwrap();
            let archive = preserve(&conn, &root, &current).unwrap();
            assert_eq!(std::fs::read(archive).unwrap(), bytes.as_bytes());
            assert!(descriptor(&conn, &seed.id).unwrap().is_none());
            let after = crate::session_store::get_session(&conn, &seed.id)
                .unwrap()
                .unwrap();
            assert_eq!(before.provider_session_id, after.provider_session_id);
            assert_eq!(before.provider_account_id, after.provider_account_id);
            assert_eq!(before.queued_messages, after.queued_messages);
            assert_eq!(after.model_settings["effort"], "high");
            assert_eq!(
                after.model_settings["__monocodeCodexStorageHome"],
                "private-home"
            );
            assert!(preserve(&conn, &root, &current).is_err());
            drop(conn);
            drop(store);
            std::fs::remove_dir_all(root).unwrap();
        }
    }
}
