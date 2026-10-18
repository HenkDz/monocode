type MarkdownNode = { type: string; value?: string; url?: string; children?: MarkdownNode[] };
export const ARTIFACT_LINK_PREFIX = "/__monocode_artifact__/";

/** Replace prose references, including inline code, without altering code blocks or URLs. */
export function remarkArtifactLinks() {
  function visit(node: MarkdownNode) {
    if (["code", "link", "image"].includes(node.type)) return;
    node.children = node.children?.flatMap(child => {
      if ((child.type === "text" || child.type === "inlineCode") && child.value) {
        const parts = child.value.split(/(artifact-[A-Za-z0-9_-]+)/g);
        if (parts.length > 1) return parts.filter(Boolean).map(part => /^artifact-[A-Za-z0-9_-]+$/.test(part)
          ? { type: "link", url: `${ARTIFACT_LINK_PREFIX}${part}`, children: [{ type: "text", value: "Document" }] }
          : { type: child.type, value: part });
      }
      visit(child);
      return [child];
    });
  }
  return visit;
}
