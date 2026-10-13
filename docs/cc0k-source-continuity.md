# CC0K: Codex source/home continuity and recoverable archives

This builder changes only K1/K2 on integrated base `551fc02acfb7f53cf8e52c67281c7f73f1b124f9` (tree `85fd2bf4d088905cdf2d2107b7dcfbdaaaafc5b6`). Coordinator integration, Claude's focused recheck, preview, release and RG1 rebinding remain separate gates.

## Source/home continuity

The current launch source selects its original bound home, or the separate home explicitly confirmed for that canonical path and physical directory identity. Original ownership takes precedence, including over redundant separate choices left by CC0J. A source that already owns the original home never receives another empty home.

Each conversation retains `providerSessionIdByHome` in the existing session settings JSON. Preparation selects its current source's thread before migration/resume; App persistence records the outgoing thread and binds the incoming thread. Selection changes only the conversation being prepared/recovered. Other Monos keep their threads, homes and held messages. The queue, exact held intent and Mono transcript remain intact. Storage markers are removed from provider model settings on reload.

Unmapped legacy threads are restricted to the original home. Older/native callers that supply a thread without confirmed ownership cannot resume it in a foreign separate home. Provider preparation carries the expected home and uses the App-selected thread instead of a cached foreign resume. Queued provider-binding events carry home provenance and cannot stamp a previous home's ID onto the newly selected home.

Recreated sources require the explicit **Return to original home / re-attach source** action. It checks canonical path and physical identity, pins source/private directories, and takes exclusive managed context leases. Immutable, bounded, single-link receipts refer to the original binding's identity/fingerprint. The original binding, private rollouts and credential ownership records are preserved. Unknown/ambiguous/invalid ownership remains blocked. Permissions and held intent are not relaxed; source choices retain account/provider/generation, busy/preparing, remote and transport guards.

## Recoverable archive publication

Archive bytes are copied to a UUID-owned temporary file, validated and synced, then published through the existing identity/fingerprint-aware `RecordedEntry` helper without replacement. Deterministic rollout dedupe still reuses an identical archive. An unfamiliar partial canonical entry, foreign link or racing publication is preserved; retry publishes in a fresh owned directory. A killed copy leaves a non-authoritative temp rather than a corrupt deterministic archive.

The private-history path/fingerprint/identity checks and post-archive race recheck remain. No unknown archive/private rollout is removed or overwritten to make retry pass. Existing journal/recovery/authority rules and R1/R3/R4 remain in place.

## Evidence and limits

Evidence and coordinator reports: `C:/Users/nooro/AppData/Local/Temp/monocode-cc/cc0k/`. The clean-base input manifest and original expected-safe failures are retained. Native process drivers kill immediately after archive creation and after copy/before sync, then restart/retry migration, keep-private and resolve. The connected browser adapter calls actual storage and SQLite/Mono persistence commands in a synthetic, windowless Tauri host; provider transports remain synthetic.

Final frozen counts, implementation/final-doc pins, changed-path hashes and applicability are recorded in `REPORT.md`, `VALIDATION-READY.md` and `evidence/final-candidate-manifest.json` when final gates complete. The library-test executable needs a test-only Common Controls v6 activation manifest to call the native Tauri host on Windows; bootstrap before/after binary hashes are recorded independently of source pins.

No real profiles, credentials, Credential Manager, live providers/model turns, ACL/account operations, native preview, push/deploy or other worktrees are used. This is builder evidence, not release acceptance. Literal raw-prefix, routing experimental/default-off old-fixture, MP4/host failures and the cc0ir/cc0jr P3 ledgers remain held evidence; K1/K2 do not expand those fixes. Original/partial temp retention can accumulate; unknown state remains conservative. Windows test coverage does not establish power-loss durability or Unix concurrent-writer guarantees.
