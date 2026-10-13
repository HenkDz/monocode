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
Base safety repro: 9 failed / 41 passed. Prefreeze plain native: 204 passed / 0
failed / 5 ignored. Expanded connected App/SDK/autosave controls: 114 passed / 0
failed. Final frozen gates and exact execution/binary pins are reported in
`cc0l/REPORT.md` and `VALIDATION-READY.md` after completion.

Prior patched native results, loader failures, opaque-map/fingerprint reds,
raw-prefix/routing/MP4/host failures, archive kill receipts and accepted P3 ledgers
remain at their original pins. This round adds no P3 work, dependency upgrades,
real profiles/credentials/model calls, preview, push or deployment. Claude alone
rechecks L1–L4; the coordinator alone integrates. Builder completion is not SHIP.
