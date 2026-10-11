# CC5DF: recoverable, bounded Manager wake digests

CC5DF fixes all five CC5DR findings in the current `nour` integration. A Manager
digest survives session-store serialization and restart with managed authority
intact; completed reports become eligible after Continue; failed target saves
and lookups retry without unrelated traffic. Late dependencies create immediate
acceptance decisions. New digest pages stay within 4,000 characters while
retaining every source event.

Branch: `HenkDz/cc5df-wake-fixes`. Starting commit:
`e950866bb164ded1eba3cbcd5632279a8fd313c8`. CC5D
`c991987025736de5a42ceb31c474b9e25514a8f0` was merged without conflicts in
`90690eec6f9bf2510c34372d4f0c8cb2da6f41a2`. Implementation commits:
`c44929d64ae02749f12344b4b8ff99b7b6bb1861` and
`7fba7ded9cf0e053592c6347d41c8e261bb81109`. Final frontend validation targets
the latter; the following documentation commit changes no source or tests.

## Persistence and authority

New digest IDs use `manager-digest-<uuid>`. The shared queue sanitizer round-trips
`appRequestId` and validated `managerWake` metadata. Marker, queue and request
identities must match. Malformed managed entries are rejected instead of being
restored as user messages. Exact old `manager-digest:<uuid>` receipts remain
supported through a narrow managed-queue/internal-block exception, preserving
previously frozen IDs and bodies. Global session-ID validation is unchanged.

The queue bridge reads the actual stored session after saving and verifies the
receipt ID, body, request ID and marker before publication or source acknowledgment.
Live receipt replay also verifies persisted state; archived internal receipts
use the existing native lookup. App's queue dispatcher passes `managed: true`
for hydrated digests. Pending questions and approvals retain their gates, and
these messages cannot steer into a running turn.

Tests exercise the real frontend serializer/hydrator with synthetic native storage
on both ordinary and Mono paths. A fresh store resumes one retained digest and
preserves its internal submitted-turn request identity. Negative cases simulate
successful native saves that lose the queue or marker; acceptance rejects and
never acknowledges pending sources.

CC5DG replaces the verification callback's normal loader with
`readPersistedSession`. It hydrates the durable queue and internal receipt fields
without replacing the active Mono's suffix-write cache or running provider repairs.
The normal chat loader still initializes its cache and repairs restored transcripts.
The real-store regression covers 10, 11 and 25 user turns, queue and consumed-receipt
replay, and a later user turn. Successful storage that changes the body or request
ID is rejected alongside missing queues and markers.

## Recovery and dependency decisions

An active run can deliver a retained report whose only wave is retired. This
releases completed work after Continue without reviving cancelled children or
changing cancellation retirement.

Target saves, read-back and archived-receipt lookup failures retain the same frozen
receipt and event IDs. Persisted backoff is 1, 2, 4, 8, 16 and 32 seconds, then
60 seconds per attempt; external sync cannot bypass it. After three failures,
CC4's existing selector reports a recoverable storage blocker. Automatic retries
continue, and successful acknowledgment clears it. Snapshot reconciliation retains
retry state belonging to the selected receipt and clears stale acknowledged errors.

A late dependency upgrades an unfrozen prerequisite report to a decision. If the
report is frozen or delivered, a separate `decision:report:<dispatch>` event
supplies the gate without changing its original receipt. Repeated reconciliation
and already accepted prerequisites create no additional wake.

## Digest budget

Each included event has one short line containing its stable identity, action
kind, task/request identity when present, summary and full-report reference.
Saved reports keep artifact links; other task evidence uses `app sessions.read`.
Full team-message envelopes remain in `wakeState.events`, available through
`control list` for the assigned project.

CC5DG bounds the project label to 100 characters and includes the stable Manager
ID. The lookup is `control list {} -> run.wakeState.events`: the authenticated
Manager owns one project, so no executable path is abbreviated. Long Windows paths
no longer consume the header budget. Both separator variants retain complete event
IDs, action priority, continuation pages and full source envelopes.

The coordinator's storage-preparation/rejection regression now uses fake timers
instead of polling against the one-second retry deadline. It checks every original
assertion, advances through the deadline while storage is blocked, then verifies
one successful acceptance after repair. Preparation also explicitly prevents
acceptance. Production retry timing is unchanged.

Action items precede routine updates. Overflow becomes another durable receipt;
only represented events and timeout lines are acknowledged. A persisted
continuation flag keeps the info-only remainder eligible after the action has
been acknowledged. Completed waves remain eligible until their remaining
evidence is represented. No outbox entry is truncated or deleted.

The 21-event fixture retains 126,227 source-text characters and produces a
2,705-character digest containing all 21 events, with the question first.
Separate 150-action and 150-update fixtures verify bounded pages and exactly-once
acknowledgment of every event.

## Validation and evidence

Windows, Node `v26.5.0`; every Node check uses
`NODE_OPTIONS=--no-experimental-webstorage`. Final frontend checks are pinned
to `7fba7ded9cf0e053592c6347d41c8e261bb81109`. Native control code is unchanged
since its merge-commit check.

| Check | Result |
| --- | --- |
| Full `npx vitest run --maxWorkers=8` | 6,555 passed, 13 skipped, 0 failed; 6,568 tests. 573 passed files, 2 skipped; 575 files. |
| `npx tsc --noEmit` | Passed, no diagnostics. |
| `npm run build` | Passed, TypeScript and Vite. |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib control_cli::tests` | 24 passed, 0 failed/ignored/measured; 669 filtered. |
| Focused wake/store suites | 104 passed, 0 failed/skipped; 5 files, included in the full suite. |
| `git diff --check` / edited line endings | Passed; LF throughout, no whole-file rewrites. |

Original recovery, late-dependency and size reproductions: four failures before
fixes. Initial persistence matrix: 24 failures and one passing validation control.
Two additional stale retry-state controls each failed before correction and passed
afterward.

Evidence root: `C:/Users/nooro/AppData/Local/Temp/monocode-cc/cc5df/evidence/`.
`persistence/` contains actual-store before/after logs and JSON; `recovery/`
contains original reproductions, final recovery/budget results and stale-state
regression logs. `validation/` contains exact-command receipts, full Vitest JSON,
typecheck, build and native logs. `digest-budget.json` and its `.mjs` probe record
the final digest measurement. Original review evidence remains in `cc5dr/evidence/`.

## Limits and deliberately omitted work

No live preview, provider turn, real profile write, push, other-worktree change
or integration into `nour` occurred. The coordinator owns integration and live
acceptance. Previously frozen receipts keep their original bodies, including
older oversized bodies; the budget applies to new receipts. Long-lived runs
retain acknowledged evidence. The existing twenty-continuation safety limit
still applies to exceptionally large batches. Retry frequency is bounded;
automatic retries continue until recovery or a run/session gate intervenes.

No new dependency, database, event bus, classifier, approval bypass, review-fork
automation or unrelated UI was added. Broader native/browser checks and equal-work
live latency measurement remain outside this round. Existing dependency audit and
build warnings were recorded without dependency or build-policy changes.

CC5DG's current validation, source boundary and evidence are recorded in
`docs/cc5dg-manager-wake-readback.md` and
`C:/Users/nooro/AppData/Local/Temp/monocode-cc/cc5dg/REPORT.md`.
