# TypeScript narrowing follow-up to corrected N5 source freeze

HEAD `c23f188216126933ddc5eaa70d959fecf2f24bb0`, tree `56bcc5447202a6fd1c77118c91d62bc729aaa5a6`; clean two-file delta after 9ffdde4, 46 cumulative V1 paths and no native changes (MANIFEST-c23f188.json). The 9ffdde4 lock repair and its source-only packet remain intact; this pin adds no authority path or guard bypass.

Admitted `wired-tsc-20261019T202710Z` on exact9ffdde4 used fresh6896525312 free bytes and failed with six errors, retained verbatim in its .log. App's three nullable native saved-session values now pass `undefined` to the existing binding validator when native read returns null; absence still fails. Quarantined consumer validation explicitly rejects a missing current run before accessing its receipt. `retireDecisionDigest` binds its post-await fresh run to a const, retains its missing-run/wake check, and uses that same fresh snapshot throughout the synchronous commit transform, avoiding a mutable captured value TypeScript could not narrow.

`git diff --check` passed before commit. This follow-up remains UNRUN pending the next affected/tsc/browser gates. No full gate or final acceptance is claimed; previous actual820pass/3fail focused result and all older failures/refused starts are preserved. Root must bind final authority/runtime reviews and final gates to the eventual exact candidate.
