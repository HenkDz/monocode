# CC3 mockup screenshots

Final isolated Chromium capture: **14 scenarios, 14 full-page screenshots, 219 checks passed, 0 failed**. Receipt: [browser-verification.json](../browser-verification.json). Reproduce from the worktree root in PowerShell:

```powershell
$env:NODE_OPTIONS='--no-experimental-webstorage'
rtk proxy node docs/cc3/capture.mjs
```

All five pages were opened and inspected by Playwright in dark/light at a 1440 × 1100 viewport. Three dark mobile scenarios used 390 × 1000; the narrow home scenario used 900 × 1000. The PNG heights below include the entire document, beyond the viewport. “Viewed” means the builder opened this final PNG with `view_image` and inspected it visually; other rows received browser assertions and capture only.

| Screenshot | Full-page pixels | Viewed |
| --- | --- | --- |
| [Mission control · dark](mission-control-dark-1440.png) | 1440 × 1180 | Yes |
| [Mission control · light](mission-control-light-1440.png) | 1440 × 1180 | Browser assertions only |
| [Attention · dark](attention-dark-1440.png) | 1440 × 1212 | Browser assertions only |
| [Attention · light](attention-light-1440.png) | 1440 × 1212 | Yes |
| [Timeline · dark](timeline-dark-1440.png) | 1440 × 1337 | Yes |
| [Timeline · light](timeline-light-1440.png) | 1440 × 1337 | Browser assertions only |
| [Member · dark](member-dark-1440.png) | 1440 × 1296 | Yes |
| [Member · light](member-light-1440.png) | 1440 × 1296 | Yes |
| [Steering · dark](steering-dark-1440.png) | 1440 × 1195 | Yes |
| [Steering · light](steering-light-1440.png) | 1440 × 1195 | Browser assertions only |
| [Mission control · mobile](mission-control-dark-390.png) | 390 × 2255 | Yes |
| [Member · mobile](member-dark-390.png) | 390 × 2389 | Yes |
| [Steering · mobile](steering-dark-390.png) | 390 × 1625 | Yes |
| [Mission control · narrow](mission-control-dark-900.png) | 900 × 1349 | Yes |

Visual inspection found no remaining clipping or overlap in the ten viewed final images. The parent also inspected the final light Member image after the capture builder's nine-image review. The narrow workers use both columns; mobile views stack content and place member details below work. Failed QA remains visible, Manager approval availability is separate from review phase, and proposed backend controls are labeled locally.

The checks cover local links/assets, document landmarks/titles, horizontal overflow, native Tab traversal and focus outlines, skip links, native details, inert operational buttons, reduced motion, browser errors, and sampled attention text contrast. There were **258 native-control focus visits** and **114 attention-text contrast samples**; sampled minima were **4.73:1 light** and **5.93:1 dark**. These are repeated visits/samples across scenarios, not distinct controls or a complete WCAG audit.

Palette arrows/Enter/Esc, command execution, member tabs, filtering, approvals, repair, reassignment and goal operations are schematic. Native buttons/selects/inputs/textarea and details retain their normal focus behavior; operational buttons have no scripts, handlers or form actions. This evidence covers static design artifacts, not native MonoCode, provider sessions, app persistence, screen-reader acceptance, touch hardware, or later backend behavior.

The helper uses an empty owned temporary cwd, a separate browser profile, `com.monocode.cc3.mockups`, no `CODEX_HOME`, and zero `ORCA_*` variables. The final receipt confirms browser/server closure and verified removal of the temporary profile. Six HTML/CSS hashes and fourteen screenshot SHA256 hashes bind the receipt to these files.
