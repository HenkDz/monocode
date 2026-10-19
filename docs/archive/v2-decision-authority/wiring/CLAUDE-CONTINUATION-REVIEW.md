# Claude early review — V2 continuation delta (`CONTINUATION-CONTRACT-20261019.md`)

**Verdict: APPROVED, with one change.**

**What's right:**
- The strict `decision-action` text schema. Monos are limited to resolve, escalate, raise-impact and remind, with no actor/goal/autonomy/delegation fields.
- Exact retry identity.
- Queue read-back before acknowledgement, which closes my earlier P3.
- No intake turns or steering.
- Live and original identity are checked separately.
- `isTrusted` is documented as an in-app boundary.

## Required change: conflicting autonomy aliases must not block decisions
Today, conflicting saved Windows path spellings "reject reads/resolution/writes visibly without a save". That freezes every decision for the project over a cosmetic key collision. Instead:
- **Reads and resolution** use the **most restrictive** of the conflicting values. The order is `everything` > `medium-and-up` > `high-impact-only`, so the user is asked more often, never less. Show a quiet notice: "Autonomy setting had conflicting copies; using the stricter one".
- **An explicit user write** of the autonomy setting is the newest intent. It replaces all matching aliases with the single `pathKey` entry, and **records the replaced values** in the decision log (who, when, old → new). It never silently picks a less strict value.
- Keep POSIX case significance and roster-membership validation as specified.
- **Tests:**
  - conflicting aliases → the stricter value is used, and resolution is not blocked;
  - a user write consolidates the aliases and logs the replaced values;
  - nonconflicting aliases consolidate silently.
