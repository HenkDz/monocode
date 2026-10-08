# Codex Mono storage links (upstream 0.10.0)

Local branch: `HenkDz/r25-codex-mono-storage`, based on `8f07a46f96feabf540f2e19f62df938071009220`. This patch does not authorize a push, merge, or deployment.

MonoCode 0.10.0 can reject a valid shared configuration entry when the selected Codex home's source is itself a link. For example, an Orca account's `AGENTS.md` points to the user's ordinary `.codex/AGENTS.md`; the Mono storage entry resolves to that same file, but the old check compares it with the unresolved account path. Every Manager retry fails before Codex starts and eventually asks the user for a decision.

The Windows fallback also removed arbitrary regular files before creating hardlinks. A local configuration conflict could therefore lose data. A source change needs to replace only an established link, while private sessions, configuration conflicts, and migration state remain intact.

## Patch

- Compare canonical source and destination paths, including Windows path prefixes, and use file identity for hardlinks.
- Serialize storage preparation and repair. Replace mismatched links safely and remove obsolete links when switching sources; remove directory links without walking their targets. Keep real conflicting entries and report the conflict. A detached former hardlink with only one remaining name is conservatively treated as a real file.
- Preserve and log existing real `config.toml` and `config.toml.bak` as private overrides. Credential-store selection reads the effective private configuration. Other real conflicts, including credentials, stop preparation and remain untouched.
- Stop automatic turn retries for storage failures. Show one `Codex storage needs repair` notice with a Repair action, retain the failed turn, and resume it only after successful repair.
- Expose the selected source home and its selection origin (provider account, `CODEX_HOME`, or the ordinary `.codex` home) in Mono Details and return the source after successful preparation.

## Reproduction

Use isolated temporary homes and an isolated application profile. Create a source `AGENTS.md` that links to another file, prepare the Mono store twice, then switch the source home and prepare again. Assert that the entry resolves to the new source and that both source targets, real conflicting files, private sessions, and migration state retain their bytes. On Windows, cover junctions and hardlinks as well as symbolic links. Never run a deployment request as a smoke test.

## Validation

Thirteen Windows native tests passed: resolved source chains, hardlink identity and replacement, atomic junction replacement and link-only removal, failed replacement preservation, stale link cleanup, real-file/directory preservation, private config overrides, private state isolation, and a two-source relink fixture. Three unrelated migration tests were deliberately excluded because they remove real marker files in fixture Codex storage. All fixture homes remain available for inspection.

Real, read-only Codex turns completed against the isolated native-prepared source-link fixture and after switching to a second source (`R25_STORAGE_OK`, successful turn completion, exit 0). The original Orca authentication file's hash remained unchanged. These provider checks use an empty working directory and remove inherited `ORCA_*` variables; they do not replay a deployment request.

The full frontend Vitest suite, `tsc --noEmit`, and `npm run build` passed with `NODE_OPTIONS=--no-experimental-webstorage` for Node 26/happy-dom. Existing bundler chunk warnings remain. Repository-wide `cargo fmt --check` reports formatting problems in unchanged files; the changed storage module passes its scoped formatter check.

An application rebuilt from this worktree ran an actual Manager turn in a separate profile under a synthetic user home, launched from an empty directory with inherited `ORCA_*` variables removed. With the explicit `CODEX_HOME` source containing a linked `AGENTS.md`, the native rollout completed with `R25_MANAGER_CODEX_HOME_OK`, without an unexpected-link error or decision escalation. Mono Details displayed the selected source home and `CODEX_HOME` origin. The user's running profile and dzdistro checkout were untouched.

The same isolated profile was then restarted with `CODEX_HOME` unset and a synthetic `USERPROFILE/.codex` containing a different linked source. Storage reported the `default` origin, `AGENTS.md` resolved to the new instructions file, and an actual Manager turn completed with `R25_MANAGER_CLEAN_ENV_OK`. Both Manager markers are confirmed in native saved rollouts; neither test operated on the real dzdistro project.

Final frontend snapshot: **5,695 tests, 5,682 passed, 13 skipped, zero failures**; TypeScript and the production build passed. The local Vitest JSON report is `C:/Users/nooro/AppData/Local/Temp/r25-storage-vitest-final.json`.

Repair retention, concurrent submission handling, the single notice, and its action were exercised by frontend tests and independently reviewed. An optional live failure-injection probe did not intercept any preparation calls, so it supplies no live Repair-action evidence. Owned preview processes were stopped; scratch homes were retained without recursive cleanup.

## R26 follow-up: file relinking and repair feedback

An existing `hooks.json.bak` hardlink could fail the junction-oriented Windows rename with OS error 123. File links now use `MoveFileExW` with replacement, while junctions retain their handle-based atomic rename. Replacement remains restricted to established links: lone files, source contents, private state, and real configuration overrides are preserved.

Preparation logs and skips optional-entry failures, including backups and caches, during both stale-link cleanup and sharing. Auth, secrets, runtime configuration, instructions, skills, and hooks failures still block with the failing entry. Each distinct storage error or private-configuration notice is logged once per application run.

Repair shows progress, then a dismissible success after retrying the retained turn. Its notice stays mounted while storage errors clear, and missing/busy conversations or a failed retry report an error instead of silent success. Failed-entry details can be copied using the existing clipboard integration.

Focused Windows tests cover hardlinked `hooks.json` and `hooks.json.bak` switching between separate source homes, a busy backup being skipped during replacement and cleanup, a busy hooks file blocking both operations, preservation of real optional conflicts and both source files, unchanged junction replacement, and log deduplication. Synthetic homes are retained for inspection; no real-file cleanup is performed.

R26 validation: **18 Windows native tests passed**; the same three unrelated migration tests remain excluded. The full frontend suite passed **5,685 tests, with 13 skipped and zero failures**; TypeScript and the production frontend build passed. Existing bundler warnings remain. Evidence summaries are `C:/Users/nooro/AppData/Local/Temp/r26-native-validation.txt` and `C:/Users/nooro/AppData/Local/Temp/r26-vitest-final.json`.

The final rebuilt native app passed the source-switch reproduction in an isolated empty working directory with a synthetic home and inherited `CODEX_HOME`/`ORCA_*` variables unset. A stale `hooks.json.bak` hardlink moved to the selected source, both original files retained their bytes, and the skills junction remained valid. The notice exercised real preparation IPC in the native webview: progress, exact critical hooks failure, Copy details, and success were observed. A real optional cache conflict stayed untouched and logged once across repeated preparations. Logs and inspected screenshots are retained under `C:/Users/nooro/AppData/Local/Temp/r26-native-preview-_inaj7eo/`. Preview processes were stopped. No credentials or live model turns were used; retained-turn retry is covered by frontend tests.

### R26 runtime follow-up

The existing user profile exposed a path-length-dependent junction failure: the counted UTF-16 filename buffer did not guarantee a trailing NUL for Win32's path conversion. Some allocations supplied padding by chance. Reserve the terminator explicitly while keeping `FileNameLength` exclusive of it. Direct Windows probes reproduced a stray-name rename with the original aligned buffer and successful replacement with the fixed buffer at all four alignments. All 19 focused native tests pass, including nested source junctions and backup hardlinks across those alignments; both source contents remain intact. Evidence is retained in `C:/Users/nooro/AppData/Local/Temp/r26-junction-followup-validation.txt`.

Storage repair and session loading are separate operations. The reported `thread not loaded` error was not reproduced by isolated migration probes on the two available Codex binaries. Add the exact RPC method to storage failures, retained-thread resume failures, and immediate turn-start rejections. Preserve the original deleted-thread classification and saved-context guard, and never treat an unloaded thread as deleted. The focused provider tests pass (105 tests), including rejection without a replacement thread or turn acceptance; request parameters and credentials are not logged.

The user-authorized same-profile restart preserves `.codex-global-state.json` as a real optional conflict; its SHA256 and single-link count remained unchanged. The profile database was backed up before relaunch and the old executable retained. No model turn was submitted by the verifier or coordinator; the new diagnostic prefix needs the user's next retry to identify the failing runtime RPC.

Final follow-up frontend checks: 532 test files, 5,688 passed, 13 skipped, zero failures; TypeScript and the production frontend build passed. The report is `C:/Users/nooro/AppData/Local/Temp/r26-vitest-followup.json`.

The diagnostic identified an initial `thread/read` rejection. Recover only when its raw error exactly names the requested UUID as unloaded: resume that same UUID, then reread once. Failed resume or reread stays blocked; no replacement thread or model turn is created. This preserves deleted-thread classification and exposes the actual failed RPC. Focused provider tests pass (109 tests); the full suite passes 5,692 tests with 13 skipped and zero failures, and TypeScript/build pass. Report: `C:/Users/nooro/AppData/Local/Temp/r26-vitest-coldread.json`.

Existing profile rollouts can remain in the previous source home after configuration links switch. A same-ID retry cannot find data absent from the selected source. The current repair plan is restricted to authoritative active Mono roster IDs and original native bytes, with no authentication copies, source moves/deletes, or replacement of differing private files. Account identity must be confirmed before transferring context between different logins.
