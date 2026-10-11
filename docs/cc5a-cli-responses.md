# CC5A: reliable Windows app CLI responses

Branch: `HenkDz/cc5a-cli-responses`, based on
`3e6354ee820db8d94f6dac5da87c3c8caebf8862`. Final commit and complete before/after
matrix are recorded in
`C:/Users/nooro/AppData/Local/Temp/monocode-cc/cc5a/REPORT.md`.

## What changed and why

Windows release agents receive the absolute path to `monocode-cli.exe`, a
console executable that calls the existing control client. The desktop
`monocode.exe` retains its GUI subsystem and normal startup. Debug builds
already use the console subsystem and retain their own executable identity.
The CLI uses the same parser, validation, authenticated localhost connection,
response limits and authorization checks as before.

The actual release GUI binary reproduced blank output with exit 0 under
PowerShell redirection, and error replies with shell exit 0. The synthetic
endpoint recorded the request and complete reply. A GUI-subsystem probe with
checked flush and parent-console attachment still lost redirected output.
This locates the failure at the shell/process capture boundary; it is not an
empty app reply. PowerShell classifies GUI executables as background processes
at the end of a pipeline. Its [native command implementation](https://raw.githubusercontent.com/PowerShell/PowerShell/master/src/System.Management.Automation/engine/NativeCommandProcessor.cs)
documents that behavior. Runtime console attachment cannot change the PE
subsystem that the shell inspected before launching the process.

Adding a console companion is therefore necessary for reliable direct calls,
redirection and exit status. It contains no desktop startup path. Cargo's
`default-run = "monocode"` retains the desktop entry point. Tauri [builds and
bundles Cargo binaries](https://raw.githubusercontent.com/tauri-apps/tauri/dev/crates/tauri-cli/src/interface/rust.rs)
and includes the companion beside the desktop automatically;
no custom build hook, resource map or second protocol is needed. The Windows
configuration is unchanged. Renamed release previews must keep their own
companion in the same directory; a missing companion produces an explicit
native path-resolution error rather than selecting another installation.

Every action now writes a single JSON line through a checked writer and flushes
before returning its exit code. Short writes are completed. Broken pipes,
failed flushes and detached/null Windows stdout return nonzero; diagnostics
retain the original request ID for calls whose outcome may be unknown. A
successful reply also includes its request ID without altering its result.
Invalid response envelopes are converted to normal client errors. Help and
version remain text and use the same checked writer.

Injected Windows executable paths use forward slashes, which work in
PowerShell, cmd and Git Bash. One exported native constant,
`CLI_SHELL_GUIDANCE`, explains the PowerShell call operator for quoted paths,
Git Bash syntax and the existing PowerShell 5.1 input-file alternative. No
`monoOrg.ts`, `monoFiles.ts`, provider capture or approval grammar changes are
included. Existing strict command approval and canonical executable identity
checks are retained, now bound to the injected companion.

## Unknown outcomes

The existing durable goal ledger persists its receipt and delivery outbox
before replying. The new regression deliberately discards the first receipt,
recreates the ledger from persisted state, retries the same request ID, and
asserts the original receipt, one goal, one queued delivery and one delivery
call. It uses the existing message-queue helper as the synthetic host adapter;
the inline App delivery bridge is not driven by a real model turn. No new
goal deduplication mechanism or automatic mutation retry is added. A lost
reply remains an unknown outcome: retain and reuse the same ID and arguments.

## Validation and rerun

Node 26 web checks used `NODE_OPTIONS=--no-experimental-webstorage`:

- Full Vitest confirmation: 545 files passed, 2 skipped; 5,967 tests passed,
  13 skipped, 0 failures (5,980 total).
- TypeScript and `npm run build`: exit 0.
- Native `cargo test --release --lib control_cli::tests`: 20 passed, 0 failed,
  615 filtered; includes five new output/path tests.
- Native `cargo test --release --lib control::tests`: 11 passed, 0 failed,
  624 filtered.
- Goal retry regression: 8 tests passed in its focused file; included in the
  full suite.
- Release shell matrix: before 198 passed, 90 failed, 40 blank responses with
  exit 0; after 288 passed, 0 failed, 0 blank responses with exit 0. Both the
  Cargo build and final Tauri packaging-profile companion passed all 288 cases.
- Actual Codex `exec_command` with `login:false`: 8 fixed checks passed. The
  old GUI binary produced an error receipt with tool exit 0 and a zero-byte
  redirected file despite one endpoint request and one complete reply.
- Broken release stdout pipe: exit 1, the original request ID in stderr,
  exactly one endpoint request. Shell runner exit propagation: 15/15 checks.
- Normal Tauri release build with the companion initially absent: exit 0;
  `cargo build --bins --features tauri/custom-protocol --release` rebuilt both
  binaries automatically (279.039 s including the web build).
- Isolated-identifier NSIS bundle: exit 0 (20.570 s); its generated installer
  script includes exactly one `monocode-cli.exe` beside the desktop executable.
- Final PE subsystem checks: desktop 2 (GUI), companion 3 (console).
- Touched Rust files pass `rustfmt --check`; `git diff --check` passes.

The first full Vitest run had one existing Composer timing failure (5,966
passed, 1 failed, 13 skipped). The test passed alone and the full confirmation
passed. The original failure is preserved in the evidence, without changing
the Composer test or implementation.

On Windows, build through the normal Tauri entry point and run the matrix:

```powershell
$env:NODE_OPTIONS = '--no-experimental-webstorage'
npx tauri build --no-bundle
python scripts/control-cli-shell-matrix.py --binary target/release/monocode-cli.exe --output "$env:TEMP/cc5a-matrix"
cargo test --release --lib control_cli::tests
cargo test --release --lib control::tests
```

The matrix requires PowerShell 7 at its standard Program Files location,
Windows PowerShell 5.1, cmd, Git Bash and Python. It uses a synthetic threaded
localhost endpoint, removes inherited `CODEX_HOME`, `ORCA_*` and `MONOCODE_*`
variables, and creates disposable homes. All invocation directories are
isolated. It covers direct calls, pipes, file redirection and spaced executable
paths; modern-shell inline JSON and file input; success, parse/auth/server
errors, help, a 2.1 MB response, malformed reply and empty reply. PowerShell 5.1
uses file input. `codex-ps7-equivalent` rows represent the verified harness
shell; separate evidence captures actual `exec_command` with `login:false`.
`--allow-failures` records a failing pre-fix binary without aborting the matrix.

Raw evidence is under
`C:/Users/nooro/AppData/Local/Temp/monocode-cc/cc5a/`: `matrix-before/`,
`matrix-after/`, `matrix-after-tauri/`, `actual-harness/`, `validation/`, `shell-scan.md`,
`matrix-exit-review.json` and `retry-safety-evidence.md`. The earliest matrix
used cmd `more`, which splits long lines, and an incorrect cmd pipeline exit
capture; `matrix-initial/` preserves it. The final matrix uses a byte-preserving
relay and a separate producer status receipt; only the corrected comparison
is acceptance evidence.

## Boundaries

No real app data, credentials, goals or model turns were used. No preview,
installer execution, push, merge, rebase or other-worktree changes were made.
Installer contents are validated from the generated NSIS script and package;
installed-app acceptance remains for the coordinator. Existing direct callers
of the GUI executable should use the companion path; PowerShell cannot obtain
reliable CLI capture or exit status from a GUI-subsystem process.
The local release artifacts use `com.monocode.cc5a.fixture`; they were built
for isolated validation. macOS/Linux native builds were not run.
