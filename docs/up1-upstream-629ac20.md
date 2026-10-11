# UP1 — Upstream Mono chat integration

UP1 merges the 12 Mono chat UX commits through upstream
`629ac2053bebe2c3e0b4ac9858a1ebf417f6e99c` into the Command Center fork.
The upstream composer, emoji picker, artifact chip, session cards, hover
actions and reply motion coexist with the fork's routing, durable events,
member view, effort ownership, permissions and context rotation.

## Revision and boundary

- Worktree: `C:/Users/nooro/orca/workspaces/monocode/up1-upstream`.
- Branch: `HenkDz/up1-upstream`.
- Fork base: `cf616bab7bc8af98d60a5fe190e893d908f6b6c1`.
- Pinned upstream: `629ac2053bebe2c3e0b4ac9858a1ebf417f6e99c`.
- Merge: `6ad27936217b0714d9e8176693c2daeed01d3da3`, with the fork base
  and pinned upstream as its two parents.

The existing upstream ref matched the pin, so no fetch was needed. The real
`git merge --no-ff upstream/main` was completed on this branch. No other
branch or worktree was changed, and nothing was pushed or deployed.

The starting checkout already included CC5-C/CC5C-F, CC5-E/CC5E-F and
CC7-B/P/D/E, so reconciliation used their actual current implementations.
The graph did not index this checkout; targeted source searches were used.

## Conflicts

All six conflicts were resolved locally; no whole-file choice discarded the
fork's implementation.

| File | Resolution |
| --- | --- |
| `src/app/App.tsx` | Defined upstream `rememberFollowUp` before the fork's queued request check. Both queued and already-sent retries record a card after validating the original prompt; accepted new sends record one too. |
| `src/features/monos/model/monoMessaging.ts` | Kept the fork's `rejectMessageSend`, including durable `pendingMonoEvents`, and added upstream `visibleMonoCompletionMessages`. |
| `src/features/monos/ui/MonoComposer.tsx` | Adopted upstream input/send helpers, emoji picker, icon tools and controls row. Preserved the goal submission API and route chip, runtime permission props, and exactly one controls slot. |
| `src/features/sessions/ui/AgentTranscript.tsx` | Kept both `managerProject` and upstream `revealOnHover` on turn actions. Adopted session-card anchoring and upstream motion/layout changes. |
| `src/features/sessions/ui/ModelPicker.tsx` | Kept upstream text/pill variants and the fork's optional `settingId`, including selected and toggle controls. |
| `src/features/sessions/ui/SessionPane.tsx` | Kept `monoState`, routing and the member branch. Adopted the launched-session prop API, integrated completion residue into `monoNotices`, and combined upstream model controls with fork context rotation. |

## Semantic reconciliations

The primary Mono and member panes have one context meter in upstream's model
controls row. It carries scheduled rotation, the actual deferral reason,
manual compaction and the existing operation/decision guards. The former
above-input controls row was removed. The meter's wrapper has adaptive width
and height so unknown usage and long deferrals can render text.

Both new `ModelPicker` and `ModelControlPills` callbacks forward `settingId`
to App, preserving explicit effort ownership. Integration tests click the
real effort control in manager and member panes and exercise the actual
picker callback. Existing model settings behavior remains.

Permissions remain beside attach and emoji in the composer tools row for
primary Mono chats, member chats and floating Mono chats. Keeping the
existing `AccessPicker` there makes this per-agent choice directly reachable
without opening Details. The goal route chip stays above the input. No
accordions were introduced.

Launched-session status has no separate derivation: `launchedSessionState`
aliases CC4's `selectAgentLiveState`, and cards render CC7-P's
`AgentStatusLabel` and its single cue. App reads saved sessions for closed
cards, deriving their canonical state instead of inferring done. Missing
sessions derive idle. Saved state is read again after a session is reopened
and closed, preventing an old failure from returning after recovery. App
tests cover the saved-state and refetch paths as well as follow-up retries.

The existing receipt parser accepts CC5-A's real response shapes:
`sessions.list` carries a project `cwd` with session rows keyed by `id`, and
accepted `sessions.send` receipts carry `sessionId`, `submitted` and
`alreadySubmitted`. The native envelope adds `requestId`. A new fixture tests
these envelopes and retry deduplication. Per-turn transcript recovery also
receives whole-conversation known sessions, covering old chats where a
listing and a later accepted send are in different user turns. Cards still
belong to the requesting turn and preserve their handoff/report ordering.

The shared user outbox intentionally filters internal events. A dedicated
`completions` variant permits only the completion residue selected by
upstream's visibility helper. It displays a safe title/count and failure
with Retry, while normal outboxes keep their existing filter. Internal
prompts and reports remain hidden. New tests cover individual/combined
summaries and exclusion of user messages from this notices variant. The
fork's durable digests and pending events remain the authoritative model.

Dependencies were installed from the merged lockfile with `npm ci`:
`frimousse` 0.4.0 and `emojibase-data` 17.0.0 are the only new direct
dependencies. No dependency upgrades, audit fixes or global installs were
made. Install reported 428 packages added, 429 audited and the existing
nine advisories (five low, one moderate, one high, two critical).

## Decisions and alternatives

- Kept the fork's data model and upstream's composer structure rather than
  duplicating layout/control rows or replacing the member view.
- Reused the canonical status selector and label rather than retaining
  upstream's working/input/draft vocabulary or closed-means-done rule.
- Kept permissions in the tools row rather than making Details the sole
  permission entry point.
- Reused `MessageQueue` with an explicit completion-only variant rather
  than exposing internal events in every queue or creating another queue UI.
- Kept the parser's accepted response shapes; no speculative CLI response
  changes or new receipt protocol were added.

## Evidence and validation

Evidence root: `C:/Users/nooro/AppData/Local/Temp/monocode-cc/up1/evidence/`.
Checks use Windows Node 26 with process-local
`NODE_OPTIONS=--no-experimental-webstorage`. Baseline browser evidence uses
an archive of the exact fork base, rather than another checkout.

Focused checks passed: composer/picker/pane integration 80 tests in three
files; launched sessions/card/shared status 84 in four files; follow-up and
cross-turn transcript recovery 39 in two files. Additional messaging,
outbox and pane-scroll tests passed before full verification.

The base browser suite passed 89 of 90 checks: Chromium 45/45, WebKit 44/45.
The sole failure was the existing video preview metadata assertion after
15 seconds with `metadataReady: false` and media error code 4. The video
fixture and assertion were retained for the merged comparison.

Before screenshots use the existing CC5-C embedded composer fixture with
New goal/Auto routing and CC7-B empty member fixture, in dark and light.
Stable paths are `base/before-mono-composer-{dark,light}.png` and
`base/before-member-chat-{dark,light}.png`. The direct composer fixture does
not include SessionPane's model controls; supplementary screenshots cover
the real pane separately.

There are no net native or host source changes in the merge, including the
upstream native emoji implementation that was added and then reverted.
Native tests and native preview builds are therefore outside this round's
required change validation. Browser fixtures submit no live model turns.

| Required check at merge `6ad2793` | Result | Evidence |
| --- | --- | --- |
| `npx vitest run --maxWorkers 1` | Exit 0; 592 files passed, 2 skipped; 7,058 tests passed, 13 skipped, 0 failed; 440.40 s. | `validation/vitest-full.log`, `validation/vitest-receipt.json` |
| `npx tsc --noEmit` | Exit 0; no diagnostics. | `validation/tsc.log`, `validation/tsc-receipt.json` |
| `npm run build` | Exit 0; Vite built in 20.97 s. Existing CSS minifier and chunk-size warnings remain. | `validation/build.log`, `validation/build-receipt.json` |
| `npm run test:browser` on base | Exit 1; 89 passed, 1 failed, 0 skipped, 0 flaky; 158.62 s. | `base/browser-suite.log`, `base/playwright.json`, `base/browser-summary.json` |
| `npm run test:browser` on merge | Exit 1; 99 passed, 1 failed, 0 skipped, 0 flaky; 150.73 s. | `after/browser-suite.log`, `after/playwright.json`, `after/browser-summary.json` |
| Focused native tests | Not applicable; no net `src-tauri` changes. | `validation/source-receipt.json` |
| Source review / whitespace | No blocking source regression; `git diff --check` passes. | `final-source-review.md` |

The merged full browser run passed 99 of 100 checks: Chromium 50/50 and
WebKit 49/50, with zero skips or flaky results. Its only failure matches the
base's project, test, assertion at `video-preview.spec.ts:25`, 15-second
timeout, `metadataReady: false` and media error 4. This is the brief's
explicitly permitted baseline failure; it remains a failed check. The new
emoji and completion-motion tests, plus CC5-C and CC7-B, passed in both
engines. The source/fixture/config signature remained
`fd38c71b03c25c6207d5c3a36d2def46c310bf9d5e68e667d7b3dbc0e903e3fa`
over 1,446 files before/after the run; documentation is excluded from it.

Matched after images are `after/after-mono-composer-{dark,light}.png` and
`after/after-member-chat-{dark,light}.png`. Supplementary
`after/session-pane-model-row-*.png` and their bounds JSON cover known,
unknown and deferred context in the real SessionPane at desktop and narrow
widths. These use synthetic fixture-response interception, without modifying
production components or submitting a provider turn. Primary review of the
matched images confirms the tool/model row, route chip and member work view
coexist. Narrow unknown/deferred images show the complete context text
inside the viewport. Permission and effort labels truncate at 360–420 px;
this remains a follow-up layout limit. No horizontal page overflow was seen.
All 14 supplementary scenarios passed actual access, effort and model menu
opening, including pointer and keyboard interaction at narrow widths. Full
accessible labels remain available and the menus fit in the viewport.

The independent source review at the merge SHA found no blocking regression
in its integration scope. Its receipt is `final-source-review.md`. The
earlier `semantic-audit.md` records the cache, fixture and cross-turn findings
that were fixed before the merge. Browser counts, identical failure
comparison and process cleanup are recorded in `base/` and `after/`.

## Deliberately outside this round

No merge into `nour`/`main`, push, deployment, installed-app restart, native
window acceptance, live provider turn/authentication, macOS/Linux check,
signed packaging or dependency advisory remediation. Real user profiles
were not targeted. Native tests are not applicable to the net frontend-only
change. Inherited MemberWorkLog task/history disclosure controls were not
redesigned; UP1 introduces no accordion in its changed components. Windows
WebKit Blob-MP4 playback and narrow toolbar label readability remain open.
