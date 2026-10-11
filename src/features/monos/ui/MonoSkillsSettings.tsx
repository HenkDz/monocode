import { useEffect, useState, useSyncExternalStore } from "react";
import { hasHeadlessChildBackend, monoCodexSkillsCatalog } from "../../../integrations/harness/core/child";
import { remoteProjectFor } from "../../connections/model/remoteProjects";
import { selectedProviderAccountId } from "../../providers/model/providerAccounts";
import { Modal } from "../../../shared/ui/Modal";
import { ChevronRight, Search, X } from "../../../shared/ui/icons";
import { findMono, listMonos, monosSnapshot, subscribeMonos, updateMono } from "../model/mono";
import { enabledMonoSkills, monoSkillsRole, resolveMonoSkillsPolicy, type MonoSkillsCatalog, type MonoSkillsPolicy } from "../model/monoSkills";
import { SwitchRow } from "./monoPanelParts";

export function MonoSkillsSettings({ monoId, harness, providerAccountId, cwd }: { monoId: string; harness: string; providerAccountId?: string; cwd: string }) {
  useSyncExternalStore(subscribeMonos, monosSnapshot);
  const [catalog, setCatalog] = useState<MonoSkillsCatalog>();
  const [error, setError] = useState<string>();
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
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
  const selectSkill = (id: string, checked: boolean) => save({ ...policy, mode: "custom", enabled: checked ? [...enabled, id] : enabled.filter(value => value !== id) });
  const filtered = catalog.skills.filter(skill => `${skill.name} ${skill.description} ${skill.source}`.toLowerCase().includes(search.trim().toLowerCase()));
  const selection = mono.skillsPolicy ? "This Mono's selection" : mono.reportsTo && findMono(mono.reportsTo)?.teamSkillsPolicy ? "Team default" : "Curated role default";
  return <section className="border-t border-stroke px-4 py-3" aria-label="Mono skills">
    <button type="button" aria-label={`Skills · ${enabled.length} enabled`} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}
      className="flex w-full items-center gap-3 rounded-lg border border-stroke bg-content/2 px-3 py-2.5 text-left hover:bg-selection-subtle focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
      <span className="min-w-0 flex-1"><span className="block text-[13px] font-medium">Skills · {enabled.length} enabled</span><span className="mt-0.5 block text-[11px] text-content/60">{selection}</span></span>
      <ChevronRight className="size-3.5 text-content/60" aria-hidden="true" />
    </button>
    {open && <Modal title="Skills" description="Changes apply on this Mono's next turn." fitViewport onClose={() => setOpen(false)}>
      <div className="space-y-4 px-4 pb-4 pt-4 text-xs">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div role="group" aria-label="Skills selection" className="inline-flex gap-0.5 rounded-md bg-selection-subtle p-0.5">
            {([{ mode: "role", label: "Role default" }, { mode: "custom", label: "Custom" }, { mode: "all", label: "All" }] as const).map(({ mode, label }) =>
              <button key={mode} type="button" aria-pressed={policy.mode === mode} onClick={() => save({ ...policy, mode, enabled })}
                className={`rounded px-3 py-1.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent ${policy.mode === mode ? "bg-background-base text-content" : "text-content/60 hover:text-content"}`}>{label}</button>)}
          </div>
          <span className="text-[11px] text-content/60">{selection}</span>
        </div>
        <section aria-label="Enabled skills">
          <div className="mb-2 flex items-center justify-between text-[11px] text-content/60"><h3 className="font-medium">Enabled</h3><span className="tabular-nums">{enabled.length} of {catalog.skills.length}</span></div>
          <div className="flex max-h-24 flex-wrap gap-1.5 overflow-y-auto p-0.5">
            {catalog.skills.filter(skill => enabledSet.has(skill.id)).map(skill => <button key={skill.id} type="button" aria-label={`Remove ${skill.name}`} title={`Remove ${skill.name}`} onClick={() => selectSkill(skill.id, false)}
              className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-stroke bg-selection-subtle px-2 py-1 text-[11px] hover:bg-selection focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
              <span className="truncate">{skill.name}</span><X className="size-3 shrink-0 text-content/60" aria-hidden="true" />
            </button>)}
            {!enabled.length && <p className="text-content/60">No skills enabled. Choose skills below.</p>}
          </div>
        </section>
        <div className="flex items-center gap-2 rounded-md border border-stroke px-2.5">
          <Search className="size-3.5 shrink-0 text-content/60" aria-hidden="true" />
          <input type="search" aria-label="Search skills" placeholder="Search skills" value={search} onChange={event => setSearch(event.target.value)} className="min-w-0 flex-1 bg-transparent py-2 outline-none focus-visible:ring-2 focus-visible:ring-accent" />
        </div>
        <section aria-label="Available skills">
          <div className="mb-1 flex items-center justify-between text-[11px] text-content/60"><h3 className="font-medium">Available skills</h3><span className="tabular-nums">{filtered.length} results</span></div>
          <div className="max-h-72 overflow-y-auto">
            {filtered.map(skill => <label key={skill.id} className="flex cursor-pointer items-start gap-2.5 rounded-md px-2 py-2 hover:bg-selection-subtle" title={skill.description}>
              <input type="checkbox" aria-label={skill.name} checked={enabledSet.has(skill.id)} onChange={event => selectSkill(skill.id, event.target.checked)} className="mt-0.5 size-3.5 shrink-0 accent-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent" />
              <span className="min-w-0"><span className="block truncate leading-4 text-content/90">{skill.name}</span><span className="block truncate text-[11px] leading-4 text-content/60">{skill.source} · {skill.description}</span></span>
            </label>)}
            {!filtered.length && <p className="py-3 text-content/60">No matching skills.</p>}
          </div>
        </section>
        {catalog.plugins.length > 0 && <section aria-label="Plugins" className="border-t border-stroke pt-3">
          <h3 className="mb-1 text-[11px] font-medium text-content/60">Plugins · opt-in</h3>
          {catalog.plugins.map(plugin => <SwitchRow key={plugin} label={plugin} description="Opt in to this plugin's instructions and tools on the next turn." on={policy.plugins?.includes(plugin) ?? false}
            onChange={on => save({ ...policy, plugins: on ? [...policy.plugins ?? [], plugin] : policy.plugins?.filter(id => id !== plugin) ?? [] })} />)}
        </section>}
        {(mono.reportsTo || mono.role === "manager" || mono.role === "orchestrator" || mono.teamSkillsPolicy) && <div className="flex flex-wrap gap-2 border-t border-stroke pt-3">
          {mono.reportsTo && <button type="button" className="rounded-md border border-stroke px-2.5 py-1.5 text-content/70 hover:bg-selection-subtle focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent" onClick={() => save()}>Use team default</button>}
          {(mono.role === "manager" || mono.role === "orchestrator") && <button type="button" className="rounded-md border border-stroke px-2.5 py-1.5 text-content/70 hover:bg-selection-subtle focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent" onClick={() => updateMono(monoId, value => ({ ...value, teamSkillsPolicy: { ...policy, mode: policy.mode === "role" ? "custom" : policy.mode, enabled } }))}>Use selection for team</button>}
          {mono.teamSkillsPolicy && <button type="button" className="rounded-md border border-stroke px-2.5 py-1.5 text-content/70 hover:bg-selection-subtle focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent" onClick={() => updateMono(monoId, value => ({ ...value, teamSkillsPolicy: undefined }))}>Reset team to role defaults</button>}
        </div>}
      </div>
    </Modal>}
  </section>;
}
