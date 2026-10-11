use super::*;
use std::collections::{BTreeSet, HashMap};

// shortcut: this mirrors Codex 0.162.1's version-5 setup decision; recheck on Codex upgrades.
const SETUP_VERSION: u32 = 5;
const OFFLINE_USERNAME: &str = "CodexSandboxOffline";
const ONLINE_USERNAME: &str = "CodexSandboxOnline";
const UF_ACCOUNTDISABLE: u32 = 2;
const UF_PASSWORD_EXPIRED: u32 = 0x800000;
const PROXY_KEYS: &[&str] = &[
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "WS_PROXY",
    "WSS_PROXY",
    "http_proxy",
    "https_proxy",
    "all_proxy",
    "ws_proxy",
    "wss_proxy",
];

#[derive(Deserialize)]
struct Marker {
    version: u32,
    offline_username: String,
    online_username: String,
    #[serde(default)]
    proxy_ports: Vec<u16>,
    #[serde(default)]
    allow_local_binding: bool,
}

#[derive(Deserialize)]
struct User {
    username: String,
    password: String,
}

#[derive(Deserialize)]
struct Users {
    version: u32,
    offline: User,
    online: User,
}

fn blocked(base: &Path, reason: impl Into<String>) -> String {
    let home = crate::fs::path_to_js(base).replace('\'', "''");
    serde_json::json!({
        "sandbox": true,
        "reason": reason.into(),
        "setupCommand": format!("$env:CODEX_HOME = '{home}'; codex sandbox -c 'windows.sandbox=\"elevated\"' -P :workspace -C '{home}' -- powershell.exe -NoProfile -Command 'Write-Output \"Codex sandbox setup complete\"'")
    }).to_string()
}

pub(super) fn validate(
    base: &Path,
    config_home: &Path,
    required: bool,
    windows_sandbox: Option<&str>,
    network_access: Option<bool>,
    effective_config: Option<&serde_json::Value>,
) -> Result<(), String> {
    #[cfg(windows)]
    {
        if !required || windows_sandbox == Some("unelevated") {
            return Ok(());
        }
        let config = match effective_config {
            Some(config) => config.clone(),
            None => serde_json::to_value(skills::read_config(config_home)?)
                .map_err(|e| e.to_string())?,
        };
        validate_launch_with(
            base,
            &config,
            required,
            windows_sandbox,
            network_access,
            &std::env::vars().collect(),
            local_user_flags,
        )
        .map_err(|reason| blocked(base, reason))
    }
    #[cfg(not(windows))]
    {
        let _ = (
            base,
            config_home,
            required,
            windows_sandbox,
            network_access,
            effective_config,
        );
        Ok(())
    }
}

fn elevated_engine(
    config: &serde_json::Value,
    windows_sandbox: Option<&str>,
) -> Result<bool, String> {
    if windows_sandbox == Some("unelevated") {
        return Ok(false);
    }
    if config.get("profile").is_some_and(|value| !value.is_null()) {
        return Err("Legacy 'profile' configuration is unsupported by Codex 0.162.1; remove it or select a named .config.toml profile explicitly outside MonoCode.".into());
    }
    let engine = windows_sandbox
        .or_else(|| {
            config
                .pointer("/windows/sandbox")
                .and_then(serde_json::Value::as_str)
        })
        .or_else(|| {
            (config.pointer("/features/elevated_windows_sandbox")
                == Some(&serde_json::Value::Bool(true)))
            .then_some("elevated")
        });
    match engine {
        None | Some("unelevated") | Some("mxc") => Ok(false),
        Some("elevated") => Ok(true),
        Some(engine) => Err(format!(
            "The effective Windows sandbox engine '{engine}' cannot be checked safely."
        )),
    }
}

fn validate_launch_with(
    base: &Path,
    config: &serde_json::Value,
    required: bool,
    windows_sandbox: Option<&str>,
    network_access: Option<bool>,
    env: &HashMap<String, String>,
    user_flags: impl Fn(&str) -> Result<Option<u32>, String>,
) -> Result<(), String> {
    validate_with(
        base,
        config,
        required,
        windows_sandbox,
        network_access,
        env,
        user_flags,
    )?;
    if required && elevated_engine(config, windows_sandbox)? {
        return Err("Codex 0.162.1 can automatically repair sandbox credentials and enter elevated setup. Read-only checks cannot exclude that path without authentication side effects. Manual setup alone cannot unlock elevated Mono turns; use unelevated sandbox or full access until Codex can forbid automatic provisioning.".into());
    }
    Ok(())
}

pub(super) fn validate_with(
    base: &Path,
    config: &serde_json::Value,
    required: bool,
    windows_sandbox: Option<&str>,
    network_access: Option<bool>,
    env: &HashMap<String, String>,
    user_flags: impl Fn(&str) -> Result<Option<u32>, String>,
) -> Result<(), String> {
    if !required || !elevated_engine(config, windows_sandbox)? {
        return Ok(());
    }
    let marker: Marker = read_artifact(base, ".sandbox/setup_marker.json")?;
    if marker.version != SETUP_VERSION
        || marker.offline_username != OFFLINE_USERNAME
        || marker.online_username != ONLINE_USERNAME
    {
        return Err("The sandbox setup marker is incompatible with Codex 0.162.1.".into());
    }
    let users: Users = read_artifact(base, ".sandbox-secrets/sandbox_users.json")?;
    if users.version != SETUP_VERSION
        || users.offline.username != OFFLINE_USERNAME
        || users.online.username != ONLINE_USERNAME
        || users.offline.password.is_empty()
        || users.online.password.is_empty()
    {
        return Err("The recorded sandbox users are missing credentials or incompatible with the setup marker.".into());
    }
    if !base.join(".sandbox-bin").is_dir() {
        return Err("The sandbox helper directory .sandbox-bin is missing.".into());
    }
    if !std::fs::read(base.join("cap_sid")).is_ok_and(|bytes| !bytes.is_empty()) {
        return Err("The sandbox capability cache cap_sid is missing or empty.".into());
    }
    let network_access = network_access.unwrap_or_else(|| {
        config
            .pointer("/sandbox_workspace_write/network_access")
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(false)
    });
    let proxy = config.pointer("/features/network_proxy");
    let managed_proxy = proxy.is_some_and(|value| {
        value.as_bool() == Some(true)
            || value.get("enabled").and_then(serde_json::Value::as_bool) == Some(true)
    });
    if managed_proxy && network_access {
        return Err("Codex's managed network proxy chooses runtime listener ports; offline sandbox compatibility cannot be established without starting it.".into());
    }
    if !network_access {
        let mut env = env.clone();
        let policy = config.get("shell_environment_policy");
        if policy
            .and_then(|value| value.get("experimental_use_profile"))
            .and_then(serde_json::Value::as_bool)
            == Some(true)
        {
            return Err("A shell profile can change offline proxy settings; sandbox readiness cannot be established without running the profile.".into());
        }
        if matches!(
            policy
                .and_then(|value| value.get("inherit"))
                .and_then(serde_json::Value::as_str),
            Some("none" | "core")
        ) {
            for key in PROXY_KEYS.iter().copied().chain([
                "CODEX_WINDOWS_SANDBOX_PROXY_PORTS",
                "CODEX_NETWORK_ALLOW_LOCAL_BINDING",
            ]) {
                env.remove(key);
            }
        }
        if let Some(set) = config
            .pointer("/shell_environment_policy/set")
            .and_then(serde_json::Value::as_object)
        {
            for (key, value) in set {
                if let Some(value) = value.as_str() {
                    env.insert(key.clone(), value.into());
                }
            }
        }
        let filtered = ["exclude", "include_only"].iter().any(|key| {
            policy
                .and_then(|value| value.get(key))
                .and_then(serde_json::Value::as_array)
                .is_some_and(|values| !values.is_empty())
        });
        if filtered
            && PROXY_KEYS
                .iter()
                .copied()
                .chain([
                    "CODEX_WINDOWS_SANDBOX_PROXY_PORTS",
                    "CODEX_NETWORK_ALLOW_LOCAL_BINDING",
                ])
                .any(|key| env.contains_key(key))
        {
            return Err("Shell environment filters can change offline proxy settings; their sandbox compatibility cannot be established safely.".into());
        }
        let ports = proxy_ports(&env);
        let binding = env
            .get("CODEX_NETWORK_ALLOW_LOCAL_BINDING")
            .is_some_and(|value| value == "1");
        // Local binding uses no port-specific rules, matching Codex's offline compatibility check.
        if marker.allow_local_binding != binding || (!binding && marker.proxy_ports != ports) {
            return Err(format!(
                "Offline firewall settings changed (stored_ports={:?}, desired_ports={ports:?}, stored_allow_local_binding={}, desired_allow_local_binding={binding}).",
                marker.proxy_ports, marker.allow_local_binding
            ));
        }
    }
    for username in [OFFLINE_USERNAME, ONLINE_USERNAME] {
        let flags = user_flags(username)
            .map_err(|error| format!("Could not verify sandbox account '{username}': {error}"))?
            .ok_or_else(|| format!("Sandbox account '{username}' is missing."))?;
        if flags & UF_ACCOUNTDISABLE != 0 {
            return Err(format!("Sandbox account '{username}' is disabled."));
        }
        if flags & UF_PASSWORD_EXPIRED != 0 {
            return Err(format!(
                "Sandbox account '{username}' has an expired password."
            ));
        }
    }
    Ok(())
}

fn read_artifact<T: serde::de::DeserializeOwned>(base: &Path, entry: &str) -> Result<T, String> {
    let bytes = std::fs::read(base.join(entry))
        .map_err(|error| format!("Could not read {entry}: {error}"))?;
    serde_json::from_slice(&bytes)
        .map_err(|_| format!("The sandbox artifact {entry} is malformed."))
}

fn proxy_ports(env: &HashMap<String, String>) -> Vec<u16> {
    let mut ports = BTreeSet::new();
    for key in PROXY_KEYS {
        if let Some(port) = env.get(*key).and_then(|value| loopback_proxy_port(value)) {
            ports.insert(port);
        }
    }
    if let Some(value) = env.get("CODEX_WINDOWS_SANDBOX_PROXY_PORTS") {
        ports.extend(
            value
                .split(',')
                .filter_map(|port| port.trim().parse::<u16>().ok())
                .filter(|port| *port != 0),
        );
    }
    ports.into_iter().collect()
}

fn loopback_proxy_port(url: &str) -> Option<u16> {
    let authority = url.trim().split_once("://")?.1.split('/').next()?;
    let host_port = authority
        .rsplit_once('@')
        .map_or(authority, |(_, value)| value);
    let (host, port) = if let Some(host) = host_port.strip_prefix('[') {
        let (host, rest) = host.split_once(']')?;
        if host != "::1" {
            return None;
        }
        (host, rest.strip_prefix(':')?)
    } else {
        let (host, port) = host_port.rsplit_once(':')?;
        if !(host.eq_ignore_ascii_case("localhost") || host == "127.0.0.1") {
            return None;
        }
        (host, port)
    };
    let _ = host;
    let port = port.parse::<u16>().ok()?;
    (port != 0).then_some(port)
}

#[cfg(windows)]
fn local_user_flags(username: &str) -> Result<Option<u32>, String> {
    use windows_sys::Win32::NetworkManagement::NetManagement::{
        NERR_UserNotFound, NetApiBufferFree, NetUserGetInfo, USER_INFO_1,
    };
    let name = username.encode_utf16().chain(Some(0)).collect::<Vec<_>>();
    let mut buffer = std::ptr::null_mut();
    let status = unsafe { NetUserGetInfo(std::ptr::null(), name.as_ptr(), 1, &mut buffer) };
    if status == NERR_UserNotFound {
        return Ok(None);
    }
    if status != 0 {
        return Err(format!("NetUserGetInfo returned Windows error {status}."));
    }
    if buffer.is_null() {
        return Err("NetUserGetInfo returned no account information.".into());
    }
    let flags = unsafe { (*buffer.cast::<USER_INFO_1>()).usri1_flags };
    unsafe {
        NetApiBufferFree(buffer.cast());
    }
    Ok(Some(flags))
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let home = std::env::temp_dir()
                .join(format!("monocode-cc6g-sandbox-{}", uuid::Uuid::new_v4()));
            for entry in [".sandbox", ".sandbox-secrets", ".sandbox-bin"] {
                std::fs::create_dir_all(home.join(entry)).unwrap();
            }
            std::fs::write(home.join("cap_sid"), b"synthetic SID").unwrap();
            std::fs::write(home.join(".sandbox/setup_marker.json"), br#"{"version":5,"offline_username":"CodexSandboxOffline","online_username":"CodexSandboxOnline"}"#).unwrap();
            std::fs::write(home.join(".sandbox-secrets/sandbox_users.json"), br#"{"version":5,"offline":{"username":"CodexSandboxOffline","password":"synthetic"},"online":{"username":"CodexSandboxOnline","password":"synthetic"}}"#).unwrap();
            Self(home)
        }
        fn check(&self, env: &HashMap<String, String>, flags: Option<u32>) -> Result<(), String> {
            let users = std::fs::read(self.0.join(".sandbox-secrets/sandbox_users.json")).unwrap();
            let result = validate_with(
                &self.0,
                &serde_json::json!({"windows":{"sandbox":"elevated"}}),
                true,
                None,
                Some(false),
                env,
                |_| Ok(flags),
            );
            assert_eq!(
                std::fs::read(self.0.join(".sandbox-secrets/sandbox_users.json")).unwrap(),
                users
            );
            result
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            std::fs::remove_dir_all(&self.0).unwrap();
        }
    }

    #[test]
    fn intact_identity_control_passes_without_setup() {
        Fixture::new().check(&HashMap::new(), Some(0)).unwrap();
    }
    #[test]
    fn production_launch_gate_blocks_healthy_elevated_identity_without_authentication_or_setup() {
        let fixture = Fixture::new();
        let users = std::fs::read(fixture.0.join(".sandbox-secrets/sandbox_users.json")).unwrap();
        let reads = std::cell::Cell::new(0);
        let reason = validate_launch_with(
            &fixture.0,
            &serde_json::json!({"windows":{"sandbox":"elevated"}}),
            true,
            None,
            Some(false),
            &HashMap::new(),
            |_| {
                reads.set(reads.get() + 1);
                Ok(Some(0))
            },
        )
        .unwrap_err();
        assert_eq!(reads.get(), 2);
        assert!(reason.contains("automatically repair sandbox credentials"));
        assert!(reason.contains("Manual setup alone cannot unlock elevated Mono turns"));
        assert_eq!(
            std::fs::read(fixture.0.join(".sandbox-secrets/sandbox_users.json")).unwrap(),
            users
        );
        let payload: serde_json::Value =
            serde_json::from_str(&blocked(&fixture.0, reason.clone())).unwrap();
        assert_eq!(payload["sandbox"], true);
        assert_eq!(payload["reason"], reason);
        assert!(payload["setupCommand"]
            .as_str()
            .unwrap()
            .contains("-P :workspace -C"));
    }
    #[test]
    fn production_launch_gate_preserves_effective_unelevated_none_and_full_access_controls() {
        let home = std::env::temp_dir().join(format!(
            "monocode-cc6g-launch-controls-{}",
            uuid::Uuid::new_v4()
        ));
        for (config, required, engine) in [
            (
                serde_json::json!({"windows":{"sandbox":"elevated"}}),
                true,
                Some("unelevated"),
            ),
            (
                serde_json::json!({"windows":{"sandbox":"unelevated"}}),
                true,
                None,
            ),
            (serde_json::json!({}), true, None),
            (
                serde_json::json!({"windows":{"sandbox":"elevated"}}),
                false,
                None,
            ),
            (
                serde_json::json!({"windows":{"sandbox":"unelevated"}}),
                false,
                Some("elevated"),
            ),
        ] {
            validate_launch_with(
                &home,
                &config,
                required,
                engine,
                Some(false),
                &HashMap::new(),
                |_| panic!("launch controls must not query accounts"),
            )
            .unwrap();
        }
        assert!(!home.exists());
    }
    #[test]
    fn explicit_elevated_engine_overrides_unelevated_configuration_and_stays_blocked() {
        let fixture = Fixture::new();
        let reason = validate_launch_with(
            &fixture.0,
            &serde_json::json!({"windows":{"sandbox":"unelevated"}}),
            true,
            Some("elevated"),
            Some(false),
            &HashMap::new(),
            |_| Ok(Some(0)),
        )
        .unwrap_err();
        assert!(reason.contains("automatically repair sandbox credentials"));
    }
    #[test]
    fn missing_machine_account_blocks_before_setup() {
        assert!(Fixture::new()
            .check(&HashMap::new(), None)
            .unwrap_err()
            .contains("is missing"));
    }
    #[test]
    fn disabled_machine_account_blocks_before_setup() {
        assert!(Fixture::new()
            .check(&HashMap::new(), Some(UF_ACCOUNTDISABLE))
            .unwrap_err()
            .contains("is disabled"));
    }
    #[test]
    fn expired_machine_account_blocks_before_setup() {
        assert!(Fixture::new()
            .check(&HashMap::new(), Some(UF_PASSWORD_EXPIRED))
            .unwrap_err()
            .contains("expired password"));
    }
    #[test]
    fn offline_proxy_port_drift_blocks_before_setup() {
        assert!(Fixture::new()
            .check(
                &HashMap::from([("CODEX_WINDOWS_SANDBOX_PROXY_PORTS".into(), "8080".into())]),
                Some(0)
            )
            .unwrap_err()
            .contains("desired_ports=[8080]"));
    }
    #[test]
    fn offline_binding_drift_blocks_before_setup() {
        assert!(Fixture::new()
            .check(
                &HashMap::from([("CODEX_NETWORK_ALLOW_LOCAL_BINDING".into(), "1".into())]),
                Some(0)
            )
            .unwrap_err()
            .contains("desired_allow_local_binding=true"));
    }
    #[test]
    fn read_only_unelevated_launch_needs_no_elevated_artifacts() {
        let home = std::env::temp_dir().join(format!(
            "monocode-cc6g-no-artifacts-{}",
            uuid::Uuid::new_v4()
        ));
        validate_with(
            &home,
            &serde_json::json!({"windows":{"sandbox":"elevated"}}),
            true,
            Some("unelevated"),
            Some(false),
            &HashMap::new(),
            |_| panic!("unelevated launch must not query machine accounts"),
        )
        .unwrap();
        #[cfg(windows)]
        validate(&home, &home, true, Some("unelevated"), Some(false), None).unwrap();
        assert!(!home.exists());
    }
    #[test]
    fn full_access_bypasses_and_restricted_policies_keep_readiness() {
        let home = std::env::temp_dir().join(format!(
            "monocode-cc6g-full-access-{}",
            uuid::Uuid::new_v4()
        ));
        let config = serde_json::json!({"windows":{"sandbox":"elevated"}});
        validate_with(
            &home,
            &config,
            false,
            None,
            Some(true),
            &HashMap::new(),
            |_| panic!("full access must not query machine accounts"),
        )
        .unwrap();
        #[cfg(windows)]
        validate(&home, &home, false, None, Some(true), None).unwrap();
        for network in [false, true] {
            assert!(validate_with(
                &home,
                &config,
                true,
                None,
                Some(network),
                &HashMap::new(),
                |_| Ok(Some(0))
            )
            .is_err());
        }
        assert!(!home.exists());
    }
    #[test]
    fn online_identity_ignores_offline_drift_and_binding_ignores_port_drift() {
        let fixture = Fixture::new();
        let env = HashMap::from([("CODEX_WINDOWS_SANDBOX_PROXY_PORTS".into(), "8080".into())]);
        let config = serde_json::json!({"windows":{"sandbox":"elevated"}});
        validate_with(&fixture.0, &config, true, None, Some(true), &env, |_| {
            Ok(Some(0))
        })
        .unwrap();
        std::fs::write(fixture.0.join(".sandbox/setup_marker.json"), br#"{"version":5,"offline_username":"CodexSandboxOffline","online_username":"CodexSandboxOnline","allow_local_binding":true}"#).unwrap();
        let mut env = env;
        env.insert("CODEX_NETWORK_ALLOW_LOCAL_BINDING".into(), "1".into());
        fixture.check(&env, Some(0)).unwrap();
    }
    #[test]
    fn loopback_proxy_ports_follow_codex_sort_dedup_and_url_rules() {
        let env = HashMap::from([
            (
                "HTTP_PROXY".into(),
                "http://user:pass@LOCALHOST:8080/path".into(),
            ),
            ("HTTPS_PROXY".into(), "http://[::1]:9090".into()),
            ("ALL_PROXY".into(), "http://external.example:1234".into()),
            (
                "CODEX_WINDOWS_SANDBOX_PROXY_PORTS".into(),
                "9090, 123, 0, invalid,65536".into(),
            ),
        ]);
        assert_eq!(proxy_ports(&env), vec![123, 8080, 9090]);
    }
    #[test]
    fn account_lookup_errors_block_instead_of_assuming_readiness() {
        let fixture = Fixture::new();
        let error = validate_with(
            &fixture.0,
            &serde_json::json!({"windows":{"sandbox":"elevated"}}),
            true,
            None,
            Some(false),
            &HashMap::new(),
            |_| Err("Windows error 5".into()),
        )
        .unwrap_err();
        assert!(error.contains("Could not verify sandbox account"));
    }
    #[test]
    fn effective_config_and_legacy_engine_select_the_guard() {
        let fixture = Fixture::new();
        let env = HashMap::new();
        let flags = |_: &str| Ok(Some(0));
        let config = serde_json::json!({"features":{"elevated_windows_sandbox":true},"shell_environment_policy":{"set":{"CODEX_WINDOWS_SANDBOX_PROXY_PORTS":"8080"}}});
        assert!(
            validate_with(&fixture.0, &config, true, None, Some(false), &env, flags)
                .unwrap_err()
                .contains("desired_ports=[8080]")
        );
        validate_with(
            &fixture.0,
            &config,
            true,
            Some("unelevated"),
            Some(false),
            &env,
            flags,
        )
        .unwrap();
        let config =
            serde_json::json!({"windows":{"sandbox":"elevated"},"features":{"network_proxy":true}});
        assert!(
            validate_with(&fixture.0, &config, true, None, Some(true), &env, flags)
                .unwrap_err()
                .contains("runtime listener ports")
        );
    }
    #[test]
    fn unsupported_legacy_profile_blocks_before_launch() {
        let home =
            std::env::temp_dir().join(format!("monocode-cc6g-profile-{}", uuid::Uuid::new_v4()));
        let config = serde_json::json!({"profile":"review","windows":{"sandbox":"elevated"},"profiles":{"review":{"windows":{"sandbox":"unelevated"}}}});
        assert!(validate_with(
            &home,
            &config,
            true,
            None,
            Some(false),
            &HashMap::new(),
            |_| panic!("unsupported profiles must not read accounts"),
        )
        .unwrap_err()
        .contains("Legacy 'profile' configuration is unsupported"));
        let config = serde_json::json!({"profile":"review","windows":{"sandbox":"unelevated"},"profiles":{"review":{"windows":{"sandbox":"elevated"}}}});
        assert!(validate_with(
            &home,
            &config,
            true,
            None,
            Some(false),
            &HashMap::new(),
            |_| Ok(Some(0))
        )
        .unwrap_err()
        .contains("Legacy 'profile' configuration is unsupported"));
        assert!(!home.exists());
    }
    #[test]
    fn changing_account_state_is_checked_on_every_turn() {
        let fixture = Fixture::new();
        fixture.check(&HashMap::new(), Some(0)).unwrap();
        assert!(fixture
            .check(&HashMap::new(), Some(UF_ACCOUNTDISABLE))
            .unwrap_err()
            .contains("is disabled"));
    }
    #[test]
    fn environment_filters_cannot_pass_with_unproven_proxy_settings() {
        let fixture = Fixture::new();
        let env = HashMap::from([("HTTP_PROXY".into(), "http://localhost:8080".into())]);
        let config = serde_json::json!({"windows":{"sandbox":"elevated"},"shell_environment_policy":{"inherit":"none"}});
        validate_with(&fixture.0, &config, true, None, Some(false), &env, |_| {
            Ok(Some(0))
        })
        .unwrap();
        let config = serde_json::json!({"windows":{"sandbox":"elevated"},"shell_environment_policy":{"exclude":["HTTP_*"]}});
        assert!(
            validate_with(&fixture.0, &config, true, None, Some(false), &env, |_| Ok(
                Some(0)
            ))
            .unwrap_err()
            .contains("environment filters")
        );
    }
    #[cfg(windows)]
    #[test]
    fn native_account_lookup_reads_a_missing_synthetic_account() {
        let username = format!("mc-cc6g-{}", &uuid::Uuid::new_v4().to_string()[..8]);
        assert_eq!(local_user_flags(&username).unwrap(), None);
    }
}
