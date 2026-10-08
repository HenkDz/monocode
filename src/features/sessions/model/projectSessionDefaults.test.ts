import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  newSession,
  newDefaultSession,
  newSessionForProject,
  retargetSessionToProject,
  type Session,
} from "./session";
import {
  setProjectDefaultModel,
  setProjectDefaultProvider,
  setProjectProviderHidden,
} from "./projectProviders";
import { saveLastModelChoice, resetHarnessModelOverlays, setHarnessModels } from "./models";

describe("newSessionForProject", () => {
  beforeEach(() => {
    const storage = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
    });
  });

  afterEach(() => {
    resetHarnessModelOverlays();
    vi.unstubAllGlobals();
  });

  it("uses Codex 6.1 Sol for a fresh project instead of an unrelated Claude seed", () => {
    const seed = newSession("claude", "/repo/a", "claude:opus-5");
    const session = newSessionForProject(seed, "/repo/a");
    expect(session.harness).toBe("codex");
    expect(session.model).toBe("codex:gpt-6.1-sol");
    expect(seed.harness).toBe("claude");
    expect(seed.model).toBe("claude:opus-5");
  });

  it("falls back to an enabled provider when the seed one is disabled", () => {
    setProjectProviderHidden("/repo/a", "claude", true);
    const seed = newSession("claude", "/repo/a", "claude:opus-5");
    const session = newSessionForProject(seed, "/repo/a");
    expect(session.harness).toBe("codex");
    expect(session.cwd).toBe("/repo/a");
  });

  it("does not carry a seed model across providers", () => {
    setProjectProviderHidden("/repo/a", "claude", true);
    const seed = newSession("claude", "/repo/a", "claude:opus-5");
    const session = newSessionForProject(seed, "/repo/a");
    expect(session.model).not.toBe("claude:opus-5");
  });

  it("uses the project default provider even when the seed one is allowed", () => {
    setProjectDefaultProvider("/repo/a", "cursor", "cursor:composer-2.5");
    const seed = newSession("claude", "/repo/a", "claude:opus-5");
    const session = newSessionForProject(seed, "/repo/a");
    expect(session.harness).toBe("cursor");
    expect(session.model).toBe("cursor:composer-2.5");
  });

  it("preserves an explicitly configured project provider and model", () => {
    setProjectDefaultProvider("/repo/a", "claude");
    setProjectDefaultModel("/repo/a", "claude", "claude:haiku-4.5");
    const seed = newSession("claude", "/repo/a", "claude:opus-5");
    const session = newSessionForProject(seed, "/repo/a");
    expect(session.harness).toBe("claude");
    expect(session.model).toBe("claude:haiku-4.5");
  });

  it("ignores stale global Claude defaults for new chats and retains the exact Codex model through late catalogs", () => {
    saveLastModelChoice("claude", "claude:sonnet-5");
    resetHarnessModelOverlays();
    expect(newDefaultSession("/repo/new")).toMatchObject({ harness: "codex", model: "codex:gpt-6.1-sol" });
    expect(newSession()).toMatchObject({ harness: "codex", model: "codex:gpt-6.1-sol" });
    saveLastModelChoice("codex", "codex:gpt-5.6-sol");
    expect(newSession()).toMatchObject({ harness: "codex", model: "codex:gpt-6.1-sol" });
    setHarnessModels("codex", [{ id: "codex:gpt-6.1-sol", harness: "codex", name: "GPT 6.1 Sol" }]);
    expect(newDefaultSession("/repo/new")).toMatchObject({ harness: "codex", model: "codex:gpt-6.1-sol" });
    expect(newSession("codex", "/repo/new", "codex:gpt-5.6-sol")).toMatchObject({ harness: "codex", model: "codex:gpt-5.6-sol" });
    expect(newSession("claude", "/repo/new", "claude:sonnet-5")).toMatchObject({ harness: "claude", model: "claude:sonnet-5" });
  });
});

describe("retargetSessionToProject", () => {
  beforeEach(() => {
    const storage = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("adopts the project defaults while keeping the session identity", () => {
    setProjectDefaultProvider("/repo/a", "cursor", "cursor:composer-2.5");
    const blank = newSession("claude", "~", "claude:opus-5");
    const retargeted = retargetSessionToProject(blank, "/repo/a");
    expect(retargeted.id).toBe(blank.id);
    expect(retargeted.cwd).toBe("/repo/a");
    expect(retargeted.harness).toBe("cursor");
    expect(retargeted.model).toBe("cursor:composer-2.5");
  });

  it("keeps the session's provider when the project has no defaults", () => {
    const blank = newSession("claude", "~", "claude:opus-5");
    const retargeted = retargetSessionToProject(blank, "/repo/a");
    expect(retargeted.harness).toBe("claude");
    expect(retargeted.model).toBe("claude:opus-5");
  });

  it("drops provider-bound fields when retargeting changes the harness", () => {
    setProjectDefaultProvider("/repo/a", "cursor", "cursor:composer-2.5");
    const blank: Session = {
      ...newSession("claude", "~", "claude:opus-5"),
      providerSessionId: "claude-session",
      providerAccountId: "claude-account",
    };
    const retargeted = retargetSessionToProject(blank, "/repo/a");
    expect(retargeted.harness).toBe("cursor");
    expect(retargeted.providerSessionId).toBeUndefined();
    expect(retargeted.providerAccountId).toBeUndefined();
  });

  it("keeps provider-bound fields when the harness is unchanged", () => {
    setProjectDefaultModel("/repo/a", "claude", "claude:haiku-4.5");
    const blank: Session = {
      ...newSession("claude", "~", "claude:opus-5"),
      providerSessionId: "claude-session",
      providerAccountId: "claude-account",
    };
    const retargeted = retargetSessionToProject(blank, "/repo/a");
    expect(retargeted.harness).toBe("claude");
    expect(retargeted.providerSessionId).toBe("claude-session");
    expect(retargeted.providerAccountId).toBe("claude-account");
  });
});
