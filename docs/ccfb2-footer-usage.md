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
