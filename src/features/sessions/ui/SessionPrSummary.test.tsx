// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { SessionPrSummary } from "./SessionPrSummary";
import type { WorktreePr } from "../../source-control/model/pullRequests";

it("renders a single slim reference chip for merged/closed history and navigates to those URLs", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const entries: WorktreePr[] = ["merged", "closed"].map((state, i) => ({
    cwd: "/repo",
    links: [],
    verifiedAt: 1,
    pr: {
      number: i + 1,
      title: "History",
      url: `https://github.com/example/repo/pull/${i + 1}`,
      state,
    },
  }));
  const host = document.createElement("div"),
    root = createRoot(host),
    open = vi.fn();
  window.addEventListener("monocode:open-pull-requests", open);
  try {
    await act(async () => root.render(<SessionPrSummary turn={{ entries }} />));
    expect(host.textContent).toBe("2 PRs referenced · all settled ›");
    expect(host.querySelectorAll("button")).toHaveLength(1);
    expect(host.querySelector("section")).toBeNull();
    await act(async () => host.querySelector("button")!.click());
    expect(open.mock.calls[0][0].detail.urls).toEqual(
      entries.map((entry) => entry.pr.url),
    );
    await act(async () =>
      root.render(
        <SessionPrSummary
          turn={{
            entries: [
              {
                ...entries[0],
                pr: {
                  ...entries[0].pr,
                  state: "open",
                  checksStatus: "pending",
                },
              },
            ],
            action: "Opened",
          }}
        />,
      ),
    );
    expect(host.textContent).toBe("Opened PR #1 · checks running ›");
    expect(host.textContent).not.toContain("Open diff");
  } finally {
    act(() => root.unmount());
    window.removeEventListener("monocode:open-pull-requests", open);
    vi.unstubAllGlobals();
  }
});
