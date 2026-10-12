# CC6G sandbox readiness and read-only Mono launches

CC6FR found that well-formed sandbox files did not prove readiness, Windows
read-only Mono arguments failed the native storage guard, and their explicit
unelevated engine incorrectly required elevated artifacts. CC6G checks the
effective engine and settings before restricted submission and retains the
existing filesystem permission policies.

## Changes

- The version-5 marker's offline proxy ports and local-binding setting must
  match Codex 0.162.1. Read-only `NetUserGetInfo` checks both recorded machine
  accounts for existence, disabled state and password expiration. Lookup
  errors block. The guard never creates accounts, removes the shared users
  file, refreshes ACLs or runs setup.
- Native preparation can check the selected instruction home; adapter launches
  defer readiness until the merged `config/read` result, before thread recovery and before
  each Mono turn, including warm servers and text helpers. Full-access Chat
  skips elevated readiness; Plan and workspace-write retain it.
- Windows read-only workers launch with `app-server` first, followed by the
  explicit unelevated override. The same override remains effective in
  thread configuration. A shared fixture connects the JavaScript builder
  regression to the actual native storage guard; executable validation is
  unchanged.
- CC4 displays **Codex sandbox needs setup**, its exact reason and an exact
  PowerShell setup command without an accordion. The user can check again,
  explicitly switch the account to unelevated with preserved configuration
  backups, or choose full access for the affected Mono. Read-only workers
  retain their restrictions, and Plan still requires sandbox readiness.
- Historical CC6G behavior: the explicit account switch pinned and updated
  both source and private configuration files through held Windows handles.
  CC6I superseded that writer. Current repair changes only the account's private
  Mono config and saves an independent, exact private backup. The source Codex
  config bytes and attributes remain unchanged, including when the private
  config is a read-only source hardlink. CC6J completes owned-claim cleanup and
  journal recovery without clearing shared attributes. Comments and other
  settings remain intact; failed actions resume no held turns. See
  [CC6I](cc6i-permission-fixes.md) and [CC6J](cc6j-readonly-repair.md).
- On Windows, the OS deletes hook staging allocations if the process dies
  before the journal owns recovery. Kills before and after journal creation
  are followed by two successful restarts and nested cleanup checks.
  Unfamiliar empty and nonempty staged files are preserved.

## Enforcing the hard contract in the installed runtime

The requested five readiness counterexamples are covered by committed
tests, together with an intact identity control and explicit unelevated
launches without elevated artifacts. This establishes the reviewed
`require_sandbox_account_with_setup` preflight decision, not a guarantee
that stock Codex will never provision later.

The tagged Codex source has another path: a credential-mismatch runner
failure invokes `refresh_logon_sandbox_creds`, which deletes the shared users
file and reaches automatic full setup. Account flags cannot establish that
saved DPAPI credentials still match the account password. `LogonUser` can
produce audits and lockout effects, so it was not used as a side-effect-free
probe. The inspected runtime has no configuration switch disabling this
repair path. Account or command-environment changes after preflight are
also outside a before-turn snapshot.

The production launch guard therefore holds **every effective elevated Mono
turn**, even when the pure readiness control passes. This follows the brief's
instruction to block whenever side-effect-free checks cannot establish safety.
Failed readiness checks retain their precise reasons; intact elevated state
receives an explanation of the automatic credential-repair path. Manual setup
alone cannot enable unattended elevated execution. The user can explicitly
choose unelevated for the account or full access for the Mono. Plan remains
restricted, including after a full-access choice. No new saved setting, silent
fallback, automatic setup or runtime patch was added.

No elevated runtime, real account credentials, ACLs, firewall, installed profile
or live model turn was exercised. The independent DX1 runtime ACL-refresh hang
remains separate; these preflight checks do not repair it. Allowing elevated
Mono launches again requires a Codex runtime that can prohibit automatic
provisioning throughout execution.

## Validation and evidence

Windows, Node 26.5.0 and `NODE_OPTIONS=--no-experimental-webstorage`:

| Check | Final result |
| --- | --- |
| Full `npx vitest run --maxWorkers=4` | 7,266 passed, 13 skipped, 0 failed; 604 passed files, 2 skipped |
| `npx tsc --noEmit` | Exit 0, no diagnostics |
| `npm run build` | Exit 0 |
| `cargo test ... codex_mono_store --lib` | 139 passed, 0 failed, 3 ignored, 619 filtered |
| `cargo test ... harness --lib` | 26 passed, 0 failed/ignored, 735 filtered |
| Chromium blocker pointer checks | 2 passed, 0 failed/skipped; desktop and 390px screenshots inspected |
| Provider/bridge focused checks | 265 passed, 0 failed/skipped, 5 files |
| Focused model/UI/App/CC4 checks | 80 passed, 0 failed/skipped, 4 files |

The web skips are existing Antigravity real-provider/soak tests. The native
ignored entries are existing subprocess/runtime entrypoints; passing crash
tests invoke their subprocess entrypoints. The five checked native modules
pass rustfmt; repo-wide formatting was omitted per COMMON.md's baseline.
Initial fixture, compiler and in-progress build failures are retained in
evidence and described in the report. No timeout or skip was increased.

Evidence root:
`C:/Users/nooro/AppData/Local/Temp/monocode-cc/cc6g/evidence/`.

Final receipts are `full-vitest-final.{log,json}` and its results JSON,
`tsc-merged.{log,json}`, `web-build-final.{log,json}`,
`native-storage-formatted.{log,json}`, `native-harness-formatted.{log,json}`
and `rustfmt-final.{log,json}`. Browser receipts, screenshots and cleanup
are under `sandbox-ui-browser/` and `sandbox-ui-cleanup.json`.

The retained source references are
`../cc6r/evidence/native/codex-source/codex-rs/windows-sandbox-rs/src/`:
`setup.rs:462-483`, `identity.rs:350-412`, `identity.rs:483-509`, and
`elevated_impl.rs:218-245`. The independent original observations are under
`../cc6fr/evidence/sandbox/`; DX1's diagnosis is in `../dx1/REPORT.md`.

These validation numbers and evidence describe the historical CC6G writer;
they do not validate the current Mono-private-only repair. Current repair never
updates the source/base account config or creates a source-directory backup.
No merge, push, deployment, automatic setup, account reset or automatic
access broadening was performed. Unix pre-journal SIGKILL cleanup and
operating-system power loss are unverified.
