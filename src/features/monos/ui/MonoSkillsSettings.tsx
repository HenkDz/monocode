import { useEffect, useState, useSyncExternalStore } from "react";
import { hasHeadlessChildBackend, monoCodexSkillsCatalog } from "../../../integrations/harness/core/child";
import { remoteProjectFor } from "../../connections/model/remoteProjects";
import { selectedProviderAccountId } from "../../providers/model/providerAccounts";
import { findMono, listMonos, monosSnapshot, subscribeMonos, updateMono } from "../model/mono";
import { enabledMonoSkills, monoSkillsRole, resolveMonoSkillsPolicy, type MonoSkillsCatalog, type MonoSkillsPolicy } from "../model/monoSkills";
import { SwitchRow } from "./monoPanelParts";

export function MonoSkillsSettings({ monoId, harness, providerAccountId, cwd }: { monoId: string; harness: string; providerAccountId?: string; cwd: string }) {
  useSyncExternalStore(subscribeMonos, monosSnapshot);
  const [catalog, setCatalog] = useState<MonoSkillsCatalog>();
  const [error, setError] = useState<string>();
  const [search, setSearch] = useState("");
  const accountId = providerAccountId ?? selectedProviderAccountId("codex", cwd);
  useEffect(() => {
    let live = true;
    setCatalog(undefined);
    setError(undefined);
    if (harness === "codex" && !hasHeadlessChildBackend() && !remoteProjectFor(cwd))
      void monoCodexSkillsCatalog(accountId, cwd).then(value => { if (live) setCatalog(value); })
        .catch(reason => { if (live) setError(String(reason)); });
    return () => { live = false; };
  }, [harness, accountId, cwd]);
  const mono = findMono(monoId);
  if (harness !== "codex" || !mono || hasHeadlessChildBackend() || remoteProjectFor(cwd)) return null;
  if (!catalog) return error ? <p role="alert" className="px-4 py-2 text-xs text-red-400">Could not load skills: {error}</p> : null;
  const policy = resolveMonoSkillsPolicy(mono, listMonos());
  const enabled = enabledMonoSkills(catalog, monoSkillsRole(mono), policy);
  const enabledSet = new Set(enabled);
  const save = (next?: MonoSkillsPolicy) => updateMono(monoId, value => ({ ...value, skillsPolicy: next }));
  const filtered = catalog.skills.filter(skill => `${skill.name} ${skill.description} ${skill.source}`.toLowerCase().includes(search.trim().toLowerCase()));
  return <section className="border-t border-stroke px-4 py-3" aria-label="Mono skills">
    <details>
      <summary className="cursor-pointer rounded text-xs focus-visible:outline-accent">Skills: {enabled.length} enabled</summary>
      <p className="mt-2 text-xs text-content/50">{mono.skillsPolicy ? "This Mono's selection" : mono.reportsTo && findMono(mono.reportsTo)?.teamSkillsPolicy ? "Team default" : "Curated role default"}. Changes apply on its next turn.</p>
      <div className="my-2 flex flex-wrap gap-2 text-xs">
        <button type="button" className="rounded bg-content/5 px-2 py-1" onClick={() => save({ mode: "role" })}>Use role default</button>
        {mono.reportsTo && <button type="button" className="rounded bg-content/5 px-2 py-1" onClick={() => save()}>Use team default</button>}
        {(mono.role === "manager" || mono.role === "orchestrator") && <button type="button" className="rounded bg-content/5 px-2 py-1" onClick={() => updateMono(monoId, value => ({ ...value, teamSkillsPolicy: { ...policy, mode: policy.mode === "role" ? "custom" : policy.mode, enabled } }))}>Use selection for team</button>}
        {mono.teamSkillsPolicy && <button type="button" className="rounded bg-content/5 px-2 py-1" onClick={() => updateMono(monoId, value => ({ ...value, teamSkillsPolicy: undefined }))}>Reset team to role defaults</button>}
      </div>
      <SwitchRow label="Enable all skills" description="Includes every available skill; plugins remain opt-in." on={policy.mode === "all"} onChange={on => save({ ...policy, mode: on ? "all" : "custom", enabled })} />
      <input aria-label="Search skills" placeholder="Search skills" value={search} onChange={event => setSearch(event.target.value)} className="my-2 w-full rounded border border-stroke bg-transparent px-2 py-1.5 text-xs" />
      <div className="max-h-64 overflow-y-auto">
        {filtered.map(skill => <label key={skill.id} className="flex items-start gap-2 rounded py-2 text-xs" title={skill.description}>
          <input type="checkbox" checked={enabledSet.has(skill.id)} onChange={event => save({ ...policy, mode: "custom", enabled: event.target.checked ? [...enabled, skill.id] : enabled.filter(id => id !== skill.id) })} />
          <span className="min-w-0"><span className="block">{skill.name}</span><span className="block truncate text-content/50">{skill.source}</span></span>
        </label>)}
        {!filtered.length && <p className="py-2 text-xs text-content/50">No matching skills.</p>}
      </div>
      {catalog.plugins.length > 0 && <div className="mt-2 border-t border-stroke pt-2">
        <p className="mb-1 text-xs text-content/50">Plugins</p>
        {catalog.plugins.map(plugin => <SwitchRow key={plugin} label={plugin} description="Opt in to this plugin's instructions and tools on the next turn." on={policy.plugins?.includes(plugin) ?? false}
          onChange={on => save({ ...policy, plugins: on ? [...policy.plugins ?? [], plugin] : policy.plugins?.filter(id => id !== plugin) ?? [] })} />)}
      </div>}
    </details>
  </section>;
}
