# CC0I storage consistency and recovery

Baseline: `ec1250de4f0abc0af781485ed581aa0cc81bff7d`, tree `660a3ffdea50073682a0edcfb8adb5b9321a54ac`. Final application source: `b88ff5c80a3a720b868333a5c9c0c243d0280e2c`, tree `ad7a57c1ef55850a9fff1ac692fa318dfd52da15`. Native executions retain their original `3fb6a4857e83c518acc8b3d0b3007a44319745a2` pin; all 113 native inputs match the final source. This documentation update changes no application or test input. Coordinator integration, current native families and independent Claude re-review remain separate gates; this is not a SHIP verdict.

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

The completed sandbox category stays visible while its success receipt is shown, even when App clears the blocker first. Browser attempt02 exposed this actual notice defect; its unchanged five-second assertion is retained and passes after the source correction and regression test.

## Validation and evidence

Evidence root: `C:/Users/nooro/AppData/Local/Temp/monocode-cc/cc0i/evidence/`.

| Check | Executed result and pin |
| --- | --- |
| Initial source/small callback/model probe | 12 passed / 0 failed; synthetic native/persistence adapters |
| Locked install | 428 packages; exit0; no source/lock drift |
| Focused App/model/notice/store/provider/Attention | 111/0 before notice correction; focused notice34/0 afterward |
| Actual full crate storage group,3fb6a48 | 189 passed / 0 failed / 5 child entrypoint ignores / 628 filtered |
| Native harness / Mono / control,3fb6a48 | Broad harness26/0; narrower namespace21/0; Mono14/0; control11/0 |
| Owned lifecycle/namespace subset | 11/0/1 child ignore; synthetic credential backend, real Windows file leases |
| Original A probe,3fb6a48 native export | 11/0/1 entrypoint ignore;61 rows include original49 kill cases; all safe assertions pass |
| Original H11,3fb6a48 native export | 11/0:9 terminated cases plus2 resumed replacement controls |
| H39,3fb6a48 | Actual native suite/child checkpoints retained; separate0.594s aggregator validates39 fixtures plus2 publication and1 allocation control |
| Original literal / separate canonical / original legacy journal | Literal4 pass/1 known raw-prefix failure/1 child ignore; canonical5/0/1; legacy1/0 |
| Actual old ec1250d copy safety assertion | 0 pass/1 expected failure; newer private dependency turns were lost |
| Full one-worker Vitest,b88ff5c | 8302 passed / 0 failed /13 existing skips,627 test files |
| TypeScript / production build,b88ff5c | Both exit0;1936 inputs unchanged through each gate |
| Chromium/WebKit,b88ff5c UI | 68/0;56 wide/narrow dark/light PNGs inspected; native helper from3fb6a48 with unchanged native hashes |

Every failed implementation attempt is retained: native4/4 and172/10 and187/1; focused102/1 and109/2. Correcting invalid rollout fixtures did not change safe expectations. The old held Plan test now asserts refusal before preparation and no persistence, preserving its restriction/retained-prompt intent. The original external literal READONLY assertion is unchanged; canonical normalization stays a separate control. No deadlines, retries or skips were relaxed. Native credential tests perform no real Credential Manager operations.

Historical full frontend results8301/0/13 and tsc/build0 at3fb6a48 remain historical. Browser01 failed before UI on a canonical receipt-path fixture mismatch; browser02 failed an actual UI success-category assertion; browser03 failed an actual UI success assertion because its synthetic legacy fixture also contained an unowned config. Browser04 initializes that fixture through native prepare before injecting the original kill point. Assertions and deadlines are unchanged; every failed receipt/log and the02/03 PNG/driver inventories remain. A console-encoding exception after build01 is retained separately from its successful direct build receipt.

Browser04 runs the actual production components, storage model and App callback with isolated IPC/persistence adapters and full-crate native primitives. It exercises all three original legacy kill points in both engines, then the UI Archive action and prepare, checking original bytes, Windows attributes and retained file identity. It also exercises source confirmation/mismatch, explicit namespace confirmation/cancel/keyboard, and actual other-process lease refusal. Credentials are synthetic only. No browser console error or external request occurred. All owned servers/browsers/children were stopped.

External REPORT and VALIDATION-READY record final source/doc pins, commands and the closure ledger. `evidence/final-source-manifest.json` lists all23 changed paths, including both notice-correction paths. `native-applicability-and-browser-inputs.json` verifies historical native inputs, unchanged exported helpers/test modules and separate browser-driver changes. `final-web-summary.json` preserves the unchanged13 skip inventory. `browser/results.json` and `browser/inspection/` bind and inspect all56 PNGs. Native evidence is not relabeled as execution at the final UI head.

## Remaining limits

No live profile/model/credential/ACL/provisioning operation, push, deployment or native preview is part of this round. Unix runtime, OS power-loss durability and native WebView acceptance are not established. Independent credential writers are not excluded by managed context leases; explicit namespace scope and conservative automatic refusal make that limit visible.

Broad archive/context retention, hardlink-fallback archive growth including legacy login archives, unknown-authority guided recovery, first source `secrets` directory creation, sandbox setup through source junctions, inherited-engine label provenance, reserved Windows names and arbitrary readonly sqlite-home input remain separate P3 follow-ups. No context/data pruning was added. Coordinator integration and a fresh independent Claude STORAGE RE-REVIEW remain mandatory.
