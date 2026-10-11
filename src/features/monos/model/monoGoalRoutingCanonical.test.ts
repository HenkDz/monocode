// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MonoComposer } from "../ui/MonoComposer";
import { clearComposerDraft } from "../../sessions/model/draftCache";
import { newSession } from "../../sessions/model/session";
import { sanitizeSessionForPersist } from "../../sessions/data/sessionStore";
import { MonoManagerGoals, type ManagerGoalHost } from "./monoManagerGoals";
import {
  appendMonoGoalOrigin, decideMonoGoalRoute, submitMonoGoal,
  type MonoGoalRoutingContext, type MonoGoalRouteChoice, type MonoGoalSubmission,
} from "./monoGoalRouting";

vi.mock("../../sessions/hooks/useFileDrop", () => ({ useFileDrop: () => false }));
const context: MonoGoalRoutingContext = { ownerId: "grand", projects: [
  { id: "atlas", name: "Atlas", path: "C:/synthetic/Atlas", managerMonoId: "atlas-manager", available: true },
  { id: "beacon", name: "Beacon", path: "C:/synthetic/Beacon", managerMonoId: "beacon-manager", available: true },
] };
const auto: MonoGoalRouteChoice = { mode: "goal", override: "auto" };
const selected: MonoGoalRouteChoice = { mode: "goal", override: "manager", projectId: "atlas" };
const decide = (text: string, choice = auto, ctx = context) =>
  decideMonoGoalRoute({ text, attachmentCount: 0, choice, context: ctx });

// Original CC5CHR inputs, including its passing controls and all 41 unsafe resolver cases.
const cases = [
  { label: "exact two-project control", text: "Fix Atlas and Beacon login" },
  { label: "sentence punctuation control", text: "Fix Atlas and Beacon." },
  { label: "split line break", text: "Fix Atlas and Bea\ncon login" },
  { label: "split whitespace", text: "Fix Atlas and Bea con login" },
  { label: "Markdown bold split", text: "Fix Atlas and Bea**con** login" },
  { label: "Markdown code split", text: "Fix Atlas and Bea`con` login" },
  { label: "plural", text: "Fix Atlas and Beacons login" },
  { label: "ASCII possessive", text: "Fix Atlas and Beacon's login" },
  { label: "curly possessive", text: "Fix Atlas and Beacon’s login" },
  { label: "zero-width-space inside name", text: "Fix Atlas and Bea\u200bcon login" },
  { label: "zero-width-non-joiner inside name", text: "Fix Atlas and Bea\u200ccon login" },
  { label: "zero-width-joiner inside name", text: "Fix Atlas and Bea\u200dcon login" },
  { label: "word joiner inside name", text: "Fix Atlas and Bea\u2060con login" },
  { label: "soft hyphen inside name", text: "Fix Atlas and Bea\u00adcon login" },
  { label: "BOM inside name control", text: "Fix Atlas and Bea\ufeffcon login" },
  { label: "combining grapheme joiner", text: "Fix Atlas and Bea\u034fcon login" },
  { label: "bidi isolate inside name", text: "Fix Atlas and Bea\u2066con\u2069 login" },
  { label: "Cyrillic o homoglyph", text: "Fix Atlas and Beac\u043en login" },
  { label: "fullwidth compatibility form", text: "Fix Atlas and Ｂｅａｃｏｎ login" },
  { label: "added combining acute", text: "Fix Atlas and Bea\u0301con login" },
  { label: "added precomposed acute", text: "Fix Atlas and Beácon login" },
  { label: "canonically equivalent NFC registered name", name: "Beácon", text: "Fix Atlas and Bea\u0301con login" },
  { label: "canonically equivalent NFD registered name", name: "Bea\u0301con", text: "Fix Atlas and Beácon login" },
  { label: "Arabic diacritics", name: "بوابة", text: "Fix Atlas and بُوابة login" },
  { label: "HTML comment splits name", text: "Fix Atlas and Bea<!--comment-->con login" },
  { label: "HTML inline open tag splits name", text: "Fix Atlas and Bea<b>con login" },
  { label: "HTML full inline tag splits name", text: "Fix Atlas and Bea<b>con</b> login" },
  { label: "numeric HTML entity splits name", text: "Fix Atlas and Bea&#99;on login" },
  { label: "Markdown link splits name", text: "Fix Atlas and [Bea](#anchor)con login" },
  { label: "plain unavailable identity", text: "Fix Atlas and Beacon login", unavailable: true },
  { label: "invisible unavailable identity", text: "Fix Atlas and Bea\u200bcon login", unavailable: true },
];

describe("canonical project conflict routing", () => {
  for (const choice of [auto, selected])
    it.each(cases)(`safe ${choice.override}: $label`, ({ text, name, unavailable }) => {
      const ctx = { ...context, projects: context.projects.map(project => project.id === "beacon"
        ? { ...project, name: name ?? project.name, available: !unavailable } : project) };
      expect(decide(text, choice, ctx)).toMatchObject({ kind: "grand" });
    });

  it.each([
    { names: ["Atlas", "API", "Beacon API"], text: "Fix Beacon API login" },
    { names: ["Atlas", "Go"], text: "Fix Atlas goals" },
    { names: ["Atlas", "BE"], text: "Fix Atlas and Beacon login" },
    { names: ["Atlas", "Atlas API"], text: "Fix Atlas API login" },
  ])("keeps short/overlapping registered substring $text at Grand", ({ names, text }) => {
    const ctx = { ownerId: "grand", projects: names.map((name, i) => ({ id: `project-${i}`, name,
      path: `C:/synthetic/p${i}`, managerMonoId: `manager-${i}`, available: true })) };
    expect(decide(text, auto, ctx)).toMatchObject({ kind: "grand" });
  });

  it.each(["Fix Ａｔｌａｓ login", "Fix Átlas login", "Fix A\u0301tlas login"])(
    "normalizes exact positive project names before comparing %s", text => {
      expect(decide(text)).toMatchObject({ kind: "manager", project: { id: "atlas" } });
    });

  it("folds sharp s in both names and text", () => {
    const ctx = { ...context, projects: context.projects.map(project => project.id === "beacon"
      ? { ...project, name: "Straße" } : project) };
    for (const choice of [auto, selected])
      for (const name of ["STRASSE", "Straße", "STRAẞE"])
        expect(decide(`Fix Atlas and ${name} login`, choice, ctx)).toMatchObject({ kind: "grand" });
  });

  it("keeps a name reduced to an empty skeleton conservative", () => {
    const ctx = { ...context, projects: context.projects.map(project => project.id === "beacon"
      ? { ...project, name: "\u0301" } : project) };
    expect(decide("Fix Atlas login", auto, ctx)).toMatchObject({ kind: "grand" });
  });

  it.each(["$", "😀", "\u0000", "\u2028"])("strips every non-alphanumeric insertion from a conflict: %s", insertion => {
    for (const choice of [auto, selected])
      expect(decide(`Fix Atlas and Bea${insertion}con login`, choice)).toMatchObject({ kind: "grand" });
  });

  it.each(["修复登录", "إصلاح الدخول", "Исправить вход"])(
    "requires an explicit chip for separate non-English prose: %s", text => {
      expect(decide(`Atlas ${text}`)).toMatchObject({ kind: "grand" });
      expect(decide(`Atlas ${text}`, selected)).toMatchObject({ kind: "manager", project: { id: "atlas" } });
    });

  it.each(["Beac\u043en", "Beac\u200b\u043en", "Beac\u2060\u043en"])(
    "keeps mixed-letter tokens at Grand even with an explicit chip: %s", name => {
      expect(decide(`Fix Atlas and ${name} login`, selected)).toMatchObject({ kind: "grand" });
    });

  it.each([auto, selected])("never routes randomized two-project insertions to one Manager ($override)", choice => {
    let seed = 0xcc5c1;
    const random = (length: number) => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed % length;
    };
    const insertions = ["", "\u200b", "\u200c", "\u200d", "\u2060", "\u00ad", "\u034f", "\n", "\r\n",
      "<!--note-->", "<b>", "</b>", "[x](#anchor)", "\u0301", "**"];
    const homoglyphs: Record<string, string> = { A: "А", B: "В", a: "а", c: "с", e: "е", o: "о", s: "ѕ" };
    const mutate = (name: string) => [...name].map(letter =>
      `${choice.override === "auto" && random(4) === 0 ? homoglyphs[letter] ?? letter : letter}${insertions[random(insertions.length)]}`).join("");
    for (let i = 0; i < 256; i++) {
      const first = mutate("Atlas");
      const second = mutate("Beacon");
      for (const text of [`Fix Atlas and ${second} login`, `Fix ${first} and Beacon login`, `Fix ${first} and ${second} login`])
        expect(decide(text, choice), JSON.stringify({ text, choice })).toMatchObject({ kind: "grand" });
    }
  });

  it("keeps at least fourteen of the reviewer's twenty single-project goals on Auto", () => {
    const sample = [
      "Fix MonoCode keyboard navigation in the project sidebar",
      "Make MonoCode retain unsent drafts after a restart.",
      "Improve MonoCode accessibility for the route picker",
      "Add regression coverage for MonoCode queue receipts",
      "Reduce MonoCode memory use when opening long conversations",
      "Fix MonoCode src/app/App.tsx autosave handling",
      "Upgrade MonoCode to v1.2.3",
      "Fix DZDistro checkout when a cashier loses connectivity",
      "Improve DZDistro Arabic invoice labels.",
      "Make DZDistro prevent duplicate stock adjustments",
      "Add DZDistro tests for tenant scoped price lists",
      "Speed up DZDistro sales reports for large customers",
      "Update DZDistro InvoiceController.php validation",
      "Improve Browser Link keyboard navigation in settings",
      "Fix Browser Link restoring its minimized window.",
      "Make Browser Link preserve the selected browser after restart",
      "Add Browser Link regression tests for URL routing",
      "Improve Browser Link error messages for missing browsers",
      "Fix Browser Link handling of https://example.test URLs",
      "Simplify Browser Link browser registration cleanup",
    ];
    const ctx = { ownerId: "grand", projects: ["MonoCode", "DZDistro", "Browser Link"].map((name, i) => ({
      id: `project-${i}`, name, path: `C:/synthetic/realistic-${i}`, managerMonoId: `manager-${i}`, available: true,
    })) };
    const decisions = sample.map(text => ({ text, decision: decide(text, auto, ctx) }));
    expect(decisions).toHaveLength(20);
    expect(decisions.filter(row => row.decision.kind === "manager").length).toBeGreaterThanOrEqual(14);
    for (const row of decisions)
      if (row.decision.kind === "manager") expect(row.text).toContain(row.decision.project.name);
  });
});

describe("reviewer Composer/adapter/ledger regressions", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    clearComposerDraft("cc5ci-normalization");
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    clearComposerDraft("cc5ci-normalization");
    vi.unstubAllGlobals();
  });

  it.each([
    { label: "plain conflict Auto control", text: "Fix Atlas and Beacon login", explicit: false },
    { label: "plain conflict explicit chip control", text: "Fix Atlas and Beacon login", explicit: true },
    { label: "zero-width Auto", text: "Fix Atlas and Bea\u200bcon login", explicit: false },
    { label: "zero-width explicit chip", text: "Fix Atlas and Bea\u200bcon login", explicit: true },
    { label: "canonical-equivalent accented name Auto", text: "Fix Atlas and Bea\u0301con login", secondName: "Beácon", explicit: false },
    { label: "homoglyph Auto", text: "Fix Atlas and Beac\u043en login", explicit: false },
    { label: "markup Auto", text: "Fix Atlas and Bea<!--comment-->con login", explicit: false },
    { label: "markup explicit chip", text: "Fix Atlas and Bea<b>con</b> login", explicit: true },
  ])("sends $label safely through the real Composer", async ({ text, explicit, secondName }) => {
    const ctx = { ...context, projects: context.projects.map(project => project.id === "beacon"
      ? { ...project, name: secondName ?? project.name } : project) };
    let source = newSession("codex", "C:/synthetic/Atlas");
    const projects = ctx.projects.map(project => ({ id: project.id, name: project.name, folder: project.path,
      managerId: `${project.id}-engine`, managerMonoId: project.managerMonoId, managerExists: true,
      running: 0, needsDecision: 0, ready: 0, blocked: [], goals: [] }));
    const deliver = vi.fn<ManagerGoalHost["deliver"]>(async () => {});
    const goals: ManagerGoalHost = { mayDelegate: () => true, projects: async () => projects,
      deliver, status: async () => ({}), ready: async () => [] };
    const ledger = new MonoManagerGoals({ load: async () => null, save: async () => {} });
    const grand = vi.fn(() => true);
    const captured: MonoGoalSubmission[] = [];
    const onSubmit = async (prompt: string, attachments: unknown[], submission?: MonoGoalSubmission) => {
      captured.push(submission!);
      return submitMonoGoal({ text: prompt, attachmentCount: attachments.length, origin: "user", submission: submission! }, {
        context: () => ctx, ledger, goals, resolve: async target => projects.find(project => project.id === target.id),
        persistOrigin: async (envelope, message) => { source = appendMonoGoalOrigin(source, envelope, message); },
        hasOrigin: envelope => source.blocks.some(block => block.id === envelope.userMessageId),
        persistPending: async () => {}, persistCard: async () => {}, grand,
      });
    };
    act(() => root.render(createElement(MonoComposer, { name: "Grand", sessionId: "cc5ci-normalization", goalRouting: ctx, onSubmit })));
    const field = container.querySelector<HTMLTextAreaElement>('[aria-label="Message Grand"]')!;
    const props = Object.entries(field).find(([key]) => key.startsWith("__reactProps"))![1];
    act(() => props.onChange({ target: { value: text } }));
    act(() => [...container.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "New goal")!.click());
    if (explicit) {
      await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Goal route: Auto route"]')!.click());
      await act(async () => [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')].find(button => button.textContent?.trim() === "Atlas Manager")!.click());
    }
    expect(container.querySelector('[data-mono-goal-route] [role="status"]')?.textContent).toContain("Send to Grand Orch");
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Send"]')!.click());
    expect(captured[0].projectId).toBeUndefined();
    expect(grand).toHaveBeenCalledOnce();
    expect(deliver).not.toHaveBeenCalled();
    expect(ledger.goals("grand")).toHaveLength(0);
    expect(sanitizeSessionForPersist(source).blocks).toHaveLength(0);
  });
});
