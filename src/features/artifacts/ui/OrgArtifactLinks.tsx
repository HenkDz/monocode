import { ArtifactReference } from "./ArtifactReference";
/** Org cards open the same document panel as ordinary artifact cards. */
export function OrgArtifactLinks({ monoId, links }: { monoId?: string; links: readonly { id?: string; label: string }[] }) {
  if (!monoId || !links.some(link => link.id)) return null;
  return <div className="flex flex-wrap gap-1">
    {links.filter(link => link.id).map(link => <ArtifactReference key={link.id} id={link.id!} monoId={monoId} label={link.label} />)}
  </div>;
}
