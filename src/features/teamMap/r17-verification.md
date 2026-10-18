# R17 Team map layout verification

The reproduced org has four Managers, four members under `dzdistro4`, three under `browser-link-4`, and two empty teams. On the same **1100 × 1250 canvas**, the original layout fits at **41%** and the new layout at **100%**, in both themes. The new cards show full task lines without vertical clipping; long names and task titles retain ellipsis and hover details.

| Scenario | Canvas | Fit | Orientation | Visible cards |
| --- | --- | --- | --- | --- |
| User org, dark and light | 1100 × 1250 | 100% | Left to right | 12 |
| Wide user org | 1600 × 800 | 100% | Left to right | 12 |
| Ten members in dzdistro4, three in browser-link-4 | 1100 × 1250 | 100% | Top down | 18 |
| Five Managers with six members each | 1100 × 1250 | 92% | Left to right | 36 |

The browser checks assert at least 90% fit for those scenarios, zero card overlaps, and enough task-line height to avoid flex shrinking the text. No browser errors occurred. The initial visual pass found clipped task text; final captures include the corrected spacing.

Before screenshots use the exact original Team map sources from commit `e7e2d4d8849bb38af58193de8c5fc31e535f77ea`: [dark](evidence/r17-before-dark.png), [light](evidence/r17-before-light.png), [baseline receipt](evidence/r17-before-live.json). Final screenshots: [dark](evidence/r17-after-dark.png), [light](evidence/r17-after-light.png), [wide](evidence/r17-after-wide.png), [ten-member team](evidence/r17-after-10-members.png), [five teams of six](evidence/r17-after-5x6.png), [focused team](evidence/r17-after-focus.png), [compact cards](evidence/r17-after-compact.png), [idle summary](evidence/r17-after-idle-summary.png), [routed pulse](evidence/r17-after-pulse.png), and [narrow list](evidence/r17-after-narrow.png).

Interaction checks cover Manager click focusing its pod at 150%; Escape returning to the 100% whole org while keeping the map open; a scoped Manager opening already focused; separate Manager chat navigation; a member opening its chat through Enter; right-arrow movement between grid neighbors; an idle team collapsing to `4 teammates · all idle` and expanding again; Needs you dimming cards and edges; project filtering; crew-feed highlighting and member focus; and viewport resize recomputing the layout. At 69% zoom, all twelve task lines are hidden and twelve status chips remain. Reduced motion produces `0s` canvas and card transitions with no `animateMotion` elements.

A synthetic assignment sent through the existing crew-message store produced one pulse along the new trunk-and-branch route to the Researcher card and a matching feed entry. This checks the actual subscription, event routing, SVG path and UI. It does not establish real-provider task acceptance.

The [final runtime receipt](evidence/r17-after-live.json) records geometry, interaction results and SHA-256 hashes of the actual source snapshot loaded by the browser. The fixture ran from the newly created empty folder `C:/Users/nooro/AppData/Local/Temp/monocode-r17-layout-evidence`, outside Git ancestry, with identifier `com.monocode.r17.layout-evidence`, its own browser profile, and no real project or user app profile. It uses the actual TeamMap, theme CSS and Mono stores, with a labelled synthetic roster and Tauri API shims. Fixture and capture scripts remain local in that folder and under `target/r17-screenshots/`.

All four loaded source hashes matched the final workingtree files. The isolated Vite service and browser were stopped after capture; cleanup found zero remaining browser processes for this fixture. User processes were left untouched.

These are live browser component checks, not native desktop or real-provider acceptance. No native binary rebuild, real checkout preview, remote push, merge or deployment was performed by this verification run.

Frontend verification passed: the focused Team map suite has **50 passing tests across five files**, and the final full frontend run has **5,339 passing tests across 502 files** with **13 existing Antigravity tests skipped across two files**. The full run finished in 189.46 seconds with `NODE_OPTIONS=--no-experimental-webstorage` and `vitest run --maxWorkers 4 --testTimeout 15000`; the Node option avoids Node 26's unavailable native localStorage overriding happy-dom. Two earlier full runs using the default five-second timeout hit unrelated `FileEditorCrlfGit.test.ts` timeouts under Windows Git contention, with follow-on DOM failures after an unfinished `act` call. That file passed all four tests independently at the default timeout, and all assertions passed in the final full run after the isolated preview was stopped. No repository test timeout or assertions were changed for that issue. Standalone `tsc --noEmit` and `npm run build` (`tsc` plus Vite) also exited successfully. Existing build warnings concern transcript `::highlight` CSS, mixed static/dynamic imports and large chunks.
