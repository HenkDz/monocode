# CC8Y: queued provider-binding provenance

Branch: `HenkDz/cc8y-binding-provenance`; base
`56334de5e2480c652fcfc49943b28cba93c3b029`, including CC8X and CC5E-J.
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

| Probe | Red baseline | Corrected |
| --- | --- | --- |
| Retained adapter/callback/writer inventory | 105 passed / 6 failed / 0 skipped; 111 tests, 2 files | 111 passed / 0 failed / 0 skipped; 6.41 s Vitest |
| Retained actual picker/save/restart | 0 passed / 3 failed; 49 unselected by existing name filter | 3 passed / 0 failed; 2.30 s Vitest |
| Committed reducer/migration regressions | 103 passed / 8 failed; 111 tests, 2 files | Included in focused group below |
| Focused provider, App, queue and migration group | — | 235 passed / 0 failed / 0 skipped, 9 files; 11.43 s Vitest |

Required full Vitest, typecheck and build are awaiting an explicit slot under
the coordinator's `VALIDATION-QUEUE.md`. Final results will be recorded here
and in the external report after that slot completes. No native source changed,
so no new native compilation is required.

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
rotation, renderer, workbench, routing or real-data change was made. No push,
merge, rebase, deployment, other-worktree edit or board update was performed.
