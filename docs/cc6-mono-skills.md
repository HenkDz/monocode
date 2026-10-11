# CC6 curated Mono skills

Branch: `HenkDz/cc6-mono-skills`, based on `e950866bb164ded1eba3cbcd5632279a8fd313c8`. Integration and publication remain coordinator-owned.

Monos receive a small skill set chosen for their role. Details and Team settings show **Skills: N enabled**, searchable individual selections, a team default, an explicit role reset, all-skills opt-in, and separate plugin opt-in. Choices persist with the Mono roster and take effect on its next preparation/turn; a changed policy restarts a warm Codex server while retaining its native thread. Ordinary conversations and ordinary orchestration workers keep their existing behavior.

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

A single shared discovery directory with per-server disabled-path snapshots was rejected after a reproduction: a second member added a new project skill, and the first member's next request included it. Codex defaults unknown paths to enabled. Each effective selection therefore has its own private **CODEX_HOME**, keyed by account/source, project, role, policy and inventory. Selected skill folders are linked from their originals; skill originals are neither copied nor modified. State directories inside these homes remain real directories. The existing account Mono **SQLite home** remains the common native thread index, and legacy rollout files remain in place. This preserves history while separating skill discovery. Private configuration/instruction choices and isolated hooks from storage repair are inherited; hook copies use staged publication.

Existing SQLite-indexed threads resume by ID across instruction homes. A first copied legacy rollout has no row in the new index, so preparation and copying return its native validated path for `thread/resume`. Runtime probes cover both cases with unchanged files. A copied Paginated rollout without its SQLite history remains an existing storage-import limitation: the runtime rejects it even with an explicit path. Existing Paginated threads whose shared SQLite history is present resume successfully. CC6 does not import those missing databases or manufacture history.

Large path inventories travel through thread RPC, avoiding Windows' 32,767-character command-line limit. Only the compact bundled-skills setting and complete plugin map travel in startup arguments. Account configuration, permissions and credentials keep their existing preparation rules.

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

## Limits

Windows is the verified platform. Native migration exercises process termination and restart, not operating-system power loss. Unix retains the documented external path-replacement/open-writer limitation. The settings control applies to local Codex Monos; remote/headless provider storage is unchanged. Global skill installation performed outside MonoCode while a server is running remains subject to Codex discovery; the inventory resolves again on preparation. Old instruction homes are retained because they can own rollout files; automatic pruning was not added. Copied Paginated account imports require a separate storage follow-up. No global configuration or real profile was repaired, no live model inference was run, and no merge, push or deployment was performed.
