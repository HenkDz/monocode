# CC0J recovery corrections

Frozen implementation `d3ac5e9ff32efbba818038ed1eb15b013c591f92`, tree `ca4648c75978309322691dddbcb3ac59f4e7927e`; clean baseline `6bcc9f59b45e77efe267e19cd19c6ae04347a796`, tree `d4a3871766fcb413dbf28f581f942f759e4b015b`. Evidence root: `C:/Users/nooro/AppData/Local/Temp/monocode-cc/cc0j/evidence/`. This document is added after validation; final candidate/doc pins are in the round REPORT and final-candidate-manifest.json.

R1 source-owned `codex` secrets and gateway mirrors now refresh the private mirror from the source instead of permanently refusing divergence. `Codex Auth` still refuses a foreign login, retains same-account refresh, and is the only service allowed to write back. Tests call the production helper with a supplied synthetic backend; no credential values are logged.

R2 offers a deliberate separate-home choice on a source mismatch or recreated source directory. The native confirmation rechecks the canonical source and physical directory identity. Each choice persists in a separate home keyed by source path and identity; the original home and credential namespaces remain in place. Idle account servers are stopped; active/busy managed contexts refuse the action. The App clears the original provider thread ID before retrying, keeps held/queued/transcript content, and persists the owning home using the existing session settings format. Native preparation rejects a conversation's foreign home marker. Independent child reloads work for synthetic terminal CODEX_HOME and desktop-unset launches after recreation. The notice title and remedy match the source choice.

R3 stores the actual held intent alongside its retry and exposes that authority in session state. A held ordinary prompt is distinct from having no held prompt. Held Plan/Orchestrate with an ordinary queued prompt refuse Full access before preparation or persistence; ordinary held with queued Plan uses the held intent. Retries preserve the first held intent. Existing read-only, remote, Elevated, generation/provider/account/readiness and queue guards remain.

R4 native rollout archives dedupe identical incoming bytes. A checked in-app Keep private history action records the displayed source/private fingerprints and identities, then retries migration while retaining the private rollout's bytes and identity. Changed versions and foreign paths refuse confirmation. Config/AGENTS links left by old preparation are replaceable only when they still target the selected account entry. The existing journaled link helper rechecks the claimed account target; real private files, arbitrary foreign links and a racing real file remain protected. No private rollout publication replaces an existing file.

## Validation

| Executed frozen gate | Result |
|---|---|
| Current native storage | 195 passed / 0 failed / 5 ignored / 628 filtered |
| Harness / Mono / control | 26/0, 14/0, 11/0 |
| Full Vitest | 8438 passed / 0 failed / 13 existing skips; 633 file records, 631 with passing tests |
| Typecheck / production build | exit 0 / exit 0; routing false |
| Frozen export recovery family | 5/0, production helpers with test-only adapters |
| Original A49 | 11/0/1 ignored; 61 rows including 49 original kills, all safe assertions pass |
| Original H11 | 11 actual cases: 9 kills + 2 resumed replacement controls |
| H39 | 39 actual child/checkpoint cases in current native execution; separate receipt aggregator plus 2 publication and 1 allocation controls |
| Literal / canonical / legacy | Literal 4/1-known-raw-prefix/1-ignore retained; canonical 5/0/1; legacy 1/0 |
| Connected Chromium + WebKit | 98/0, 86 PNGs, 11 complete-image contact sheets inspected plus 3 full-resolution frames |
| Launch-mode supplement | 4 native child reload operations; both distinct homes prepare after recreation |

All 30 direct job receipts have unchanged before/after input hashes, matching execution HEADs and reaped children. H39's derived pointer is separate. All original assertions/deadlines remain; the old wrong held-intent expectation was corrected as requested. Source-mismatch browser wording follows the required new remedy. Test-only export deltas and original module hashes are recorded separately; export inputs remain unchanged after execution.

## Evidence and limits

Baseline/frozen-source/final-export manifests bind all inputs. validation-summary.json indexes every direct gate, including failures. A49/H11/H39 provenance, original literal/canonical/legacy modules, browser-driver/native adapter manifests, browser-attempt-01/results.json, inspection receipt and cleanup receipts are retained. VALIDATION-READY.md and checkpoint.md record the grant and resumable work.

Original expected-safe failures on 6bcc9f5 plus additive tests: R1/R2/R4-link 0/3 native, R4 dedupe 0/1 (three archives versus one), R3 App 16/3. Original production inputs were unchanged; baseline-test-diff.patch records the test-only delta.

Retained iteration failures: corrected-native01 compile error from an overbroad signature edit; native02 192/1/5 from Windows canonical/raw path comparison; tsc01 rejected the narrower Block intent type; prefreeze-web01 159/1 from accidentally mixing a durable home marker into the transient-state fixture. Each was corrected without removing its safety assertion. Final core gates use the committed corrected source. A local Windows text rewrite changed 17 unrelated App Unicode sequences; they were restored before freeze and the final diff remains scoped.

The broad export-store01 invocation produced 203/11/9 because eleven historical driver tests lacked CC6IR_EVIDENCE. All eleven failed at setup, not at their safety assertion. That failed log/receipt is retained. The export recovery family and original drivers then ran separately with the required environment. The original literal raw-prefix assertion remains 4/1/1; its module SHA and assertion are unchanged, and the separate canonical control passes. It is not reported green.

Cleanup/report assembly initially misclassified the derived H39 pointer as a direct job and hit a Windows default text-decoding error. cleanup-attempt-01.json retains the false aggregate; it found no live owned processes or listener. Corrected cleanup distinguishes 30 direct jobs from one pointer and confirms all reaped/stable. Shell/read/quoting setup failures remain in the task transcript. No final source edit or gate assertion/deadline relaxation occurred.

No real profile mutation, Credential Manager operation, credential/model/provider turn, native GUI/WebView preview, ACL/account provisioning, Unix execution, OS power-loss test, other-checkout edit, push, merge or deployment. Browser/native IPC, source locations and persistence adapters are synthetic; the tests exercise production components, the actual App callback/model and frozen native helpers, not a live Tauri/provider/database acceptance run.

No suitable owned profile filesystem copy was identified in the supplied evidence. The supplied DB copy is not a context filesystem copy. Profile-copy provenance records this limit; only synthetic owned account config/AGENTS link targets were used. Old source/home markers and private history remain unchanged in the observed controls.

The authorized metadata-only supplement after freeze observed 21 real default-home contexts / 42 config+AGENTS link rows, with stable originals across two reads. All 21 config links point at the private base config; the base config is a real file. The base AGENTS entry is itself a shared source link, so source-target context instructions are not proof of the private-override upgrade conflict. No stranded account-target config link was observed. profile-link-metadata.json and profile-base-metadata.json are independent metadata copies only: no auth, credential, rollout or config/instruction contents were read, no real link was copied into a fixture, and no profile was mutated. This is a post-freeze observation, not a pre-fix copied-profile execution or general live acceptance.

The cc0ir P3 ledger remains accepted and is not expanded or claimed closed: legacy/accumulating credential copies; no automatic Windows credential CAS or exclusion of independent consumers; file-store auth.json write-through and workspace-level account identity; Windows hardlink fallback/private-config provenance; retention/orphan/context scans; lease/drop/stdout-lock races; bare sharing errors; rare envelope wrappers; source secrets creation/sandbox setup through links; unknown authority/reserved names/read-only sqlite; existing Inbox restriction flags, retry guidance, mode autosave, focus/stale labels and Attention title limits. Routing classifier, role effort/defaults, release flag, compiler/dependencies and unrelated Workbench/authority surfaces remain unchanged.

Coordinator integration, whole-program RG1 rebinding and native/live acceptance must target the corrected final candidate. Claude's focused R1-R4 recheck remains downstream. This is a completed BUILD round, not SHIP.
