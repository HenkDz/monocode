# CC7T: Transcript and Activity rendering

Member Activity no longer prints app CLI receipts as inline JSON. The shared
transcript tool rows present a compact action card and an anchored **View full
output** popover. Generic output previews contain at most three short lines;
structured output has a label and an on-demand reader. Commands requiring
approval retain **View command** and the existing approval controls and request
identity.

The round starts at `7cc1648927704200fe4c3618fb1498061a4ed304` on
`HenkDz/cc7t-transcript-rendering`. Integration belongs to the coordinator.

## Presentation and source boundaries

`monocodeToolCall.ts` recognizes all 49 native app actions, including session
reads/lists/sends, team messages, goal assignments, task requests, artifacts,
and app rules. Receipt summaries use actual response fields and the existing
roster for names. Queued delivery and rejected assignment stay distinct from
successful delivery and assignment. Unknown identities use a readable fallback.
Summary cards never quote saved conversation bodies.

`transcriptPresentation.ts` removes app-owned prompt envelopes, team-sender
metadata, reply boilerplate and authority-core text from presentation. It also
sanitizes strings inside saved-conversation JSON and handles partial envelopes
and escaped markers. Team messages show the sender mascot, name, topic and
message body. Manager receipts become digest cards with readable event lines.
The shared Markdown, plan/task previews, plain transcript rows, copied replies,
tool popovers and error readers use the same presentation filter. Ordinary text,
code, whitespace and JSON without protocol content retain their content.

Persisted blocks, provider input, orchestration prompts and receipt payloads are
unchanged. The finite list of app-owned tags must be extended when new prompt
envelopes are introduced; it is a presentation rule, not an authority parser.

`TranscriptError` maps storage launch mismatch, sandbox/access readiness, usage
limits, provider authentication, missing CLI commands and interrupted transports
to a title, cause and action. Details preserve diagnostics behind an explicit
control, and copying reports clipboard failure without throwing away the error.
Known message-delivery failures reuse the existing Retry callback. Worker task
recovery opens its existing conversation: a member timeline does not acquire a
Manager's retry/reassignment authority. Existing provider sign-in and storage
recovery controls remain the execution routes.

## Activity integration

The shared Activity content uses All, Assignments, Tools, Messages, Results and
Errors chips. Member Activity combines saved assignments/dispatch outcomes with
the visible conversation in one chronological timeline. Drafts, internal blocks
and hidden tools stay excluded. Task and dispatch identities include their
Manager so equal task IDs in separate runs cannot open the wrong conversation.
Legacy clocks remain **Time not recorded**; transcript steps without their own
clock keep their source group rather than inventing a timestamp. The list pages
80 events at a time through **Show earlier events**.

Normal member task cards and their existing actions remain available outside the
Activity tab. `SessionPane.tsx` adds only the member identity to its existing
Activity content call. `App.tsx`, member shell layout, provider execution, native
code, dependencies and persistent schemas are untouched.

Rejected alternatives: inline JSON, output accordions, a second transcript
store, reading CLI input files to infer presentation, new retry execution paths,
and restructuring the member layout owned by CC7S.

## Evidence and verification

Evidence root: `C:/Users/nooro/AppData/Local/Temp/monocode-cc/cc7t/evidence/`.
The real-component harness is `tests/browser/transcript-presentation.*`.
`baseline-source.json` captures the original eight renderer modules at the base
commit; the baseline Vite loader renders them against the same synthetic data
used for the final capture. `before-dark.png` and `before-light.png` reproduce
the large `sessions.read` receipt, leaked Native Core team protocol and storage
launch failure. Final Chromium/WebKit captures show the compact card, clean
message and flat timeline in both themes. Browser interactions also exercise
the output popover and diagnostic reader.

`contrast-current.json` records the initial low-contrast light-theme controls.
`contrast-final.json` records the corrected controls/cause text: minimum sampled
contrast 5.68:1 in light and 8.28:1 in dark. These are sampled new controls, not
a claim of a full application accessibility audit.

All browser launches use an empty isolated folder and synthetic homes with
`CODEX_HOME` and `ORCA_*` removed. No live model turn or real profile/database
change was performed. The browser harness proves frontend rendering and
interaction; native lifecycle and live-provider acceptance remain unverified.

## Final validation

Windows / Node 26.5.0 checks use `NODE_OPTIONS=--no-experimental-webstorage`.
The final full unit run uses four workers after the browser previews stop.

| Check | Final result |
| --- | --- |
| Full unfiltered Vitest | 617 files passed, 2 skipped, 0 failed; 7,522 tests passed, 13 skipped, 0 failed/todo; 619 files / 7,535 tests total. Process time 214.383 s. |
| Changed Vitest tests, included above | 13 files / 212 tests passed, 0 failed/skipped. |
| `npx tsc --noEmit` equivalent direct TypeScript CLI | Passed, exit 0; 43.305 s. |
| `npm run build` | Passed, exit 0; 76.907 s. |
| `npm run test:browser` | 137 passed, 1 unchanged known WebKit video failure, 0 skipped/flaky; 138 total; 368.380 s. All 6 CC7T cases passed. |
| Final browser capture rebind | 6 passed, 0 failed/skipped/flaky; 57.156 s including rebuild. All 476 browser artifacts are byte-identical to the full-suite build. |
| Screenshots | 2 baseline and 4 final theme/engine PNGs; inspected before dark and final dark/light Chromium captures. |
| Native checks | Not applicable: no native or host changes. |

The unit, TypeScript and production-build checks share one unchanged 1,423-file
source digest: `2690763ac2180d1657c2c5d8068df95c4b3a001d7c0fda6010298f4fd61778bf`.
`validation/` contains raw logs, JSON results and per-check source hashes.
`manifest-final.json` binds the screenshot hashes and final browser sources;
the capture rebuild proves a later comment/docs change did not alter the served
artifacts. The two existing Antigravity real-provider suites account for all 13
unit skips.

The sole browser failure is the unchanged Windows WebKit Blob-MP4 metadata test
in `tests/browser/video-preview.spec.ts`: media error code 4 and
`metadataReady: false`. It remains neither skipped nor weakened. Build retains
the existing transcript `::highlight` CSS warnings, mixed `mono.ts` import notice
and large-chunk advisory. No timeout was increased.

Provisional unit/type/build failures are retained in `validation-initial/`.
The first unit run had 12 failures: nine old rendering expectations, two
unrelated timing failures, and one test/source change during the run. The old
expectations and two incomplete typed fixtures were corrected. The unrelated
CRLF Git and pasted-image tests pass unchanged in both their focused rerun and
the final full suite. Only the final unchanged-source checks establish readiness.
`browser-full.log` preserves the earlier complete browser run and
`browser-final-full.log` records the final one.
