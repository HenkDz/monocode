// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { OrgArtifactLinks } from "./OrgArtifactLinks";

it("opens scoped document ids through the existing panel route and omits absent references", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div"), root = createRoot(container);
  const open = vi.fn();
  window.addEventListener("monocode:open-artifact", open);
  try {
    await act(async () => root.render(<OrgArtifactLinks monoId="member" links={[{ id: "review-1", label: "Review" }, { label: "Report" }]} />));
    expect(container.querySelectorAll("button")).toHaveLength(1);
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Open review"]')!.click());
    expect(open.mock.calls[0][0].detail).toEqual({ monoId: "member", id: "review-1" });
    await act(async () => root.render(<OrgArtifactLinks links={[{ id: "review-1", label: "Review" }]} />));
    expect(container.querySelector("button")).toBeNull();
  } finally {
    await act(async () => root.unmount());
    window.removeEventListener("monocode:open-artifact", open);
    vi.unstubAllGlobals();
  }
});
