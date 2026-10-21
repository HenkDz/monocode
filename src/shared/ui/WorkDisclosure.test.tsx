// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { WorkDisclosure } from "./WorkDisclosure";
import { ShortHashes } from "./ShortHashes";
const copy = vi.fn(async (_text: string) => {});
vi.mock("../../platform/tauri/clipboard", () => ({ copyText: (text: string) => copy(text) }));

it("keeps work behind an accessible button and copies full commit values from short labels", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div"), root = createRoot(host);
  const hash = "0123456789abcdef0123456789abcdef01234567";
  try {
    await act(async () => root.render(<WorkDisclosure title="Command output"><ShortHashes text={`Commit ${hash}`} /></WorkDisclosure>));
    const toggle = host.querySelector("button")!;
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(host.textContent).not.toContain(hash);
    await act(async () => toggle.click());
    const commit = host.querySelector<HTMLButtonElement>(`button[title="${hash}"]`)!;
    expect(commit.textContent).toBe("0123456");
    expect(host.querySelector('[id]')?.id).toBe(toggle.getAttribute("aria-controls"));
    await act(async () => commit.click());
    expect(copy).toHaveBeenCalledExactlyOnceWith(hash);
    expect(host.querySelector('[role="status"]')?.textContent).toBe("Commit copied");
    await act(async () => toggle.click());
    expect(host.querySelector('[id]')?.hasAttribute("hidden")).toBe(true);
  } finally { await act(async () => root.unmount()); vi.unstubAllGlobals(); }
});
