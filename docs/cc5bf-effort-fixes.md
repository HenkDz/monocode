# CC5BF: preserve effort choices and cancelled workers

CC5BF closes all four findings in the CC5B-R review. Its branch starts at `nour` snapshot `8352c883da301d1df377a306e159e5fe00d87304`, merges CC5-B `658372f3c4247645c3bb9dc8dcee510dde0d0058` with merge commit `38bf53a93102b36e00fccdc40944b1681cea9215`, and applies repairs in `ae77cfcf592ad4999dd5d9cb5a63e115d3f279ef`.

## Changes and regression coverage

- Worker preparation re-reads the run after checkout scope discovery. It requires an active run, a running task, and the same dispatch ID, then commits from that current snapshot. A cancelled task stays cancelled and never submits. The tests also cover stopped runs, replaced dispatches, and unrelated tasks added during preparation.
- ModelPicker supplies the selected setting ID through Composer, SessionPane, and PaneTree to App. Selecting the displayed effort again now records user ownership and locks settings. Both Composer layouts are tested with the actual controls and App callback; grouped Fast and Service Tier selections retain role ownership.
- Explicit Plan Build effort becomes user-owned on the Session; the accepted submission updates its Mono profile and settings lock. The regression selects xhigh with the actual Build target control, exercises App's private helper and accepted-commit callback, renders Details, then applies the actual catalog-refresh callback. The chosen effort survives every stage. A target without an effort choice retains role ownership.
- Team API provider/model switches without explicit settings reuse `switchMonoRoleEffort` with both advertised models. Compatible effort survives a change in setting ID. Existing settings locks survive translation and Undo; explicit writes, new locks, and concurrent edits still fail their existing checks. Coverage includes live catalog IDs, model-only switches, user/legacy/role ownership, and grouped Undo.

The private App callbacks are extracted from the current source with TypeScript in the tests. This exercises their real logic without exporting test-only APIs or booting the native workspace. The four reported reproductions are committed as correctness assertions, rather than assertions of the old broken behavior. The repairs add 26 cases.

## Decisions

The change reuses the existing optional setting-ID callback, effort policy, settings locks, Team change receipts, and dispatch identity. It adds no dependency, persisted field, migration, or new policy. Value comparison alone cannot identify a same-value user selection. Removing locks would weaken the Team contract, and copying provider keys without translation loses compatible choices. The preparation race is fixed at the awaited scope boundary, preserving concurrent engine commits.

## Validation and evidence

Windows x64, Node v26.5.0, npm 11.17.0. All final Node checks used `NODE_OPTIONS=--no-experimental-webstorage` on clean implementation commit `ae77cfcf592ad4999dd5d9cb5a63e115d3f279ef`. Package and lock hashes stayed unchanged. Subsequent repository changes are documentation only.

| Check | Result | Wall time |
| --- | --- | --- |
| Full `npx vitest run --maxWorkers=4` | 551 files: 549 passed, 2 skipped, 0 failed. 6,072 tests: 6,059 passed, 13 skipped, 0 failed | 95.845 s; runner 94.47 s |
| `npx tsc --noEmit` | Exit 0, no diagnostics | 14.032 s |
| `npm run build` | Exit 0 | 30.605 s |
| Focused orchestration suite | 119 passed, 0 failed/skipped | Runner 10.82 s |
| Focused Team and role policy suites | 54 passed, 0 failed/skipped | Runner 2.04 s |
| Composer/control/SessionPane suites | 78 passed, 0 failed/skipped across 4 files | Recorded in focused log |
| Focused Plan Build suite | 2 passed, 0 failed/skipped | Runner 4.89 s during implementation |
| `git diff --check` | Passed | Not timed |

The full run had no retries, exclusions, or assertion/timeout changes. Its skipped cases are existing opt-in coverage. The original Composer callback produces two expected failures in the same-value regression fixtures; the repaired callback passes. Build retains existing CSS highlight, mixed import, and large-chunk warnings. npm reports the existing nine advisories; dependencies were not changed.

Evidence root: `C:/Users/nooro/AppData/Local/Temp/monocode-cc/cc5bf/`.

- `validation/SUMMARY.md`, `SUMMARY.json`, `baseline.json`, `run-validation.mjs`, phase receipts and pre/postcondition JSON: exact head, commands, exits, times, clean status, and manifest hashes.
- `validation/vitest-results.json`, `vitest.stdout.log`, `vitest.stderr.log`, `tsc.*`, `build.*`: complete final validation results and logs.
- `evidence/cancel-race-tests.json`, `composer-focused.log`, `composer-before-fix.config.mjs`, `composer-before-fix.log`, and `plan-tests.json`/`plan-tests.log`: focused and negative-control evidence.
- `REPORT.md`: complete round handoff. Review inputs remain in `../cc5br/REPORT.md` and its reproduction files.

## Limits and integration

No native code changed, so Cargo checks were not applicable. No native preview, screenshot, real model turn, remote provider, older binary, latency benchmark, push, merge into `nour`, or deployment was performed. Synthetic fixtures and mocked native boundaries preserve real profile data. Grouped settings locks and provider fallback for unsupported effort remain existing limitations.

During the round, the coordinator advanced `nour` to `5801602ed7fed03f50db645dc5b61a89521cb91c` with CC0/CC0-F. This branch contains the starting `nour` snapshot and the required CC5-B merge; the later coordinator integration remains separate. Revalidate the actual combined head when integrating it.
