# CC8W: narrow Mono working folders

Branch: `HenkDz/cc8w-mono-workdir`, based on `b94219ab8cadfd066c64beca20d0f00f0a2665b0`.
Integration and publication remain coordinator-owned.

DX1 found that every Mono chat started in the whole user profile. That made
the default shell workspace unnecessarily large and contributed to the scope
of Codex's elevated Windows sandbox ACL refresh. New chats now use these
defaults, while existing home-folder chats migrate at their next turn:

| Conversation | Default working folder |
| --- | --- |
| Grand Orch | `<appData>/monos/<id>/workspace`, even with assigned projects |
| Manager | Its retained `managerProject`, otherwise its first assigned project |
| Member or ordinary Mono with a project | Its first assigned project |
| Any project-less Mono | Its own scratch workspace |
| Task worker | Existing project root or assigned `worktreeCwd` |

Home assignments are excluded from defaults. Existing valid project/custom
folders stay unchanged. A legacy home cwd is recognized using the existing
Windows-aware path comparison, including slash/case/trailing-slash variants,
`~` and empty legacy cwd values.

## Saved conversations and restart recovery

Opening a saved chat does not rewrite its folder. Submission checks existing
storage blockers first, then prepares its folder before storage preparation,
Manager startup, context rotation or provider execution. Migration changes
only the default cwd; an assigned worktree stays attached. Details offers a
native folder picker shared by all roles. Explicit folder changes clear old
worktree metadata, keep the conversation, reject the home folder and wait for
the current turn to finish.

The existing serialized App session writer persists the folder using the
latest profile/transcript state and checks that the original cwd is still
current and idle. A failed save leaves the conversation's published folder
unchanged. Duplicate preparation is rejected; cancellation, preparation
failure and downstream rejection retain interactive input as a draft.

Before saving a changed folder, its old native provider ID is recorded in a
per-session localStorage key. Separate keys avoid read/modify/write races
between app windows. The record survives a crash or restart between saving
the cwd and relocating native context. It matches only the original native
ID and is cleared after a provider accepts a turn, or after an explicit chat
reset deletes that conversation. A marker write failure stops the folder
transaction. A marker left after a failed save conservatively retains the
old context for the next attempt.

CC1 standing and organization receipts are invalidated after a successful
save and are recorded again only on acceptance. Codex's instruction-home
signature also includes cwd. CC5-E rotation retains the new cwd and existing
worktree through its existing session spread. CC6 continues to receive the
effective folder as `prepareMonoCodexStore(..., { projectPath })`; the new
preflight ensures it receives the migrated folder before preparing a home.

## Provider continuation

All eleven harnesses are covered by the adapter changes or existing Codex
resume override. The Mono exception requires the same provider account;
ordinary conversation folder changes keep their existing behavior.

| Provider | Saved native context after relocation |
| --- | --- |
| Codex | `thread/resume` with new cwd, same native ID; private history and instruction-home preparation remain intact |
| Claude | Same native ID through `--resume` from the new launch cwd |
| Cursor, Hermes, Devin, Grok, FX | Saved ID through cwd-bearing `session/load` |
| Antigravity | Cwd-bearing `session/resume`, retaining its existing load fallback |
| Pi, OMP | Explicit `--fork <UUID>` copies full native history into the new cwd and binds a new native ID |
| OpenCode v2 | In-place move, followed by a GET confirming the requested directory |
| Compatible OpenCode v1 | Full-history fork, followed by a GET confirming the requested directory |

Pi's ordinary global UUID resume can ask an interactive fork question; OMP's
ordinary global resume can change back to the saved cwd. Explicit forks avoid
both behaviors and preserve their source conversations. Some OpenCode v1
versions, including the inspected v1.15.12 routing, force a fork into the
source directory. That case stops with an update/retry error, retains the
original conversation and removes only the throwaway fork. Failed Mono
relocation never substitutes an empty provider session.

These are source and mock-transport proofs. Installed-provider execution,
native directory-switch acceptance and full-history preservation on every
provider version have not been independently exercised live.

## Scratch creation and project access

`mono_workspace_ensure({ id })` creates directory components under the trusted
Tauri app-data path using the existing Mono ID validator and file mutex. It
rejects files, symlinks and Windows reparse points at the controlled app-data,
monos, ID and workspace components. It preserves existing scratch contents
and does not seed or overwrite soul, memory, topics or habits. The frontend
loads Mono files first so legacy identity-folder adoption happens before the
scratch directory creates the Mono folder. Scratch is a child directory,
separate from `SOUL.md`, `MEMORY.md` and `memory/`.

The App CLI authorizes project operations using the Mono's project assignments
and explicit project paths, independently of its shell cwd. Existing tests
cover a Mono chat outside its assigned project. This covers project metadata,
sessions and worktrees; the CLI does not expose a generic source-file reader.

Pinned Codex 0.162.1 source gives legacy read-only/workspace-write policies
logical full-disk read access. Its Windows elevated implementation gathers
platform paths, ordinary profile children, cwd and explicit permission roots.
Moving to scratch retains the ordinary profile-child read grants. Actual ACL
access to external-drive projects such as `E:/Projects` was not established
with either the old home cwd or the new one. No approval, sandbox, network or
writable-root policy was broadened. Exact source references and downloaded
source hashes are in `evidence/native/READABLE_ROOTS.md`.

## Validation and evidence

Windows, Node `v26.5.0`, with process-local
`NODE_OPTIONS=--no-experimental-webstorage`:

- Final full Vitest: **7,367 passed, 13 skipped, 0 failed**, **609 passed and
  2 skipped files**, **117.85 s**, no unhandled errors; `--maxWorkers=4`.
- Final storage/migration/submission/provider regression group: **79 passed,
  0 failed/skipped**, 5 files, **2.05 s**.
- `npx tsc --noEmit`: **exit 0**, no diagnostics, **22.36 s**.
- `npm run build`: **exit 0**, **49.14 s** overall; Vite **26.96 s**, 3,709
  modules. It reports two CSS highlight optimizer warnings, the mixed
  static/dynamic `mono.ts` import warning and the large-chunk warning.
- Focused Rust `cargo test --lib mono::tests:: -- --nocapture`: **9 passed,
  0 failed/ignored, 730 filtered out**; **9.48 s** compile, **0.04 s** tests.
- Touched `mono.rs` formatting and `git diff --check` passed. No dependencies
  or native database schema were added.

The original skipped provider files are `antigravityReal.test.ts` (3 tests)
and `antigravitySoak.test.ts` (10 tests). No skip or timeout was added.

An earlier full run had 7,365 passed, 2 failed, 13 skipped and one unhandled
rejection in the existing storage-repair VM fixture. The fixture was missing
the new preparation phase. It now explicitly exercises the downstream
storage guards; the new preparation phase has separate App-source tests.
Initial Details selectors and a writer-call type error were also corrected.
All intermediate failures remain in the evidence directory.

Evidence root:
`C:/Users/nooro/AppData/Local/Temp/monocode-cc/cc8w/evidence/`.

- `final2-full.log`, `final2-full-results.json`, `final2-full-summary.json`:
  final suite, unchanged skips and the 93-test root behavior group.
- `final2-tsc.*`, `final2-build.*`: final typecheck and production build.
- `final2-focused.*`, `preflight-expanded.*`, `provider-final.*`:
  focused regression runs, including saved/live/parked, account and restart cases.
- `native/cargo-mono-tests.log`, `native/READABLE_ROOTS.md`, source manifests:
  scratch safety, App CLI authorization and readable-root/source evidence.
- `final-full.*`, `focused.*`, `tsc.*`, npm install receipts: preserved earlier
  failures and dependency setup/recovery evidence.

## Limits and deliberately omitted work

No native preview or live model turn was launched. Isolating an app identifier
alone does not isolate installed Codex's Windows Known Folder/sandbox identity;
a restricted probe could refresh real-account ACLs. The optional restricted
`echo hi` acceptance remains unproven, and DX1's environmental sandbox failures
may remain. No user account/configuration, sandbox identity or ACL was repaired.

The change adds no eager startup migration, project/home file move, automatic
scratch cleanup, sandbox fallback, permission escalation, dependency, task
routing feature or sidebar/Cockpit change. Other worktrees, the coordinator's
board, push and merge were left alone.
