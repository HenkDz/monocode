# CC6H: role permission defaults

New Grand Orchestrators and Managers use full access. New workers, including
Reviewers and anonymous task workers, use `auto`: Codex's on-request /
workspace-write policy with the existing Auto reviewer. Auto-accept edits
remains a compatible explicit choice; its user reviewer differs from Auto.
This implements the user's CC6H decision and integrates CC6G's readiness guard.

| Fresh role or task | Effective permission | Windows Mono engine |
| --- | --- | --- |
| Grand Orchestrator / Manager | Full access | Chat bypasses readiness; Plan stays restricted |
| Worker / Reviewer chat | Auto | Unelevated unless explicitly selected |
| Read-only task | Supervised plus read-only | Unelevated unless explicitly selected |
| Saved user or legacy choice | Retained | An explicit Mono engine always wins |

Existing conversations, explicit choices, permission locks and legacy roster
choices retain their permissions. Source-less legacy profiles retain their old
implicit defaults too. Details shows the effective mode with **Role default**
or **Set by you**, explains the role default and offers **Use role default**.
The user can select any existing mode again to reverse the reset. Reset clears
only the permission lock; model, soul and other locks remain intact. A Team
profile without a chat can reset directly; a saved chat opens its authoritative
permission controls.

## Resolution and persistence

`monoRolePermissions.ts` resolves role defaults and freezes worker permission
snapshots. Fresh profiles carry `runtimeModeSource: "role"`; an explicit choice
records `"user"` and locks permissions. Saved workers and prepared task
snapshots take precedence over later roster changes, including retries and
hydration. Anonymous workers no longer inherit full access from a coordinator.
Read-only tasks remain supervised and retain the independent read-only flag.
Automatic re-reviews retain prior Reviewer permissions instead of copying the
implementation's engine choice. Preparation rereads the resident choice after
awaited checkout work; a cancelled or replaced dispatch still cannot resurrect.

Mono roster parsing validates source, mode, engine and locks. Session storage
uses the existing private model-settings markers, strips them on hydration and
passes no internal markers to providers. Workspace stubs, chat resets, habits
and account clones preserve ownership and engine choices. No database migration
or global preferences change is needed. A role-owned conversation follows a
new role's default when a plain Mono becomes Grand; saved user and legacy modes
remain unchanged.

## Windows engine

Windows Mono Auto launches select `windows.sandbox="unelevated"` through the
existing private configuration and per-launch arguments. The argument order
stays `app-server -c windows.sandbox="unelevated"`, accepted by CC6G's native
storage guard. The engine is included in preparation identity, warm-server
reuse, effective configuration and every-turn readiness. No account config
write or automatic elevated setup is used. Ordinary Auto homes and non-Windows
behavior retain their existing policy; the existing ordinary read-only path
also stays unchanged.

An explicit Mono engine selection takes precedence, including for read-only
workers. Explicit elevated restricted turns still hit CC6G's blocker before
submission. Full-access Chat bypasses readiness; Plan and read-only execution
remain restricted. Text helpers retain their existing supervised permissions
and honor explicit engine choices. Engine changes wait for an idle chat,
restart its server, save successfully before updating the roster and show
save errors. Details displays the selected effective engine, Chat bypass, or
an explicitly unknown inherited account/project engine.

Rejected alternatives were rewriting the user's config, migrating every saved
agent, inheriting the coordinator's permission mode for anonymous workers,
using full access for read-only tasks, bypassing CC6G's elevated guard and
adding a new database schema. Source, UI, provider and native guard tests use
synthetic storage and fixtures.

The optional live checks used isolated direct stock Codex app-server transport,
not a native GUI preview. Exact Auto requests came from the production builders
and retained `auto_review`; effective unelevated over a synthetic elevated
baseline returned `hi`, exit 0. A full-access coordinator also returned `hi`,
exit 0. The retained Auto-accept edits control succeeded too. Each ran one tiny
shell command from an isolated CC8W-style scratch folder. Cleanup verification
confirms no owned Codex processes, no copied credentials, unchanged original
auth bytes, no app-server approval requests and no elevated setup artifacts.
This does not prove native App/WebView acceptance or OS-wide ACL/UAC behavior.

Unelevated network-isolation parity remains unverified. Elevated restricted
execution remains unavailable until a runtime can forbid automatic provisioning.
No installed-profile repair, merge into nour, push, deployment or shipping was
performed. Evidence is under
`C:/Users/nooro/AppData/Local/Temp/monocode-cc/cc6h/`; the final report records
the branch, commits, validation results and deliberately omitted checks.

## Validation

Windows, Node 26.5.0, Vitest 3.2.7; all web checks used process-local
`NODE_OPTIONS=--no-experimental-webstorage`. No timeout or skip was increased.

| Final check | Result |
| --- | --- |
| Full `npx vitest run --maxWorkers=4` | 7,504 passed, 13 skipped, 0 failed; 614 passed files, 2 skipped; 232.83 s |
| `npx tsc --noEmit` | Exit 0; 44.027 s |
| `npm run build` | Exit 0; 88.420 s; Vite 42.56 s |
| Actual `cargo test ... codex_mono_store --lib` | 140 passed, 0 failed, 3 ignored, 623 filtered |
| Actual `cargo test ... harness --lib` | 26 passed, 0 failed/ignored, 740 filtered |
| Provider/bridge focused suite | 285 passed, 0 failed/skipped; 5 files |
| Model/lifecycle/persistence focused suite | 211 passed, 0 failed/skipped; 8 files |
| Conversion/workspace/policy focused suite | 104 passed, 0 failed/skipped; 3 files |
| Permission UI focused suite | 46 passed, 0 failed/skipped; 5 files |
| Actual App callback regressions | 4 passed, 0 failed/skipped |
| Touched Rust formatting / Git whitespace | Exit 0; all changed files use LF |

The 13 skips are existing Antigravity real-provider and soak checks. Native
ignored entries are existing subprocess/runtime entrypoints; passing crash
tests invoke their subprocess entrypoints. Repo-wide formatting was omitted
per COMMON.md's existing baseline. Existing CSS, import-overlap and large-chunk
build warnings remain. Initial fixture/expectation/type errors were corrected;
earlier passing full runs were superseded after additional source corrections.

Final evidence: `evidence/full-vitest-final.{log,json}` and its results JSON,
`tsc-final-role-resolution.{log,json}`, `web-build-final-role-resolution.{log,json}`,
`native-engine-{storage,harness}.{log,json}`, `engine-rustfmt.{log,json}`,
`focused-engine-providers-final.{log,json}`, `ui-vitest-final.json`,
`focused-model-lifecycle-final.{log,json}` and `../model-focused.json` relative
to the evidence directory. Live proof and cleanup are in
`live-engine-verified.json`, `live-engine-verification-exact.{log,json}` and
`live-engine/*/{events,result}.json`; exact Auto's production requests are
retained alongside its events. Source and final commit manifests identify
the validated files. See CC6H REPORT.md for complete paths and earlier results.
