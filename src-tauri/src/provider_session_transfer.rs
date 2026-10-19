//! Ordinary provider homes have no reviewed private-home transfer binding.
//! Keep the caller's handoff fallback; Mono Codex uses its guarded private store.

#[tauri::command(async)]
pub fn provider_session_transfer(
    provider: String,
    from_account_id: Option<String>,
    to_account_id: Option<String>,
    provider_session_id: String,
) -> Result<(), String> {
    refuse_unbound_transfer(&provider, from_account_id.as_deref(), to_account_id.as_deref(), &provider_session_id)
}

fn refuse_unbound_transfer(
    provider: &str,
    _from_account_id: Option<&str>,
    _to_account_id: Option<&str>,
    provider_session_id: &str,
) -> Result<(), String> {
    crate::codex_mono_store::validate_thread_id(provider_session_id)
        .map_err(|_| "Invalid provider session id".to_string())?;
    if !matches!(provider, "claude" | "codex") {
        return Err("Provider accounts are not supported for this provider".into());
    }
    // Account IDs cannot authorize writes to a home or identify its bound thread.
    Err("Native conversation transfer requires a reviewed private-home binding. Continue from a handoff instead.".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn refuses_default_named_and_equal_accounts_without_resolving_homes() {
        for provider in ["claude", "codex"] {
            for (from, to) in [(None, None), (Some("a"), None), (None, Some("b")), (Some("a"), Some("a")), (Some("a"), Some("b"))] {
                assert!(refuse_unbound_transfer(provider, from, to, "thread-1")
                    .unwrap_err().contains("private-home binding"));
            }
        }
    }

    #[test]
    fn refuses_invalid_ids_and_unsupported_providers() {
        assert_eq!(refuse_unbound_transfer("codex", None, None, "../escape").unwrap_err(), "Invalid provider session id");
        assert!(refuse_unbound_transfer("other", None, None, "thread-1").unwrap_err().contains("not supported"));
    }

    #[test]
    fn refused_transfer_preserves_newer_destination_and_source_bytes() {
        let root = std::env::temp_dir().join(format!("monocode-refused-transfer-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let source = root.join("source.jsonl");
        let destination = root.join("destination.jsonl");
        std::fs::write(&source, b"older source\n").unwrap();
        std::fs::write(&destination, b"newer destination\n").unwrap();
        assert!(refuse_unbound_transfer("codex", Some("a"), Some("b"), "thread-1").is_err());
        assert_eq!(std::fs::read(&source).unwrap(), b"older source\n");
        assert_eq!(std::fs::read(&destination).unwrap(), b"newer destination\n");
        std::fs::remove_dir_all(root).unwrap();
    }
}
