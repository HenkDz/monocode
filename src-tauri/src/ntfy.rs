//! Outbound-only phone alerts. No prompts, paths, PR details or tokens leave
//! through notification bodies. Destination and token live in the OS vault.
use crate::session_store::{now_millis, SessionStore};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::time::Duration;
use tauri::{Manager, State};

#[derive(Default, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    pub enabled: bool,
    pub server: String,
    pub topic: String,
    #[serde(default)]
    pub token: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    enabled: bool,
    server: String,
    topic: String,
    has_token: bool,
    supported: bool,
    status: String,
}

fn target(app: &tauri::AppHandle) -> String {
    format!("{}:ntfy", app.config().identifier)
}

#[cfg(windows)]
fn vault(target: &str, write: Option<&Config>) -> Result<Config, String> {
    use windows_sys::Win32::{
        Foundation::{GetLastError, ERROR_NOT_FOUND},
        Security::Credentials::*,
    };
    let mut name: Vec<u16> = target.encode_utf16().chain(Some(0)).collect();
    if let Some(config) = write {
        let mut bytes =
            serde_json::to_vec(config).map_err(|_| "Could not encode phone settings")?;
        if bytes.len() > 2560 {
            return Err("Phone settings are too long".into());
        }
        let credential = CREDENTIALW {
            Type: CRED_TYPE_GENERIC,
            TargetName: name.as_mut_ptr(),
            CredentialBlobSize: bytes.len() as u32,
            CredentialBlob: bytes.as_mut_ptr(),
            Persist: CRED_PERSIST_LOCAL_MACHINE,
            ..Default::default()
        };
        let ok = unsafe { CredWriteW(&credential, 0) } != 0;
        bytes.fill(0);
        if !ok {
            return Err("Windows Credential Manager could not save phone settings".into());
        }
        return Ok(config.clone());
    }
    let mut credential = std::ptr::null_mut();
    if unsafe { CredReadW(name.as_ptr(), CRED_TYPE_GENERIC, 0, &mut credential) } == 0 {
        return if unsafe { GetLastError() } == ERROR_NOT_FOUND {
            Ok(Config::default())
        } else {
            Err("Windows Credential Manager could not read phone settings".into())
        };
    }
    let result = unsafe {
        if (*credential).CredentialBlob.is_null() || (*credential).CredentialBlobSize == 0 {
            CredFree(credential.cast());
            return Err("Stored phone settings are empty".into());
        }
        let bytes = std::slice::from_raw_parts(
            (*credential).CredentialBlob,
            (*credential).CredentialBlobSize as usize,
        );
        let result = serde_json::from_slice(bytes)
            .map_err(|_| "Stored phone settings are invalid".to_string());
        CredFree(credential.cast());
        result
    };
    result
}

#[cfg(not(windows))]
fn vault(_target: &str, write: Option<&Config>) -> Result<Config, String> {
    if write.is_some() {
        Err("Phone notifications currently require Windows Credential Manager".into())
    } else {
        Ok(Config::default())
    }
}

fn endpoint(config: &Config) -> Result<String, String> {
    let mut url = url::Url::parse(&config.server).map_err(|_| "Enter an HTTPS ntfy server URL")?;
    if config.server.len() > 512
        || url.scheme() != "https"
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("Use an HTTPS server URL without credentials, query or fragment".into());
    }
    if config.topic.is_empty()
        || config.topic.len() > 128
        || !config
            .topic
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
    {
        return Err("Topic must contain 1–128 letters, digits, underscores or hyphens".into());
    }
    if config.token.len() > 1024 || !config.token.bytes().all(|b| b.is_ascii_graphic()) {
        return Err("Invalid ntfy access token".into());
    }
    url.set_path(&format!(
        "{}/{}",
        url.path().trim_end_matches('/'),
        config.topic
    ));
    Ok(url.to_string())
}

fn message(kind: &str) -> Result<&'static str, String> {
    match kind {
        "decision" => Ok("Your project Manager needs a decision. Open MonoCode to respond."),
        "ready" => Ok("Your project Manager has a pull request ready for review. Open MonoCode."),
        "test" => Ok("MonoCode phone notifications are connected. This is a test."),
        _ => Err("Unsupported phone notification".into()),
    }
}

fn prepare(conn: &rusqlite::Connection) -> Result<(), String> {
    conn.execute_batch("CREATE TABLE IF NOT EXISTS ntfy_delivery (id TEXT PRIMARY KEY, status TEXT NOT NULL, at INTEGER NOT NULL);")
        .map_err(|_| "Could not open phone delivery history".to_string())
}

fn status(store: &SessionStore) -> Result<String, String> {
    let conn = store.lock_conn()?;
    prepare(&conn)?;
    Ok(conn
        .query_row(
            "SELECT status FROM ntfy_delivery ORDER BY at DESC, rowid DESC LIMIT 1",
            [],
            |r| r.get(0),
        )
        .unwrap_or_else(|_| "No phone notifications sent".into()))
}

#[tauri::command(async)]
pub fn ntfy_settings(
    app: tauri::AppHandle,
    store: State<'_, SessionStore>,
) -> Result<Settings, String> {
    let config = vault(&target(&app), None)?;
    Ok(Settings {
        enabled: config.enabled,
        server: config.server,
        topic: config.topic,
        has_token: !config.token.is_empty(),
        supported: cfg!(windows),
        status: status(&store)?,
    })
}

#[tauri::command(async)]
pub fn ntfy_save(
    app: tauri::AppHandle,
    mut config: Config,
    clear_token: bool,
) -> Result<(), String> {
    let saved = vault(&target(&app), None)?;
    if clear_token {
        config.token.clear();
    } else if config.token.is_empty() && config.server == saved.server {
        config.token = saved.token;
    }
    if config.enabled {
        endpoint(&config)?;
    }
    vault(&target(&app), Some(&config))?;
    Ok(())
}

fn reserve(conn: &rusqlite::Connection, id: &str) -> Result<bool, String> {
    prepare(conn)?;
    let now = now_millis();
    conn.execute("UPDATE ntfy_delivery SET status='Delivery interrupted; use Send test to check the connection' WHERE status='Sending…' AND at < ?1", [now - 60_000]).map_err(|_| "Could not recover phone delivery history")?;
    let pending: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM ntfy_delivery WHERE status='Sending…'",
            [],
            |r| r.get(0),
        )
        .map_err(|_| "Could not read phone delivery history")?;
    if pending >= 20 {
        return Err("Phone delivery queue is full".into());
    }
    // ponytail: retain 500 IDs; use a dedicated durable outbox if offline replay is required.
    conn.execute("DELETE FROM ntfy_delivery WHERE id IN (SELECT id FROM ntfy_delivery WHERE status != 'Sending…' ORDER BY at DESC, rowid DESC LIMIT -1 OFFSET 499)", []).map_err(|_| "Could not trim phone delivery history")?;
    Ok(conn
        .execute(
            "INSERT OR IGNORE INTO ntfy_delivery (id,status,at) VALUES (?1,'Sending…',?2)",
            rusqlite::params![id, now],
        )
        .map_err(|_| "Could not reserve phone delivery")?
        == 1)
}

fn retryable(status: u16) -> bool {
    status == 429 || status >= 500
}

fn deliver(
    config: &Config,
    url: &str,
    body: &str,
    still_current: impl Fn() -> Result<bool, String>,
) -> Result<(), String> {
    let client = ureq::AgentBuilder::new()
        .timeout(Duration::from_secs(10))
        .redirects(0)
        .build();
    for attempt in 0..3 {
        // Disable/change takes effect before retries. Never send an old
        // event to a newly configured destination.
        if !still_current()? {
            return Err("Delivery cancelled: settings changed".into());
        }
        let mut request = client
            .post(url)
            .set("Title", "MonoCode Manager")
            .set("Content-Type", "text/plain; charset=utf-8");
        if !config.token.is_empty() {
            request = request.set("Authorization", &format!("Bearer {}", config.token));
        }
        let error = match request.send_string(body) {
            Ok(response) if (200..300).contains(&response.status()) => return Ok(()),
            Ok(_) => return Err("Delivery refused a redirect".into()),
            Err(ureq::Error::Status(code, _)) if !retryable(code) => {
                return Err(format!("Delivery rejected (HTTP {code})"))
            }
            Err(ureq::Error::Status(code, _)) => format!("Delivery failed (HTTP {code})"),
            Err(_) => "Delivery failed: network or TLS error".into(),
        };
        if attempt == 2 {
            return Err(error);
        }
        std::thread::sleep(Duration::from_secs(if attempt == 0 { 1 } else { 3 }));
    }
    unreachable!()
}

#[tauri::command]
pub async fn ntfy_send(
    app: tauri::AppHandle,
    event_id: String,
    kind: String,
) -> Result<String, String> {
    if event_id.is_empty() || event_id.len() > 512 {
        return Err("Invalid notification identity".into());
    }
    let body = message(&kind)?;
    tauri::async_runtime::spawn_blocking(move || {
        let config = vault(&target(&app), None)?;
        if !config.enabled {
            return Ok("Phone notifications are off".into());
        }
        let url = endpoint(&config)?;
        let id = format!("{:x}", Sha256::digest(format!("{kind}:{event_id}")));
        let store = app.state::<SessionStore>();
        let reserved = {
            let conn = store.lock_conn()?;
            reserve(&conn, &id)?
        };
        if !reserved {
            return Ok("Already handled".into());
        }
        let result = deliver(&config, &url, body, || {
            Ok(vault(&target(&app), None)? == config)
        });
        let summary = match &result {
            Ok(()) => "Delivered to ntfy".to_string(),
            Err(error) => error.clone(),
        };
        store
            .lock_conn()?
            .execute(
                "UPDATE ntfy_delivery SET status=?2, at=?3 WHERE id=?1",
                rusqlite::params![id, summary, now_millis()],
            )
            .map_err(|_| "Could not save phone delivery status")?;
        result.map(|_| summary)
    })
    .await
    .map_err(|_| "Phone delivery task failed".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn local_transport_retries_transient_errors_and_redacts_rejections() {
        use std::io::{BufRead, Read, Write};
        for codes in [vec![503, 200], vec![401], vec![302], vec![503, 503, 503]] {
            let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
            let address = listener.local_addr().unwrap();
            let expected = codes.clone();
            let server = std::thread::spawn(move || {
                for code in expected {
                    let (mut stream, _) = listener.accept().unwrap();
                    stream
                        .set_read_timeout(Some(Duration::from_secs(3)))
                        .unwrap();
                    let mut reader = std::io::BufReader::new(stream.try_clone().unwrap());
                    let mut length = 0;
                    loop {
                        let mut line = String::new();
                        reader.read_line(&mut line).unwrap();
                        if line == "\r\n" {
                            break;
                        }
                        if let Some(value) = line.to_lowercase().strip_prefix("content-length:") {
                            length = value.trim().parse::<usize>().unwrap();
                        }
                    }
                    let mut body = vec![0; length];
                    reader.read_exact(&mut body).unwrap();
                    assert_eq!(body, message("ready").unwrap().as_bytes());
                    write!(stream, "HTTP/1.1 {code} Test\r\nContent-Length: 6\r\nConnection: close\r\n\r\nsecret").unwrap();
                }
            });
            let result = deliver(
                &Config::default(),
                &format!("http://{address}/test"),
                message("ready").unwrap(),
                || Ok(true),
            );
            assert_eq!(result.is_ok(), codes.last() == Some(&200));
            if let Err(error) = result {
                assert!(!error.contains("secret") && !error.contains(&address.to_string()));
            }
            server.join().unwrap();
        }
        assert_eq!(
            deliver(&Config::default(), "http://127.0.0.1:1", "test", || Ok(
                false
            ))
            .unwrap_err(),
            "Delivery cancelled: settings changed"
        );
    }
    #[cfg(windows)]
    #[test]
    fn windows_vault_roundtrip_without_exposing_token() {
        let target = format!("monocode-ntfy-test-{}", uuid::Uuid::new_v4());
        let config = Config {
            token: "test-only-token".into(),
            ..Default::default()
        };
        assert!(vault(&target, None).unwrap().token.is_empty());
        vault(&target, Some(&config)).unwrap();
        let matches = vault(&target, None).unwrap() == config;
        let name: Vec<u16> = target.encode_utf16().chain(Some(0)).collect();
        let removed = unsafe {
            windows_sys::Win32::Security::Credentials::CredDeleteW(
                name.as_ptr(),
                windows_sys::Win32::Security::Credentials::CRED_TYPE_GENERIC,
                0,
            )
        };
        assert!(matches);
        assert_ne!(removed, 0);
    }
    #[test]
    fn validates_destination_and_keeps_payload_fixed() {
        let mut config = Config {
            enabled: true,
            server: "https://ntfy.example/base".into(),
            topic: "private-topic".into(),
            token: String::new(),
        };
        assert_eq!(
            endpoint(&config).unwrap(),
            "https://ntfy.example/base/private-topic"
        );
        for server in [
            "http://ntfy.example",
            "https://user:secret@ntfy.example",
            "https://ntfy.example?token=secret",
            "https://ntfy.example/#fragment",
        ] {
            config.server = server.into();
            assert!(endpoint(&config).is_err());
        }
        config.server = "https://ntfy.example".into();
        config.topic = "../private".into();
        assert!(endpoint(&config).is_err());
        assert!(message("prompt contents").is_err());
        assert!(!message("ready").unwrap().contains("https://"));
        assert!(retryable(429) && retryable(503));
        assert!(!retryable(401) && !retryable(403));
    }
    #[test]
    fn dedupe_is_durable_and_queue_is_bounded() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        assert!(reserve(&conn, "same").unwrap());
        assert!(!reserve(&conn, "same").unwrap());
        for id in 0..19 {
            assert!(reserve(&conn, &id.to_string()).unwrap());
        }
        assert!(reserve(&conn, "overflow").is_err());
        conn.execute("UPDATE ntfy_delivery SET at=0", []).unwrap();
        assert!(reserve(&conn, "after-recovery").unwrap());
        assert!(!reserve(&conn, "same").unwrap());
    }
}
