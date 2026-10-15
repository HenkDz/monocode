# CC-FB2 footer usage navigation

The footer usage popover offers **See all usage →** after the quota windows and
before banked resets, so reset details do not hide the dashboard action.
The action closes the popover and invokes the supplied `onOpenUsage` callback.
`UsageFooter` forwards it to Claude, Codex, OpenCode, Devin, and Pi chips.
The trigger, account picker, add-account view, and sign-in view retain their behavior.

The single App integration line is held for the coordinator's accepted CC-STATE
handoff: add `onOpenUsage={() => onOpenTeamMap(USAGE_DASHBOARD_SCOPE)}` to the
existing `UsageFooter` JSX. No new navigation state or dashboard collector is needed.

Validation: four focused shell files passed 34 tests, with no failures or skips;
TypeScript passed; Chromium passed two dark/light synthetic cases, including
keyboard activation, Escape focus return, account-picker navigation, popover
closure, and dashboard-heading focus. Screenshots were individually inspected.
The fixture uses real footer, popover, and dashboard components with synthetic
quota data and mocked IPC; it does not boot the installed/native/full App.

Logs and screenshots are retained at
`C:/Users/nooro/AppData/Local/Temp/monocode-cc/ccfeedback2/evidence/`.
Reports and the open-batch checkpoint are in the parent `ccfeedback2` directory.
No broad suite, production build, native/profile/provider acceptance, or release
was attempted. Root freezes the batch and owns fresh review/integration/release.

## Follow-up: long elapsed time

The transcript's running and completed work rows now use `formatLiveElapsed`,
the same helper as live-agent previews, task metrics, Workbench headers/details,
and Mono activity. It formats nonzero days, hours, minutes, and seconds while
preserving the existing rounding and minimum one-second display. The reported
`1642m 8s` becomes `1d 3h 22m 8s`. Measurement, timestamps, and timer behavior
are unchanged. Focused tests passed 120/0/0 across eight affected files,
including minute/hour/day boundaries, a multi-day example, both fold states,
timer ticks and cleanup. TypeScript passed. Dark/light running and completed
row screenshots were individually inspected.

## Follow-up: hidden window controls, App hold

The top-left destinations are Mission Control, Usage, Attention, Map (tree and
orbit), Search, Inbox, Pull Requests, Notes, Automations, and Settings. The last
six already own their window chrome. The first four share `teamMap.open`, which
hides/inerts the workspace subtree containing the existing TitleBar and its
WindowControls. This was reproduced with real page components and placement
expressions extracted from current App source by the synthetic fixture.

The smallest fix is App-only and is still held for the accepted State handoff:
hoist the same existing title bar while non-macOS TeamMap pages are open, and
let it own controls while the underlying Mono panel is hidden. No page-specific
buttons, new chrome component, z-index change, or native callback change is
needed. The fixture currently verifies the accepted base's missing controls;
replace that reproduction assertion with positive geometry/hit-testing,
callback and keyboard cases after the held App edit is authorized. This is not
a repaired-window-controls acceptance claim.

Final follow-up images are under `evidence/browser-20261015T102821Z/`.
Earlier passing capture runs at `102434Z` and `102637Z` are retained, but their
running-row screenshots were clipped by the original fixture containers and
are not visual acceptance evidence. The fixture containers/capture were fixed;
product layout, timers and assertions were not weakened.
