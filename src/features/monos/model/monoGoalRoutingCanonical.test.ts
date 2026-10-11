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

// All CC5CI-R resolver probes, including its safe controls.
const reviewCases = [
  { label: "RLO reversed whole second name", text: "Fix Atlas and \u202enocaeB\u202c login" },
  { label: "RLO reversed second-name suffix", text: "Fix Atlas and Bea\u202enoc\u202c login" },
  { label: "RLO unavailable second identity", text: "Fix Atlas and \u202enocaeB\u202c login", unavailable: true },
  { label: "fullwidth digits", name: "Beacon2", text: "Fix Atlas and Beacon\uFF12 login" },
  { label: "circled digit", name: "Beacon2", text: "Fix Atlas and Beacon\u2461 login" },
  { label: "mathematical double-struck digit", name: "Beacon2", text: "Fix Atlas and Beacon\u{1D7DA} login" },
  { label: "ASCII digit name", name: "Beacon2", text: "Fix Atlas and Beacon2 login" },
  { label: "overlapping Atlas and Atlas2", name: "Atlas2", text: "Fix Atlas2 login" },
  { label: "overlapping numeric name with fullwidth digit", name: "Atlas2", text: "Fix Atlas and Atlas\uFF12 login" },
  { label: "emoji split", text: "Fix Atlas and Bea\u{1F680}con login" },
  { label: "registered emoji name", name: "Beacon\u{1F680}", text: "Fix Atlas and Beacon\u{1F680} login" },
  { label: "CRLF inside second name", text: "Fix Atlas and Bea\r\ncon login" },
  { label: "CRLF between names", text: "Fix Atlas\r\nand Beacon login" },
  { label: "very long normal conflict within limit", text: "Fix Atlas " + "x ".repeat(3900) + "and Beacon login" },
  { label: "very long RLO conflict within limit", text: "Fix Atlas " + "x ".repeat(3900) + "and \u202enocaeB\u202c login" },
  { label: "above maximum length", text: "Fix Atlas " + "x ".repeat(4100) + "and \u202enocaeB\u202c login" },
  { label: "RLI ordinary direction control", text: "Fix Atlas and \u2067Beacon\u2069 login" },
  { label: "RLO logical forward control", text: "Fix Atlas and \u202eBeacon\u202c login" },
  { label: "fullwidth second name", text: "Fix Atlas and \uFF22\uFF45\uFF41\uFF43\uFF4F\uFF4E login" },
  { label: "nested substring names", first: "Beacon", name: "Beacon API", text: "Fix Beacon API login" },
  { label: "overlapping numeric name with Arabic Indic digit", name: "Atlas2", text: "Fix Atlas and Atlas\u0662 login" },
  { label: "whole Cyrillic lookalike Ace", name: "Ace", text: "Fix Atlas and \u0410\u0441\u0435 login" },
  { label: "whole Cyrillic lookalike COO", name: "COO", text: "Fix Atlas and \u0421\u041E\u041E login" },
  { label: "whole Cyrillic lookalike ACCESS", name: "ACCESS", text: "Fix Atlas and \u0410\u0421\u0421\u0415\u0405\u0405 login" },
];
for (const [label, zero] of [
  ["Arabic Indic", 0x660], ["Extended Arabic Indic", 0x6f0], ["Devanagari", 0x966], ["Bengali", 0x9e6],
  ["Gurmukhi", 0xa66], ["Gujarati", 0xae6], ["Oriya", 0xb66], ["Tamil", 0xbe6], ["Telugu", 0xc66],
  ["Kannada", 0xce6], ["Malayalam", 0xd66], ["Thai", 0xe50], ["Lao", 0xed0], ["Tibetan", 0xf20],
] as const) reviewCases.push({ label: `${label} decimal digit`, name: "Beacon2",
  text: `Fix Atlas and Beacon${String.fromCodePoint(zero + 2)} login` });

describe("canonical project conflict routing", () => {
  for (const choice of [auto, selected])
    it.each(reviewCases)(`CC5CI-R ${choice.override}: $label`, ({ text, name, first, unavailable }) => {
      const ctx = { ...context, projects: context.projects.map(project => project.id === "beacon"
        ? { ...project, name: name ?? project.name, available: !unavailable }
        : { ...project, name: first ?? project.name }) };
      expect(decide(text, choice, ctx)).toMatchObject({ kind: "grand" });
    });

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
    "keeps non-ASCII positive project mentions at Grand: %s", text => {
      for (const choice of [auto, selected])
        expect(decide(text, choice)).toMatchObject({ kind: "grand" });
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
    "keeps separate non-English prose at Grand in both modes: %s", text => {
      for (const choice of [auto, selected])
        expect(decide(`Atlas ${text}`, choice)).toMatchObject({ kind: "grand" });
    });

  it.each(["Beac\u043en", "Beac\u200b\u043en", "Beac\u2060\u043en"])(
    "keeps mixed-letter tokens at Grand even with an explicit chip: %s", name => {
      expect(decide(`Fix Atlas and ${name} login`, selected)).toMatchObject({ kind: "grand" });
    });

  it.each(["Átlas", "Ａｔｌａｓ", "Atlas\u{1F680}", "Atlas\u0000", "بوابة"])(
    "keeps a selected non-ASCII or control-bearing registered name at Grand: %s", name => {
      const ctx = { ...context, projects: [{ ...context.projects[0], name }] };
      for (const choice of [auto, selected])
        expect(decide("Fix Atlas login", choice, ctx)).toMatchObject({ kind: "grand" });
    });

  it.each([auto, selected])("rejects every non-ASCII code point anywhere in a generated goal ($override)", choice => {
    let seed = 0xcc5c5;
    const prefix = "Fix Atlas login";
    for (let codePoint = 0x80; codePoint <= 0x10ffff; codePoint++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const position = seed % (prefix.length + 1);
      const text = prefix.slice(0, position) + String.fromCodePoint(codePoint) + prefix.slice(position);
      const route = decide(text, choice);
      if (route.kind !== "grand") throw Error(`Direct Manager route for U+${codePoint.toString(16)}: ${JSON.stringify(text)}`);
    }
  });

  it.each([auto, selected])("rejects ASCII controls except ordinary whitespace ($override)", choice => {
    for (const codePoint of [...Array(32).keys(), 127]) {
      if ([9, 10, 13].includes(codePoint)) continue;
      expect(decide(`Fix Atlas login${String.fromCodePoint(codePoint)}`, choice)).toMatchObject({ kind: "grand" });
    }
    expect(decide(" \t\r\nFix Atlas login\t\r\n ", choice)).toMatchObject({ kind: "manager", project: { id: "atlas" } });
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
    expect(decisions.filter(row => row.decision.kind === "manager")).toHaveLength(14);
    expect(decisions.filter(row => row.decision.kind === "grand").map(row => row.text))
      .toEqual([sample[0], sample[5], sample[6], sample[11], sample[12], sample[18]]);
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
    { label: "RLO Auto", text: "Fix Atlas and \u202enocaeB\u202c login", explicit: false },
    { label: "RLO explicit", text: "Fix Atlas and \u202enocaeB\u202c login", explicit: true },
    { label: "Arabic Indic digit Auto", text: "Fix Atlas and Beacon\u0662 login", secondName: "Beacon2", explicit: false },
    { label: "Arabic Indic digit explicit", text: "Fix Atlas and Beacon\u0662 login", secondName: "Beacon2", explicit: true },
    { label: "whole Cyrillic lookalike explicit", text: "Fix Atlas and \u0410\u0441\u0435 login", secondName: "Ace", explicit: true },
    ...["\u00a0", "\ufeff", "\u2028"].flatMap(mark => [false, true].flatMap(explicit => [
      { label: `leading ${JSON.stringify(mark)} ${explicit ? "explicit" : "Auto"}`, text: `${mark}Fix Atlas login`, explicit },
      { label: `trailing ${JSON.stringify(mark)} ${explicit ? "explicit" : "Auto"}`, text: `Fix Atlas login${mark}`, explicit },
    ])),
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
      expect(prompt).toBe(text);
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
    expect(captured[0].managerMonoId).toBeUndefined();
    if (/[^\t\n\r\x20-\x7e]/.test(text))
      expect(captured[0].reason).toBe("Contains non-English or special characters, so Grand Orch will route it.");
    expect(grand).toHaveBeenCalledOnce();
    expect(deliver).not.toHaveBeenCalled();
    expect(ledger.goals("grand")).toHaveLength(0);
    expect(sanitizeSessionForPersist(source).blocks).toHaveLength(0);
  });
});
