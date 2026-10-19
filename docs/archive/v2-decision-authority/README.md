# Archived: V2 "decision authority" runtime (CC-VISION V2)

**Status:** archived on 2026-10-19 by the user's decision. Not merged.

**What this branch preserves:**
- **Branch:** `archive/v2-decision-authority`.
- **Code:** frozen at `9ffdde483c96c73bfddc3e03b0419ee59d1c0d58`, the last reviewed candidate. It was built on the accepted V1 `0e95c375`, which already contained the merged V2 *data* foundation `4b32e8b1`.
- **Documents:** every contract, checkpoint and review from the program folder is copied here:
  - `wiring/`: runtime wiring;
  - `data/`: data model;
  - `CCVISION-BRIEF.md`: the original approved brief.

## The goal (unchanged)
The user wants MonoCode to move coding toward **decisions**:
- agents work autonomously;
- a worker asks its Manager, the Manager asks the Boss, and the Boss asks the user only for high-impact calls;
- the user sees calm Decision cards, never logs or bureaucracy.

The user's words when switching: *"my goal is still getting the smoothest easiest experience without tech heavy interfaces or bureaucracy."*

## What this V2 built
A decision answer was treated as **authority**: a durable, versioned grant delivered back down the escalation chain. Agents could act on it as if the user had approved. Making that safe required:
- **Durable decision records** in the owning Manager's GoalLedger, with versioned options, impact floors and protected-class routing. Exactly-once delivery used CC5D receipts and outbox read-back (`data/CONTRACT.md`).
- **Trusted-gesture user actor** (`assertDecisionUiGesture`), and Mono actors only from authenticated `team.message`.
- **Stale-answer retirement** whenever the task, goal, generation, binding or account changed, plus `retiredEventIds` on Manager digests.
- **Stop retirement**, persisted through a verified Stop marker, so a stopped run could not later act on old answers.
- **Continue epochs** (`decisionContinuedAt` / `decisionContinuePendingAt`), so questions could resume after Stop without reviving old authority. Trusted, one-use, run-bound gestures; staged save and read-back (`wiring/CONTINUE-EPOCH-*`).
- **Quarantine recovery** for unreadable decision records: an atomic host notice plus retirement (`wiring/QUARANTINED-DIGEST-*`).

## Why it was dropped
Each review round closed its findings, but the authority machinery kept producing **new blocking defects at its own edges**:

| Pin | Verdict | New blockers |
|---|---|---|
| `c993d69` | FIX-FIRST | One stale decision wedged a Manager's report pipeline forever. Stop's empty pause wasn't cleared by Continue. (`wiring/CLAUDE-WIRED-REVIEW*.md`) |
| `136b8fa` | FIX-FIRST | The Stop marker froze unsaved chats. A paged-history retry erased the marker. Valid answers were dropped as stale. A corrupt ledger blocked every Manager. Stop then Continue could never ask again. A self-deadlock. (`wiring/CLAUDE-DELTA-REVIEW-136b8fa-evidence.md`) |
| `3006351`/`9ffdde4` | FIX-FIRST | After any Continue, Managers with 2+ goals could never raise a decision. Stop during an approval prompt wedged the chat until restart. Continue timed out on slow machines. (`wiring/CLAUDE-DELTA-REVIEW-3006351-evidence.md`, `wiring/CLAUDE-DELTA-REVIEW-9ffdde4.md`) |

**Root cause:** once an answer *is* authority, every lifecycle event (Stop, Continue, restart, corruption, pagination, races) needs bespoke persistence and retirement logic. The safety benefit was largely redundant: protected actions (merge, install, sign-in, delete, spend, system settings) are **already** gated by MonoCode's existing operation approvals at the moment they execute. The reviewer's own strict clarifications (exactly-once, stale retirement, Stop durability) drove much of the complexity.

## What replaces it (V2-lite)
- A Decision card is a structured, nicer way to **ask in chat**. The user's click, or "Let the Boss decide", is delivered as an **ordinary message** from the user or the Boss to the asking agent, exactly as if typed.
- **No authority bookkeeping:** no stale retirement, no Stop markers, no Continue epochs, no quarantine recovery.
- **Safety stays where it already lives:** the existing operation approval prompts gate protected actions when they are attempted. A stale or wrong answer can't do anything dangerous.
- **Kept:**
  - Decision cards and the Decisions page or rail;
  - the escalation ladder;
  - the "Ask me for" autonomy setting;
  - `bossMayDecide`;
  - the decision log;
  - trusted-click only for the user's choice.

## If anyone revisits this
Start from `wiring/CLAUDE-DELTA-REVIEW-9ffdde4.md`. It lists the open defects NF-1 to NF-5, and every earlier finding was closed in source at that pin. None of the gates (tsc, browser, full suite) was green at the final pin.
