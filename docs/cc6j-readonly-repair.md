# CC6J: read-only private config repair and honest remedies

CC6IR found that repairing a read-only source config hardlinked into the Mono
base published an independent config, then failed to delete its owned claim.
The resulting journal blocked reconciliation, preparation and retry. Source
bytes and attributes remained intact. CC6J completes the private transaction
while preserving that source boundary and the elevated provisioning guard.

## Native completion and recovery

Windows cleanup still uses the held entry handle. A read-only entry additionally
uses `FILE_DISPOSITION_FLAG_IGNORE_READONLY_ATTRIBUTE`; writable entries retain
the original deletion flags. No source attribute is cleared. This unlinks the
owned alias without changing the source inode's attributes or widening access.
[Microsoft's disposition flag reference](https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/ntddk/ns-ntddk-_file_disposition_information_ex)
describes the flag's deletion behavior.

Repair saves and verifies its independent private backup, then discards its
owned claim before publishing the replacement. Unsupported claim cleanup can
therefore restore the original path and return an error without publishing.
The Windows stage remains writable until cleanup succeeds, so refusal can also
clean its own stage without requiring read-only deletion support. Source and
backup attributes are preserved; successful publication retains the original
private read-only permission through the held stage file.

The existing journal gains a narrow `PrivateConfig` intent for `config.toml`.
After interruption between claim disposal and publication, recovery requires
the recorded stage identity/fingerprint, a real independent stage and a valid
exact private archive before publishing without replacement. After publication,
recovery restores the `private_override` snapshot. Snapshot failure preserves
the journal until that snapshot succeeds. Changed stages, archives, original
paths and unfamiliar claims remain conflicts with recoverable bytes retained.
If interruption precedes the Windows stage's READONLY copy, recovery restores
that permission from the verified, pinned backup onto a verified independent
stage handle before publication. A source hardlink substituted at the stage
path is refused before any attribute change.

Existing CC6I journals used `UseAccount`. A verified, published real private
config with an exact archive is recognized at that boundary and gets its private
snapshot before safe claim cleanup. Ordinary account relinks retain their link
behavior. No new persistence layer or dependency is introduced.

Committed regressions cover read-only source/private hardlinks, exact source
and backup bytes/attributes, independent backups, no stranded owned entries,
reconciliation, repeated preparation and retry, clean cleanup refusal, failed
snapshot recovery, legacy completion, and concurrent/changed recovery entries.
Real child-process kills exercise six boundaries: journal creation, claim
creation, before disposal, after disposal, after publication and after snapshot.

Rejected alternatives: clearing shared READONLY, deleting by an unpinned path,
overwriting a concurrent replacement, discarding unfamiliar claims, publishing
before unsupported cleanup, changing the source account config, widening
permissions, or allowing automatic elevated provisioning.

## Remedies and preserved behavior

The notice uses the existing production blocker reason to identify elevated
execution that manual setup cannot unlock. It displays **Codex elevated sandbox
unavailable** and the existing private unelevated/full-access remedies without
contradictory setup instructions or setup/recheck controls. Other readiness
blockers keep their manual command and recheck. A later generic repair failure
does not resurrect setup guidance for the cached elevated blocker.

Plan/read-only restrictions, explicit engine precedence, worker Auto reset,
saved task choices and the account busy/preparation/restart guards are retained.
Repair still writes only the selected account's private Mono config and backup.
Ordinary Codex configuration remains untouched. CC6G's old source/private
writer description and its validation are now explicitly historical.

## Inherited private engine integration

CC0GR3's actual adapter witness found a further repair gap: source `config/read`
still supplied elevated to readiness after the private base and linked context
were repaired to unelevated. Auto's default override hid that gap; inherited
supervised and Plan turns stayed held.

Native preparation now returns the independent Windows Mono base's retained
`windows.sandbox` value in `privateConfig`. Ordinary account links and Unix
preparations do not add this override. The adapter merges that engine into the
resolved account/project configuration before readiness and the outgoing thread
configuration. Skill/plugin overrides, relative paths resolved by `config/read`,
models and other settings retain their current behavior. An explicit engine
choice is applied last, so explicit elevated still blocks restricted execution.
This field is transient preparation data, with no new stored setting or writer.
Private context hardlinks do not suppress that read-only override: source inode
identity distinguishes ordinary inheritance from the independent private base.
The change deliberately keeps the ordinary config/read helper's home and
resolved settings. Switching that helper to the private home or overlaying all
raw private TOML would change path resolution and project settings beyond this
engine correction.

The committed correct-behavior witness runs the real adapter, JsonRpcClient,
provider request builder and AST-derived App repair callback with native IPC
and transport mocked. Physical source/private/context config files are synthetic.
It covers inherited and explicit engines, unchanged account/project settings,
source bytes, account-scoped held replay, exact prompts, and restricted outgoing
supervised and Plan policies. A native regression also checks the actual private
override reader after repair and actual context preparation; native execution
awaits the assigned heavy-check slot.

The unchanged six correct-behavior assertions fail against the pinned original
adapter: 3 passed, 3 failed, 0 skipped. Only the old adapter's four import paths
are retargeted to current modules in the external baseline fixture. The current
adapter passes all 6, and the connected adapter group passes 36. The earlier
full-suite results below predate this integration change and do not validate it.

## Validation and evidence

Windows/NTFS, Node 26.5.0; web checks use
`NODE_OPTIONS=--no-experimental-webstorage`. Assertions, timeouts and existing
skips remain unchanged. Heavy checks are temporarily serialized by the
coordinator's `VALIDATION-QUEUE.md`.

| Check | Result |
| --- | --- |
| Baseline unchanged CC6IR read-only assertion in full native crate | 0 passed, 1 failed, 0 ignored, 780 filtered; exit 101; 204.468 s |
| Corrected unchanged CC6IR module in full native crate | 4 passed, 1 failed, 1 ignored, 782 filtered; exit 101; 107.406 s |
| Required unchanged read-only assertion in that corrected module | Passed; all reconcile/preparation/retry errors null; no stranded claims/journals; source attributes 33 |
| Full Vitest before inherited-engine integration | 7,888 passed, 13 skipped, 0 failed; 623 files passed, 2 skipped; runner 250.25 s; superseded as final-source proof |
| Original reset/App/request matrix | 25 passed, 0 failed/skipped; 2 files; 40.500 s |
| Focused production permission/provider/repair/UI | 536 passed, 0 failed/skipped; 15 files; 39.391 s |
| Focused notice tests | 26 passed, 0 failed/skipped, including 2 new cases; 12.698 s |
| Production Chromium controls | 59 named checks passed, 0 failed; 10 screenshots; 1440px/390px pointer and keyboard; 36.780 s |
| Unchanged Attention browser cases | 4 passed, 0 failed/skipped/flaky; 6 screenshots; runner 13.688 s |
| Exact-source readiness reproductions | 8 passed; five JS/native argument controls passed |
| Correct-behavior private-engine witness against original adapter | 3 passed, 3 failed, 0 skipped; exit 1; 2.578 s |
| Corrected real-module private-engine/held-replay witness | 6 passed, 0 failed/skipped; 3.532 s |
| Connected current adapter group | 36 passed, 0 failed/skipped; 2 files; 2.859 s |
| Final native storage/harness and committed regressions | Awaiting explicit heavy-check slot |
| Final full Vitest / TypeScript / production build | Awaiting explicit heavy-check slot; one worker for full Vitest |

The corrected original module's retained failure is a fixture path-prefix
comparison between its JS backup path and canonical Windows home. The literal
fixture is preserved unchanged. The required read-only behavior passes in the
actual full native crate with real path/filesystem/transaction implementations;
no copied or stubbed native harness is used as completion proof.

Evidence root: `C:/Users/nooro/AppData/Local/Temp/monocode-cc/cc6j/evidence/`.
`native/baseline/` holds the failing source-bound export, log, receipt and source
preservation observation. `native/final/` holds the corrected full export and
unchanged original module receipts. `permissions/`, `validation/` and `ui/`
contain source hashes, raw logs, counts, browser fixtures and cleanup receipts.
`private-engine/` holds the CC0GR3 witness origin, correct-behavior baseline,
current real-module results and exact source manifests. The old full/native
exports remain preserved rather than relabelled as final-source evidence.
The round's `REPORT.md` records final validation, commits and deliberately
omitted work; `VALIDATION-READY.md` records the temporary queue.

The 13 web skips are existing Antigravity real-provider/soak checks. Native
ignored subprocess entry points are exercised by their parent crash tests.
Initial UI dependency-startup failures and the literal fixture failure are
retained as failures. All 16 browser screenshots were inspected. Owned previews
were stopped, their fixture process count is zero, and ports 17971/1478 are closed.

No real profile/account/ACL/service setup, live model turn, native App/WebView
acceptance, OS filesystem/network-denial parity, merge, push or deployment is
claimed. Unelevated network isolation is not established as equivalent to
elevated execution. Elevated restricted Mono execution remains blocked. Unix
writer exclusion and operating-system power-loss behavior remain unverified.
