/** Org cards open the same document panel as ordinary artifact cards. */
export function OrgArtifactLinks({ monoId, links }: { monoId?: string; links: readonly { id?: string; label: string }[] }) {
  if (!monoId || !links.some(link => link.id)) return null;
  return <div className="flex flex-wrap gap-1">
    {links.filter(link => link.id).map(link => <button
      key={link.id}
      type="button"
      data-org-artifact={link.id}
      aria-label={`Open ${link.label.toLowerCase()}`}
      className="rounded-md px-2.5 py-1.5 text-xs text-content/70 hover:bg-content/8 focus-visible:outline-accent"
      onClick={() => window.dispatchEvent(new CustomEvent("monocode:open-artifact", { detail: { monoId, id: link.id } }))}
    >{link.label}</button>)}
  </div>;
}
