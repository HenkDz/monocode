# R12 live-test findings

This branch fixes the ten findings in the coordinator's R12 brief. Worker changes are measured against the checkout at dispatch, including inherited uncommitted edits. The existing seeded-worktree behavior is intentional and retained.

| Finding | Verified cause and change |
| --- | --- |
| No-change acceptance | Ordinary workers were checked against the assignment branch, while read-only workers had an immutable snapshot. All new tasks now retain their first dispatch snapshot and compare HEAD and content against it. Rejections name changed paths since task start. Older tasks reuse the earliest saved snapshot or complete with the explicit **Completed (no changes, baseline unknown)** outcome. |
| Lifecycle disagreement | Recent tasks exposed raw worker status while cards derived review/acceptance state. All task surfaces use `managerTaskLifecycle`, with current PR evidence where available. |
| Team messages | Provider prompts used user-role blocks, which rendered as user bubbles and participated in user affordances. Team deliveries retain sender metadata, render incoming with name/mascot, and are excluded from user editing and counts. Legacy envelopes remain readable. |
| Availability disagreement | Headers used the agent's own session while Activity rolled up its team. `monoLiveState` supplies the same live state to headers, sidebar, org nodes and floating windows. |
| Lost sidebar expansion | Project rows, Manager team and Finished sections kept expansion in component state. Per-project storage retains these choices across navigation and remounts, preserving the existing Task worktrees storage key. |
| Artifact IDs | Compact rows rendered plain strings and artifact links used generic labels. Shared title chips resolve artifact metadata and open the reader across Activity, cards, feed and Markdown summaries. |
| Empty project groups | Activity registered a project before checking for visible content. Empty groups are omitted. |
| Missing Managers | Assignment could resolve a Manager engine ID without creating a Mono record. Assigned projects now have empty Manager records immediately; session and provider creation remain lazy. Existing assignments are migrated. |
| Member Details | Permissions was rendered after the entire member panel, and Specialty lacked overflow handling. Permissions follows model settings; Specialty truncates with a full-text tooltip. |
| Accessible commands | Sidebar accessible names included the current tool command. Names now expose agent identity and availability. |

Managers accept report-only results with `control review {"taskId":"…","outcome":"accept-no-changes"}`. This does not create a PR, merge, remove a worktree or alter checkout content. Unknown-baseline acceptance is explicitly labelled; it is not proof of an unchanged checkout.

The inherited-change count is shown in task details. Changed code retains its review and PR flow. Agent merge/destructive-action protections are unchanged.

Validation on the final implementation:

| Check | Result |
| --- | --- |
| Full frontend suite | 5,264 passed; 13 existing skips. |
| Full host suite and host TypeScript | 96 passed; 12 existing platform skips; TypeScript passed. |
| Frontend TypeScript and production build | Passed; existing CSS highlighting and large-chunk warnings remain. |
| Native worktrees | 17 passed, including content/path hashes, staged edits, renames, commits and dirty submodule content. |
| Native control CLI / authorization / read-only | 15 / 12 / 4 passed. |
| Provider protocol and provider checks | 257 passed. |
| Focused orchestration acceptance | 105 passed, including inherited edits, new changes, unknown-baseline migration and retry behavior. |
| Independent integration review | Completed; lifecycle, availability, legacy baseline, messages, artifacts, lazy Manager creation and expansion persistence checked. |

Full test logs are retained in `target/r12-frontend-tests-final-capture.log` and `target/r12-host-tests-current.log`. The final web build log is `target/r12-web-build-final-capture.log`.

The final isolated native preview is `target/r12-preview-final/monocode.exe`, identifier `com.monocode.desktop.r12-test-findings`, SHA-256 `4cfb3af901289cf502260cf4a9a9d55bc16f4d5ff287cf12eacd2de378bebaac`. It launches from `C:/Users/nooro/AppData/Local/Temp/monocode-r12-empty-launch`; Git confirms that folder is outside a repository. The initial live acceptance used the same implementation before the final sidebar-only patch, binary SHA-256 `3c1259878e7f80e99f2faa32871e024ac0c0b9c74ef717249a8d3cff2e1ccb72`.

The user's `com.monocode.desktop.manager-review-verified` profile was confirmed running by its exact WebView2 user-data directory (parent MonoCode PID 88776). Its three browser-link-4 sample tasks were not changed. The executable directory name `manager-final-preview` does not establish the running profile's identifier. The bounded process receipt is `target/r12-user-profile-active.json`.

After that profile exits, build this checkout with the existing `../nou/target/manager-review-verified.json` Tauri configuration, launch from an empty folder, and ask its browser-link-4 Manager to close only the three sample tasks with `control review {"taskId":"…","outcome":"accept-no-changes"}`. Verify that they appear in Finished with matching labels on every surface; legacy tasks with no original dispatch snapshot must show **Completed (no changes, baseline unknown)**. Preserve their worktrees and checkout edits.

| User-profile sample | Task ID |
| --- | --- |
| Trace URL routing | `7bfca491-261d-4a4e-a2cb-b539264045fc` |
| Inspect native UI tests | `8af064b0-abf3-4797-926b-fb0823c09e2f` |
| Audit smoke-test isolation | `2ac8cfff-a824-45e2-970c-afa1a1e94425` |

Their retained lead is `project-manager-c1a740dd58f3ffa5d77a09c1bae0089e2168ca473e0e9cbb0286d417ea404975`. The conditional closure must wait until the profile and its WebView2 processes have exited; a binary filename alone is insufficient to establish that condition.

The isolated live repro dispatched ordinary task `ad125a79-cae6-490e-a0b9-6b5d5d878f6b` on `mc/baseline-inherited-edits`, with `readOnly:false`. A real Codex worker completed its report, attached **Report: Baseline inherited edits**, and the Manager accepted dispatch `1e823705-fe2f-456b-8d8f-cbfff4aafea1` with `completionOutcome:no-changes`. Its original snapshot contains inherited `README.md` content. Both source and worker retained ` M README.md`, unchanged HEAD `0e29f40a5fbfc8a3ac5b5b256bb3658f18c10b50`, and byte-identical README SHA-256 `7936bdae1470728bf0bf4c0b2cdd9c484b29a1c4ca7de838b4feb1f74e9b594f`.

The live Settings check also found initially expanded rows had not materialized their default into storage. The final hook now saves that initial choice, with an additional Settings/selection-change/remount regression.

On the final binary, the accepted task survived restart with zero active workers and Idle availability. Settings → Back and a full process restart retained project, Manager team, Task worktrees and Finished expansion. Receipts: `target/r12-live-baseline-accepted.json`, `target/r12-sidebar-settings-preserved.json`, `target/r12-live-final-receipt.json`.

Native captures: [member dark](../target/r12-final-member-dark.png), [member light](../target/r12-final-member-light.png), [Activity dark](../target/r12-final-activity-dark.png), [Activity light](../target/r12-final-activity-light.png), [report reader](../target/r12-final-artifact-dark.png). These show the actual inherited-change task, matching lifecycle labels, title chip/reader, shared Idle state and Details row order. Working-state captures are `target/r12-live-working-dark.png` and `target/r12-live-working-light.png`.

No implementation branch was pushed, no PR was created, and the user's running profile was left untouched. Generated binaries, captures, logs and disposable checkout data remain local in ignored `target/` directories. The full native suite was not run; the relevant native groups above passed.
