# CC0I storage consistency and recovery

Baseline: `ec1250de4f0abc0af781485ed581aa0cc81bff7d`, tree `660a3ffdea50073682a0edcfb8adb5b9321a54ac`. Implementation validation is complete enough to freeze source; final exact-pin native/web/process/browser gates are still pending. This document is not a SHIP verdict.

## Migration and recovery

Thread migration now takes the same storage lock as prepare, reconciles journals, and uses the existing journaled no-replace rollout publication. Identical retries preserve the destination inode. Divergent dependencies or descendants preserve the private thread and archive the incoming version inside the private home's conflict archive; the structured recovery result identifies both copies. The pending migration marker remains until the entire root/dependency/descendant/agent-edge copy succeeds. A late destination writer cannot be replaced by publication.

Legacy retention propagates the whole structured recovery envelope through clone verification and outer retention errors. The frontend continues to parse only the complete JSON payload after the storage prefix. Three original real termination points now expose Archive metadata and recover exact rollout bytes and original retained identity. Original unknown/tampered authority refusal, bounded whole-record parsing, journal identity, single-link and attribute safeguards remain.

## Source identity

Default desktop launch selects `~/.codex`; an Orca terminal may select its different `CODEX_HOME`. The private home is now bound to both the canonical resolved source path and directory identity. Normalized aliases reuse the binding. A different source stops before relinking or credential preparation and displays the original and selected source.

An existing unbound home requires explicit confirmation of its original account; legacy links alone are not accepted as ownership. Contexts inherit that verified private-home binding. A separately bound context cannot be retained or prepared under another source. New binding metadata is strict, bounded and published without replacement; malformed or unfamiliar records are preserved. There is no broad profile migration or automatic reassignment of private sessions.

## Credential lifecycle

`sync_auth` writes a source login only when nonempty account identities match; independently changed source credentials retain the newer-same-account safeguard. Opaque secrets do not write back without an account identity. The actual TOML document parser is used for the explicit keyring setting. File-store contexts no longer copy unused CLI keyring credentials solely because encrypted MCP files exist. Existing different-account, missing-source and unknown private credentials are preserved.

Managed servers/renderers share the actual `MonoCodexStore` Arc. The stdout and final-wait owners keep a context file lease until all references finish; canceled spawns keep the store through the child wait. Windows share modes also exclude other managed native processes. Final synchronization precedes release. Lease identity and complete contents are pinned; neither one drain callback nor an in-process count alone is advertised as inactivity.

Windows keyring read/delete is not conditional deletion. Automatic system retirement therefore declines uncertain cleanup. A bounded production path handles owned copies: strict immutable per-entry ownership records created before copying; a native retirement command and exported desktop bridge; exact source/context/ownership receipts; an exclusive inactive-context lease; and explicit confirmation in the existing storage settings. It clears only the recorded private namespace entries, including changed logins as stated in the confirmation. Source credentials, unowned/legacy namespaces and context/session/config files remain. Next use can copy credentials again. Partial failures preserve the receipt for refresh/retry. This is authorized namespace clearing, not a claim of keyring CAS or exclusion of independent Credential Manager writers.

## Private contexts and remedies

Context preparation chooses private config, instructions and overrides before any link operation. Repeated prepare leaves existing private targets/content in place. A different existing context target is preserved rather than removed temporarily. Explicit real private overrides keep their existing ownership and contents. Native readers outside the process lock exercise repeated preparation.

Explicit Elevated selections receive accurate guidance to change Sandbox engine in Permissions; ineffective private repair is withheld and no success receipt is posted before readiness. Held Plan/orchestrate/read-only messages do not offer Full access. Ordinary Full access checks native readiness before saving the Mono/session permission change, then resumes the held prompt once. Failed readiness leaves persisted modes unchanged and accepts no turn. Remote-host notices expose host guidance instead of local mutations; sandbox failures show their human reason.

## Implementation checks and evidence

Evidence root: `C:/Users/nooro/AppData/Local/Temp/monocode-cc/cc0i/evidence/`.

| Check | Current implementation result |
| --- | --- |
| Initial source/small callback/model probe | 12 passed / 0 failed; synthetic native/persistence adapters |
| Locked install | 428 packages; exit0; no source/lock drift |
| Focused App/model/notice/store/provider/Attention | 111 passed / 0 failed |
| Actual current full crate storage group | 189 passed / 0 failed / 5 child entrypoint ignores / 628 filtered |
| Owned lifecycle/namespace subset | 11 passed / 0 failed / 1 child ignore; synthetic credential backend, real file leases |
| Implementation TypeScript | Exit0 before the last local corrections; final rerun pending |

Every failed implementation attempt is retained: native4/4 and172/10 and187/1; focused102/1 and109/2. Correcting invalid rollout fixtures did not change safe expectations. The old held Plan test now asserts refusal before preparation and no persistence, preserving its restriction/retained-prompt intent. The original external literal READONLY assertion is unchanged; canonical normalization stays a separate control. No deadlines, retries or skips were relaxed. Native credential tests perform no real Credential Manager operations.

Final frozen-source validation, original A49/H11/39/legacy/literal/canonical controls, complete one-worker Vitest, tsc/build, Chromium/WebKit proof and current PNG inspection are required before reporting DONE. REPORT and VALIDATION-READY outside the checkout record the exact source/doc pins and final counts when available.

## Remaining limits

No live profile/model/credential/ACL/provisioning operation, push, deployment or native preview is part of this round. Unix runtime, OS power-loss durability and native WebView acceptance are not established. Independent credential writers are not excluded by managed context leases; explicit namespace scope and conservative automatic refusal make that limit visible.

Broad archive/context retention, hardlink-fallback archive growth including legacy login archives, unknown-authority guided recovery, first source `secrets` directory creation, sandbox setup through source junctions, inherited-engine label provenance, reserved Windows names and arbitrary readonly sqlite-home input remain separate P3 follow-ups. No context/data pruning was added. Coordinator integration and a fresh independent Claude STORAGE RE-REVIEW remain mandatory.
