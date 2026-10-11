# CC7Q: Cockpit polish

The Cockpit now keeps branch names, badges, session chips and action buttons
inside their available sidebar space. Recent activity presents a merged PR once,
with its completion and related review retained as secondary detail. Managers
use project/role initials, matching the MM/DM identities in the CC7M reference.

The round starts at `f7f8449e8235174cfbab34b8922f6d081ff6e6d5` on
`HenkDz/cc7q-cockpit-polish`. The coordinator owns integration into `nour`.

## Changes and decisions

Worktree chips sit beneath the branch/badge line and keep their existing session
callbacks. Narrow rails put existing actions on a separate line. Wider rails
retain hover actions. Visual PR status text folds in narrow rails while its
accessible description and tooltip remain. Right-click and ContextMenu/Shift+F10
on chips still open the exact checkout's menu. Mission control lets an open menu
consume Escape and navigation keys; closing a menu leaves the Cockpit visible.

Activity groups by saved PR URL or Manager-scoped task identity, following an
explicit review link when present. Merge wins over review and completion;
the newest recorded outcome wins within one kind. Secondary details deduplicate,
and the selected outcome keeps its own timestamp and conversation target. A
reused branch still cannot prove a merge. Matching titles or a shared goal alone
never collapse unrelated tasks.

The existing type scale, surfaces and grid gaps remain. Comfortable cards and
the organization lead have 144/64 px minimum heights; the command restores its
104 px reference rhythm. Status sits at the card bottom. Vitals captions share a
baseline. Narrow attention and in-flight strips give their headings a full row.
The feed uses the house merge/check icons. Storage recovery controls align on a
shared line without changing fieldset semantics or recovery behavior.

Unavailable organization metrics say No samples/Not recorded. Absent agent
clocks and panel ages are omitted. Unknown phase/ledger values say Unknown;
exact missing boundaries say not recorded. Recorded durations, partial token
coverage and Review's guarded Not started state retain their original meaning.

Rejected alternatives: truncating a primary badge to nothing, overlaying actions
on branch text, deleting completion evidence, grouping all tasks by goal/title,
inferring merge status from a branch, inventing missing timestamps or phases,
adding avatar assets/dependencies, and using display:contents on recovery
fieldsets. No new disclosures, composer, storage schema or execution path.

## Evidence and limits

Evidence root: `C:/Users/nooro/AppData/Local/Temp/monocode-cc/cc7q/evidence/`.
`before/`, `mockup/`, `final/` and `comparison/` hold the screenshots and measured
receipts. `validation/` contains raw logs, counts and source hashes. Provisional
failures remain separate from the final evidence. The committed browser harness
renders the actual Cockpit, Manager rows, worktrees and recovery controls with
synthetic data.

All previews use isolated homes, app identifiers and empty launch folders with
CODEX_HOME/ORCA_* removed. There are no live model turns or native changes.
This evidence establishes frontend projection, layout and interaction; native
lifecycle and provider acceptance remain outside this round.

## Validation

Windows / Node 26.5.0; `NODE_OPTIONS=--no-experimental-webstorage` and synthetic
homes. The full runs keep the original suites, projects and browser viewport;
only launch paths, evidence output and the isolated port change.

| Check | Final result |
| --- | --- |
| Full unfiltered Vitest | 601 files passed, 2 skipped, 0 failed; 7,209 tests passed, 13 skipped, 0 failed/todo; 603 files / 7,222 tests total. 144.39 s Vitest / 148.320 s command. |
| Focused changed-component checks | 5 files / 151 tests passed, 0 failed/skipped. Included in the full suite. |
| `npx tsc --noEmit` | Exit 0; 18.968 s. |
| `npm run build` | Exit 0; 33.841 s. |
| Full `npm run test:browser` | 121 passed, 1 known WebKit video failure, 0 skipped/flaky/todo; 122 tests / 10 files total (9 files passed / 1 failed). 241.882 s Playwright / 251.183 s command. |
| Cockpit browser cases | 32 passed, 0 failed/skipped across Chromium and WebKit. Included in the full browser suite. |
| Visual evidence | 49 final PNGs and 19 mockup comparisons; 12 base home layouts, 6 open-PR layouts, 7 drawers, 24 sidebar crops. 36 sidebar states / 144 rendered rows: zero overlaps. 12 menu-dismissal checks passed. |
| Contrast and alignment | Minimum sampled normal text 5.35965:1. Vitals caption coordinates match; storage controls differ by at most 0.5 px. |
| Native checks | Not applicable: no native/host changes. |

The two existing Antigravity real-provider suites account for 13 skips. The sole
browser failure remains the unmodified Windows WebKit Blob-MP4 test in
`tests/browser/video-preview.spec.ts`: metadata readiness is false, media error
code 4. Its assertion, timeout and enabled status remain intact.

All four full checks preserve the same 1,617-file source/test/config digest:
`b90fa17dc69c87d7cb04340d5cd305240d33499ee9a0b282e319ad6b161ceb28`.
Package-lock bytes remain unchanged. The capture binds 80 source hashes;
`evidence/final-commit-binding.json` checks these against the resulting Git blobs
and verifies every final screenshot/comparison hash. Previews and synthetic
homes are stopped/removed. Build retains the existing CSS/import/chunk notices.

Provisional strict-locator failures, a menu-Escape integration failure and the
interrupted pre-polish full run remain available under separate evidence
directories. The final browser assertions retain the card-height checks that
caught the Escape issue; no test was skipped or weakened.
