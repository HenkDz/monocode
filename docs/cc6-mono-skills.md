# CC6 curated Mono skills

Branch: `HenkDz/cc6-mono-skills`, based on `e950866bb164ded1eba3cbcd5632279a8fd313c8`. Integration and publication remain coordinator-owned.

Monos receive a small skill set chosen for their role. Details and Team settings show **Skills · N enabled**, opening an accordion-free picker with searchable selections, enabled chips, Role default / Custom / All segments, team defaults and separate plugin opt-in. Choices persist with the Mono roster and take effect on its next preparation/turn; a changed policy restarts a warm Codex server while retaining its native thread. Ordinary conversations and ordinary orchestration workers keep their existing behavior.

## Installed Codex investigation

The probes used installed **Codex 0.162.1**, its matching `rust-v0.162.1` source, and synthetic homes. Originals were inventoried read-only. An empty `CODEX_HOME` still found **153 global skills plus 5 bundled skills**: isolating only the home skills directory does not isolate discovery. Windows `HOME`/`USERPROFILE` overrides also do not redirect the Known Folder lookup used by `dirs::home_dir`.

- Codex discovers `$CODEX_HOME/skills`, bundled system skills, user `~/.agents/skills`, trusted project `.codex/skills`, and project `.agents/skills` along ancestors to the configured project root. Unix also has `/etc/codex/skills`; Windows has the Known Folder `%ProgramData%/OpenAI/Codex/skills` admin root, absent on this machine. Enabled plugins contribute their own skill roots. `$CODEX_HOME/plugins/cache/<marketplace>/<plugin>/<version>` supplies cached plugin assets.
- Project `.claude/skills` is not automatically discovered; MonoCode makes it available through selected directory links, including repository-root folders when the working directory is nested. AGENTS.md remains project instructions, independently of skill discovery.
- `skills.config` accepts ordered name or full **SKILL.md path** selectors. A directory selector does not disable its children. Junction paths canonicalize to the original document, and later matching entries win. All known aliases of a selected document receive the same enabled state.
- `skills.bundled.enabled=false` suppresses bundled discovery on the first boot and on subsequent boots. All-skills opt-in retains bundled discovery.
- Plugin suppression must use a complete nested `plugins` map. A quoted dotted CLI assignment such as `plugins."probe@cc6".enabled=false` did not disable the probe plugin; `plugins={"probe@cc6"={enabled=false}}` did. Thread configuration uses nested `skills` and `plugins` maps.
- Ponytail's cached manifest names `hooks/claude-codex-hooks.json`. Its SessionStart hooks activate the instructions on startup/resume/clear/compact, SubagentStart activates them for children, and UserPromptSubmit tracks its mode. The tagged loader returns before loading these hooks when the plugin is disabled. Selecting a cached Ponytail review skill is independent of activating Ponytail's hooks. Real Ponytail hooks were not executed; synthetic plugin skill suppression was verified in outgoing requests.

The loader and configuration behavior are grounded in [Codex skill configuration](https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/config/src/skills_config.rs), [skill discovery](https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/ext/skills/src/loader/discovery.rs), and the source downloads and runtime receipts under the evidence root below.

## Defaults and isolation

Defaults are a small name table in `codex_mono_store/skills.rs`, resolved against available inventory rather than hardcoded machine paths. Missing skills are omitted; account switches resolve the inventory again. Default choices respect account skill disable rules. Explicit selections and all-skills opt-in can enable an available skill.

| Role | Default candidates |
| --- | --- |
| Grand Orch | orca-cli, orchestration, codebase-memory |
| Manager | Grand Orch candidates, improve |
| Worker | codebase-memory, laravel-tdd, frontend-design, vercel-react-best-practices |
| Reviewer | codebase-memory, ponytail-review, laravel-tdd, vercel-react-best-practices |

Available project-local skills are included in each role default. Bug bounty, red-team, video and other unrelated global domains remain available for explicit selection. Plugin hooks stay opt-in even when all skills are enabled; plugin switches describe caches available to the selected account.

The former shared `skills` junction becomes a real private directory using a new `IsolateSkills` journal intent. Existing real directories and user files remain intact. Directory junctions are claimed, identity-checked, and replaced with a staged empty directory; only the original link is discarded. Interrupted work reconciles through the existing CC0G transaction machinery. Windows keeps the private directory handle locked while creating selected links. Skill aliases include canonical source identity, so changing account/source never redirects a link an older server may still use.

A single shared discovery directory with per-server disabled-path snapshots was rejected after a reproduction: a second member added a new project skill, and the first member's next request included it. Codex defaults unknown paths to enabled. Each effective selection therefore has its own private **CODEX_HOME**, keyed by account/source, project, role, policy and inventory. Selected skill folders are linked from their originals; skill originals are neither copied nor modified. The account Mono base owns the shared **SQLite home**, sessions, archived sessions and native memory. Instruction homes link these state roots while retaining private instruction choices. Existing context rollouts are retained through journaled migration, preserving their original bytes and updating only their matching index paths. Private configuration/instruction choices and isolated hooks from storage repair are inherited; hook copies use journaled staged publication.

Existing SQLite-indexed threads resume by ID across instruction homes. A first copied legacy rollout has no row in the new index, so preparation and copying return its native validated path for `thread/resume`. Runtime probes cover both cases with unchanged files. A copied Paginated rollout without its SQLite history remains an existing storage-import limitation: the runtime rejects it even with an explicit path. Existing Paginated threads whose shared SQLite history is present resume successfully. CC6 does not import those missing databases or manufacture history.

Large path inventories travel through thread RPC, avoiding Windows' 32,767-character command-line limit. Only the compact bundled-skills setting and complete plugin map travel in startup arguments. Account configuration, permissions and credentials keep their existing preparation rules.

## Sandbox readiness

CC6G checks the effective Windows engine before restricted Mono turns.
Elevated readiness requires a compatible version-5 marker, matching offline
proxy ports and local-binding settings, and existing, enabled sandbox accounts
without expired passwords. The read-only account lookup and artifact checks
never perform setup or delete shared identity files. Warm turns check again.
The explicit unelevated read-only worker path skips elevated artifacts and
puts `app-server` before config overrides, retaining read-only permissions.

The CC4 blocker displays **Codex sandbox needs setup**, the precise reason
and a copyable setup command. Account engine changes require an explicit
user action with configuration backups; full access is scoped to the chosen
Mono and Plan remains restricted. Sandbox remediation uses no accordions.

Stock Codex 0.162.1 also repairs saved-password logon failures by deleting
the users file and entering full setup. Side-effect-free account flags cannot
rule this path out, and the runtime exposes no switch to disable it. The launch
guard consequently blocks every elevated Mono turn, including an otherwise
intact identity. The pure readiness control still passes; it does not authorize
a runtime that can provision later. Elevated launches require a runtime with
a no-provisioning execution contract. This does not repair DX1's ACL-refresh hang.
See [CC6G](cc6g-sandbox-readiness.md) for evidence, validation and limits.

## Prompt measurements

Actual outgoing Responses requests were captured by a **loopback-only unauthenticated stub**, using synthetic copies of skill names/frontmatter. No real model provider was contacted. The matched before snapshot uses current user/account skill metadata and the configured enabled plugin versions. It discovered 212 enabled entries; the model's catalog budget displayed 211. The broader 299-entry all-cache experiment remains separate stress evidence.

| Selection | Visible skills | Skills block characters | Developer message characters |
| --- | ---: | ---: | ---: |
| Before: current enabled sources | 211 | 22,211 | 26,150 |
| Grand Orch | 3 | 2,895 | 6,834 |
| Manager | 4 | 3,443 | 7,382 |
| Worker | 4 | 1,818 | 5,757 |
| Reviewer | 4 | 1,723 | 5,662 |

The measured skills block shrank by approximately **84.5–92.2%**. These are exact captured characters for this synthetic model/catalog budget, not token estimates or production latency results. Historical program evidence had 188 skills and roughly 63k characters; it uses a different account/model budget and is not the matched baseline above. Codex 0.162.1 budgets the skill catalog against model context and can shorten descriptions, which explains why a broad list does not scale linearly in rendered size.

## Validation and evidence

Windows with Node 26 and `NODE_OPTIONS=--no-experimental-webstorage`:

- Full Vitest suite: **6,451 passed, 13 skipped, 0 failed**, in **571 passed and 2 skipped files**. The final standalone run used `--maxWorkers=4`, keeping the normal test timeouts. A concurrent validation attempt had six unchanged-test timeouts; its failure log is retained separately.
- `npx tsc --noEmit` and `npm run build`: passed. The build retains its existing large-chunk warning.
- Focused native `cargo test ... codex_mono_store --lib`: **96 passed, 0 failed, 1 ignored, 616 filtered out**. The ignored entry point is invoked by the crash harness. Nineteen new policy/context tests and two new crash tests cover role/default resolution, overrides, missing skills, account switching, all-skills, private choices, rooted history, late additions and six new kill/restart checkpoints.
- All seven touched Rust files pass `rustfmt --check` with child traversal disabled; `git diff --check` passes. Seventeen completed loopback-only stub requests prove installed-runtime behavior. UI behavior is also covered by focused DOM and adapter tests, including the final 149-test runtime/history group.

Evidence root: `C:/Users/nooro/AppData/Local/Temp/monocode-cc/cc6/evidence/`.

- `inventory.json`, `source-download.json`, `codex-source/`, `schema/`: read-only inventory and version-matched source/schema.
- `baseline-real-user.json`, `control-rpc.json`, `junction-rpc.json`, `bundled-first-rpc.json`, `plugins-rpc.json`: installed-runtime discovery, selector, junction and plugin controls.
- `mock-summary.json`, `mock-*-request.json`, `matched-baseline-sources.json`, `matched-baseline-list-rpc.json`: captured developer messages, role measurements and matched baseline.
- `mock-late-growth-requests.json`, `mock-late-growth-rpc.json`: rejected shared-directory design reproduction.
- `mock-isolated-resume-*.json`, `mock-thread-id-resume-*.json`, `mock-copied-legacy-resume-*.json`: separate instruction roots, shared SQLite, unchanged files, and first-copy path fallback.
- `frontend-focused.txt`, `frontend-regression.txt`, `vitest-final.log`, `tsc-final.log`, `build-final.log`, `native-tests.log`: focused and complete validation.
- `vitest-parallel-failed.log`: the retained concurrent run with six 5-second timeouts; no timeout or skip was added to obtain the final pass.
- `../REPORT.md`: commit, exact final counts, files changed, risks and deliberately omitted work.

## CC6F review corrections

CC6F integrates the original CC6 branch into `HenkDz/cc6f-skills-fixes`, starting from `nour` at `4a86188dba99a580814fbd8fa6f1e97a44bebdee`. The requested merge was clean and local. All seven CC6R findings have regression coverage:

- **F1, sandbox continuity:** Every selection links the base `.sandbox`, `.sandbox-bin`, `.sandbox-secrets` and `cap_sid` identity. Sandboxed preparation checks the existing elevated sandbox's version-5 marker/users and required artifacts before provider spawn, rejecting missing or malformed provisioning without launching setup. Full-access Chat does not require provisioning. Read-only and Plan turns do; switching access waits for the active Mono turn before rechecking. The guard follows installed Codex 0.162.1 and must be revisited when its schema changes. It does not test Windows account flags, DPAPI, ACLs or live sandbox execution.
- **F2, archive ownership:** Base-owned `sessions` and `archived_sessions` are linked into every home. Legacy context files are copied with no-replace publication, fsync and identity/fingerprint checks; the exact matching SQLite paths are updated, and original directories are retained. Busy writers, unfamiliar entries and divergent collisions fail with bytes preserved. An archived saved thread is unarchived through a temporary selected-home Codex server before the normal adapter resumes it. No replacement thread or synthesized history is used.
- **F3, application context:** The adapter remembers policy/home identity across idle parking and forgets both receipt families before `prepareText` after a switch. Unchanged-home parking keeps its receipts. Rejected sends retain no new receipt and retry with the full org, soul and memory context.
- **F4, native memory:** Every selection shares base `memories`. Legacy context memory uses the same journaled retention: context-only and disjoint files migrate, identical duplicates reuse their bytes, and divergent files require explicit reconciliation with both versions intact.
- **F5, private skills:** Real base-private skills appear as catalog source `mono`, including custom and all-skills mode. Canonical aliases avoid duplicate catalog entries. Curated role defaults remain selective.
- **F6, controls:** A compact **Skills · N enabled** row opens the shared Modal, with search, removable enabled chips and Role default / Custom / All segments. Plugin opt-in and team defaults remain available. The real Modal and SwitchRow supply keyboard behavior; there are no disclosure or accordion elements.
- **F7, staging recovery:** Hook clones are journaled before copying and fingerprinted before publication. Restart cleans only recorded matching stages and preserves unfamiliar replacements. Crash assertions inspect nested homes as well as the base. Rollout and memory copies use the same checked journal mechanics.

Final integrated Windows validation, Node `v26.5.0`, with `NODE_OPTIONS=--no-experimental-webstorage`:

| Check | Result |
| --- | --- |
| Full `npx vitest run --maxWorkers=4` | **7,096 passed, 13 skipped, 0 failed**; 593 passed files, 2 skipped |
| `npx tsc --noEmit` | Exit 0, no diagnostics |
| `npm run build` | Exit 0; existing CSS/import/chunk warnings retained |
| Actual-crate `cargo test --manifest-path src-tauri/Cargo.toml codex_mono_store --lib --no-fail-fast -- --nocapture` | **114 passed, 0 failed, 3 ignored, 618 filtered** |
| Touched Rust formatting / diff / LF checks | Eight CC6F Rust files pass `rustfmt --check` with child traversal disabled; diff check passes; no changed file has CRLF |
| Skills browser fixture | **27 passed checks**, six dark/light desktop/narrow screenshots; no browser errors or external requests |
| Installed Codex archive migration | **15 thread RPC operations**, four server lifetimes; same populated thread ID and two exact history turns; original hash retained; zero provider requests and model turns |

The three ignored native entries are the two subprocess entrypoints and the synthetic installed-runtime preparation entrypoint, exercised by crash tests and the runtime probe. The 13 Vitest skips are existing real-provider/soak tests. No timeout or skip was increased. One pre-final native compile exposed an ambiguous error conversion in the full Tauri crate; an explicit closure result type fixed it, and the actual suite then passed. Earlier red context-receipt and queued-access regressions are retained as separate evidence.

Evidence root: `C:/Users/nooro/AppData/Local/Temp/monocode-cc/cc6f/evidence/`.

- `validation/`: full Vitest, TypeScript, build and actual native logs/exit receipts, focused before/after context tests, sandbox adapter checks and formatting receipt.
- `native/`: state regression log, copied-harness provenance/hashes and native design/limits. Copied-harness tests supplement the passing actual-crate run.
- `continuity/`: installed-runtime archive/migration probes and receipts, retained synthetic fixtures, and native migration transform manifest.
- `ui/`: actual-component browser fixture, 27-check receipt, source hashes, screenshots and focused UI tests.
- `../REPORT.md`: branch/commits, changed-file lists, exact validation numbers, decisions and remaining risks.

## Limits

Windows is the verified platform. Native migration exercises process termination and restart, not operating-system power loss. Unix retains the documented external path-replacement/open-writer limitation. The settings control applies to local Codex Monos; remote/headless provider storage is unchanged. Global skill installation performed outside MonoCode while a server is running remains subject to Codex discovery; the inventory resolves again on preparation. Old instruction homes and retained originals remain available; automatic pruning was not added. Copied Paginated account imports require a separate storage follow-up. No global configuration or real profile was repaired, no live model inference or elevated sandbox command was run, and no push, deployment or merge into `nour` was performed. The sandbox preflight cannot establish live machine provisioning health; conflicting legacy memory requires explicit reconciliation. Native WebView screenshot acceptance remains separate from the synthetic browser fixture.
