# CC6I: permission resets and private sandbox repair

CC6HR found that a legacy worker reset to Auto could still prepare a full-access
task worker, and that the sandbox repair action changed the source Codex account
config. CC6I closes both paths while retaining coordinator full access, worker
Auto, saved task permissions and the existing elevated execution blocker.

## Permission ownership

The Details permission picker and role reset now use `saveMonoRuntimeMode`, as
App's composer, floating and full-access recovery handlers already do. The saver
supersedes a pending legacy migration value, persists user/role ownership and
changes only the permission lock. Other locks and engine choices remain intact.

Fresh task preparation resolves a role-owned resident through current member
ownership instead of copying its stale runtime mode. Saved workers and task
snapshots still win; legacy/user-owned residents keep their existing behavior.
Read-only tasks still use supervised permissions and retain their engine.

The committed App regression ports CC6HR's real reset control, synthetic
localStorage, first-open path, actual App `createWorker` callback, submission
resolver and Codex request builder. Resetting the chatless legacy full-access
worker and immediately preparing a named worker now produces on-request /
workspace-write. A second model regression covers a stale role-owned resident.
Both failed before the implementation change: 26 passed, 2 failed, 0 skipped.

## Private sandbox repair

**Use unelevated sandbox for Monos** changes only the selected account's private
Mono base config. The native writer reads its original settings, stages an
independent file, archives one exact private backup and records the existing
`private_override`. Linked/hardlinked configs are detached before publishing;
existing private settings are retained. Subsequent storage preparation preserves
the override. The source account config is never written, backed up or given new
permissions, including when that source is the user's `~/.codex`.

The change reuses storage claims, file identities, fingerprints and recovery
journals. A failed backup or concurrent private replacement holds messages and
preserves the existing files. App retains the idle account-server guard/restart
and held-message recovery. UI, system receipt, unit tests and the browser fixture
describe the private scope. Explicit elevated choices still win and remain
blocked; Plan and read-only policies stay restricted.

The committed native regression checks a synthetic `.codex/config.toml` for
byte equality after repair and after preparation. It failed against the old
writer: 0 passed, 1 failed, 0 ignored. Additional checks cover hardlinks, existing
private settings, a missing private base, unchanged source read-only attributes,
invalid config, backup failures and concurrent replacement.

Rejected alternatives: clearing migration data only in the UI, migrating saved
task snapshots, changing source-account configs, introducing another engine
action, using full access for restricted turns, or adding a dependency/schema.
The private base is shared by this account's Monos, so a selected-session-only
server restart would leave idle peers with stale configuration.

## Validation

Windows, Node 26.5.0; web checks used process-local
`NODE_OPTIONS=--no-experimental-webstorage`. No new skips or timeout changes.

| Check | Result |
| --- | --- |
| Full `npx vitest run --maxWorkers=4` | 7,755 passed, 13 skipped, 0 failed; 622 files passed, 2 skipped; 128.575 s |
| Focused web suite | 154 passed, 0 skipped/failed; 9 files; 7.585 s |
| `npx tsc --noEmit` | Exit 0; 25.704 s |
| `npm run build` | Exit 0; 51.899 s; Vite 25.20 s |
| Actual native `codex_mono_store --lib` | 144 passed, 3 ignored, 0 failed; 623 filtered; 3.360 s including Cargo |
| Focused native `sandbox_config --lib` | 11 passed, 0 ignored/failed; 759 filtered |
| Synthetic Chromium repair controls | 2 passed, 0 skipped/failed/flaky; desktop 1440px and mobile 390px |
| Touched Rust formatting / Git whitespace | Exit 0 |

The 13 skips are existing Antigravity real-provider/soak checks. Native ignored
entries are existing subprocess/runtime entrypoints. Existing CSS `::highlight`,
mixed static/dynamic import and large-chunk build warnings remain.

Evidence root: `C:/Users/nooro/AppData/Local/Temp/monocode-cc/cc6i/evidence/`.
Before/after web proof is `p1-before-results.json` and `focused-results.json`;
full web results, logs and receipts use `full`, `tsc` and `build` prefixes.
Native proof is `native/source-bytes-{before,after}.{log,json}`,
`native/sandbox-config-after.{log,json}` and
`native/codex-mono-store-after.{log,json}`. Browser results, launch/cleanup
receipts and two screenshots are under `browser/`. The round REPORT records
the local commit and final source manifest.

No native GUI/model turn, live sandbox denial check, installed-profile repair,
merge, push or shipping was performed. Elevated restricted execution remains
blocked, and unelevated filesystem/network parity remains unverified. The
private base override retains its settings rather than following later changes
to the source account config; restore its private backup to undo this repair.
