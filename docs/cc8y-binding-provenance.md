# CC8Y: queued provider-binding provenance

Branch: `HenkDz/cc8y-binding-provenance`; base
`56334de5e2480c652fcfc49943b28cba93c3b029`, including CC8X and CC5E-J.
Under explicit own-branch authorization, nour
`2bd9b5231b1891fa894dfc3cfc21e36cc097d94b` was merged without conflicts.
All final checks use frozen merge pin
`9a2b41adcae4337496cf21baa910aa787d0fd145`. Incoming private-config,
rotation, routing and persistence guards remain intact; there is no CC8Y
native delta against the authorized nour pin.
The coordinator owns integration and the final independent review.

## Change and reason

Pi, OMP and compatible OpenCode publish a new native ID before awaiting the
relocation checkpoint. If the actual model picker chooses Claude during that
save, the checkpoint refuses, but its failure flush previously attached the
queued old ID to Claude. Ordinary persistence and startup retained this invalid
pair even though no provider prompt was accepted.

`bindTurnContextProfile` now also captures a separate immutable ownership
snapshot, `ProviderBindingProfile`, containing harness and account. The existing
queue carries it to `applyHarnessEvent`, which checks both against the current
session before attaching the native ID. Undefined and `default` accounts use
the existing `sameProviderAccountId` normalization. Main send/rewind and manual
compaction tag with the account actually passed to the provider.

Ownership ignores model, effort, runtime mode, read-only and sandbox controls.
Their next-turn changes retain valid bindings. Existing context/configuration
matching still checks harness, model and every settings key and evolves with
provider configuration events. The awaited durable checkpoint, null/rejected/
unreadable-save guards, event generation, generation checks, handoff metadata,
transcript, queue cadence and acceptance receipts remain intact.

No new adapter API, dependency, storage schema or writer is needed. Rejecting
against the full context profile would discard legitimate same-provider model
changes. Draining events on every picker change would require more choice paths
and alter publication timing. Creating an empty context would lose continuity.

## Connected paths and regressions

The inventory covers 13 production emission sites in 10 source files serving
all 11 harnesses. Send, edited resend, rewind and compaction enter the existing
App tagger/queue/reducer. Outgoing handoff and BTW do not publish a binding onto
their parent session; Cursor subagent recovery emits agent steps. The remote
host reduces events immediately, rejects configuration while running, checks
run identity and does not expose a harness/account switch there. Its existing
untagged direct events stay compatible via the optional provenance field.

The migration regression fixture now uses the real tagger, batch reducer and
queue, AST-extracted App picker/choice/checkpoint/persistence callbacks, actual
serialized writer and record hydration, and the startup binder. Tests cover
both event orders, failure/finally flush, old harness/account publication,
ordinary persistence/restart, unrelated sessions, healthy model changes,
permission/queue/history preservation, acceptance crash windows and save retry.
Actual App compaction tests cover the same-owner, old-harness, old-account and
legacy/selected-account mismatches through its own `finally` flush.

Ordinary account selection in a nonempty or busy chat creates a new chat; it
does not mutate that chat's account. Idle Mono usage-limit recovery can change
the same chat's account but refuses while busy. The held-save account mutation
probe is synthetic. No cross-account exposure or accepted-turn loss is claimed.

## Validation and evidence

Windows, Node `v26.5.0`, process-local
`NODE_OPTIONS=--no-experimental-webstorage`, synthetic home/profile/cache/temp,
unset `CODEX_HOME` and all `ORCA_*` variables. No assertion, timeout or skip in
the retained external probes changed.

| Probe | Red baseline at 56334de | Final merged source at 9a2b41a |
| --- | --- | --- |
| Retained adapter/callback/writer inventory | 105 passed / 6 failed / 0 skipped; 111 tests, 2 files | 111 passed / 0 failed / 0 skipped; 6.077 s command / 5.31 s Vitest |
| Retained actual picker/save/restart | 0 passed / 3 failed; 49 unselected by existing name filter | 3 passed / 0 failed; 2.331 s command / 1.71 s Vitest; same 49 unselected |
| Committed reducer/migration regressions | 103 passed / 8 failed; 111 tests, 2 files | Included in focused group below |
| Focused provider, App, queue and migration group | — | 235 passed / 0 failed / 0 skipped, 9 files; 9.085 s command / 7.10 s Vitest |
| Complete one-worker Vitest | — | 8,140 passed / 0 failed / 13 skipped / 0 todo; 624 passed / 2 skipped files, 626 total; 329.233 s command / 327.41 s Vitest |
| `npx tsc --noEmit` | — | Exit 0, no diagnostics; 18.152 s |
| `npm run build` | — | Exit 0; 31.251 s overall / 16.23 s Vite |

The coordinator granted the sole FULL heavy slot on 2026-10-12. Required gates
ran sequentially with one Vitest worker, unchanged assertions/timeouts/skips,
and unchanged frozen source. The 13 existing skips are Antigravity real/soak
fixtures. Build retains the CSS highlight, mixed-import and chunk-size warnings.
No unhandled test error was reported. No CC8Y native delta means no new native
compilation was needed. All owned validation jobs have stopped.

Earlier pre-integration green checks remain archived; they are not the full
readiness proof for this merge. The final documentation commit changes only this
document; source/test/config hashes still match the validated merge pin.

Evidence root: `C:/Users/nooro/AppData/Local/Temp/monocode-cc/cc8y/evidence/`.

- `provider/baseline-verified/`, `provider/corrected/`: retained raw probes,
  actual-picker snapshots, JSON results, commands and source/fixture hashes.
- `provider/assertion-integrity.json`: unchanged assertion expressions compared
  with retained CC8XR fixtures.
- `committed-red*`, `focused-green*`, `focused-corrected*`: committed red and
  corrected focused runs. `migration-red*` and `focused-final*` retain the two
  fixture-contract mistakes before correction.
- `caller-inventory.md`: exact base source paths, producer/caller inventory,
  account reachability and conservative account-selection limits.
- `provider/merged-corrected/`, `merged-focused*`, `merged-vitest-full*`,
  `merged-tsc*`, `merged-build*`, `merged-validation-summary.json`: final merged
  replay and required gates, exact commands, raw logs, counts and durations.
- `merged-frozen-source-manifest.json`, `merged-source-proof-*`,
  `merged-process-completion.json`: 1,517 unchanged source/config hashes,
  retained fixture integrity, preserved incoming guards and job completion.
- Prior `cc8xr/evidence/web-validation/` retains the failed parallel full run
  (7,873 passed / 13 failed / 13 skipped) and passing serial retry on its pin;
  those historical runs do not validate CC8Y.

## Limits and deliberately omitted work

This is source/integration proof with synthetic transports/native records.
Installed-provider history, live UI/native crash durability, restricted-drive
access, sandbox/ACL repair and real profile behavior were not exercised.

Compaction still has its inherited selected-account fallback. If it selects a
named account for a legacy default-owned session, the provenance check refuses
that mismatched binding; it does not reassign ownership or silently start a
fresh conversation. The migration checkpoint retains its conservative check
against the captured session account. Account routing is outside this correction.

Grok, FX, Devin and Antigravity still omit `onAccepted`; their migration, CC1 and
CC5E receipts may conservatively remain pending. This inherited P3 adapter
backlog is documented rather than repaired here. No native storage/permission,
rotation, renderer, workbench, routing or real-data change was made by CC8Y.
Only the explicitly authorized own-branch nour merge was performed. No push,
rebase, deployment, other-worktree edit or board update was performed.
