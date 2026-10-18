// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { ArtifactText } from "./ArtifactReference";
import { OrgArtifactLinks } from "./OrgArtifactLinks";
import { AgentMarkdown } from "../../sessions/ui/AgentMarkdown";
import { ARTIFACTS_CHANGED_EVENT } from "../artifacts";

const fixture = vi.hoisted(() => ({ title: "Investigation findings" }));
vi.mock("../artifacts", async importOriginal => ({ ...await importOriginal<typeof import("../artifacts")>(), getArtifact: vi.fn(async () => ({ id: "artifact-report-123", kind: "document", title: fixture.title, scope: { ownerMonoId: "worker" } })) }));

it("uses the artifact title and reader route in Activity, cards and Markdown summaries", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div"), root = createRoot(container);
  const open = vi.fn();
  window.addEventListener("monocode:open-artifact", open);
  try {
    await act(async () => root.render(<>
      <ArtifactText text="Report saved and attached: `artifact-report-123`" monoId="worker" />
      <OrgArtifactLinks monoId="worker" links={[{ id: "artifact-report-123", label: "Report" }]} />
      <AgentMarkdown text="Report saved: `artifact-report-123`." />
    </>));
    expect(container.textContent).not.toContain("artifact-report-123");
    expect(container.querySelectorAll('[aria-label="Open Investigation findings"]')).toHaveLength(3);
    await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
    expect(open.mock.calls[0][0].detail).toEqual({ monoId: "worker", id: "artifact-report-123" });
    fixture.title = "Updated report";
    await act(async () => window.dispatchEvent(new Event(ARTIFACTS_CHANGED_EVENT)));
    expect(container.querySelectorAll('[aria-label="Open Updated report"]')).toHaveLength(3);
  } finally {
    await act(async () => root.unmount());
    window.removeEventListener("monocode:open-artifact", open);
    vi.unstubAllGlobals();
  }
});
