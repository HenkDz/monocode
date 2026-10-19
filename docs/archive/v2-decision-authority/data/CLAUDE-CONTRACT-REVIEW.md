# Claude early review — CC-VISION V2 data contract (`CONTRACT.md`, base `8232734e`)

**Verdict: APPROVED in direction, with 8 required clarifications** to build into the implementation and tests before the final review.

**What's right, keep it:**
- It reuses the `team.message` kinds, the GoalLedger serialized writer (`control_save` / `control_load`), CC5D stable receipts and CC-GOAL guards.
- No native, schema or parallel channel.
- Authority comes from host-supplied live snapshots, never from payloads.
- Protected operations always go to the user.
- Absent fields mean defaults; invalid present data fails closed.

## Required clarifications
1. **Single authoritative owner per decision.** A decision moves worker → Manager → Boss → user. Ledgers are per owner (`mono-goals:<owner>`).
   - **Pick one home**, preferably the originating project Manager's ledger, keyed by the decision id.
   - Every level reads and updates **that** record through its serialized writer; other levels (Boss, UI) hold references only.
   - No duplicated copies that can diverge. Test that an escalation updates the same record, and that concurrent Boss and user actions serialize, with the second refused as stale.
2. **Only the trusted host can produce answers.**
   - Monos may only *ingest* question and escalation payloads, parsed from `text` JSON.
   - Any `decided`, `answer` or `delegated` status, or a user-level resolution, must come solely from host actions: UI clicks, or the Boss's own authenticated `team.message` at its chain level, validated against the live roster.
   - Text that claims to be an answer, or that names a decider, is ignored as a summary. Add spoofing tests: a worker forges a user answer; a Manager forges a Boss decision.
3. **Impact can be raised, never lowered.**
   - A requester's self-rated impact is a floor.
   - Higher levels may raise it, but nobody below the user may lower a high one.
   - **Protected classes force a user decision whatever the stated impact or the autonomy setting:** merge, install, sign-in/credentials, destructive operations, system or default settings, spending.
   - Classify these from structured fields (an action type), not from prose. Test that a "low"-labelled merge still reaches the user.
4. **Bounded history.**
   - Decision history lives inside a ledger saved through `control_save`.
   - Keep all pending decisions, plus the last N decided (e.g. 200) or 30 days.
   - Move older ones into a compact, append-only archive record, or prune with a count shown in the UI log.
   - Never drop a pending decision.
   - Test large-history save/load size limits.
5. **Exactly-once delivery downward.**
   - The user's answer or delegation travels back down to the requester via CC5D receipts, with a stable answer-event id derived from `decisionId + resolution version`.
   - Duplicates after a restart or retry are no-ops.
   - **A stale answer** (goal cancelled, task replaced, generation changed) is recorded on the decision but not delivered as authority. The UI shows "resolved, but the task moved on".
6. **Pending decisions don't freeze the team.**
   - The requester continues other work.
   - Nothing auto-decides at the user level; no timeout auto-approval.
   - After a delay, the Boss may *remind* the user, or re-prioritize.
   - Reminders, and the Boss deciding medium-impact items within its authority, are both recorded in the log with the decider level.
7. **The Boss's authority is explicit.** Define what the Grand Orch may decide (≤ the project's autonomy threshold, never protected classes) versus what it must escalate. That rule lives in one shared function used by both the runtime and the prompt rules.
8. **Hygiene.**
   - Decision context and options are displayed, never executed.
   - Treat them as untrusted evidence: render them as text, and strip or escape any markup.
   - Cap their length (question ~300, context ~2,000, options ≤ 6).
   - Do not log them into telemetry.

## Final review requirements
- Exact HEAD and tree.
- The 8 items above, each mapped to tests.
- Plain gates: focused tests, full Vitest with workers 1, tsc/build. Plain `cargo test --lib` only if native code is touched, which isn't planned.
- Raw failures retained.

Claude reviews the final pin before integration.
