import { readFileSync } from "node:fs";
import ts from "typescript";
import { expect, it, vi } from "vitest";
import type { Mono } from "../features/monos/model/mono";
import { newSession, type Session } from "../features/sessions/model/session";
import { sameProjectPath } from "../features/projects/model/recents";
import { PROVIDER_ACCOUNT_PROVIDERS } from "../features/providers/model/providerAccounts";

// Execute the actual changed App callback with delayed session preparation ports.
const ast = ts.createSourceFile("App.tsx", readFileSync("src/app/App.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let callback: string | undefined;
const visit = (node: ts.Node) => { if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "submitMapManager") callback = node.initializer!.getText(ast); ts.forEachChild(node, visit); }; visit(ast);
if (!callback) throw Error("Actual Manager map callback missing");

function fixture() {
  let manager: Mono = { id: "manager", name: "Mira", role: "manager", projects: ["C:/app"], managerProject: "C:/app", managerEngineId: "engine", sessionId: "chat", mascot: "cat", color: "blue" };
  const chat = { ...newSession("codex", "C:/neutral/manager"), id: "chat", providerAccountId: "account", providerSessionId: "provider-chat" };
  const sessionsRef = { current: [chat] as Session[] };
  const submit = vi.fn(async () => true);
  const accounts: Record<string, string> = Object.fromEntries(PROVIDER_ACCOUNT_PROVIDERS.map(provider => [provider, "selected-account"]));
  let prepare: () => Promise<Session | undefined> = async () => chat;
  const ports = { findMono: (id: string) => id === "manager" ? manager : undefined, sameProjectPath, sessionsRef,
    selectedProviderAccountId: (provider: string) => accounts[provider], PROVIDER_ACCOUNT_PROVIDERS, ensureMonoSession: vi.fn(async () => prepare()), homeDir: async () => "C:/synthetic/home",
    ensureOpenSession: async () => chat, saveMonoPermissions: async () => {}, newDefaultSession: newSession, setSessions: vi.fn(), submitSessionRef: { current: submit } };
  const send = new Function(...Object.keys(ports), ts.transpile(`return ${callback}`, { target: ts.ScriptTarget.ES2022 }))(...Object.values(ports)) as (managerId: string, project: string, text: string) => Promise<boolean>;
  return { send, submit, chat, sessionsRef, ports, update: (change: Partial<Mono>) => { manager = { ...manager, ...change }; },
    account: (value: string, provider = "codex") => { accounts[provider] = value; }, prepare: (value: () => Promise<Session | undefined>) => { prepare = value; } };
}

it("sends exact ordinary user text to the bound Manager conversation, including a retained neutral cwd", async () => {
  const f = fixture(); await expect(f.send("manager", "c:\\APP", "  Exact user request\nkeep source  ")).resolves.toBe(true);
  expect(f.submit).toHaveBeenCalledExactlyOnceWith("chat", "  Exact user request\nkeep source  ", []);
});

it.each(["archive", "role", "project", "engine", "session", "account", "storage-account", "provider-session", "selected-account", "cwd", "worktree", "removed-session"])("rejects %s drift after asynchronous session preparation without sending", async change => {
  const f = fixture();
  f.prepare(async () => {
    if (change === "archive") f.update({ archivedAt: 1 });
    if (change === "role") f.update({ role: "member" });
    if (change === "project") f.update({ projects: ["C:/other"], managerProject: "C:/other" });
    if (change === "engine") f.update({ managerEngineId: "replacement" });
    if (change === "session") f.update({ sessionId: "replacement" });
    if (change === "selected-account") f.account("new-account");
    const mutation: Partial<Session> = change === "account" ? { providerAccountId: "new-account" } : change === "storage-account" ? { codexStorageAccountId: "new-account" } : change === "provider-session" ? { providerSessionId: "new-provider-chat" } : change === "cwd" ? { cwd: "C:/other" } : change === "worktree" ? { worktreeCwd: "C:/other-wt" } : {};
    f.sessionsRef.current = change === "removed-session" ? [] : [{ ...f.chat, ...mutation }];
    return f.chat;
  });
  await expect(f.send("manager", "C:/app", "User request")).rejects.toThrow(/changed/);
  expect(f.submit).not.toHaveBeenCalled();
});

it("preserves refusal and preparation errors from the ordinary user path", async () => {
  const f = fixture(); f.submit.mockResolvedValueOnce(false);
  await expect(f.send("manager", "C:/app", "Request")).resolves.toBe(false);
  f.prepare(async () => { throw Error("Preparation unavailable"); });
  await expect(f.send("manager", "C:/app", "Request")).rejects.toThrow("Preparation unavailable");
  expect(f.submit).toHaveBeenCalledOnce();
});

it.each(PROVIDER_ACCOUNT_PROVIDERS)("rejects a %s default selection change while preparing without sending", async provider => {
  const f = fixture(); f.prepare(async () => { f.account("new-selection", provider); return f.chat; });
  await expect(f.send("manager", "C:/app", "Request")).rejects.toThrow("account changed");
  expect(f.submit).not.toHaveBeenCalled();
});

it("allows first session creation only when the exact live Manager binds that returned session", async () => {
  const f = fixture(); f.update({ sessionId: undefined }); f.sessionsRef.current = [];
  f.prepare(async () => { f.update({ sessionId: f.chat.id }); f.sessionsRef.current = [f.chat]; return f.chat; });
  await expect(f.send("manager", "C:/app", "First request")).resolves.toBe(true);
  expect(f.submit).toHaveBeenCalledOnce();
});
