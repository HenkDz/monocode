# CC0L focused release fixes

Base: `8319031a1cd46a19922c8993da26d187687d91c2`. Only Claude cc0kr L1–L4
are assigned. Nour and all other checkouts remain untouched.

L1 uses `shouldPersistSession` when adopting a launch home. Habit/inbox/blank
owned sessions select the home and thread in memory; persistable save failures
still refuse. Account, generation, permissions, remote, busy and transport checks
remain in place. No peer thread or map is cleared.

L2 excludes the windowless Tauri command adapter from default library linkage.
`native-storage-probe` is an explicit non-default test feature. On Windows MSVC
its build script embeds the CommonControls manifest through the linker, only for
that feature. Ordinary native library gates use default features with no manifest
patch or probe flag. The synthetic adapter remains available for actual native
commands and canonical Mono persistence proof; production defaults are unchanged.

L3 exposes a nonblocking explicit return choice after preparation succeeds in an
already bound separate home. Earlier bindings at the same canonical source path
are distinguished by physical identity, including earlier separate homes. Return
uses the existing source confirmation, ownership receipts and context leases.
Both homes, binding/namespace bytes, history and per-home threads remain intact.

L4 gives opaque stored home maps a structured conversation notice and visible
unsaved-edit feedback. The explicit preserve/reset action verifies the displayed
record identity and fingerprint under the SQLite writer transaction. It writes,
syncs and publishes the exact original model-settings bytes without replacement
in `.monocode-preserved-transactions`, then removes only the opaque map key.
Title, draft, queue and current provider/home/account continuity remain in memory
and pass through the serialized canonical writer after deliberate recovery.
Changed/foreign records refuse; failed or interrupted archival keeps the stored
map. Unknown formats are archived rather than interpreted.

Evidence: `C:/Users/nooro/AppData/Local/Temp/monocode-cc/cc0l/evidence`.
Final implementation/test freeze `615606e1aee2b258f897ce029debe3c185ca64dd`, tree `27bb581b688671a86583e07c545e9514189318d5`.
All final gates below executed with frozen clean inputs; all raw receipts show
sourceStable=true and reaped children. Ordinary native commands use default
features, with no manifest patch, copied binary or probe flag. Probe commands
use the separate explicit feature and its linker manifest; binary provenance is
in `evidence/probe-binary.json`. Native family counts overlap.

| Gate | Actual result | Raw receipt |
| --- | --- | --- |
| Native storage (default) | 205 passed / 0 failed / 5 ignored / 628 filtered | `evidence/final-native-store-02.receipt.json` |
| Native harness (default) | 26 passed / 0 failed / 0 ignored / 812 filtered | `evidence/final-native-harness-01.receipt.json` |
| Native Mono (default) | 232 passed / 0 failed / 5 ignored / 601 filtered | `evidence/final-native-mono-01.receipt.json` |
| Native persistence (default) | 62 passed / 0 failed / 0 ignored / 776 filtered | `evidence/final-native-session-01.receipt.json` |
| TypeScript | exit0 | `evidence/final-tsc-01.receipt.json` |
| Full one-worker Vitest | 8459 passed / 0 failed / 13 skipped;631 files passed / 2 skipped | `evidence/final-vitest-01.receipt.json` |
| Routing-false build | exit0 | `evidence/final-build-01.receipt.json` |
| Explicit non-default probe build | exit0 | `evidence/final-probe-build-03.receipt.json` |
| Probe binary pin | exit0 | `evidence/final-probe-pin-03.receipt.json` |
| Chromium + WebKit connected proof | 10 remaining flows + 6 retained completed Chromium source flows / 42 inspected PNGs / 420 native calls | `evidence/final-browser-02.receipt.json` |
| Canonical Mono guarded map recovery | 5 opaque maps recovered / 1 valid control / 65 native calls | `evidence/final-map-01.receipt.json` |

The base safety repro failed9/passed41; expanded App/SDK/autosave controls passed
114/0. Final native-store01 retained204/1/5 atbc4a0cc: a new test passed an
unresolved Windows spelling to a canonical-path helper. Retained binding bytes
confirmed the mismatch. One fixture line was canonicalized with its assertions
unchanged. No product behavior changed afterbc4a0cc. Final-store02 passed205/0/5
at the test-corrected freeze above. All previous failed attempts remain raw.

Connected proof uses actual extracted App adoption/repair/autosave callbacks,
the actual prepare bridge, native commands and canonical Mono save/load through
mockIPC and a windowless synthetic AppHandle. Both browser engines verify
original and earlier-separate home return after recreate/separate/reload,
retained K1/K2 controls and two actual K2 copy kills. Five opaque-map formats
refuse autosave/foreign/stale recovery, preserve raw values and reload edited
title/draft/queue after explicit recovery. Valid maps remain unchanged.
Browser wrapper01 retained six completed Chromium source flows before a missing
persistFingerprint fixture import stopped its L4 autosave proof. The failed PNG
and raw timeout remain retained. Dependencies were added from their actual modules
and checked before fixture startup, with assertions/deadlines unchanged. Wrapper02
ran the ten remaining WebKit/L4/K2 controls; completed Chromium source checks were
not repeated. evidence/browser-complete/result.json binds both actual attempts,
their identical product hashes and native binary, without relabelling wrapper01.

Prior patched native results, loader failures, opaque-map/fingerprint reds,
raw-prefix/routing/MP4/host failures, archive kill receipts and accepted P3 ledgers
remain at their original pins. This round adds no P3 work, dependency upgrades,
real profiles/credentials/model calls, preview, push or deployment. Claude alone
rechecks L1–L4; the coordinator alone integrates. Builder completion is not SHIP.
