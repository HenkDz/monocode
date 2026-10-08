# Team map verification

Frontend validation passed: 20 focused tests; 5,284 tests across 497 files in the full suite (13 tests and two files skipped); TypeScript and the production build. The broad suite covers the streaming model; the final Needs you dimming and highlight-order presentation tweaks additionally passed focused tests, TypeScript and build. The full suite used `NODE_OPTIONS=--no-experimental-webstorage` on Node 26 with four workers. No dependencies or Rust source were changed.

The baseline Windows preview was built and checked on 2026-10-08 with the actual native app, real Codex GPT-6.1-Sol turns, and a separate `com.monocode.desktop.r14-team-map-test` profile. It launched from an empty OS-temp folder outside Git ancestry. The original user preview, PID `88776`, remained running; tests used only the isolated profile. The latest continuous-streaming acceptance is recorded below.

Baseline executable: `target/r14-preview/monocode-r14-delivery.exe`. SHA-256: `00954cb070612c5767687522cc7ae98c268e2d580209ca10372a5d53a850bbea`. Loaded frontend asset: `App-BcBqkQZz.js`. Native build passed; no frontend asset interception was used.

The isolated profile contains a persisted Orchestrator, Atlas and Beacon Managers, two members per Manager, and an ordinary Notes companion. Only that initial roster and two standalone README repositories were configured as fixtures. Goals, dispatches, reports, acceptance receipts and crew events were produced by real native app/control calls with prepared `--input` files and `login:false`.

| Baseline live evidence | ID |
| --- | --- |
| Final Orchestrator → Atlas goal, done | `e6034577-6077-4546-8f5e-ce6cbd4dfd3a` |
| Atlas Engineer task, accepted without changes | `95823cbb-3e3b-4b95-954a-dcf61a0b1a0a` |
| Exact accepted Atlas dispatch | `06a1a354-f43b-468c-a944-3ed75fa44900` |
| Beacon Engineer task, accepted without changes | `27b5b978-0b57-4948-96f4-b5f0498f34cf` |
| Exact accepted Beacon dispatch | `676923f6-d6a1-440d-8439-90f37fa67c42` |

Six report-only marker checks completed during native debugging and acceptance. Every task is `readOnly:true`, completed, accepted against its latest dispatch, and records `completionOutcome:no-changes`. Both repositories retain their original HEAD, byte-identical README, clean status and no remotes. Both Manager runs are finished and zero provider turns remain active. Only the unused Manager-only motion probe was cancelled; accepted tasks and repositories were retained.

Real event captures prove visible dots travel down for goal/task assignment and up for worker/Manager reports. Computed opacity is `1` during travel; native SMIL motion and visibility start times match within the same frame. The native check found the earlier syncbase visibility animation never started, so the final component starts motion and visibility explicitly together. No invented events or manually restarted animations are included in the acceptance sequences.

Three-frame sequences: [goal assignment](evidence/goal-down-1.png), [member dispatch](evidence/dispatch-down-1.png), [worker report](evidence/report-up-1.png). The corresponding `-2.png` and `-3.png` files show subsequent positions. [Native verification JSON](evidence/native-verification.json) records IDs, coordinates, opacity, runtime identity, repository checks and final cleanup.

Screenshots: [dark](evidence/native-dark.png), [light](evidence/native-light.png), [narrow tree list](evidence/native-narrow.png), [real event with reduced motion](evidence/native-reduced-motion.png). Dark/light stills use the full native `1280×1038` view. Animation frames use a `1280×800` capture viewport; the narrow screenshot temporarily uses the actual native WebView at `600×800`. Capture overrides are cleared immediately afterward. Reduced motion showed static indicators, no `animateMotion` elements and no animated working rings.

Ten live interaction groups passed: zoom/fit, mouse panning, Needs you dimming, project filtering, cluster collapse/expand, real crew-event focus/highlight, narrow keyboard order, Enter opening the focused chat, scoped Manager header navigation and map navigation after toggling the project rail. The JSON receipt records those checks.

The reported bottom gap was reproduced by temporary capture emulation: the native client remained `1280×1038`, while an emulated height of `800` placed the dialog bottom at `784`. Clearing the override restored `innerHeight`, document height and visual viewport to `1038`, with dialog bottom `1022` and the intended `16px` inset. The preview is left visible, idle and dark, with no forced device metrics, media preferences or diagnostic hooks.

Live PR states and Reviewer changes requests were not exercised; their event/status mappings have unit coverage. No push, remote PR, merge or deployment was performed.

## Continuous streaming follow-up

The latest native executable is `target/r14-preview/monocode-r14-stream.exe`, PID `123272`, SHA-256 `450cdbec42dfad0690e64f8a5684fc06b8d05942da2b7cdbf9a2ca5038d3b167`, with loaded `App-DUEFOdYu.js` and `App-C-Pl6AZq.css`. It uses the same isolated profile, launched from another empty temp folder. The baseline receipt and pulse sequences above are retained as earlier acceptance evidence.

Real goal `673a9e52-9693-4aa8-9c20-d019516e00f1` dispatched read-only task `674104f0-0c66-4917-81fa-e65b078804ef` to Atlas Engineer. The worker ran a prepared README assertion, waited 12 seconds, asserted the repeated read was unchanged, and saved its report. The Manager accepted exact dispatch `71c83289-a180-47eb-a0a6-4a0a9a1aef68` with `completionOutcome:no-changes`; the goal is done and the run finished. Both repositories retain their original HEAD, byte-identical README and clean status.

At 7.7 seconds after dispatch, no one-shot pulses remained. Both Engineer → Manager and Manager → Orchestrator paths still had upward, infinite `team-map-work-flow` CSS animation. Their dash offsets changed from `-2.77841px` / `-7.1952px` to `-14.7784px` / `-19.1952px` in the next sample. Needs you dimmed both active edge groups while preserving their underlying flow. Reduced motion preserved static `6px, 6px` dashes with no edge animation. After report acceptance and the team becoming idle, both flow attributes and animations were absent.

Evidence: [underway](evidence/streaming-active.png), [finished](evidence/streaming-finished.png), [streaming receipt](evidence/streaming.json). These screenshots use the actual `1280×1038` native client without device emulation. The continuous effect reads existing availability/task state and animates through CSS; it adds no event generator, polling or progress timer.

The preview remains visible, idle and dark. Final native and browser heights are both `1038`, with dialog bottom `1022`; device and media overrides are cleared. The original user preview, PID `88776`, remains running. No push or remote publication was performed.
