# R13 visual evidence

The captures use the actual React components and shared theme stylesheet, rendered in Chrome with fixture orchestration, Mono roster, GitHub and Tauri services. They demonstrate component layout and interactions, not a native build or a real task execution. No user profile or checkout was opened.

The preview started in the disposable empty folder `C:/Users/nooro/AppData/Local/Temp/monocode-r13-component-preview`, outside Git. It uses its own Chrome storage directory and the fixture application identifier `com.monocode.r13.component-evidence`. Before components came from a Git archive of `465c686`. After components were copied from this R13 worktree; the [source receipt](../target/r13-visual-source-receipt.json) records their hashes.

Screenshots and receipts remain local under ignored `target/`. The [complete screenshot index](../target/r13-screenshots/index.md) includes five surfaces in both themes at 900px and 390px, plus narrow Open dialogs, Details sub-pages and Activity tabs.

| Surface | Before dark | After dark | Before light | After light |
| --- | --- | --- | --- | --- |
| Member chat | [Before](../target/r13-screenshots/before-member-dark-900.png) | [After](../target/r13-screenshots/after-member-dark-900.png) | [Before](../target/r13-screenshots/before-member-light-900.png) | [After](../target/r13-screenshots/after-member-light-900.png) |
| Manager: Team hired and PR-ready | [Before](../target/r13-screenshots/before-manager-dark-900.png) | [After](../target/r13-screenshots/after-manager-dark-900.png) | [Before](../target/r13-screenshots/before-manager-light-900.png) | [After](../target/r13-screenshots/after-manager-light-900.png) |
| Activity | [Before](../target/r13-screenshots/before-activity-dark-900.png) | [After](../target/r13-screenshots/after-activity-dark-900.png) | [Before](../target/r13-screenshots/before-activity-light-900.png) | [After](../target/r13-screenshots/after-activity-light-900.png) |
| Details | [Before](../target/r13-screenshots/before-details-dark-900.png) | [After](../target/r13-screenshots/after-details-dark-900.png) | [Before](../target/r13-screenshots/before-details-light-900.png) | [After](../target/r13-screenshots/after-details-light-900.png) |
| Sidebar: Task worktrees and Finished | [Before](../target/r13-screenshots/before-sidebar-dark-900.png) | [After](../target/r13-screenshots/after-sidebar-dark-900.png) | [Before](../target/r13-screenshots/before-sidebar-light-900.png) | [After](../target/r13-screenshots/after-sidebar-light-900.png) |

The [after receipt](../target/r13-after-visual-receipt.json) records mounted page text, disclosure counts, panel widths, runtime exceptions and horizontal overflow. All five after surfaces are free of inline `<details>`. The [interaction receipt](../target/r13-interaction-receipt.json) covers Open dialogs, Shift+Tab containment, Escape and focus return, artifact/Team/worktree navigation dismissing its dialog, all four Details sub-pages and back buttons, keyboard navigation between counted Activity tabs, Feed and Show work. Every accepted capture has no browser runtime exception or horizontal page overflow. The narrow-width audit found the existing Details resize maximum compressed its 340px minimum to 156px at a 390px viewport; the final source retains a readable 340px panel at that width, verified in the receipt and three rendered width tests.

Additional narrow evidence includes the [member task reader](../target/r13-screenshots/after-member-open-dark-390.png), [PR detail reader](../target/r13-screenshots/after-pr-open-light-390.png), [Team hired detail](../target/r13-screenshots/after-team-open-dark-390.png), [Soul sub-page](../target/r13-screenshots/after-details-soul-light-390.png), [Feed](../target/r13-screenshots/after-activity-feed-dark-390.png) and [Show work output](../target/r13-screenshots/after-activity-show-work-light-390.png). Reduced-motion preference is exercised on the Soul sub-page; its covered-page transition property computes to `none`.

| Check | Result |
| --- | --- |
| Full frontend suite, two workers | 5,270 passed; 13 existing skips; 496 files passed and two files skipped. [Log](../target/r13-frontend-tests-final.log) |
| Final changed and new UI tests, after navigation and width fixes | 104 passed across 15 files. [Log](../target/r13-changed-tests-final.log) |
| Final frontend TypeScript | Passed. [Log](../target/r13-typescript-frozen.log) |
| Final production build | Passed; existing large chunk warnings remain. [Log](../target/r13-vite-build-frozen.log) |

The initial unrestricted full-suite run exposed outdated UI expectations/mocks and resource-sensitive file-editor timeouts. Connected UI tests were updated. Both unrelated file-editor files passed all 13 tests in isolation, then the full suite passed with two workers. Final navigation, work-reader approval and narrow-width changes received the final focused run above.

Native runtime, real provider work and a live artifact read were not exercised by these fixtures. No Team map files were changed; no branch was pushed.
