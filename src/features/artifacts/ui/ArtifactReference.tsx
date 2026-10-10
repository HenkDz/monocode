import { useEffect, useState } from "react";
import { ARTIFACTS_CHANGED_EVENT, getArtifact, type Artifact } from "../artifacts";

export function ArtifactReference({ id, monoId, label = "Document" }: { id: string; monoId?: string; label?: string }) {
  const [artifact, setArtifact] = useState<Artifact | null>(null);
  useEffect(() => {
    let current = true;
    const load = () => { void getArtifact(id).then(value => { if (current) setArtifact(value); }).catch(() => { if (current) setArtifact(null); }); };
    setArtifact(null);
    load();
    window.addEventListener(ARTIFACTS_CHANGED_EVENT, load);
    return () => { current = false; window.removeEventListener(ARTIFACTS_CHANGED_EVENT, load); };
  }, [id]);
  const title = artifact?.title || label;
  return <button type="button" data-org-artifact={id} aria-label={`Open ${artifact?.title || label.toLowerCase()}`} title={title}
    className="inline-flex max-w-full items-center gap-1 rounded-md bg-content/6 px-2 py-0.5 align-baseline text-xs text-content/70 hover:bg-content/10 focus-visible:outline-accent"
    onClick={event => { event.stopPropagation(); window.dispatchEvent(new CustomEvent("monocode:open-artifact", { detail: { monoId: monoId ?? artifact?.scope?.ownerMonoId, id } })); }}>
    <span className="truncate">{title}</span>
  </button>;
}

/** Notices and compact feed entries share the same reader link as Markdown summaries. */
export function ArtifactText({ text, monoId }: { text: string; monoId?: string }) {
  const parts = text.split(/`?(artifact-[A-Za-z0-9_-]+)`?/g);
  return <>{parts.map((part, index) => index % 2 ? <ArtifactReference key={index} id={part} monoId={monoId} /> : part)}</>;
}
