# CC0K: Codex source/home continuity and recoverable archives

This builder changes only K1/K2 on integrated base `551fc02acfb7f53cf8e52c67281c7f73f1b124f9` (tree `85fd2bf4d088905cdf2d2107b7dcfbdaaaafc5b6`). Coordinator integration, Claude's focused recheck, preview, release and RG1 rebinding remain separate gates.

## Source/home continuity

The current launch source selects its original bound home, or the separate home explicitly confirmed for that canonical path and physical directory identity. Original ownership takes precedence, including over redundant separate choices left by CC0J. A source that already owns the original home never receives another empty home.

Each conversation retains `providerSessionIdByHome` in the existing session settings JSON. Preparation selects its current source's thread before migration/resume; App persistence records the outgoing thread and binds the incoming thread. Selection changes only the conversation being prepared/recovered. Other Monos keep their threads, homes and held messages. The queue, exact held intent and Mono transcript remain intact. Storage markers are removed from provider model settings on reload.

Unmapped legacy threads are restricted to the original home. Older/native callers that supply a thread without confirmed ownership cannot resume it in a foreign separate home. Provider preparation carries the expected home and uses the App-selected thread instead of a cached foreign resume. Queued provider-binding events carry home provenance and cannot stamp a previous home's ID onto the newly selected home.

An unreadable, unknown-format or oversized existing home-thread map is marked unresolved during hydration. Metadata saves and home selection refuse before publication rather than erasing opaque persisted bytes. The marker stays outside provider model settings. A narrow canonical Mono SQLite probe confirmed that native metadata upsert replaces these settings; its original failing expected-safe receipt is retained. Correction pins and refreshed web evidence are recorded in the external report/manifest.

Recreated sources require the explicit **Return to original home / re-attach source** action. It checks canonical path and physical identity, pins source/private directories, and takes exclusive managed context leases. Immutable, bounded, single-link receipts refer to the original binding's identity/fingerprint. The original binding, private rollouts and credential ownership records are preserved. Unknown/ambiguous/invalid ownership remains blocked. Permissions and held intent are not relaxed; source choices retain account/provider/generation, busy/preparing, remote and transport guards.

## Recoverable archive publication

Archive bytes are copied to a UUID-owned temporary file, validated and synced, then published through the existing identity/fingerprint-aware `RecordedEntry` helper without replacement. Deterministic rollout dedupe still reuses an identical archive. An unfamiliar partial canonical entry, foreign link or racing publication is preserved; retry publishes in a fresh owned directory. A killed copy leaves a non-authoritative temp rather than a corrupt deterministic archive.

The private-history path/fingerprint/identity checks and post-archive race recheck remain. No unknown archive/private rollout is removed or overwritten to make retry pass. Existing journal/recovery/authority rules and R1/R3/R4 remain in place.

## Evidence and limits

Evidence and coordinator reports: `C:/Users/nooro/AppData/Local/Temp/monocode-cc/cc0k/`. Clean base/input manifests and original expected-safe failures remain retained. Initial implementation `18fd3f1657ea40db060138b6613d7082c4200327`, tree `ce44fd3964b22c3835459bb3c541744ccc56a67d`, received native and full web/connected checks. A subsequent narrow canonical Mono persistence probe confirmed that metadata upsert erased malformed/unknown maps. That raw failure and the first correction's fingerprint failure remain recorded.

Final correction was frozen at `8d9ddc1fb6ff4376318d38c90f94a1308d2b4363`, tree `bd82e5f1f98873c3a4dcb97059def4a3a22f69ba`, before refreshed affected gates. Metadata writes/sanitization and home selection refuse unresolved maps, while pure fingerprints remain readable. No native source/config/Cargo bytes changed; native gates retain their initial execution pins with explicit input equivalence. Fresh web/connected evidence binds final correction. This final doc-only child changes no executable input; exact final-doc pin/tree and all 25 changed-path hashes are in external `REPORT.md`, `VALIDATION-READY.md` and `evidence/final-candidate-manifest.json`.

| Applicable gate | Actual source pin | Result |
| --- | --- | --- |
| Native Codex storage | 18fd3f1 | 202 passed, 0 failed, 6 ignored |
| Native harness | 18fd3f1 | 26 passed, 0 failed |
| Native Mono | 18fd3f1 | 229 passed, 0 failed, 6 ignored |
| Native session persistence | 18fd3f1 | 62 passed, 0 failed |
| TypeScript | 8d9ddc1 | Exit 0 |
| Full one-worker Vitest | 8d9ddc1 | 8450 passed, 0 failed, 13 skipped |
| Routing-false build | 8d9ddc1 | Exit 0 |
| Chromium and WebKit connected recovery | 8d9ddc1 | 14 passed flows, 30 inspected PNGs, 332 native calls |
| Canonical Mono opaque-map persistence | 8d9ddc1 | 4 preserved, 3 save refusals, 1 valid save, 17 native calls |

The final connected browser proof invokes 134 actual `mono_session_upsert` writes and 12 `mono_session_get` loads. Both launch orders, two Monos plus an unrelated account, reload, recreated original/separate sources and migration kill/restart are covered. Twenty-two expected native refusals retain legacy/expected-home safety. The earlier regular-session fixture has narrower applicability and is not Mono-persistence proof. All 112 newly captured PNGs across retained runs were inspected.

Six distinct native kill cases exercise migration, keep-private and resolve at both archive checkpoints, running in both storage and Mono families. Twelve retained native kills plus two latest connected copy kills form the 14-kill current applicable set, all reaped/recovered. Two initial authoritative browser kills remain separately retained (16 actual executions across those authoritative runs). Numeric source/private identities and PIDs stay in original receipts. Captured successful Mono stdout was not rerun for printing. No assertions, skips or deadlines were weakened; failed and intentionally cancelled attempts remain recorded.

The library-test executable needs a test-only Common Controls v6 activation manifest for the windowless Tauri host; before/after binary hashes are recorded separately from source pins. The browser exercises actual Notice, extracted App callbacks, prepare bridge and native command functions through mocked IPC and a synthetic AppHandle. Provider transport and rollout markers remain synthetic. This does not establish native WebView/IPC, real provider transport or live acceptance.

No real profiles, credentials, Credential Manager, model turns, ACL/account operations, native preview, push/deploy or other worktrees were used. Builder DONE is separate from Claude focused clearance/coordinator integration/release acceptance. Literal raw-prefix, routing experimental/default-off old fixtures, MP4/host failures and cc0ir/cc0jr P3 ledgers remain held. Historical unchanged-helper matrices retain original pins. Unknown temp/partial/choice receipt retention can accumulate; opaque thread maps conservatively refuse saves until explicit repair. Reattachment preserves old credential ownership bytes; source-identity-sensitive listing/retirement stays conservative. Windows tests do not establish power-loss durability, Unix concurrent-writer guarantees or separate long-path-consumer acceptance.
