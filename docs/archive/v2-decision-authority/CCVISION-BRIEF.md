# CC-VISION — Decisions-first command map + workspace (USER-APPROVED design)

Read COMMON.md and OPERATING-MODEL.md first. Base: nour `8232734e` (UP15 + FB3 + FB4).
- **Supersedes CC-LAYOUT.** Its mockups were never shown to the user. Reuse any of its findings on the inset sidebar.
- **No further mockup approval is needed.** The user approved the two interactive prototypes below on 2026-10-19 ("I love both map and workspace view"). Match them closely, using MonoCode's real components and design tokens.

## Approved reference prototypes (open in a browser; invented data)
- `cc-program/vision/index.html`, the **Command map**. `#bl4` opens a project drawer.
- `cc-program/vision/workspace.html`, the **Workspace view**. `#wt` opens a worktree.
- Rendered frames are in the same folder: `preview.png`, `preview-project.png`, `preview-workspace.png`, `preview-worktree.png`.

## The user's product vision (use these exact principles)
- Coding is moving to **decisions**. The user sees outcomes and makes decisions; commands and logs stay hidden unless opened ("Show work" / "Worked for…" folds).
- **An escalation ladder:**
  - a worker asks its Manager;
  - a Manager decides within its authority, otherwise escalates to the Boss (Grand Orch);
  - the Boss decides, or escalates to the user only for **high-impact** calls.
  
  Otherwise the team works toward the goal autonomously.
- **Managers choose skills and integrations.** The user only approves **installs** and provides **sign-ins**.
- **Merging is always the user's call** (an existing hard rule). Worktrees and PRs are first-class in the everyday view.

## Stages (one builder per stage, in parallel where independent; storage/persistence parts get Claude review)

**V1: Workspace shell on the v0.15 inset sidebar.** UI only; reuses existing data.
- **Project switcher** with live status ("3 working · 1 decision").
- **Search or ask the Boss** (Ctrl K).
- **Nav:** Command map, **Decisions** (count), Inbox, Notes, Automations, **Usage** (mini meter).
- **Team:**
  - the Boss, pinned for all projects;
  - this project's Manager;
  - its members indented below, each with a one-line activity and a state dot (the CC4 live-state selector).
  - Clicking opens the existing Manager chat or member Workbench.
- **Worktrees:**
  - each row shows the branch, a state dot and a PR chip (number and status);
  - clicking opens a right-panel **Worktree** tab: owner, base, ahead/behind, change size, and the PR card (title, review status, checks, files with +/−);
  - state-aware actions: Merge (user only; reuse the existing PR/merge plumbing and approvals), Update from main, Create PR, Archive worktree, Open folder.
- **Chats**, then the **project spaces bar** with busy and decision dots.
- **The right context panel** has tabs **Goal & tasks** (goal progress, one line per task, "This project decides": autonomy level, decided-today count, skills chosen by the Manager, usage) and **Worktree**.
- Keep compact rail mode, shortcuts and window controls working.

**V2: Decision system (data + UI).** Persistence work, so it needs Claude review.
- **A durable Decision record:**
  - id, project, the requesting Mono, the **escalation chain** (e.g. worker → Manager → Boss → user);
  - question, impact (low/med/high), one-paragraph context, options, recommended option plus who recommends;
  - status (pending / decided / delegated) and the decider level (Manager / Boss / You);
  - created and decided timestamps.
- **Builds on the existing `team.message` kinds** (`info | question | decision | escalation`, `monoCrewEvents.ts`) and the CC5D wake digest plus CC-GOAL authority. Don't build a parallel channel.
- **The ladder:**
  - Managers resolve within authority and log it;
  - escalation to the Grand Orch is a real routed message;
  - the Grand Orch can decide or escalate to the user;
  - the per-project **autonomy setting** ("Ask me for: High-impact only · Medium & up · Everything", default high-impact only) sets the threshold.
- **The user's decision or "Let the Boss decide"** is delivered back down the chain as an authoritative answer, preserving request/goal authority (CC-GOAL), exactly once (CC5D receipts).
- **UI:**
  - the **Decisions** page and the Command map's right rail: cards with the chain, question, impact, context, options with the Boss's recommendation, Open project, and Let the Boss decide;
  - a **Decision log** tab showing who decided what and at which level;
  - "N decisions handled by the team today".
- **Agent rules** (prompt/team rules) teach Monos to *decide within authority*, escalate with a structured decision payload (question, impact, options, recommendation), and keep updates to summaries.

**V3: Command map.**
- Replace or extend the Team map / Orbit map (`src/features/teamMap/OrbitMap.tsx`, `TeamMap.tsx`) with the approved map:
  - the **Boss at the top**, with an escalation badge;
  - projects arranged below, each with a status pill, team squares (one per member, colored by state), goal progress bar, goal line and pending-decision badge;
  - animated links for working projects.
- **Clicking a project** opens the drawer: goal and progress, the autonomy segmented control, waiting decisions, team and tasks (summary per member plus a **"Show work · N steps"** custom fold showing the compact trace from CC-TX), and the Manager chat.
- **Bottom: "Tell the Boss what you want…"**, which creates a goal via the existing Grand Orch path.
- Vitals: working, goals in flight, decided by team today, need you.

**V4: Install and Sign-in approvals (ties to CC10).**
- Inline cards in chats and Decisions: **"Install `<skill>` (+size) for `<member>`, scoped to `<project>`?"** with Install / Not now, and **"Connect `<service>` for `<repo>`"** with Connect / Later, plus "merge still needs your approval".
- **Managers request them through a structured CLI action**, so a Mono can never install or authenticate silently.
- Read the CC10 design (`cc10-skills-design`, `b253459`) for skill scoping. Installs are project-scoped by default.
- A ready-to-merge PR **also** appears as a Decision card.

## Rules
- Clean, modern and calm.
  - Well-designed custom collapsibles are fine; no stock `<details>`/▸.
  - Dark and light themes.
  - Narrow layouts must work.
- No logs or raw paths in default views. Details live behind folds or Details.
- Reuse the existing state selectors, stores and commands. Don't duplicate status logic.
- The prototypes are invented data: wire to real data and show honest empty states.
- **Gates per stage:** focused tests; browser frames compared against the prototype frames; tsc/build; full suite before integration; plain `cargo test --lib` if native code changes.
- **V2 (decision persistence and the authority chain) and any installer/auth native code get Claude review.**
- Never push or deploy, and never touch the real profile, `~/.codex`, or credentials. Test-profile builds (overlay `com.monocode.preview.cc.rg1202610131819404564df`) after each stage that integrates.

## Suggested order
1. V1 and the V2 data model in parallel.
2. Then V2 UI and V3.
3. Then V4.

The coordinator decides the exact split under the operating model (up to 6 agents, at most 2 heavy jobs). Report per stage. The final deliverable is a Checkpoint 5 test build, so the user can test the full vision.

## V4 expanded: skills + integrations (user-approved prototype, 2026-10-19)
The prototype is `vision/workspace.html`: the "Access request" card in chat, the sidebar **Integrations** page (`#int`), and the frames `preview-cards.png` / `preview-integrations.png`.

- **Agents request capabilities, never credentials.**
  - A structured Mono CLI action declares: service, scopes, project and Mono scope, duration ("until goal done"), and a plain-language reason.
  - It becomes an inline **Access request** card: reason quote, scope chips, provider badge, "the agent never sees the token", **Connect / Not now / See tools** (the exact tool list).
  - It also appears in Decisions when it is protected.
- **Provider layer** (one interface, several backends):
  - existing CLIs (e.g. `gh`);
  - **local MCP servers** (sensitive data, e.g. databases or local files: "data never leaves this machine");
  - **Composio** as the default for SaaS apps (managed OAuth and token storage, tools exposed over MCP).
  
  Connections are bound to MonoCode-owned private homes/config. **Never write the user's real `~/.codex` or `~/.claude`.**
- **Integrations page:**
  - Connected rows: logo, name, provider badge, scope summary, which Monos use it, last used / call count, **Revoke** (or Remove for skills).
  - **Suggested by your team** (a Manager's reason, Connect / Dismiss).
  - **Rules:**
    - free use for reads and routine writes;
    - **always ask: merge · spend · delete · message people · system settings**;
    - default SaaS provider Composio;
    - sensitive data local MCP only;
    - tokens held by the provider or OS keychain, never in agent context.
- **Tool calls** appear only as one-line entries inside the "Worked for…" / "Show work" folds.
- **Start with a spike (no product code).**
  - Verify Composio's current API, MCP integration with Codex and Claude Code, OAuth flow from a desktop app, scoping and revocation, pricing and terms, and data residency.
  - Compare it with Arcade, Pipedream Connect, Smithery-hosted MCP and local-only MCP.
  - Recommend; the user approves the provider before build.
- **Credentials and auth code paths get Claude review.**

## V4 provider decision (USER, 2026-10-19)
**"Local first, then your own key."**

**V4a (build now):**
- skills + Install cards;
- capability requests;
- existing CLIs (`gh`);
- **local MCP** servers;
- the Integrations page;
- the trusted-broker pre-execution policy (always ask: merge, spend, delete, message people, system settings).

Also:
- **Correct the copy:** local MCP results still reach the model provider through the agent's context. Never claim "data never leaves".
- Document the same-user bypass boundary.

**V4b (next):** Composio via the **user's own account and API key (BYOK)**.
- The key is stored in the **Windows Credential Manager / OS keychain**.
- It is used **only by MonoCode's in-app trusted broker**, never in agent config or environment, and never in a provider/Mono home.
- No hosted backend.
- Start with one read-only connector, pinned to exact tools, least-privilege scopes, project/Mono/goal scope and a deadline.
- Disable proxy/code/shell/unknown tools.
- Disable or limit payload retention where Composio allows; show the user the retention setting.
- Account creation, plan/spend and connector activation each need explicit user action.

**Not chosen:** a hosted backend, or Pipedream, for now. Pipedream stays a fallback if Composio's retention terms are unacceptable.

**Claude reviews:** secret custody, broker authority, private-home persistence and the threat limits, in both V4a and V4b.
