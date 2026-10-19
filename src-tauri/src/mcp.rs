use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::Value;
use tauri::State;

use crate::dirs_home;
use crate::fs::expand_home;

const PROJECT_MCP_VERSION: &str = "2025-06-18";
const PROJECT_MCP_TOOL: &str = "monocode_project_read";
const PROJECT_MCP_FRAME: u64 = 512 * 1024;

fn project_mcp_schema() -> Value {
    serde_json::json!({"type":"object","properties":{"path":{"type":"string","minLength":1,"maxLength":512}},"required":["path"],"additionalProperties":false})
}

fn project_mcp_schema_hash() -> String {
    use sha2::{Digest, Sha256};
    format!("{:x}", Sha256::digest(project_mcp_schema().to_string().as_bytes()))
}

fn project_mcp_tool() -> Value {
    serde_json::json!({"name":PROJECT_MCP_TOOL,"description":"Read one explicitly approved project text file (up to 64 KiB). Selected results may reach the AI provider.",
        "inputSchema":project_mcp_schema(),"_meta":{"monocodeSchemaHash":project_mcp_schema_hash()}})
}

fn project_mcp_path(path: &str) -> Result<(), String> {
    let filename = path.rsplit('/').next().unwrap_or("").to_ascii_lowercase();
    if [".pem", ".key", ".p12", ".pfx", ".keystore"].iter().any(|suffix| filename.ends_with(suffix)) ||
        filename.starts_with("id_rsa") || filename.starts_with("id_ed25519") ||
        filename.contains("credentials") && filename.ends_with(".json") ||
        [".npmrc", ".pypirc", ".netrc"].contains(&filename.as_str()) {
        return Err(serde_json::json!({"action":"deny","code":"protected-file","reason":"Project read refuses known credential and token filenames. Choose a non-secret project file."}).to_string());
    }
    if path.is_empty() || path.len() > 512 || path.split('/').any(|part| part.is_empty() || part.starts_with('.') ||
        part.ends_with(['.', ' ']) || part.chars().any(|c| c.is_control() || "<>:\"\\|?*~".contains(c))) {
        return Err("Choose an exact non-hidden project-relative text file without traversal".into());
    }
    Ok(())
}

fn project_mcp_now() -> Result<u64, String> {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|duration| duration.as_millis() as u64).map_err(|e| e.to_string())
}

fn project_mcp_frame(reader: &mut impl std::io::BufRead) -> Result<Option<Value>, String> {
    use std::io::{BufRead, Read};
    let mut bytes = Vec::new();
    let count = reader.take(PROJECT_MCP_FRAME + 1).read_until(b'\n', &mut bytes).map_err(|e| e.to_string())?;
    if count == 0 { return Ok(None); }
    if count as u64 > PROJECT_MCP_FRAME || !bytes.ends_with(b"\n") { return Err("MCP frame exceeds bounds or lacks newline".into()); }
    let text = std::str::from_utf8(&bytes).map_err(|_| "MCP messages must be UTF-8")?;
    serde_json::from_str(text).map(Some).map_err(|e| format!("Invalid MCP JSON: {e}"))
}

fn project_mcp_serve(reader: &mut impl std::io::BufRead, writer: &mut impl std::io::Write,
    root: &Path, identity: &str, path: &str, deadline: u64) -> Result<(), String> {
    use serde_json::json;
    project_mcp_path(path)?;
    let mut phase = 0;
    let mut ids = std::collections::HashSet::new();
    for _ in 0..8 {
        let Some(message) = project_mcp_frame(reader)? else { return Ok(()); };
        if project_mcp_now()? >= deadline { return Err("MCP operation deadline expired".into()); }
        let object = message.as_object().ok_or("MCP message must be an object")?;
        if message["jsonrpc"] != "2.0" || object.keys().any(|key| !["jsonrpc", "id", "method", "params"].contains(&key.as_str())) {
            return Err("Unsupported MCP envelope".into());
        }
        let method = message["method"].as_str().ok_or("MCP method is required")?;
        if !object.contains_key("id") {
            if method == "notifications/initialized" && phase == 1 { phase = 2; continue; }
            if method == "notifications/cancelled" { return Ok(()); }
            return Err("Unexpected MCP notification".into());
        }
        let id = message["id"].clone();
        if !(id.is_string() || id.is_i64()) || !ids.insert(id.to_string()) { return Err("MCP request ID must be unique".into()); }
        let params = &message["params"];
        let mut complete = false;
        let result: Result<Value, (i32, String)> = match method {
            "initialize" if phase == 0 && params["protocolVersion"] == PROJECT_MCP_VERSION && params["capabilities"].is_object() && params["clientInfo"].is_object() => {
                phase = 1;
                Ok(json!({"protocolVersion":PROJECT_MCP_VERSION,"capabilities":{"tools":{"listChanged":false}},"serverInfo":{"name":"monocode-project-read","version":env!("CARGO_PKG_VERSION")}}))
            }
            "initialize" => Err((-32602, "Unsupported initialization or protocol version".into())),
            "ping" => Ok(json!({})),
            "tools/list" if phase == 2 && (params.is_null() || params.as_object().is_some_and(|value| value.is_empty())) => Ok(json!({"tools":[project_mcp_tool()]})),
            "tools/call" if phase == 2 => {
                let valid = params.as_object().is_some_and(|params| params.len() == 2 && params.contains_key("name") && params.contains_key("arguments")) &&
                    params["name"] == PROJECT_MCP_TOOL && params["arguments"].as_object().is_some_and(|args| args.len() == 1 && args.get("path").and_then(Value::as_str) == Some(path));
                if !valid { Err((-32602, "Tool and arguments must match the approved exact project read".into())) }
                else {
                    complete = true;
                    match project_mcp_read(root, identity, path) {
                        Ok(text) => Ok(json!({"content":[{"type":"text","text":text}],"isError":false})),
                        Err(reason) => Ok(json!({"content":[{"type":"text","text":reason}],"isError":true})),
                    }
                }
            }
            _ => Err((-32601, "Unsupported method or MCP lifecycle phase".into())),
        };
        let response = match result {
            Ok(result) => json!({"jsonrpc":"2.0","id":id,"result":result}),
            Err((code, message)) => json!({"jsonrpc":"2.0","id":id,"error":{"code":code,"message":message}}),
        };
        writeln!(writer, "{response}").map_err(|e| e.to_string())?;
        writer.flush().map_err(|e| e.to_string())?;
        if complete { return Ok(()); }
    }
    Err("MCP operation message limit reached".into())
}

/// Early CLI only: no app initialization, storage, profile discovery or credentials.
pub(crate) fn project_mcp_cli(args: Vec<String>) -> i32 {
    let run = || -> Result<(), String> {
        if args.len() != 8 || args[0] != "--project" || args[2] != "--identity" || args[4] != "--path" || args[6] != "--deadline" {
            return Err("Invalid fixed project MCP invocation".into());
        }
        let deadline = args[7].parse::<u64>().map_err(|_| "Invalid MCP deadline")?;
        let now = project_mcp_now()?;
        if deadline <= now || deadline - now > 30_000 { return Err("MCP deadline must be within thirty seconds".into()); }
        project_mcp_serve(&mut std::io::stdin().lock(), &mut std::io::stdout().lock(), Path::new(&args[1]), &args[3], &args[5], deadline)
    };
    match run() { Ok(()) => 0, Err(reason) => { eprintln!("Project MCP refused: {reason}"); 1 } }
}

// shortcut: enable non-Windows only after descriptor-relative path pins are implemented.
#[cfg(not(windows))]
fn project_mcp_read(_root: &Path, _identity: &str, _path: &str) -> Result<String, String> {
    Err("Pinned project MCP reads are unavailable on this platform".into())
}

#[cfg(windows)]
fn project_mcp_read(root: &Path, identity: &str, path: &str) -> Result<String, String> {
    use std::io::Read;
    project_mcp_path(path)?;
    let mut pins = Vec::new();
    let root = project_mcp_pin_root(root, &mut pins)?;
    if project_mcp_file_id(pins.last().ok_or("Missing project pin")?)? != identity { return Err("Project filesystem identity changed".into()); }
    let mut parent = root.clone();
    let parts: Vec<_> = path.split('/').collect();
    for part in &parts[..parts.len() - 1] { parent.push(part); pins.push(project_mcp_pin(&parent, true)?); }
    let file_path = parent.join(parts[parts.len() - 1]);
    let mut file = project_mcp_pin(&file_path, false)?;
    // Check the pinned long name too, so filesystem aliases cannot hide protected names.
    let resolved = std::fs::canonicalize(&file_path).map_err(|e| e.to_string())?;
    let relative = resolved.strip_prefix(&root).map_err(|_| "Project MCP file escaped its pinned root")?;
    project_mcp_path(&relative.to_string_lossy().replace('\\', "/"))?;
    if file.metadata().map_err(|e| e.to_string())?.len() > 65_536 { return Err("Project MCP text file exceeds 64 KiB".into()); }
    let mut bytes = Vec::new();
    file.by_ref().take(65_537).read_to_end(&mut bytes).map_err(|e| e.to_string())?;
    if bytes.len() > 65_536 { return Err("Project MCP text file exceeds 64 KiB".into()); }
    String::from_utf8(bytes).map_err(|_| "Project MCP reads UTF-8 text only".into())
}

#[cfg(windows)]
fn project_mcp_pin(path: &Path, directory: bool) -> Result<std::fs::File, String> {
    use std::os::windows::fs::{MetadataExt, OpenOptionsExt};
    use windows_sys::Win32::Storage::FileSystem::{FILE_ATTRIBUTE_REPARSE_POINT, FILE_FLAG_BACKUP_SEMANTICS, FILE_FLAG_OPEN_REPARSE_POINT, FILE_SHARE_READ, FILE_SHARE_WRITE};
    let file = std::fs::OpenOptions::new().read(true).share_mode(FILE_SHARE_READ | if directory { FILE_SHARE_WRITE } else { 0 })
        .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT | if directory { FILE_FLAG_BACKUP_SEMANTICS } else { 0 }).open(path).map_err(|e| e.to_string())?;
    let meta = file.metadata().map_err(|e| e.to_string())?;
    if meta.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 || meta.is_dir() != directory ||
        !directory && (!meta.is_file() || crate::codex_mono_store::handle_file_info(&file)?.nNumberOfLinks != 1) {
        return Err("Project MCP refuses linked, reparse or special paths".into());
    }
    Ok(file)
}

#[cfg(windows)]
fn project_mcp_pin_root(path: &Path, pins: &mut Vec<std::fs::File>) -> Result<PathBuf, String> {
    use std::path::{Component, Prefix};
    if !path.is_absolute() { return Err("An absolute registered local project is required".into()); }
    let mut current = PathBuf::new();
    for part in path.components() {
        match part {
            Component::Prefix(prefix) if matches!(prefix.kind(), Prefix::Disk(_) | Prefix::VerbatimDisk(_)) => current.push(part.as_os_str()),
            Component::RootDir => current.push(part.as_os_str()),
            Component::Normal(name) if name.to_str().is_some_and(|name| !name.ends_with(['.', ' ']) && !name.chars().any(|c| c.is_control() || "<>:\"/\\|?*".contains(c))) => current.push(name),
            _ => return Err("Project MCP root must be a local path without traversal".into()),
        }
        if current.is_absolute() && !matches!(part, Component::Prefix(_)) { pins.push(project_mcp_pin(&current, true)?); }
    }
    std::fs::canonicalize(current).map_err(|e| e.to_string())
}

#[cfg(windows)]
fn project_mcp_file_id(file: &std::fs::File) -> Result<String, String> {
    let (volume, index) = crate::codex_mono_store::file_identity(file)?;
    Ok(format!("windows:{volume}:{index}"))
}

#[derive(Serialize, serde::Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProjectMcpPin {
    project_identity: String,
    execution_identity: String,
    schema_hash: String,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProjectMcpRead {
    operation_id: String,
    project: String,
    path: String,
    deadline: u64,
    pin: ProjectMcpPin,
}

#[tauri::command(async)]
pub fn inspect_project_mcp(project: String) -> Result<ProjectMcpPin, String> {
    #[cfg(windows)]
    return project_mcp_inspect(Path::new(&project)).map(|(pin, _guards)| pin);
    #[cfg(not(windows))]
    { let _ = project; Err("Pinned project MCP is unavailable on this platform".into()) }
}

#[cfg(windows)]
fn project_mcp_inspect(project: &Path) -> Result<(ProjectMcpPin, Vec<std::fs::File>), String> {
    use std::io::Read;
    use sha2::{Digest, Sha256};
    let mut guards = Vec::new();
    project_mcp_pin_root(project, &mut guards)?;
    let project_identity = project_mcp_file_id(guards.last().ok_or("Missing project pin")?)?;
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let mut executable = project_mcp_pin(&exe, false)?;
    if executable.metadata().map_err(|e| e.to_string())?.len() > 256 * 1024 * 1024 { return Err("Executable exceeds MCP pin bound".into()); }
    let mut hash = Sha256::new();
    let mut buffer = [0u8; 65_536];
    loop { let read = executable.read(&mut buffer).map_err(|e| e.to_string())?; if read == 0 { break; } hash.update(&buffer[..read]); }
    let execution_identity = format!("monocode-project-read-v1:{}:{:x}", project_mcp_file_id(&executable)?, hash.finalize());
    guards.push(executable);
    Ok((ProjectMcpPin { project_identity, execution_identity, schema_hash: project_mcp_schema_hash() }, guards))
}

struct ProjectMcpOperation {
    cancel: std::sync::Arc<std::sync::atomic::AtomicBool>,
    created: std::time::Instant,
    active: bool,
}

// Owned-child cancellation only; approval authority and durable receipts remain in the existing goal ledger.
fn project_mcp_operations() -> &'static std::sync::Mutex<std::collections::HashMap<String, ProjectMcpOperation>> {
    static OPERATIONS: std::sync::OnceLock<std::sync::Mutex<std::collections::HashMap<String, ProjectMcpOperation>>> = std::sync::OnceLock::new();
    OPERATIONS.get_or_init(Default::default)
}

#[tauri::command]
pub fn cancel_project_mcp(window: tauri::WebviewWindow, operation_id: String) -> Result<(), String> {
    if operation_id.is_empty() || operation_id.len() > 128 || !operation_id.bytes().all(|byte| byte.is_ascii_alphanumeric() || b"_-".contains(&byte)) {
        return Err("Invalid MCP operation ID".into());
    }
    project_mcp_cancel(&format!("{}:{operation_id}", window.label()))
}

fn project_mcp_cancel(key: &str) -> Result<(), String> {
    let mut operations = project_mcp_operations().lock().map_err(|_| "MCP operation lock failed")?;
    operations.retain(|_, value| value.active || value.created.elapsed() < std::time::Duration::from_secs(60));
    if operations.len() >= 128 && !operations.contains_key(key) { return Err("MCP cancellation capacity reached".into()); }
    let operation = operations.entry(key.into()).or_insert_with(|| ProjectMcpOperation { cancel: Default::default(), created: std::time::Instant::now(), active: false });
    operation.cancel.store(true, std::sync::atomic::Ordering::SeqCst);
    Ok(())
}

#[tauri::command(async)]
pub fn read_project_mcp(window: tauri::WebviewWindow, request: ProjectMcpRead) -> Result<Value, String> {
    if request.operation_id.is_empty() || request.operation_id.len() > 128 || !request.operation_id.bytes().all(|byte| byte.is_ascii_alphanumeric() || b"_-".contains(&byte)) {
        return Err("Invalid MCP operation ID".into());
    }
    let key = format!("{}:{}", window.label(), request.operation_id);
    let cancel = {
        let mut operations = project_mcp_operations().lock().map_err(|_| "MCP operation lock failed")?;
        operations.retain(|_, value| value.active || value.created.elapsed() < std::time::Duration::from_secs(60));
        if operations.contains_key(&key) || operations.len() >= 128 { return Err("MCP operation already started, cancelled or at capacity".into()); }
        let cancel = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        operations.insert(key.clone(), ProjectMcpOperation { cancel: cancel.clone(), active: true, created: std::time::Instant::now() });
        cancel
    };
    let result = project_mcp_execute(request, cancel);
    if let Ok(mut operations) = project_mcp_operations().lock() {
        if let Some(operation) = operations.get_mut(&key) { operation.active = false; }
    }
    result
}

#[cfg(not(windows))]
fn project_mcp_execute(_request: ProjectMcpRead, _cancel: std::sync::Arc<std::sync::atomic::AtomicBool>) -> Result<Value, String> {
    Err("Pinned project MCP is unavailable on this platform".into())
}

#[cfg(windows)]
fn project_mcp_exchange(child: &mut std::process::Child,
    receiver: &std::sync::mpsc::Receiver<Result<Option<Value>, String>>,
    id: i32, method: &str, params: Value, check: &impl Fn() -> Result<(), String>) -> Result<Value, String> {
    use std::io::Write;
    check()?;
    let stdin = child.stdin.as_mut().ok_or("MCP child stdin missing")?;
    writeln!(stdin, "{}", serde_json::json!({"jsonrpc":"2.0","id":id,"method":method,"params":params})).map_err(|e| e.to_string())?;
    stdin.flush().map_err(|e| e.to_string())?;
    loop {
        check()?;
        match receiver.recv_timeout(std::time::Duration::from_millis(10)) {
            Ok(Ok(Some(response))) if response["jsonrpc"] == "2.0" && response["id"] == id && response.get("result").is_some() && response.get("error").is_none() => return Ok(response["result"].clone()),
            Ok(Ok(Some(_))) => return Err("MCP returned an unexpected response or error".into()),
            Ok(Ok(None)) => return Err("MCP child closed before the response".into()),
            Ok(Err(reason)) => return Err(reason),
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => (),
            Err(_) => return Err("MCP child output disconnected".into()),
        }
    }
}

#[cfg(windows)]
fn project_mcp_execute(request: ProjectMcpRead, cancel: std::sync::Arc<std::sync::atomic::AtomicBool>) -> Result<Value, String> {
    use std::io::{BufReader, Write};
    use std::os::windows::process::CommandExt;
    use std::process::{Command, Stdio};
    use serde_json::json;
    project_mcp_path(&request.path)?;
    let now = project_mcp_now()?;
    if request.deadline <= now || request.deadline - now > 30_000 { return Err("MCP deadline must be within thirty seconds".into()); }
    let (actual_pin, _guards) = project_mcp_inspect(Path::new(&request.project))?;
    if request.pin != actual_pin { return Err("MCP executable, schema or project identity changed; approve the new pin".into()); }
    if cancel.load(std::sync::atomic::Ordering::SeqCst) { return Err("MCP operation cancelled before launch".into()); }
    let mut command = Command::new(std::env::current_exe().map_err(|e| e.to_string())?);
    command.args(["mcp-project-read", "--project", &request.project, "--identity", &request.pin.project_identity, "--path", &request.path, "--deadline", &request.deadline.to_string()])
        .env_clear().current_dir(&request.project).creation_flags(0x08000000)
        .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null());
    struct OwnedChild { child: std::process::Child, reader: Option<std::thread::JoinHandle<()>>, receiver: Option<std::sync::mpsc::Receiver<Result<Option<Value>, String>>> }
    impl Drop for OwnedChild {
        fn drop(&mut self) {
            self.child.stdin.take();
            let _ = self.child.kill();
            let _ = self.child.wait();
            self.receiver.take();
            if let Some(reader) = self.reader.take() { let _ = reader.join(); }
        }
    }
    let mut owned = OwnedChild { child: command.spawn().map_err(|e| e.to_string())?, reader: None, receiver: None };
    let stdout = owned.child.stdout.take().ok_or("MCP child stdout missing")?;
    let (sender, receiver) = std::sync::mpsc::sync_channel(1);
    owned.reader = Some(std::thread::Builder::new().name("monocode-project-mcp-output".into()).spawn(move || {
        let mut stdout = BufReader::new(stdout);
        for _ in 0..4 {
            let frame = project_mcp_frame(&mut stdout);
            let done = !matches!(&frame, Ok(Some(_)));
            if sender.send(frame).is_err() || done { break; }
        }
    }).map_err(|e| e.to_string())?);
    owned.receiver = Some(receiver);
    let check = || -> Result<(), String> {
        if cancel.load(std::sync::atomic::Ordering::SeqCst) { return Err("MCP operation cancelled".into()); }
        if project_mcp_now()? >= request.deadline { return Err("MCP operation deadline expired".into()); }
        Ok(())
    };
    let receiver = owned.receiver.as_ref().ok_or("MCP receiver missing")?;
    let initialized = project_mcp_exchange(&mut owned.child, receiver, 1, "initialize", json!({"protocolVersion":PROJECT_MCP_VERSION,"capabilities":{},"clientInfo":{"name":"MonoCode","version":env!("CARGO_PKG_VERSION")}}), &check)?;
    if initialized["protocolVersion"] != PROJECT_MCP_VERSION || initialized["serverInfo"]["name"] != "monocode-project-read" || !initialized["capabilities"]["tools"].is_object() {
        return Err("MCP initialization pin mismatch".into());
    }
    writeln!(owned.child.stdin.as_mut().ok_or("MCP child stdin missing")?, "{}", json!({"jsonrpc":"2.0","method":"notifications/initialized"})).map_err(|e| e.to_string())?;
    owned.child.stdin.as_mut().ok_or("MCP child stdin missing")?.flush().map_err(|e| e.to_string())?;
    let tools = project_mcp_exchange(&mut owned.child, receiver, 2, "tools/list", json!({}), &check)?;
    if tools != json!({"tools":[project_mcp_tool()]}) { return Err("MCP tool/schema pin mismatch".into()); }
    let result = project_mcp_exchange(&mut owned.child, receiver, 3, "tools/call", json!({"name":PROJECT_MCP_TOOL,"arguments":{"path":request.path}}), &check)?;
    check()?;
    if result["isError"] != false || !result["content"].as_array().is_some_and(|parts| parts.len() == 1 && parts[0]["type"] == "text" && parts[0]["text"].as_str().is_some_and(|text| text.len() <= 65_536)) {
        return Err("MCP tool refused or returned an invalid bounded text result".into());
    }
    Ok(result)
}

fn claude_desktop_config(home: &Path) -> PathBuf {
    #[cfg(target_os = "macos")]
    {
        home.join("Library/Application Support/Claude/claude_desktop_config.json")
    }
    #[cfg(target_os = "windows")]
    {
        std::env::var_os("APPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|| home.join("AppData/Roaming"))
            .join("Claude/claude_desktop_config.json")
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        home.join(".config/Claude/claude_desktop_config.json")
    }
}

fn server_from_json(provider: &str, name: &str, config: &str) -> Result<(String, Value), String> {
    let value: Value = serde_json::from_str(config).map_err(|e| format!("Invalid JSON: {e}"))?;
    let (name, mut server) = if let Some(servers) = value.get("mcpServers") {
        let servers = servers.as_object().ok_or("mcpServers must be an object")?;
        if servers.len() != 1 {
            return Err("Add one server at a time".into());
        }
        let (server_name, server) = servers.iter().next().unwrap();
        if !name.trim().is_empty() && name.trim() != server_name {
            return Err("Name does not match the mcpServers entry".into());
        }
        (server_name.clone(), server.clone())
    } else {
        (name.trim().to_owned(), value)
    };
    if name.is_empty() || name.chars().any(char::is_control) {
        return Err("Server name cannot be empty or contain control characters".into());
    }
    if provider != "opencode"
        && !name
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    {
        return Err("Server name must use letters, numbers, hyphens, or underscores".into());
    }
    if !server.is_object() {
        return Err("Server configuration must be an object".into());
    }
    if provider == "opencode" {
        if let Some(parts) = server.get("command").and_then(Value::as_array) {
            let parts = parts
                .iter()
                .map(|part| {
                    part.as_str()
                        .filter(|text| !text.is_empty())
                        .map(str::to_owned)
                })
                .collect::<Option<Vec<_>>>()
                .ok_or("OpenCode command must contain non-empty strings")?;
            let (command, args) = parts
                .split_first()
                .ok_or("OpenCode command cannot be empty")?;
            let object = server.as_object_mut().unwrap();
            if object.contains_key("args") {
                return Err("Use either a command array or separate args".into());
            }
            object.insert("command".into(), Value::String(command.clone()));
            object.insert("args".into(), serde_json::json!(args));
        }
    }
    let command = server
        .get("command")
        .and_then(Value::as_str)
        .is_some_and(|s| !s.is_empty());
    let url = server
        .get("url")
        .and_then(Value::as_str)
        .is_some_and(|s| !s.is_empty());
    if command == url {
        return Err("Server needs either a command or a URL".into());
    }
    Ok((name, server))
}

#[tauri::command]
pub async fn mcp_add(
    host: State<'_, crate::harness::HarnessHost>,
    cwd: String,
    provider: String,
    scope: String,
    name: String,
    config: String,
) -> Result<(), String> {
    let (name, server) = server_from_json(&provider, &name, &config)?;
    let binary_path = host.runtime_binary_path(&provider);
    tauri::async_runtime::spawn_blocking(move || {
        let home = dirs_home().ok_or("Home directory not found")?;
        let project = expand_home(&cwd);
        if !project.is_dir() {
            return Err("Project directory does not exist".into());
        }
        match provider.as_str() {
            "cursor" | "claude_desktop" => {
                let path = match (provider.as_str(), scope.as_str()) {
                    ("cursor", "user") => Path::new(&home).join(".cursor/mcp.json"),
                    ("cursor", "project") => project.join(".cursor/mcp.json"),
                    ("claude_desktop", "user") => claude_desktop_config(Path::new(&home)),
                    _ => return Err("Unsupported scope for this provider".into()),
                };
                if provider == "claude_desktop" && server.get("command").is_none() {
                    return Err("Claude Desktop local configuration requires a command".into());
                }
                write_json_server(&path, &name, server)
            }
            "opencode" => {
                if !matches!(scope.as_str(), "user" | "project") {
                    return Err("Invalid OpenCode MCP scope".into());
                }
                let major = crate::harness::opencode_major_version(&cwd, binary_path.as_deref())?;
                let override_path = std::env::var_os("OPENCODE_CONFIG").map(PathBuf::from);
                let path = opencode_config_path(
                    Path::new(&home),
                    &project,
                    &scope,
                    override_path.as_deref(),
                );
                write_opencode_server(&path, &name, server, major)
            }
            "claude" | "codex" => crate::harness::add_mcp_via_cli(
                &provider,
                &scope,
                &cwd,
                &name,
                &server,
                binary_path.as_deref(),
            ),
            _ => Err("Unsupported MCP provider".into()),
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

fn opencode_config_path(
    home: &Path,
    project: &Path,
    scope: &str,
    override_path: Option<&Path>,
) -> PathBuf {
    if scope == "user" {
        if let Some(path) = override_path {
            return path.to_path_buf();
        }
    }
    let directory = if scope == "user" {
        home.join(".config/opencode")
    } else {
        project.to_path_buf()
    };
    let candidates: &[&str] = if scope == "user" {
        &["opencode.json", "opencode.jsonc"]
    } else {
        &[
            "opencode.json",
            "opencode.jsonc",
            ".opencode/opencode.json",
            ".opencode/opencode.jsonc",
        ]
    };
    candidates
        .iter()
        .map(|name| directory.join(name))
        .find(|path| path.exists())
        .unwrap_or_else(|| directory.join("opencode.json"))
}

fn normalize_opencode_server(server: Value, major: u32) -> Result<Value, String> {
    let mut object = server
        .as_object()
        .ok_or("Server configuration must be an object")?
        .clone();
    let local = object.get("command").is_some();
    let allowed: &[&str] = if local {
        &[
            "type",
            "command",
            "args",
            "env",
            "environment",
            "enabled",
            "disabled",
            "cwd",
            "timeout",
            "codemode",
            "protocol",
        ]
    } else {
        &[
            "type", "url", "headers", "enabled", "disabled", "oauth", "timeout", "codemode",
            "protocol",
        ]
    };
    if let Some(key) = object.keys().find(|key| !allowed.contains(&key.as_str())) {
        return Err(format!("OpenCode configuration cannot preserve '{key}'"));
    }
    let kind = object
        .remove("type")
        .and_then(|value| value.as_str().map(str::to_owned));
    if local {
        if !matches!(kind.as_deref(), None | Some("stdio") | Some("local")) {
            return Err("OpenCode local server type must be local".into());
        }
        let command = object
            .remove("command")
            .ok_or("Local server needs a command")?;
        let mut parts = if let Some(command) = command.as_str() {
            vec![Value::String(command.to_owned())]
        } else {
            command
                .as_array()
                .cloned()
                .ok_or("OpenCode command must be an array or string")?
        };
        if let Some(args) = object.remove("args") {
            parts.extend(
                args.as_array()
                    .ok_or("args must be an array")?
                    .iter()
                    .cloned(),
            );
        }
        if parts.is_empty()
            || parts
                .iter()
                .any(|part| part.as_str().is_none_or(str::is_empty))
        {
            return Err("OpenCode command must contain non-empty strings".into());
        }
        if object.contains_key("env") && object.contains_key("environment") {
            return Err("Use either env or environment".into());
        }
        if let Some(environment) = object
            .remove("env")
            .or_else(|| object.remove("environment"))
        {
            let values = environment
                .as_object()
                .ok_or("environment must be an object")?;
            if values.values().any(|value| !value.is_string()) {
                return Err("environment values must be strings".into());
            }
            object.insert("environment".into(), environment);
        }
        object.insert("command".into(), Value::Array(parts));
        object.insert("type".into(), Value::String("local".into()));
    } else {
        if !matches!(
            kind.as_deref(),
            None | Some("http") | Some("sse") | Some("remote")
        ) {
            return Err("OpenCode remote server type must be remote".into());
        }
        let url = object
            .get("url")
            .and_then(Value::as_str)
            .ok_or("Remote server needs a URL")?;
        let parsed = url::Url::parse(url).map_err(|_| "Invalid server URL")?;
        if !matches!(parsed.scheme(), "http" | "https") {
            return Err("MCP URL must use HTTP or HTTPS".into());
        }
        object.insert("type".into(), Value::String("remote".into()));
    }
    if major == 1 {
        if let Some(disabled) = object.remove("disabled") {
            object.insert(
                "enabled".into(),
                Value::Bool(!disabled.as_bool().ok_or("disabled must be a boolean")?),
            );
        }
    } else if let Some(enabled) = object.remove("enabled") {
        object.insert(
            "disabled".into(),
            Value::Bool(!enabled.as_bool().ok_or("enabled must be a boolean")?),
        );
    }
    Ok(Value::Object(object))
}

fn is_opencode_timeout_settings(value: &Value) -> bool {
    value.as_object().is_some_and(|timeouts| {
        timeouts.iter().all(|(key, value)| {
            matches!(key.as_str(), "startup" | "catalog" | "execution")
                && value
                    .as_f64()
                    .is_some_and(|milliseconds| milliseconds > 0.0 && milliseconds.fract() == 0.0)
        })
    })
}

fn write_opencode_server(path: &Path, name: &str, server: Value, major: u32) -> Result<(), String> {
    let server = normalize_opencode_server(server, major)?;
    write_json_config(path, |root| {
        let object = root
            .as_object_mut()
            .ok_or("Existing config must be a JSON object")?;
        let mcp = object.entry("mcp").or_insert_with(|| serde_json::json!({}));
        let mcp = mcp
            .as_object_mut()
            .ok_or("Existing mcp must be an object")?;
        let servers = if major == 1 {
            if mcp
                .get("servers")
                .and_then(Value::as_object)
                .is_some_and(|nested| nested.values().all(Value::is_object))
            {
                return Err("Existing OpenCode config uses the 2.x MCP layout".into());
            }
            mcp
        } else {
            if mcp.iter().any(|(key, value)| {
                key != "servers"
                    && value.is_object()
                    && !(key == "timeout" && is_opencode_timeout_settings(value))
            }) {
                return Err("Existing OpenCode config uses the 1.x MCP layout".into());
            }
            mcp.entry("servers")
                .or_insert_with(|| serde_json::json!({}))
                .as_object_mut()
                .ok_or("Existing mcp.servers must be an object")?
        };
        if servers.contains_key(name) {
            return Err(format!("{name} is already configured in this file"));
        }
        servers.insert(name.to_owned(), server);
        Ok(())
    })
}

fn write_json_server(path: &Path, name: &str, server: Value) -> Result<(), String> {
    write_json_config(path, |root| {
        let object = root
            .as_object_mut()
            .ok_or("Existing config must be a JSON object")?;
        let servers = object
            .entry("mcpServers")
            .or_insert_with(|| serde_json::json!({}));
        let servers = servers
            .as_object_mut()
            .ok_or("Existing mcpServers must be an object")?;
        if servers.contains_key(name) {
            return Err(format!("{name} is already configured in this file"));
        }
        servers.insert(name.to_owned(), server);
        Ok(())
    })
}

fn write_json_config(
    path: &Path,
    update: impl FnOnce(&mut Value) -> Result<(), String>,
) -> Result<(), String> {
    let parent = path.parent().ok_or("Invalid config path")?;
    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let lock_path = parent.join(format!(
        ".{}.lock",
        path.file_name()
            .and_then(|part| part.to_str())
            .unwrap_or("mcp")
    ));
    let lock = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(lock_path)
        .map_err(|e| e.to_string())?;
    lock.lock().map_err(|e| e.to_string())?;
    let mut root: Value = if path.exists() {
        let raw = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
        serde_json::from_str(&raw)
            .or_else(|_| serde_json::from_str(&strip_jsonc(&raw)))
            .map_err(|e| format!("Existing config is invalid JSON: {e}"))?
    } else {
        serde_json::json!({})
    };
    update(&mut root)?;
    let encoded = serde_json::to_vec_pretty(&root).map_err(|e| e.to_string())?;
    let temporary = parent.join(format!(
        ".{}.{}.tmp",
        path.file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("mcp"),
        uuid::Uuid::new_v4()
    ));
    let result = (|| -> std::io::Result<()> {
        use std::io::Write;
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&temporary)?;
        file.write_all(&encoded)?;
        file.sync_all()?;
        std::fs::rename(&temporary, path)
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&temporary);
    }
    result.map_err(|e| e.to_string())
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpConnection {
    provider: String,
    name: String,
    scope: String,
    config_path: String,
    transport: String,
    enabled: bool,
}

#[tauri::command]
pub async fn mcp_discover(cwd: String) -> Result<Vec<McpConnection>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let home = dirs_home().ok_or("Home directory not found")?;
        let project = expand_home(&cwd);
        let codex_home = std::env::var_os("CODEX_HOME").map(PathBuf::from);
        let desktop_config = claude_desktop_config(Path::new(&home));
        let opencode_config = std::env::var_os("OPENCODE_CONFIG").map(PathBuf::from);
        Ok(discover(
            Path::new(&home),
            &project,
            codex_home.as_deref(),
            &desktop_config,
            opencode_config.as_deref(),
        ))
    })
    .await
    .map_err(|e| e.to_string())?
}

fn discover(
    home: &Path,
    project: &Path,
    codex_home_override: Option<&Path>,
    desktop_config: &Path,
    opencode_config: Option<&Path>,
) -> Vec<McpConnection> {
    let mut connections = Vec::new();
    let claude = home.join(".claude.json");
    if let Some(config) = read_json(&claude) {
        add_json_servers(
            &mut connections,
            "claude",
            "user",
            &claude,
            config.get("mcpServers"),
        );
        add_json_servers(
            &mut connections,
            "claude",
            "local",
            &claude,
            config
                .get("projects")
                .and_then(|projects| projects.get(project.to_string_lossy().as_ref()))
                .and_then(|entry| entry.get("mcpServers")),
        );
    }
    let cursor = home.join(".cursor/mcp.json");
    add_json_file(&mut connections, "cursor", "user", &cursor, "mcpServers");
    add_json_file(
        &mut connections,
        "claude_desktop",
        "user",
        desktop_config,
        "mcpServers",
    );

    let codex_home = codex_home_override
        .map(Path::to_path_buf)
        .unwrap_or_else(|| home.join(".codex"));
    add_toml_file(
        &mut connections,
        "codex",
        "user",
        &codex_home.join("config.toml"),
    );

    for file in ["opencode.json", "opencode.jsonc"] {
        add_json_file(
            &mut connections,
            "opencode",
            "user",
            &home.join(".config/opencode").join(file),
            "mcp",
        );
    }
    if let Some(custom) = opencode_config {
        add_json_file(&mut connections, "opencode", "user", custom, "mcp");
    }

    // Project configuration is inherited from parent directories. Stop at the
    // repository boundary so an unrelated parent project is not shown.
    for directory in project.ancestors() {
        if directory == home {
            break;
        }
        add_json_file(
            &mut connections,
            "claude",
            "project",
            &directory.join(".mcp.json"),
            "mcpServers",
        );
        add_json_file(
            &mut connections,
            "cursor",
            "project",
            &directory.join(".cursor/mcp.json"),
            "mcpServers",
        );
        add_toml_file(
            &mut connections,
            "codex",
            "project",
            &directory.join(".codex/config.toml"),
        );
        for file in [
            "opencode.json",
            "opencode.jsonc",
            ".opencode/opencode.json",
            ".opencode/opencode.jsonc",
        ] {
            add_json_file(
                &mut connections,
                "opencode",
                "project",
                &directory.join(file),
                "mcp",
            );
        }
        if directory.join(".git").exists() {
            break;
        }
    }
    connections.sort_by(|a, b| {
        (&a.provider, &a.name, &a.scope, &a.config_path).cmp(&(
            &b.provider,
            &b.name,
            &b.scope,
            &b.config_path,
        ))
    });
    connections
}

fn add_json_file(
    connections: &mut Vec<McpConnection>,
    provider: &str,
    scope: &str,
    path: &Path,
    key: &str,
) {
    if let Some(config) = read_json(path) {
        add_json_servers(connections, provider, scope, path, config.get(key));
    }
}

fn add_json_servers(
    connections: &mut Vec<McpConnection>,
    provider: &str,
    scope: &str,
    path: &Path,
    servers: Option<&Value>,
) {
    // OpenCode 2.x nests the map under mcp.servers; older versions use mcp.
    // A server can itself be named "servers", so inspect the nested shape.
    let servers = servers.map(|value| {
        if provider == "opencode" {
            if let Some(nested) = value.get("servers").and_then(Value::as_object) {
                if nested.values().all(Value::is_object) {
                    return &value["servers"];
                }
            }
        }
        value
    });
    let Some(servers) = servers.and_then(Value::as_object) else {
        return;
    };
    for (name, config) in servers {
        if !config.is_object() {
            continue;
        }
        if provider == "opencode" && name == "timeout" && is_opencode_timeout_settings(config) {
            continue;
        }
        connections.push(McpConnection {
            provider: provider.into(),
            name: name.clone(),
            scope: scope.into(),
            config_path: path.to_string_lossy().into_owned(),
            transport: transport(config).into(),
            enabled: config.get("enabled").and_then(Value::as_bool) != Some(false)
                && config.get("disabled").and_then(Value::as_bool) != Some(true),
        });
    }
}

fn add_toml_file(connections: &mut Vec<McpConnection>, provider: &str, scope: &str, path: &Path) {
    let Some(raw) = std::fs::read_to_string(path).ok() else {
        return;
    };
    let Some(config) = toml::from_str::<toml::Value>(&raw).ok() else {
        return;
    };
    let Some(servers) = config.get("mcp_servers").and_then(toml::Value::as_table) else {
        return;
    };
    for (name, entry) in servers {
        connections.push(McpConnection {
            provider: provider.into(),
            name: name.clone(),
            scope: scope.into(),
            config_path: path.to_string_lossy().into_owned(),
            transport: if entry.get("url").is_some() {
                "http"
            } else {
                "stdio"
            }
            .into(),
            enabled: entry.get("enabled").and_then(toml::Value::as_bool) != Some(false),
        });
    }
}

fn transport(config: &Value) -> &str {
    config
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or_else(|| {
            if config.get("url").is_some() {
                "http"
            } else {
                "stdio"
            }
        })
}

fn read_json(path: &Path) -> Option<Value> {
    let raw = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&raw)
        .or_else(|_| serde_json::from_str(&strip_jsonc(&raw)))
        .ok()
}

/// Remove JSONC comments and trailing commas without touching quoted text.
fn strip_jsonc(raw: &str) -> String {
    let bytes = raw.as_bytes();
    let mut clean = Vec::with_capacity(bytes.len());
    let mut index = 0;
    let mut quoted = false;
    while index < bytes.len() {
        let byte = bytes[index];
        if quoted {
            clean.push(byte);
            if byte == b'\\' && index + 1 < bytes.len() {
                index += 1;
                clean.push(bytes[index]);
            } else if byte == b'"' {
                quoted = false;
            }
        } else if byte == b'"' {
            quoted = true;
            clean.push(byte);
        } else if byte == b'/' && bytes.get(index + 1) == Some(&b'/') {
            index += 2;
            while index < bytes.len() && bytes[index] != b'\n' {
                index += 1;
            }
            clean.push(b'\n');
        } else if byte == b'/' && bytes.get(index + 1) == Some(&b'*') {
            index += 2;
            while index + 1 < bytes.len() && !(bytes[index] == b'*' && bytes[index + 1] == b'/') {
                index += 1;
            }
            index = (index + 1).min(bytes.len() - 1);
        } else {
            clean.push(byte);
        }
        index += 1;
    }
    let mut result = Vec::with_capacity(clean.len());
    quoted = false;
    let mut escaped = false;
    for (index, byte) in clean.iter().enumerate() {
        if quoted {
            if escaped {
                escaped = false;
            } else if *byte == b'\\' {
                escaped = true;
            } else if *byte == b'"' {
                quoted = false;
            }
        } else if *byte == b'"' {
            quoted = true;
        }
        if !quoted
            && *byte == b','
            && clean[index + 1..]
                .iter()
                .find(|b| !b.is_ascii_whitespace())
                .is_some_and(|b| *b == b'}' || *b == b']')
        {
            continue;
        }
        result.push(*byte);
    }
    String::from_utf8(result).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pinned_project_mcp_refuses_secret_names_case_and_malformed_paths() {
        for path in ["secret.pem", "SECRET.PEM", "a/client.key", "a/STORE.P12", "a/store.pfx", "id_rsa.pub", "id_ed25519_backup", "serviceCredentials.JSON", "vault.keystore", ".npmrc", ".pypirc", ".netrc"] {
            let reason: Value = serde_json::from_str(&project_mcp_path(path).unwrap_err()).unwrap();
            assert_eq!(reason["code"], "protected-file", "{path}");
        }
        for path in ["", "../outside", "/absolute", "C:/outside", "dir//file", "dir/.env", "file.", "dir\\file", "file\0.txt", "CREDEN~1.JSON", "ENV~1"] { assert!(project_mcp_path(path).is_err(), "{path}"); }
        assert!(project_mcp_path("src/model.ts").is_ok());
    }

    #[test]
    fn pinned_project_mcp_enforces_framing_and_lifecycle() {
        use std::io::Cursor;
        let mut output = Vec::new();
        project_mcp_serve(&mut Cursor::new(b"{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/list\"}\n"), &mut output, Path::new("synthetic"), "identity", "readme.txt", project_mcp_now().unwrap() + 10_000).unwrap();
        let response: Value = serde_json::from_slice(&output).unwrap();
        assert_eq!(response["error"]["code"], -32601);
        assert!(project_mcp_frame(&mut Cursor::new(b"{}" )).is_err());
        assert!(project_mcp_frame(&mut Cursor::new(vec![b' '; PROJECT_MCP_FRAME as usize + 1])).is_err());
        assert!(project_mcp_frame(&mut Cursor::new(b"[invalid]\n")).is_err());
    }

    #[cfg(windows)]
    #[test]
    fn pinned_project_mcp_actual_native_read_and_protocol_initialize_list_call() {
        use serde_json::json;
        use std::io::Cursor;
        let root = std::env::temp_dir().join(format!("monocode-project-mcp-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        std::fs::write(root.join("readme.txt"), b"synthetic project read").unwrap();
        let mut pins = Vec::new(); project_mcp_pin_root(&root, &mut pins).unwrap();
        let identity = project_mcp_file_id(pins.last().unwrap()).unwrap(); drop(pins);
        let messages = [json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":PROJECT_MCP_VERSION,"capabilities":{},"clientInfo":{"name":"fixture","version":"1"}}}),
            json!({"jsonrpc":"2.0","method":"notifications/initialized"}),
            json!({"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}),
            json!({"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":PROJECT_MCP_TOOL,"arguments":{"path":"readme.txt"}}})];
        let input = messages.iter().map(|message| format!("{message}\n")).collect::<String>();
        let mut output = Vec::new();
        project_mcp_serve(&mut Cursor::new(input.as_bytes()), &mut output, &root, &identity, "readme.txt", project_mcp_now().unwrap() + 10_000).unwrap();
        let replies: Vec<Value> = String::from_utf8(output).unwrap().lines().map(|line| serde_json::from_str(line).unwrap()).collect();
        assert_eq!(replies.len(), 3);
        assert_eq!(replies[0]["result"]["protocolVersion"], PROJECT_MCP_VERSION);
        assert_eq!(replies[1]["result"]["tools"], json!([project_mcp_tool()]));
        assert_eq!(replies[2]["result"]["content"][0]["text"], "synthetic project read");
        assert!(project_mcp_read(&root, "different", "readme.txt").is_err());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn pinned_project_mcp_refuses_hardlink_alias_junction_and_oversize() {
        let root = std::env::temp_dir().join(format!("monocode-project-mcp-bounds-{}", uuid::Uuid::new_v4()));
        let foreign = std::env::temp_dir().join(format!("monocode-project-mcp-foreign-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap(); std::fs::create_dir(&foreign).unwrap();
        std::fs::write(root.join("secret.key"), b"synthetic credential fixture").unwrap();
        std::fs::hard_link(root.join("secret.key"), root.join("alias.txt")).unwrap();
        std::fs::write(root.join("large.txt"), vec![b'x'; 65_537]).unwrap();
        junction::create(&foreign, root.join("escape")).unwrap();
        std::fs::write(foreign.join("foreign.txt"), b"synthetic foreign").unwrap();
        let mut pins = Vec::new(); project_mcp_pin_root(&root, &mut pins).unwrap();
        let identity = project_mcp_file_id(pins.last().unwrap()).unwrap(); drop(pins);
        for path in ["alias.txt", "escape/foreign.txt", "large.txt"] { assert!(project_mcp_read(&root, &identity, path).is_err(), "{path}"); }
        assert_eq!(std::fs::read(foreign.join("foreign.txt")).unwrap(), b"synthetic foreign");
        junction::delete(root.join("escape")).unwrap();
        std::fs::remove_dir_all(root).unwrap(); std::fs::remove_dir_all(foreign).unwrap();
    }

    #[test]
    fn pinned_project_mcp_cancellation_is_bounded_and_retained_before_start() {
        let key = format!("synthetic-window:{}", uuid::Uuid::new_v4());
        project_mcp_cancel(&key).unwrap();
        let mut operations = project_mcp_operations().lock().unwrap();
        assert!(operations.get(&key).unwrap().cancel.load(std::sync::atomic::Ordering::SeqCst));
        operations.remove(&key);
    }

    #[test]
    fn parses_single_server_from_standard_json() {
        let (name, server) = server_from_json(
            "claude",
            "",
            r#"{"mcpServers":{"docs":{"command":"npx","args":["server"]}}}"#,
        )
        .unwrap();
        assert_eq!(name, "docs");
        assert_eq!(server["command"], "npx");
        assert!(server_from_json(
            "claude",
            "",
            r#"{"mcpServers":{"one":{"command":"npx"},"two":{"command":"node"}}}"#
        )
        .is_err());
        assert!(server_from_json(
            "claude",
            "different",
            r#"{"mcpServers":{"docs":{"command":"npx"}}}"#
        )
        .is_err());
    }

    #[test]
    fn accepts_opencode_names_and_command_arrays() {
        let (name, server) = server_from_json(
            "opencode",
            "docs server",
            r#"{"type":"local","command":["npx","-y","server"]}"#,
        )
        .unwrap();
        assert_eq!(name, "docs server");
        assert_eq!(server["command"], "npx");
        assert_eq!(server["args"], serde_json::json!(["-y", "server"]));
        assert!(server_from_json("claude", "docs server", r#"{"command":"npx"}"#).is_err());
        assert!(server_from_json("opencode", "docs", r#"{"command":[]}"#).is_err());
    }

    #[test]
    fn writes_opencode_one_config_with_environment() {
        let root =
            std::env::temp_dir().join(format!("monocode-opencode-one-{}", uuid::Uuid::new_v4()));
        let path = root.join("opencode.jsonc");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(&path, "{\n // keep this setting\n \"theme\": \"dark\", \"mcp\": {\"existing\": {\"type\": \"remote\", \"url\": \"https://example.com\"},},\n}").unwrap();
        let (_, server) = server_from_json(
            "opencode",
            "docs",
            r#"{"type":"local","command":["npx","-y","docs"],"environment":{"TOKEN":"{env:DOCS_TOKEN}"},"enabled":true}"#,
        ).unwrap();
        write_opencode_server(&path, "docs", server, 1).unwrap();
        let config: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(config["theme"], "dark");
        assert_eq!(config["mcp"]["existing"]["url"], "https://example.com");
        assert_eq!(
            config["mcp"]["docs"]["command"],
            serde_json::json!(["npx", "-y", "docs"])
        );
        assert_eq!(
            config["mcp"]["docs"]["environment"]["TOKEN"],
            "{env:DOCS_TOKEN}"
        );
        assert_eq!(config["mcp"]["docs"]["enabled"], true);
        assert!(
            write_opencode_server(&path, "docs", serde_json::json!({"command":"npx"}), 1).is_err()
        );
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn writes_opencode_two_config_and_normalizes_standard_env() {
        let root =
            std::env::temp_dir().join(format!("monocode-opencode-two-{}", uuid::Uuid::new_v4()));
        let path = root.join("opencode.json");
        let (_, server) = server_from_json(
            "opencode",
            "docs",
            r#"{"mcpServers":{"docs":{"command":"npx","args":["docs"],"env":{"TOKEN":"{env:DOCS_TOKEN}"},"enabled":false}}}"#,
        ).unwrap();
        write_opencode_server(&path, "docs", server, 2).unwrap();
        let config: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(
            config["mcp"]["servers"]["docs"]["command"],
            serde_json::json!(["npx", "docs"])
        );
        assert_eq!(
            config["mcp"]["servers"]["docs"]["environment"]["TOKEN"],
            "{env:DOCS_TOKEN}"
        );
        assert_eq!(config["mcp"]["servers"]["docs"]["disabled"], true);
        assert!(config["mcp"]["docs"].is_null());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn adds_opencode_two_server_without_changing_existing_timeouts_or_servers() {
        let root = std::env::temp_dir().join(format!(
            "monocode-opencode-timeout-{}",
            uuid::Uuid::new_v4()
        ));
        let path = root.join("opencode.json");
        std::fs::create_dir_all(&root).unwrap();
        let original = serde_json::json!({
            "mcp": {
                "timeout": {"startup": 45000, "catalog": 30000, "execution": 600000},
                "servers": {
                    "existing": {"type": "local", "command": ["node", "server.js"]}
                }
            }
        });
        std::fs::write(&path, serde_json::to_vec(&original).unwrap()).unwrap();

        let result = write_opencode_server(
            &path,
            "docs",
            serde_json::json!({"url": "https://example.com/mcp"}),
            2,
        );
        let config: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        std::fs::remove_dir_all(root).unwrap();

        result.unwrap();
        assert_eq!(config["mcp"]["timeout"], original["mcp"]["timeout"]);
        assert_eq!(
            config["mcp"]["servers"]["existing"],
            original["mcp"]["servers"]["existing"]
        );
        assert_eq!(
            config["mcp"]["servers"]["docs"],
            serde_json::json!({"type": "remote", "url": "https://example.com/mcp"})
        );
    }

    #[test]
    fn rejects_legacy_server_named_timeout_without_changing_config() {
        for server in [
            serde_json::json!({"type": "remote", "url": "https://old.example/mcp"}),
            serde_json::json!({"type": "local", "command": ["node", "server.js"]}),
        ] {
            let root = std::env::temp_dir().join(format!(
                "monocode-opencode-legacy-timeout-{}",
                uuid::Uuid::new_v4()
            ));
            let path = root.join("opencode.json");
            std::fs::create_dir_all(&root).unwrap();
            let original = serde_json::to_vec(&serde_json::json!({
                "mcp": {"timeout": server}
            }))
            .unwrap();
            std::fs::write(&path, &original).unwrap();

            let result = write_opencode_server(
                &path,
                "timeout",
                serde_json::json!({"url": "https://new.example/mcp"}),
                2,
            );
            let contents = std::fs::read(&path).unwrap();
            std::fs::remove_dir_all(root).unwrap();

            assert_eq!(
                result,
                Err("Existing OpenCode config uses the 1.x MCP layout".into())
            );
            assert_eq!(contents, original);
        }
    }

    #[test]
    fn adds_opencode_two_server_with_timeouts_and_no_existing_servers_map() {
        for timeout in [
            serde_json::json!({"startup": 45000, "catalog": 30000, "execution": 600000}),
            serde_json::json!({"catalog": 30000.0}),
            serde_json::json!({}),
        ] {
            let root = std::env::temp_dir().join(format!(
                "monocode-opencode-timeout-only-{}",
                uuid::Uuid::new_v4()
            ));
            let path = root.join("opencode.json");
            std::fs::create_dir_all(&root).unwrap();
            std::fs::write(
                &path,
                serde_json::to_vec(&serde_json::json!({"mcp": {"timeout": timeout}})).unwrap(),
            )
            .unwrap();

            let result = write_opencode_server(
                &path,
                "docs",
                serde_json::json!({"url": "https://example.com/mcp"}),
                2,
            );
            let config: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
            std::fs::remove_dir_all(root).unwrap();

            result.unwrap();
            assert_eq!(config["mcp"]["timeout"], timeout);
            assert_eq!(
                config["mcp"]["servers"]["docs"],
                serde_json::json!({"type": "remote", "url": "https://example.com/mcp"})
            );
        }
    }

    #[test]
    fn chooses_existing_opencode_jsonc_and_custom_user_config() {
        let root =
            std::env::temp_dir().join(format!("monocode-opencode-path-{}", uuid::Uuid::new_v4()));
        let home = root.join("home");
        let project = root.join("project");
        std::fs::create_dir_all(&project).unwrap();
        std::fs::write(project.join("opencode.jsonc"), "{}").unwrap();
        assert_eq!(
            opencode_config_path(&home, &project, "project", None),
            project.join("opencode.jsonc")
        );
        std::fs::remove_file(project.join("opencode.jsonc")).unwrap();
        std::fs::create_dir_all(project.join(".opencode")).unwrap();
        std::fs::write(project.join(".opencode/opencode.jsonc"), "{}").unwrap();
        assert_eq!(
            opencode_config_path(&home, &project, "project", None),
            project.join(".opencode/opencode.jsonc")
        );
        let custom = root.join("custom.jsonc");
        assert_eq!(
            opencode_config_path(&home, &project, "user", Some(&custom)),
            custom
        );
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn concurrent_additions_keep_every_server() {
        let root = std::env::temp_dir().join(format!("monocode-mcp-lock-{}", uuid::Uuid::new_v4()));
        let path = root.join(".cursor/mcp.json");
        std::thread::scope(|scope| {
            for index in 0..8 {
                let path = path.clone();
                scope.spawn(move || {
                    write_json_server(
                        &path,
                        &format!("server-{index}"),
                        serde_json::json!({"command":"npx"}),
                    )
                    .unwrap();
                });
            }
        });
        let value: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(value["mcpServers"].as_object().unwrap().len(), 8);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn replacing_config_restricts_permissions() {
        use std::os::unix::fs::PermissionsExt;

        let root = std::env::temp_dir().join(format!("monocode-mcp-mode-{}", uuid::Uuid::new_v4()));
        let path = root.join("mcp.json");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(&path, r#"{"mcpServers":{}}"#).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644)).unwrap();
        write_json_server(&path, "new", serde_json::json!({"command":"npx"})).unwrap();
        assert_eq!(
            std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o600
        );
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn writes_server_without_discarding_other_configuration() {
        let root =
            std::env::temp_dir().join(format!("monocode-mcp-write-{}", uuid::Uuid::new_v4()));
        let path = root.join(".cursor/mcp.json");
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(
            &path,
            r#"{"otherSetting":true,"mcpServers":{"existing":{"command":"node"}}}"#,
        )
        .unwrap();
        write_json_server(&path, "new", serde_json::json!({"command":"npx"})).unwrap();
        let value: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(value["otherSetting"], true);
        assert_eq!(value["mcpServers"]["existing"]["command"], "node");
        assert_eq!(value["mcpServers"]["new"]["command"], "npx");
        assert!(write_json_server(&path, "new", serde_json::json!({"command":"npx"})).is_err());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn adds_to_existing_cursor_jsonc() {
        let root =
            std::env::temp_dir().join(format!("monocode-mcp-jsonc-{}", uuid::Uuid::new_v4()));
        let path = root.join(".cursor/mcp.json");
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(
            &path,
            "{\n // existing server\n \"mcpServers\": {\"old\": {\"command\": \"node\",},},\n}",
        )
        .unwrap();
        write_json_server(&path, "new", serde_json::json!({"command":"npx"})).unwrap();
        let value: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(value["mcpServers"]["old"]["command"], "node");
        assert_eq!(value["mcpServers"]["new"]["command"], "npx");
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn jsonc_preserves_urls_and_removes_comments_and_trailing_commas() {
        let input = r#"{"mcp":{"servers":{"docs":{"url":"https://example.com/mcp",},},}, // comment
        }"#;
        let value: Value = serde_json::from_str(&strip_jsonc(input)).unwrap();
        assert_eq!(
            value["mcp"]["servers"]["docs"]["url"],
            "https://example.com/mcp"
        );
    }

    #[test]
    fn discovers_provider_configs_without_exposing_credentials() {
        let root = std::env::temp_dir().join(format!("monocode-mcp-{}", uuid::Uuid::new_v4()));
        let home = root.join("home");
        let project = root.join("project");
        std::fs::create_dir_all(home.join(".cursor")).unwrap();
        std::fs::create_dir_all(home.join(".codex")).unwrap();
        std::fs::create_dir_all(home.join(".config/opencode")).unwrap();
        std::fs::create_dir_all(&project).unwrap();
        // Stop the ancestor walk inside the fixture so real user configs (which
        // live in ancestors of the temp dir on a dev machine) are never read.
        std::fs::create_dir_all(root.join(".git")).unwrap();
        std::fs::write(home.join(".claude.json"), r#"{"mcpServers":{"one":{"type":"http","url":"https://example.com","headers":{"Authorization":"secret"}}}}"#).unwrap();
        std::fs::write(
            home.join(".cursor/mcp.json"),
            r#"{"mcpServers":{"two":{"command":"npx"}}}"#,
        )
        .unwrap();
        let desktop = root.join("claude_desktop_config.json");
        std::fs::create_dir_all(desktop.parent().unwrap()).unwrap();
        std::fs::write(&desktop, r#"{"mcpServers":{"desktop":{"command":"npx"}}}"#).unwrap();
        std::fs::write(
            home.join(".codex/config.toml"),
            "[mcp_servers.three]\nurl = 'https://example.com'\n",
        )
        .unwrap();
        let codex_raw = std::fs::read_to_string(home.join(".codex/config.toml")).unwrap();
        let codex_config: toml::Value = toml::from_str(&codex_raw).unwrap();
        assert!(codex_config.get("mcp_servers").is_some());
        std::fs::write(home.join(".config/opencode/opencode.jsonc"), "{\"mcp\": {\"servers\": {\"four\": {\"type\": \"remote\", \"url\": \"https://example.com\",},},}}").unwrap();
        let found = discover(&home, &project, None, &desktop, None);
        let names: Vec<_> = found
            .iter()
            .map(|entry| (entry.provider.as_str(), entry.name.as_str()))
            .collect();
        assert_eq!(
            names,
            [
                ("claude", "one"),
                ("claude_desktop", "desktop"),
                ("codex", "three"),
                ("cursor", "two"),
                ("opencode", "four")
            ]
        );
        assert!(!serde_json::to_string(&found).unwrap().contains("secret"));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn discovery_preserves_disabled_servers_across_opencode_versions() {
        for servers in [
            serde_json::json!({
                "off": {"type":"local", "command":["node"], "enabled":false},
                "on": {"type":"local", "command":["node"]}
            }),
            serde_json::json!({"servers": {
                "off": {"type":"local", "command":["node"], "disabled":true},
                "on": {"type":"local", "command":["node"], "disabled":false}
            }}),
        ] {
            let mut found = Vec::new();
            add_json_servers(
                &mut found,
                "opencode",
                "project",
                Path::new("opencode.json"),
                Some(&servers),
            );
            assert_eq!(found.len(), 2);
            assert!(
                !found
                    .iter()
                    .find(|server| server.name == "off")
                    .unwrap()
                    .enabled
            );
            assert!(
                found
                    .iter()
                    .find(|server| server.name == "on")
                    .unwrap()
                    .enabled
            );
        }
    }

    #[test]
    fn discovery_does_not_treat_opencode_timeouts_as_servers() {
        for timeouts in [
            serde_json::json!({}),
            serde_json::json!({"startup":45000}),
            serde_json::json!({"startup":45000,"catalog":60000,"execution":60000}),
        ] {
            let mut found = Vec::new();
            add_json_servers(
                &mut found,
                "opencode",
                "project",
                Path::new("opencode.json"),
                Some(&serde_json::json!({"timeout":timeouts})),
            );
            assert!(found.is_empty());
        }
        let mut found = Vec::new();
        add_json_servers(
            &mut found,
            "opencode",
            "project",
            Path::new("opencode.json"),
            Some(&serde_json::json!({"timeout":{"type":"local","command":["node"]}})),
        );
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].name, "timeout");
    }

    #[test]
    fn discovery_preserves_codex_enablement() {
        let root =
            std::env::temp_dir().join(format!("monocode-mcp-enabled-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let path = root.join("config.toml");
        std::fs::write(
            &path,
            "[mcp_servers.off]\ncommand = 'node'\nenabled = false\n[mcp_servers.on]\ncommand = 'node'\n",
        ).unwrap();
        let mut found = Vec::new();
        add_toml_file(&mut found, "codex", "user", &path);
        assert_eq!(found.len(), 2);
        assert!(
            !found
                .iter()
                .find(|server| server.name == "off")
                .unwrap()
                .enabled
        );
        assert!(
            found
                .iter()
                .find(|server| server.name == "on")
                .unwrap()
                .enabled
        );
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn does_not_duplicate_home_configs_or_hide_a_server_named_servers() {
        let root = std::env::temp_dir().join(format!("monocode-mcp-{}", uuid::Uuid::new_v4()));
        let project = root.join("work/notes");
        std::fs::create_dir_all(root.join(".cursor")).unwrap();
        std::fs::create_dir_all(&project).unwrap();
        std::fs::write(
            root.join(".cursor/mcp.json"),
            r#"{"mcpServers":{"servers":{"command":"npx"},"docs":{"command":"node"}}}"#,
        )
        .unwrap();
        let found = discover(&root, &project, None, &root.join("desktop.json"), None);
        assert_eq!(found.len(), 2);
        assert!(found.iter().all(|server| server.scope == "user"));
        assert!(found.iter().any(|server| server.name == "servers"));
        std::fs::remove_dir_all(root).unwrap();
    }
}
