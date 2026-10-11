# CC7S: member and session view directions

Two clickable design previews extend the user-selected CC7M Cockpit. Open either
HTML file directly; no server or application profile is needed. The top preview
controls switch Reviewer, Native Core and a saved session, populated/zero/loading/
load-error states, and dark/light themes. All data and actions are synthetic.

| | A · [Workbench](cc7s/workbench.html) | B · [Conversation](cc7s/conversation.html) |
| --- | --- | --- |
| Layout | Recovery and assignments on the left; conversation on the right. | Recovery and compact assignments above a full-width conversation. |
| Best fit | Monitoring a member, unblocking work, checking assignment history while messaging. | Reading and steering a long conversation or a saved session. |
| Main tradeoff | Chat has less horizontal space at 1100 px. | Work context uses some vertical chat space; the strip stays compact. |
| History | Three task cards in a labelled, keyboard-scrollable work region. | Three cards in one horizontal row; Current uses a single full-width row. |
| Details | Edge-aligned drawer; the conversation keeps its width. | Same drawer and controls, without a permanent side panel. |

Recommend **A for the member view**: recovery and current work remain visible
while the conversation scrolls. **B suits session reading** and offers a viable
single-column alternative. This round presents the choice; it does not implement
either direction in the application.

Both keep the shared Cockpit CSS, system typography, grayscale surfaces, subtle
borders, state palette and 470 px drawer. The header shows identity, role, a
reasoned state, one short metric line, Message, Steer, Open worktree and Details.
Exact input/cache/output counters and their timing scope move into Details.
Cached input remains a subset of input. Reviewer’s failed launch is distinct
from Native Core waiting for that review; historical outcomes retain their own
state. Unknown state and counters remain unavailable.

Recovery uses a human explanation before the raw launch error. Current / History /
All replaces task disclosures. Conversation and Activity share the same width,
scroll region and composer. Model, effort and access remain beside Send/Queue;
delivery is explained once. Drafts survive tab, filter and theme changes and stay
with their member. Chats open at the latest saved message; twelve earlier messages
make the long-history fixture. CC7T-style tool results occupy one line and open
saved output in the drawer; team messages use distinct bubbles.

The sidebar uses one flat row per task: state dot, short title, member chip and
short outcome. Active / All pages three rows, with full task/branch titles on
hover and in accessible labels. GRAND ORCH retains a short state; its project
and downstream context appear on hover and keyboard focus. Zero, loading and
load-error views cover assignments, transcript and task worktrees. Delivery and
state-dependent actions are disabled when saved state is unavailable.

Rejected: centered task columns above unrelated full-width chat, nested chevron
trees, cached-token noise in the header, always-open details/PR panels, a new
palette, dependencies, app wiring and simulated recovery success. Details and
Session details currently share the same drawer; phase two can keep the existing
member/session context handlers behind those entry points.

## Screenshots and validation

[All 63 screenshots](cc7s/screenshots/index.md) include both directions at
1440 × 1000 and 1100 × 1000, dark/light, for failed Reviewer, Native Core waiting
for review, three-task history, zero, loading and load-error views. Additional
captures show saved sessions, Activity, long conversations, storage/tool drawers
and keyboard-scrolled work history.

- A: [1440 dark](cc7s/screenshots/workbench-1440-dark-reviewer.png),
  [1100 light](cc7s/screenshots/workbench-1100-light-reviewer.png).
- B: [1440 dark](cc7s/screenshots/conversation-1440-dark-reviewer.png),
  [1100 light](cc7s/screenshots/conversation-1100-light-reviewer.png).

Windows / Node 26.5.0 checks use `NODE_OPTIONS=--no-experimental-webstorage`.
Full Vitest: **7,414 passed, 13 skipped, 0 failed**; **611 files passed, 2 skipped,
0 failed**. TypeScript and production build pass. Native files are unchanged.
The isolated Chromium capture passes **649 checks across 50 layouts**, including
1100 × 800 composer reachability. Minimum sampled normal-text contrast is
**5.038:1**. Independent visual review prompted the full-width empty strip,
keyboard history scrolling, focus-visible Grand context and corrected session
author/dependency labels; final screenshots include those corrections.

Evidence: `C:/Users/nooro/AppData/Local/Temp/monocode-cc/cc7s/evidence/`:
`validation/summary.json`, raw validation logs, `browser/verification.json` with
source/image hashes and cleanup receipts, and `design-review.md`. The capture
runner is [capture.mjs](cc7s/capture.mjs). Initial dependency setup and provisional
capture failures remain separately recorded; final counts are not combined.

Application integration, native/WebView2 acceptance, live model turns, a complete
screen-reader audit, merge, push and deployment are outside phase one. Owned
preview processes are stopped and their synthetic profile removed. No app code,
dependencies, real profile data or other worktrees were changed. The starting
commit is `7cc1648927704200fe4c3618fb1498061a4ed304`; the round report records the
local branch and resulting commit.
