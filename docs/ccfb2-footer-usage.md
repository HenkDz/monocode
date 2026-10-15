# CC-FB2 acceptance feedback

The footer usage popover offers **See all usage →** after the quota windows and
before banked resets, so reset details do not hide the dashboard action.
The action closes the popover and invokes the supplied `onOpenUsage` callback.
`UsageFooter` forwards it to Claude, Codex, OpenCode, Devin, and Pi chips.
The trigger, account picker, add-account view, and sign-in view retain their behavior.

App supplies `onOpenUsage={() => onOpenTeamMap(USAGE_DASHBOARD_SCOPE)}` to the
existing footer. No new navigation state or dashboard collector is needed.

## Long elapsed time

The transcript's running and completed work rows now use `formatLiveElapsed`,
the same helper as live-agent previews, task metrics, Workbench headers/details,
and Mono activity. It formats nonzero days, hours, minutes, and seconds while
preserving the existing rounding and minimum one-second display. The reported
`1642m 8s` becomes `1d 3h 22m 8s`. Measurement, timestamps, and timer behavior
are unchanged. Tests cover minute/hour/day boundaries, a multi-day example,
both fold states, timer ticks and cleanup.

## Window controls on workspace pages

The top-left destinations are Mission Control, Usage, Attention, Map (tree and
orbit), Search, Inbox, Pull Requests, Notes, Automations, and Settings. The last
six already own their window chrome. The first four share `teamMap.open`, which
hides/inerts the workspace subtree containing the existing TitleBar and its
WindowControls.

App now hoists the same existing title bar while non-macOS TeamMap pages are
open and lets it own controls while the underlying Mono panel is hidden.
There are no new page-specific buttons, chrome component, z-index changes, or
native callback changes. Existing macOS chrome placement is preserved.

## Validation and boundaries

Accepted State base: `0f9e8ce34e9661e0ee866a91fbcff0a9d74bc3ae`, tree
`baced9d09706ae01f14e38193af58ea2bdc8c070`. Only the five disclosed App hunks
change beyond that base; State publication, reducer, replay and authority code
remain untouched.

Affected tests: **191 passed, 0 failed, 0 skipped** across 15 files. Unchanged
State App/batch guards: **34 passed, 0 failed, 0 skipped**. TypeScript: exit 0.
Chromium: **12 passed, 0 failed, 0 skipped**, then **2 passed** for the footer
fixture after binding its exact App callback. The twelve cases include six
Windows layout/theme cases, two Mac cases, two duration cases and two footer
cases. Each Windows case checks both workspace and hidden-Mono origins, all
four destinations plus both Map modes, one visible set of controls, geometry,
hit-testing, drag-region exclusions, keyboard/native mock callback dispatch,
maximize/restore icon updates and return navigation. No page errors occurred.

The fixture reads App's actual title-bar placement, workspace hidden/inert,
chrome-state, control-suppression and footer-callback expressions. Connected
unit tests also execute the App Usage navigation body and heading-focus effect.
Real components and WindowControls are used; native IPC, data, sidebar context
and the underlying Mono panel are synthetic. Other-page control guards are
verified from their source for Windows and Mac; their complete controllers are
not mounted. Native traffic lights and actual window-manager effects are not
tested.

Evidence root: `C:/Users/nooro/AppData/Local/Temp/monocode-cc/ccfeedback2/`.
Final logs: `evidence/wired-20261015T104225Z.log`,
`state-20261015T104320Z.log`, `tsc-20261015T104344Z.log`,
`browser-20261015T104436Z.log`, `footer-browser-20261015T104620Z.log`.
All 36 chrome frames and four duration frames from the `104436Z` directory,
plus the two source-bound footer frames from `104620Z`, were individually
inspected. REPORT.md retains raw prior failures and preliminary capture limits.

No broad suite, production build, native/profile/provider acceptance, or release
was attempted. Root freezes the batch and owns fresh review/integration/release.
