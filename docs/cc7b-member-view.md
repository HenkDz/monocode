# CC7B: member work and contextual panels

The member view now leads with availability, recovery and assignments instead of
an empty conversation. This round implements the member/contextual-panel portion
of `docs/cc3-command-center-design.md` on the CC4 baseline `a6677f6`.

## Member work

- The persistent member header reuses CC4 state and shows current-turn elapsed
  and recorded tokens while a conversation turn runs. A stopped or storage-held
  conversation says **No conversation turn running**; the member may separately
  have a running worker assignment. Missing timing/counters stay unavailable;
  dispatch elapsed and current conversation metrics are distinct.
- Storage repair/comparison and usage/question recovery appear above assignments
  and remain available in both Conversation and Activity. Recovery has its own
  scroll area; with an empty conversation, work uses the available height rather
  than reserving blank transcript space. With conversation/activity content,
  the combined work area is bounded to half the viewport. The composer stays
  reachable in both layouts.
  A blocker inherited from an assigned worker reuses the same storage notice;
  repair/comparison/reveal target that worker's session, while the member
  conversation keeps its own delivery state.
- The existing independently scrolling MemberWorkLog groups **Current
  assignment**, **Queue**, and **Work log**. Completed/cancelled history stays
  collapsed and unmounted until requested. Each queued task shows its actual
  scheduling/storage reason and reuses worker navigation and exact-task cancel.
  Cancellation retains pending/error feedback and restores focus.
  Opening a task reader suppresses its hover hint so Escape reaches the reader,
  including on WebKit, while preserving the original Open button and focus.
- Completed tasks use their own dispatch outcomes and recorded metrics rather
  than inheriting a reused worker session's new blocker or question.
- Member chat messages have a separate editable/removable queue above the
  conversation. Pending queue bubbles remain in session storage and disappear
  only from the displayed conversation until delivery. Other Mono conversations
  keep their existing pending-bubble behavior.
- Conversation and Activity support arrow/Home/End tab navigation. The transcript
  stays mounted when Activity opens; the draft and attachments remain mounted.
  Activity reuses MonoActivityContent and its independent scroll owner. The
  composer explains whether a message starts a turn or waits for recovery.

## Right panel

Session PRs open automatically only if the existing scoped PR projection has
displayable rows. Empty and historical-only context starts closed. Explicit
opening, interaction and pinning keep the panel open as context changes; Close
suppresses automatic reopening. Existing member Details visibility is already
explicit shell state and remains respected.

The shared PR list omits zero groups, identifies its context, links to all PRs,
and distinguishes loading, refreshing, failed checks, saved/unavailable status,
empty context, historical-only context and filters with no matches. Reset filters
is offered when it can actually reveal rows. It reuses the central PR cache and
budget; no new poller or forge mutation is added. The cache has no collection-wide
fetch metadata for unverified candidates; optional loading/error props only
display real status supplied by a caller.

Details retains the existing MemberDetails and MonoRoleEffort controls, explains
that model/effort apply on the next turn, and shows the exact working copy. The
shared panel separator supports arrows (10px), Shift+arrows (40px), Home/End and
Enter reset, with ARIA bounds/current width. Closing restores focus to the opener
when focus was still inside the panel.

## Validation and evidence

Windows / Node 26 validation uses `NODE_OPTIONS=--no-experimental-webstorage`:

| Check | Final result |
| --- | --- |
| `npx vitest run --maxWorkers=4` | 563 files: 561 passed, 2 skipped, 0 failed. 6,298 tests passed, 13 skipped, 0 failed; 6,311 total. 85.27 seconds. |
| `npx tsc --noEmit` | Passed, exit 0 |
| `npm run build` | Passed, exit 0; Vite phase 20.49 seconds |
| `npm run test:browser` | 82 tests: 81 passed, 1 failed, 0 skipped. All 40 CC7B checks and all 6 original member-task checks passed. |
| Original WebKit member-task recheck | 3 passed, 0 failed, 10.1 seconds |
| `git diff --check` | Passed |

The browser failure is the unchanged `tests/browser/video-preview.spec.ts`
WebKit Blob-MP4 metadata assertion (`metadataReady: false`, media error 4).
It was neither weakened nor skipped. The earlier work-log Escape failures were
reproduced with the actual `a6677f6` component served by a temporary pre-load
override, then fixed locally and rechecked; the baseline source/proof and traces
are retained.

Full validation numbers and screenshot paths are recorded in the round report:
`C:/Users/nooro/AppData/Local/Temp/monocode-cc/cc7b/REPORT.md`.
Logs and isolated browser harness evidence are under its `evidence/` directory:
`vitest-full.log`, `tsc.log`, `build.log`, `browser-full.log`,
`browser-member-regression.log`, `browser-baseline-proof.json` and
`browser-cleanup.log`. The twelve selected screenshots are in
`evidence/screenshots/`: empty, long-log, blocked, empty-pr and loaded-pr, each in
dark/light, plus blocked-light-narrow and long-log-light-narrow. All twenty-four
Chromium/WebKit captures and the video failure trace remain in `browser-full/`.
`tests/browser/cc7b-member.html` mounts the real modified components with synthetic
sessions, tasks and PR cache data. It is component/browser acceptance, not native
app or live-provider acceptance.

No native code, shared App/orchestration wiring, other worktrees, real profile
data, dependencies or transport/approval authority were changed. Nothing was
pushed or merged. Time in a blocked state cannot be reconstructed from silence
or mutable task timestamps; the UI uses only the existing recorded boundaries.
