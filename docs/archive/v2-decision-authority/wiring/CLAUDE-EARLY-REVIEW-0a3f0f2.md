# Claude source-only early review — V2 partial `0a3f0f21eeeab0771cf8421dfdd08cbad701d092` / tree `05fbe162…` (base `4b32e8b1`)

**Verdict: on track (source), no blockers.** This is a partial, unwired checkpoint, so it is not an integration clearance. The final review happens at the wired pin.

## Verified in source
- **Session persistence** (`sessionStore.ts` / `session.ts` / `messageQueue.ts`):
  - `monoDecision` is a strict 5-field reference (manager / decision / version / event / recipient), each capped at 512 characters;
  - kept only on internal blocks;
  - a malformed reference drops the queued item rather than turning it into a plain user message (no authority laundering);
  - decision blocks are excluded from goal-submission sanitization.
- **Queue:**
  - decision items **never steer**;
  - they wait while a pending question or approval exists;
  - they also wait on pending account switches, storage holds and return choices.
- **User actor only from real gestures** (`assertDecisionUiGesture`): `isTrusted` plus `click` plus a `[data-decision-ui]` ancestor, and it is the only constructor of `{kind:"user"}`. Habits, automations and the team derive the owning Mono from runtime state, with sender and generation revalidated around the awaits.
- **Quarantine:** opaque evidence is retained, and saves refuse to modify quarantined entries (read-only). A fresh active domain is opened in the same serialized save, per the contract.
- **Prompts:**
  - Managers and the Boss get the `bossMayDecide`-derived matrix plus the schema (+918 characters);
  - members get a 159-character pointer to the app rules;
  - the original 9,500/12,500 budgets are unchanged and passing.

## P3 notes (no action required now)
- A malformed queued decision item is dropped. Recovery relies on the ledger receipt still holding the outbox: confirm in the wiring stage that the ledger only marks delivery acknowledged *after* the recipient queue save has been read back (the CC5D pattern).
- `isTrusted` defends against in-app automation and scripts, but not against OS-level UI automation driving the real window (e.g. computer-use agents). Document it as an accepted boundary.

## For the final wired review
Bring the connected evidence listed in `CLAUDE-CONTRACT-REVIEW.md`, plus a real end-to-end run: ingest → Manager → Boss → user click → answer delivered → consumed exactly once → reload.
