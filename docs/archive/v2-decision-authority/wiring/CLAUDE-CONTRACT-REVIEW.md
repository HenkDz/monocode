# Claude early review — V2 wiring contract (`CONTRACT.md`, base `4b32e8b1`)

**Verdict: APPROVED in direction, with 4 required additions.**

**What's right, keep it:**
- The roster-based autonomy without a fabricated goal.
- Quarantine only the decision domain, preserving the exact evidence and keeping goals working.
- No second bus or store.
- Answers stay evidence and never create goals or bypass guards.
- Plain-text rendering.
- The shared `bossMayDecide` used by both the prompts and the runtime.

## Required additions
1. **Quarantine must not disable decisions forever.**
   - After the decision domain of a Manager is quarantined, start a **fresh, empty active decision domain** so new decisions keep flowing.
   - The quarantined evidence stays read-only and visible ("N earlier decisions unreadable · View"), and is never merged automatically.
   - Previously **pending** decisions in the quarantined set are shown read-only, with **"Ask the Manager to re-raise"**. This sends a normal team message so the Manager re-submits through the fresh domain.
   - Starting the fresh domain happens in the same serialized save that records the quarantine. If that save fails, the disk is untouched and nothing is quarantined.
   - Tests:
     - a corrupt domain is quarantined, then a new decision ingests and resolves;
     - the quarantined bytes are identical after the new activity;
     - a re-raise produces a new decision ID.
2. **Only real user gestures act as "user".**
   - Decision UI commands with `actor: user` may originate **only** from direct UI events: click or keyboard in the Decisions rail, page or drawer.
   - Never from chat text, slash commands, Habits/Automations, a Mono's CLI, deep links, or restored or queued messages.
   - Habits and automations act as their owning Mono, never as the user.
   - Tests: an automation or habit attempting `resolve`/`delegate`/`autonomy` as user is refused.
3. **Prompt rules teach the protocol precisely and briefly.**
   - The Monos' team rules (monoOrg/monoPrompt) state:
     - decide within authority, per the `bossMayDecide` thresholds;
     - otherwise send **one structured decision payload** (schema, caps, `operation` type);
     - keep reports to summaries;
     - a received answer is evidence for the original goal only;
     - never claim a decision on behalf of a higher level.
   - Keep the added prompt text small (the CC1 diet) and measure the prompt delta.
   - **`operation` must be the truthful action class.** Merge, install, sign-in, destructive, system settings and spend are always labelled as such. The rules say so explicitly; V4 enforces it structurally.
4. **Delivery to busy or stopped recipients.**
   - An answer delivered to a busy Mono follows the existing CC5D queued-event path.
   - It does not steer into an active turn unless the CC9 steering policy later allows it.
   - It never revives a stopped or cancelled task. A cancelled goal makes the answer stale (it's recorded, not delivered).
   - User-recipient deliveries (reminders, escalations) map to a UI notification plus the rail badge, idempotent by event ID.

## Final review requirements
- The exact pin.
- The listed connected evidence plus the 4 additions above.
- Claude reviews the final wiring before integration.
