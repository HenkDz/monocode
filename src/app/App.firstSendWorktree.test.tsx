// @vitest-environment happy-dom
// Real PaneTree/SessionPane/Composer + picker and source-selected App callbacks, synthetic ports only.
import { readFileSync } from 'node:fs';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import ts from 'typescript';
const fixture = vi.hoisted(() => ({
  read: vi.fn(),
  branches: { branches: { current: 'feature-a', detached: false, branches: [{ name: 'main', current: false }] }, settled: true },
  trees: { data: { worktrees: [
    { path: 'C:/synthetic/repo', branch: 'main', isMain: true },
    { path: 'C:/synthetic/a', branch: 'feature-a', isMain: false },
    { path: 'C:/synthetic/b', branch: 'feature-b', isMain: false },
  ] } },
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: async (command: string) => { throw Error(`Unlisted native port: ${command}`); } }));
vi.mock('@tauri-apps/api/webview', () => ({ getCurrentWebview: () => ({ onDragDropEvent: async () => () => {} }) }));
vi.mock('../features/files/ui/FilePane', () => ({ FilePane: () => null }));
vi.mock('../features/source-control/hooks/useProjectBranches', () => ({ useProjectBranchesState: () => fixture.branches }));
vi.mock('../features/source-control/hooks/useProjectWorktrees', () => ({ useProjectWorktrees: () => fixture.trees }));
vi.mock('../features/sessions/model/attachments', async original => ({ ...await original<typeof import('../features/sessions/model/attachments')>(), attachmentsFromFiles: fixture.read }));
import { Composer } from '../features/sessions/ui/Composer';
import { PaneTree } from '../features/workspace/ui/PaneTree';
import { TranscriptPool, TranscriptPoolOutlet } from '../features/sessions/ui/TranscriptPool';
import { clearComposerDraft } from '../features/sessions/model/draftCache';
import { newSession, sessionWorkCwd } from '../features/sessions/model/session';
import { isBlankSession } from '../features/projects/model/projectReturn';
import { sessionInWorktree } from '../features/source-control/model/worktrees';
import { pathKey, isEqualOrInside } from '../shared/lib/paths';
import { useWorkspaceNavigation } from './hooks/useWorkspaceNavigation';
import { newTab } from '../features/workspace/model/layout';
import { setWorktreeFocus } from '../features/source-control/model/worktreeFocus';
import type { Worktree } from '../features/source-control/model/worktrees';

const checkout = '.';
const ast = ts.createSourceFile('App.tsx', readFileSync(`${checkout}/src/app/App.tsx`, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const nodes: ts.Node[] = []; const visit = (node: ts.Node) => { nodes.push(node); ts.forEachChild(node, visit); }; visit(ast);
function callback(name: string, scope: Record<string, unknown>) {
  const node = nodes.find(node => ts.isVariableDeclaration(node) && node.name.getText(ast) === name) as ts.VariableDeclaration;
  expect(node, `actual App ${name}`).toBeTruthy();
  const expression = (node.initializer as ts.CallExpression).arguments[0].getText(ast);
  return Function(...Object.keys(scope), ts.transpile(`return (${expression});`, { target: ts.ScriptTarget.ES2022 }))(...Object.values(scope));
}
let root: ReturnType<typeof createRoot> | undefined;
afterEach(() => { if (root) act(() => root!.unmount()); root = undefined; document.body.replaceChildren(); vi.unstubAllGlobals(); });

it.each(['picker', 'sidebar', 'retry', 'reset', 'unmount'] as const)('locks the source chat from Send intent during pending paste: %s', async route => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  Element.prototype.scrollIntoView = () => {};
  let release!: (attachments: unknown[]) => void;
  const pending = new Promise<unknown[]>(resolve => { release = resolve; });
  fixture.read.mockReturnValue(pending);
  fixture.read.mockClear();
  const original = { ...newSession('claude', 'C:/synthetic/repo'), id: 'draft', worktreeCwd: 'C:/synthetic/a', providerAccountId: 'synthetic-account' };
  const sessionsRef = { current: [original] };
  const calls: string[] = [];
  const noop = () => {};
  const pendingComposerSubmits = { current: new Set<string>() };
  const start = callback('onComposerSubmitStart', { pendingComposerSubmits });
  const change = callback('onWorktreeChange', {
    sessionsRef, pendingComposerSubmits, isBlankSession, sessionWorkCwd, sessionInWorktree, pathKey, isEqualOrInside,
    isProjectManager: () => false, removingSessionIds: { current: new Set() }, switchingWorktrees: { current: new Map() },
    removingWorktreePaths: { current: new Set() }, pendingPersist: { current: new Set() }, orchestrator: { forSession: () => undefined },
    listWorktrees: async () => fixture.trees.data, flushSessionCheckpoint: async () => {}, sessionChildHarnesses: () => [],
    workspacePins: { current: new Map() }, currentWorkspace: () => ({}), shouldPersistSession: () => false,
    invalidateLoadedSession: noop, setSessions: (rows: typeof sessionsRef.current) => { sessionsRef.current = rows; },
    notifyGitChanged: noop, notifyReviewChanged: noop, refreshHistory: async () => {},
    appendTab: () => { throw Error('Unexpected tab creation'); }, setActiveTabId: noop, setComposerFocused: noop,
  });
  const composerChange = callback('onComposerWorktreeChange', { onWorktreeChange: change });
  const submit = vi.fn(() => route !== 'retry');
  const createTab = vi.fn(() => 'separate-tab');
  let navigation!: ReturnType<typeof useWorkspaceNavigation>;
  let resetToken = 0;
  let replacementRelease: (() => void) | undefined;
  function Harness() {
    const tab = { ...newTab(original.id), id: 'source-tab' };
    navigation = useWorkspaceNavigation({ project: original.cwd, tabs: [tab], sessions: sessionsRef.current, activeTabId: tab.id,
      pins: new Map(), tabWorkspace: () => sessionWorkCwd(sessionsRef.current[0]),
      canReuseSession: id => !pendingComposerSubmits.current.has(id),
      moveSession: (id, tree, isCurrent) => change(id, tree, false, isCurrent),
      activateTab: noop, createTab });
    return createElement(Composer, {
      harness: 'claude', model: 'claude-sonnet', runtimeMode: 'supervised', cwd: original.cwd, executionCwd: original.worktreeCwd,
      branch: 'feature-a', draftWorkspace: true, initialDraft: 'first message', hideProjectPicker: true,
      draftResetToken: resetToken, focused: false,
      onFocus: noop, onCwdChange: noop, onModelChange: noop, onRuntimeModeChange: noop,
      onSubmit: submit, onSubmitStart: () => start(original.id),
      onWorktreeChange: async (tree: Worktree) => { calls.push(tree.path); await composerChange(original.id, tree); },
    });
  }
  const container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => root!.render(createElement(Harness)));
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label^="Starts in"]')!.click());
  const textarea = container.querySelector('textarea')!;
  const paste = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(paste, 'clipboardData', { value: { getData: () => '', files: [new File(['image'], 'synthetic.png', { type: 'image/png' })], items: [] } });
  await act(async () => textarea.dispatchEvent(paste));
  expect(fixture.read).toHaveBeenCalledOnce();
  const option = [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')].find(row => row.textContent?.includes('feature-b'))!;
  expect(option).toBeTruthy();
  await act(async () => {
    container.querySelector<HTMLButtonElement>('[aria-label="Send"]')!.click();
    option.click(); // Same event turn: the picker still holds its pre-Send callback.
  });
  expect(submit).not.toHaveBeenCalled();
  expect(pendingComposerSubmits.current.has(original.id)).toBe(true);
  try {
    await act(async () => option.click());
    if (route === 'sidebar') {
      await act(async () => navigation.selectWorkspace(original.cwd, { path: 'C:/synthetic/b', branch: 'feature-b' }));
      expect(createTab).toHaveBeenCalledOnce();
    }
    await expect(change(original.id, fixture.trees.data.worktrees[2], false)).rejects.toThrow('Wait for this session');
    console.log(JSON.stringify({ phase: 'paste-pending-after-send', callbacks: calls, sessionPath: sessionWorkCwd(sessionsRef.current[0]), providerAccountId: sessionsRef.current[0].providerAccountId }));
    expect(calls, 'No checkout change is allowed after first Send begins').toEqual([]);
    expect(sessionWorkCwd(sessionsRef.current[0])).toBe(original.worktreeCwd);
    if (route === 'reset') {
      resetToken++;
      await act(async () => root!.render(createElement(Harness)));
      expect(pendingComposerSubmits.current.size).toBe(0);
    }
  } finally {
    if (route === 'unmount') {
      await act(async () => root!.unmount()); root = undefined;
      await Promise.resolve();
      expect(pendingComposerSubmits.current.size).toBe(0);
      replacementRelease = start(original.id);
    }
    await act(async () => { release([]); await pending; });
    setWorktreeFocus(original.cwd, undefined);
  }
  if (replacementRelease) {
    expect(pendingComposerSubmits.current.has(original.id)).toBe(true);
    replacementRelease();
  }
  expect(pendingComposerSubmits.current.size).toBe(0);
  if (route === 'unmount' || route === 'reset') expect(submit).not.toHaveBeenCalled();
  else expect(submit).toHaveBeenCalledOnce();
  if (route === 'retry') {
    expect(container.querySelector('textarea')!.value).toBe('first message');
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label^="Starts in"]')!.click());
    const retryOption = [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')].find(row => row.textContent?.includes('feature-b'));
    await act(async () => retryOption!.click());
    expect(sessionWorkCwd(sessionsRef.current[0])).toBe('C:/synthetic/b');
  }
});

it.each(['single', 'split', 'pooled'] as const)('forwards actual App submit-start through real PaneTree/SessionPane/Composer: %s', async mode => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  Element.prototype.scrollIntoView = () => {};
  const original = { ...newSession('claude', 'C:/synthetic/repo'), id: `pane-${mode}`, worktreeCwd: 'C:/synthetic/a', composerSeed: 'first message', providerAccountId: 'synthetic-account' };
  const other = { ...newSession('claude', original.cwd), id: `other-${mode}` };
  const pendingComposerSubmits = { current: new Set<string>() };
  const start = callback('onComposerSubmitStart', { pendingComposerSubmits });
  const releases: ReturnType<typeof vi.fn>[] = [];
  const onComposerSubmitStart = vi.fn((id: string) => {
    const release = vi.fn(start(id));
    releases.push(release);
    return release;
  });
  let lockedAtSubmit = false;
  const onSubmit = vi.fn(() => {
    lockedAtSubmit = pendingComposerSubmits.current.has(original.id);
    return mode !== 'split';
  });
  let finishPaste!: (attachments: unknown[]) => void;
  const pending = new Promise<unknown[]>(resolve => { finishPaste = resolve; });
  fixture.read.mockReset().mockReturnValue(pending);
  const noop = () => {};
  // Select App's actual shared-prop initializer so this cannot hand-wire around its boundary.
  const declaration = nodes.find(node => ts.isVariableDeclaration(node) && node.name.getText(ast) === 'sessionPaneProps') as ts.VariableDeclaration;
  const ports = { onComposerSubmitStart, onSubmit, recents: [], workspaceNavigation: { pending: false }, active: original };
  const scope = new Proxy(ports, { has: () => true, get: (target, name) => name === Symbol.unscopables ? undefined : name in target ? Reflect.get(target, name) : noop });
  const shared = Function('scope', `with(scope) { ${ts.transpile(`return (${declaration.initializer!.getText(ast)});`, { target: ts.ScriptTarget.ES2022 })} }`)(scope);
  const pool = mode === 'pooled' ? new TranscriptPool() : undefined;
  const container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  try {
    await act(async () => root!.render(createElement('div', null,
      createElement(PaneTree, { ...shared, visible: true,
        layout: mode === 'split'
          ? { type: 'split', id: 'split', dir: 'right', children: [{ type: 'leaf', id: original.id }, { type: 'leaf', id: other.id }], sizes: [0.5, 0.5] }
          : { type: 'leaf', id: original.id },
        sessions: [original, other], editorPanes: [], dirtyFileIds: new Set(), fileErrorCounts: new Map(),
        focusedId: other.id, composerFocused: false, transcriptPool: pool,
      }),
      pool ? createElement(TranscriptPoolOutlet, { pool }) : null,
    )));
    const pane = container.querySelector<HTMLElement>(`[data-pane-id="${original.id}"]`)!;
    expect(pane).toBeTruthy();
    const paste = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(paste, 'clipboardData', { value: { getData: () => '', files: [new File(['image'], 'synthetic.png', { type: 'image/png' })], items: [] } });
    await act(async () => pane.querySelector('textarea')!.dispatchEvent(paste));
    expect(fixture.read).toHaveBeenCalledOnce();
    await act(async () => pane.querySelector<HTMLButtonElement>('[aria-label="Send"]')!.click());
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onComposerSubmitStart, 'Actual PaneTree must forward App submit-start before paste settles').toHaveBeenCalledExactlyOnceWith(original.id);
    expect(pendingComposerSubmits.current).toEqual(new Set([original.id]));
    expect(releases[0]).not.toHaveBeenCalled();
    expect(sessionWorkCwd(original)).toBe('C:/synthetic/a');
    expect(original.providerAccountId).toBe('synthetic-account');
    await act(async () => { finishPaste([]); await pending; });
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith(original.id, 'first message', [], { intent: 'default' });
    expect(lockedAtSubmit).toBe(true);
    expect(releases[0]).toHaveBeenCalledOnce();
    expect(pendingComposerSubmits.current.size).toBe(0);
  } finally {
    await act(async () => { finishPaste([]); await pending; });
    await act(async () => root!.unmount()); root = undefined;
    clearComposerDraft(original.id); clearComposerDraft(other.id);
  }
  expect(releases[0]).toHaveBeenCalledOnce();
});
