# DX1: Windows sandbox shell stalls

Restricted shell execution in the reported CC preview stalled inside Codex
0.162.1's elevated Windows sandbox setup, before a shell process or approval
request. The original copied sandbox log records both a sharing violation on
the shared `cua_node/cfb32733c877621e/bin/node_repl.exe` runtime and
`SetSecurityInfo failed: 5` ACL errors at the two shell attempts. Setup did not
finish during the captured incident window.

The Orchestrator Mono's working directory was `C:/Users/nooro`, even though
the preview launched from an empty folder. `ensureMonoSession` deliberately
uses `homeDir`, and assigning projects does not change that working directory.
The helper consequently refreshed write access across the whole profile. The
large refresh scope plausibly contributed to the wait; its exact contribution
to the duration was not measured.

The incident's actual policy was `OnRequest` / `WorkspaceWrite`. That matches
Auto or Auto-accept edits; Supervised maps to `UnlessTrusted` / `ReadOnly`.
The reported picker label therefore does not establish the incident's policy.
Fresh native Supervised testing rendered an Allow/Deny card and `Needs you`,
and the authorized echo succeeded after Allow. CC's prompt preparation, live
state, digests and member view did not remove this approval route.

Today's copied installed-desktop logs contain successful full-access shell
execution, but no successful restricted-policy comparison. PowerShell's
unsupported shell-snapshot warning also appears in successful sessions.
The native spawn implementation and thread/turn permission settings are
unchanged between pre-CC `de8edc3` and preview `1a7dd30`.

## Change

Code-mode `Script running with cell ID ...` responses previously marked the
outer tool completed. The Codex adapter now retains each running cell and
correlates subsequent `functions.wait` results with the original tool row.
Cell and call identities include thread and turn IDs; state is cleared at
turn start and settlement. Completed and failed results settle the original
row, and unknown waits cannot create a new row.
The authoritative `Script failed` header also marks a row failed when Codex
omits `is_error`; a failure header printed inside completed output does not.

When a yielded cell contains an `exec_command` call and has returned no output
for at least 60 seconds, its row and the shared live-state selector show
`Blocked · tool` with a reason and Stop/retry guidance. Elapsed time includes
the model's time between waits: the real incident waited 155.119 seconds but
its recorded host wait durations totaled only 54 seconds. New output resets
the warning; completion clears it. Pending approvals still show `Needs you`.

This is an informational warning evaluated on provider yields, not a command
timeout. A legitimately quiet build may trigger it. It neither cancels a
command nor changes its permissions. Shell detection uses the code text until
Codex exposes nested tool identity; generic JavaScript cells are not flagged.
There is no independent heartbeat for a provider that stops sending events.

The change stays in the Codex adapter and existing shared selector. It adds no
dependency, App.tsx edit, orchestration edit, sandbox fallback or permission
escalation. A per-Mono scratch working directory is a separate follow-up:
using the soul/memory directory would expose controlled identity files to
ordinary shell writes, and existing saved conversations need a migration plan.

## Remediation

1. Stop the affected turn. Let existing agent work finish, then close the
   Codex/MonoCode sessions that own the shared runtime and restart them.
   Eighteen existing `node_repl.exe` processes held the incident runtime at
   inspection; they were left running.
2. From a narrow project folder, run a model-free check with the installed CLI:
   `codex sandbox -P :workspace -C <project> -- powershell.exe -NoProfile -Command "echo hi"`.
   Inspect the selected account's `.sandbox/sandbox.YYYY-MM-DD.log` and
   `setup_error.json` if setup still fails. The incident log was
   `C:/Users/nooro/.codex/.sandbox/sandbox.2026-10-11.log`; its sanitized extract
   is retained in the evidence.
3. An optional temporary workaround is to set `[windows] sandbox = "unelevated"`
   in the selected account's configuration, then restart its app-server.
   Back up the configuration first and restore `elevated` after repair. An
   isolated on-request/workspace-write probe with this setting ran echo with
   exit 0 and no approval RPC. It retains restricted-token filesystem checks;
   its engine and security/network behavior differ from the elevated sandbox,
   and parity was not validated. Do not treat it as equivalent security or
   switch existing sessions automatically.
   A model-free temporary override also passed in the synthetic fixture:
   `codex sandbox -P :workspace -C <project> -c 'windows.sandbox="unelevated"' -- powershell.exe -NoProfile -Command "echo hi"`.

No real profile configuration, runtime, account or ACL was manually repaired.
Quiescing the user's existing agents and verifying elevated recovery remain
user follow-up work. Restricted reproduction can itself invoke the Windows
helper's ACL refresh; absence of system ACL side effects was not established.

## Validation

Windows, Node 26.5.0. All web commands use process-local
`NODE_OPTIONS=--no-experimental-webstorage`.

| Check | Result |
| --- | --- |
| Focused Codex protocol/live/approval tests | 3 files, 202 passed, 0 failed/skipped; 7.80 s |
| Full `npx vitest run --maxWorkers=4` | 573 files passed, 2 skipped; 6,565 tests passed, 13 skipped, 0 failed; 86.36 s |
| `npx tsc --noEmit` | Exit 0, no diagnostics; 14.94 s |
| `npm run build` | Exit 0; 34.24 s |
| Native baseline preview build | Release, no bundle, `com.monocode.dx1`; exact base `1a7dd30` |
| Native preview build before failure-header correction | Release, no bundle, `com.monocode.dx1`; exit 0; 208 s |
| Final native preview build | Source commit `35b88915`, release, no bundle, `com.monocode.dx1`; exit 0; 146.36 s |
| Pre-CC native build | Pinned `de8edc3`, release, no bundle, `com.monocode.dx1.base`; exit 0; 164.15 s verified repeat |
| Direct elevated workspace-write/on-request probe | Failed before process startup, `setup refresh had errors`; 12.125 s turn, 0 approval RPCs |
| Direct full-access/never probe | `hi`, exit 0; 134 ms command, 8.922 s turn |
| Direct unelevated workspace-write/on-request probe | `hi`, exit 0; 6.565 s command, 19.281 s turn |
| Native baseline Orchestrator Supervised probe | Approval card and `Needs you` visible; authorized Allow followed by `hi` |
| Native baseline Orchestrator full-access probe | Full returned result contains `hi`, exit 0; 5.410 s command |
| Native DX1 elevated Auto probe | Failed before shell startup: Temp ACL access denied; code host returns `Script failed` after 3.9 s |
| Native pre-CC elevated Auto probe | Same `helper_unknown_error: setup refresh had errors` before execution |
| Native pre-CC full-access probe | Full returned result contains `hi`, exit 0; 0.297 s command |
| Original incident replay through final mapper | First shell becomes blocked at 72.895 s; no duplicate wait rows; second shell remains pending |
| Model-free unelevated sandbox CLI self-check | `:workspace` recognized; `hi`, exit 0; 0.797 s |

The first unrestricted full-suite run had 6,560 passed / 2 failed / 13 skipped;
the second had 6,557 passed / 5 failed / 13 skipped. Failures were in unchanged
FileEditorCrlfGit, useQuickAttachments and WorktreePrActions tests. The initial
two failed files passed in isolation (17 tests), and every test passed in the
final four-worker full suite. No unrelated source, timeout or skip was changed.
Native code is unchanged, so no focused cargo test was required.

## Evidence

Evidence is under
`C:/Users/nooro/AppData/Local/Temp/monocode-cc/dx1/evidence/`:

- `LOG_DIAGNOSIS.md`, `log-comparison-sanitized.json`,
  `rollout-tool-timeline-sanitized.json`,
  `sandbox-incident-extract-sanitized.txt`,
  `sandbox-direct-probe-extract-sanitized.txt` and
  `sandbox-process-inventory-sanitized.json`.
- `appserver-probes/*/result.json` and sanitized native echo timelines/tool rows.
- `native-supervised-approval.png`, `native-supervised-result.png` and
  `native-fullaccess-result.png` show the isolated baseline preview.
- `native-final-elevated-result.png`, `native-precc-elevated-result.png`
  and `native-precc-fullaccess-result.png` show the built comparisons.
- `base-cc-launch-policy-comparison.json`, `base-native-build.json`,
  `raw-protocol-check.json`, `incident-replay.json`,
  `sandbox-remediation-selfcheck.json` and final check receipts/logs.
- `pre-cc-native-build.json` and `pre-cc-native-verify.log` bind the base binary
  to the archived source. The copied pre-CC target's standalone CLI is a stale
  CC cache artifact and was not used; pre-CC uses `monocode.exe` for CLI calls.
- Initial and second failed-suite receipts are retained alongside the final pass.

The first preview attempt reused existing browser state; it was stopped when
adding a project started Manager onboarding. Its saved rollout shows source
research, a synthetic team-plan artifact and three synthetic hires, with no
implementation delegation, source-file write or commit. Subsequent previews
explicitly use fresh `WEBVIEW2_USER_DATA_FOLDER`, synthetic USERPROFILE,
HOME, APPDATA and LOCALAPPDATA, and remove CODEX_HOME and every ORCA variable.
The source credential/configuration files are copied, never linked to the
user's profile. This first attempt is retained as a validation limitation.

Native GUI comparisons were performed before the final failure-header
correction. That correction is covered by two actual-output regression cases,
the final full suite and rebuilt native artifact; its GUI was not relaunched.
The exact final app SHA-256 is
`4AA288009B08120C82BFE498047D347BD9060FBD3ED1D25F9E00278EF2198069`;
the CLI SHA-256 is
`002B009B67258327CF3625BF3AEA6E9F7D7C7179BA514BAB9355B23350E384E9`.
