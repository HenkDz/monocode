import { afterEach, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostStore } from "./store";
import { WorkspaceCommands } from "./workspace-commands";
import {
  createHostPath,
  hostFileDiff,
  hostGitAction,
  hostGitIndex,
  listHostFiles,
  readHostFile,
  searchHostContent,
  searchHostFiles,
  writeHostFile,
} from "./workspace";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

it("checks worktree discard status and upstream errors, including untracked files", async () => {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "monocode-removal-status-")));
  roots.push(root);
  const store = new HostStore(":memory:");
  store.addProject(root, "Removal status");
  const commands = new WorkspaceCommands(store, async (_id, action) => action());
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  try {
    await expect(commands.run("git_diff_index", { cwd: root, checked: true })).rejects.toThrow();
    git("init", "-qb", "main");
    git("config", "user.name", "Test");
    git("config", "user.email", "test@example.test");
    git("config", "commit.gpgsign", "false");
    writeFileSync(join(root, "tracked.txt"), "base\n");
    git("add", ".");
    git("commit", "-qm", "base");
    writeFileSync(join(root, "empty.txt"), "");
    writeFileSync(join(root, "binary.bin"), Buffer.from([0, 1, 2]));
    expect(await commands.run("git_diff_stats", { cwd: root })).toMatchObject({ files: 2, untracked: 2 });
    expect(await commands.run("git_diff_index", { cwd: root, checked: true })).toMatchObject({ files: [expect.objectContaining({ status: "untracked" }), expect.objectContaining({ status: "untracked" })] });
    git("config", "branch.main.remote", "origin");
    git("config", "branch.main.merge", "refs/heads/main");
    await expect(commands.run("git_diff_index", { cwd: root, checked: true })).rejects.toThrow();
  } finally {
    store.close();
  }
});

it("task snapshots detect dirty content, untracked edits and commits with no diff", async () => {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "monocode-task-snapshot-")));
  roots.push(root);
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  git("init", "-qb", "main");
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.test");
  git("config", "commit.gpgsign", "false");
  writeFileSync(join(root, "tracked.txt"), "base\n");
  git("add", ".");
  git("commit", "-qm", "base");
  const base = git("rev-parse", "HEAD");
  const store = new HostStore(":memory:");
  store.addProject(root, "Snapshot");
  const commands = new WorkspaceCommands(store, async (_id, action) => action());
  const snapshot = () => commands.run("git_task_snapshot", { cwd: root, base }) as Promise<{ fingerprint: string; clean: boolean; commitsAhead: number; baseDiff: boolean; pathHashes: Record<string, string>; inheritedChangedPaths: string[] }>;
  try {
    expect(await snapshot()).toMatchObject({ clean: true, commitsAhead: 0, baseDiff: false });
    writeFileSync(join(root, "tracked.txt"), "dirty baseline\n");
    const dirty = await snapshot();
    expect(dirty.inheritedChangedPaths).toEqual(["tracked.txt"]);
    expect((await snapshot()).pathHashes).toEqual(dirty.pathHashes);
    writeFileSync(join(root, "tracked.txt"), "changed dirty baseline\n");
    const changed = await snapshot();
    expect(changed.fingerprint).not.toBe(dirty.fingerprint);
    expect(changed.pathHashes["tracked.txt"]).not.toBe(dirty.pathHashes["tracked.txt"]);
    git("add", "tracked.txt");
    expect((await snapshot()).pathHashes["tracked.txt"]).not.toBe(changed.pathHashes["tracked.txt"]);
    git("restore", "--staged", "tracked.txt");
    git("restore", "tracked.txt");
    writeFileSync(join(root, "new.txt"), "one");
    const untracked = await snapshot();
    expect(untracked.inheritedChangedPaths).toEqual(["new.txt"]);
    writeFileSync(join(root, "new.txt"), "two");
    expect((await snapshot()).fingerprint).not.toBe(untracked.fingerprint);
    expect((await snapshot()).pathHashes["new.txt"]).not.toBe(untracked.pathHashes["new.txt"]);
    rmSync(join(root, "new.txt"));
    git("commit", "--allow-empty", "-qm", "empty change");
    expect(await snapshot()).toMatchObject({ clean: true, commitsAhead: 1, baseDiff: false });
    await expect(commands.run("git_task_snapshot", { cwd: root, base: "--help" })).rejects.toThrow("Invalid task base");
    await expect(commands.run("git_task_snapshot", { cwd: tmpdir(), base })).rejects.toThrow("outside");
  } finally {
    store.close();
  }
});

it("task snapshots detect edits within an already dirty submodule", async () => {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "monocode-submodule-parent-")));
  const child = realpathSync.native(mkdtempSync(join(tmpdir(), "monocode-submodule-child-")));
  roots.push(root, child);
  const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
  for (const cwd of [root, child]) {
    git(cwd, "init", "-qb", "main");
    git(cwd, "config", "user.name", "Test");
    git(cwd, "config", "user.email", "test@example.test");
    git(cwd, "config", "commit.gpgsign", "false");
  }
  writeFileSync(join(child, "file.txt"), "initial");
  git(child, "add", ".");
  git(child, "commit", "-qm", "child file");
  git(root, "-c", "protocol.file.allow=always", "submodule", "add", child, "child");
  git(root, "commit", "-qm", "submodule");
  const store = new HostStore(":memory:");
  store.addProject(root, "Submodule");
  const commands = new WorkspaceCommands(store, async (_id, action) => action());
  const snapshot = () => commands.run("git_task_snapshot", { cwd: root }) as Promise<{ fingerprint: string; pathHashes: Record<string, string> }>;
  try {
    writeFileSync(join(root, "child/file.txt"), "inherited");
    const before = await snapshot();
    writeFileSync(join(root, "child/file.txt"), "worker edit");
    const after = await snapshot();
    expect(after.fingerprint).toBe(before.fingerprint);
    expect(after.pathHashes.child).not.toBe(before.pathHashes.child);
  } finally { store.close(); }
});

it("fetch distinguishes remote existence from upstream and sync sets tracking safely", async () => {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "monocode-publication-")));
  const remote = realpathSync.native(mkdtempSync(join(tmpdir(), "monocode-publication-remote-")));
  roots.push(root, remote);
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  git("init", "-qb", "main");
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.test");
  git("config", "commit.gpgsign", "false");
  git("config", "push.autoSetupRemote", "false");
  git("config", "push.default", "simple");
  git("commit", "--allow-empty", "-qm", "base");
  git("clone", "--bare", root, remote);
  git("remote", "add", "origin", remote);
  git("checkout", "-qb", "feat/inbox-parent-toggle");
  const store = new HostStore(":memory:");
  store.addProject(root, "Test");
  const commands = new WorkspaceCommands(store, async (_id, action) => action());
  try {
    await commands.run("git_fetch", { cwd: root });
    expect(await hostGitIndex(root)).toMatchObject({ remoteBranch: null, upstream: null, headPushed: true });
    // The branch is created remotely at the base SHA, without configuring tracking.
    git("--git-dir", remote, "update-ref", "refs/heads/feat/inbox-parent-toggle", git("rev-parse", "HEAD"));
    expect((await hostGitIndex(root)).remoteBranch).toBeNull();
    const head = git("rev-parse", "HEAD");
    writeFileSync(join(root, "untracked.txt"), "keep me");
    const status = git("status", "--porcelain=v1");
    await commands.run("git_fetch", { cwd: root });
    expect(git("rev-parse", "HEAD")).toBe(head);
    expect(git("status", "--porcelain=v1")).toBe(status);
    expect(await hostGitIndex(root)).toMatchObject({ remoteBranch: "origin/feat/inbox-parent-toggle", upstream: null, ahead: 0, behind: 0 });
    git("commit", "--allow-empty", "-qm", "local work");
    expect(await hostGitIndex(root)).toMatchObject({ ahead: 1, headPushed: false });
    await commands.run("git_sync", { cwd: root });
    expect(await hostGitIndex(root)).toMatchObject({ upstream: "origin/feat/inbox-parent-toggle", ahead: 0, aheadOfDefault: 1, headPushed: true });
    // Compare with the same-name remote branch, not main, when tracking is removed.
    git("branch", "--unset-upstream");
    expect(await hostGitIndex(root)).toMatchObject({ upstream: null, ahead: 0, aheadOfDefault: 1 });
    git("remote", "add", "other", remote);
    await commands.run("git_fetch", { cwd: root });
    git("branch", "--set-upstream-to=other/feat/inbox-parent-toggle");
    await commands.run("git_push", { cwd: root });
    expect(git("config", "branch.feat/inbox-parent-toggle.remote")).toBe("other");
    git("branch", "--unset-upstream");
    git("--git-dir", remote, "update-ref", "-d", "refs/heads/feat/inbox-parent-toggle");
    await commands.run("git_fetch", { cwd: root });
    expect((await hostGitIndex(root)).remoteBranch).toBeNull();
    git("remote", "set-url", "origin", join(remote, "missing"));
    await expect(commands.run("git_fetch", { cwd: root })).rejects.toThrow();
    await expect(commands.run("git_fetch", { cwd: remote })).rejects.toThrow("outside");
  } finally {
    store.db.close();
  }
});

it("reports a broken Git index instead of searching ignored files", async () => {
  const root = mkdtempSync(join(tmpdir(), "monocode-broken-index-"));
  roots.push(root);
  execFileSync("git", ["init", "-q"], { cwd: root });
  writeFileSync(join(root, ".gitignore"), "private.txt\n");
  writeFileSync(join(root, "private.txt"), "ignored");
  writeFileSync(join(root, ".git", "index"), "broken");
  await expect(searchHostFiles(root, "private")).rejects.toThrow();
});

it("lists host files and rejects paths escaping the project", async () => {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "monocode-workspace-")));
  roots.push(root);
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "src", "app.ts"), "source\n");
  symlinkSync(
    tmpdir(),
    join(root, "outside"),
    process.platform === "win32" ? "junction" : "dir",
  );
  expect((await listHostFiles(root, "")).map((entry) => entry.name)).toContain(
    "src",
  );
  expect(
    (await searchHostFiles(root, "app")).map((entry) => entry.path),
  ).toEqual(["src/app.ts"]);
  expect(await readHostFile(root, "src/app.ts")).toBe("source\n");
  expect(await readHostFile(root, join(root, "src", "app.ts"))).toBe(
    "source\n",
  );
  await writeHostFile(root, "src/app.ts", "source\n", "edited\n");
  expect(await readHostFile(root, "src/app.ts")).toBe("edited\n");
  expect(await searchHostContent(root, { query: "edited" })).toMatchObject({
    matches: [
      expect.objectContaining({ relative: "src/app.ts", line: 1, column: 1 }),
    ],
    truncated: false,
  });
  expect(await createHostPath(root, "src", "nested/new.ts", false)).toBe(
    "src/nested/new.ts",
  );
  expect(await readHostFile(root, "src/nested/new.ts")).toBe("");
  expect(await createHostPath(root, "", "assets", true)).toBe("assets");
  await expect(createHostPath(root, "src", "app.ts", false)).rejects.toThrow();
  await expect(
    createHostPath(root, "", "../outside.txt", false),
  ).rejects.toThrow("Invalid file name");
  await expect(createHostPath(root, "", ".git/config", false)).rejects.toThrow(
    "Invalid file name",
  );
  await expect(
    createHostPath(root, "outside", "bad.ts", false),
  ).rejects.toThrow("outside");
  await expect(
    writeHostFile(root, "src/app.ts", "source\n", "lost\n"),
  ).rejects.toThrow("changed on the host");
  await expect(listHostFiles(root, "../")).rejects.toThrow("outside");
  await expect(listHostFiles(root, "outside")).rejects.toThrow("outside");
  await expect(readHostFile(root, ".git/config")).rejects.toThrow("outside");
  expect(await hostGitIndex(root)).toMatchObject({
    branch: null,
    files: [],
    additions: 0,
    deletions: 0,
  });
});

it("reports tracked and untracked changes and commits staged files", async () => {
  const root = realpathSync.native(
    mkdtempSync(join(tmpdir(), "monocode-workspace-git-")),
  );
  roots.push(root);
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root });
  git("init", "-q");
  git("config", "core.autocrlf", "false");
  git("config", "user.name", "Workspace Test");
  git("config", "user.email", "workspace@example.test");
  writeFileSync(join(root, "app.ts"), "before\n");
  git("add", "--", "app.ts");
  git("commit", "-qm", "initial");
  writeFileSync(join(root, "app.ts"), "after\n");
  writeFileSync(join(root, "new.ts"), "new\n");

  const index = await hostGitIndex(root);
  expect(
    await searchHostContent(root, {
      query: "AFTER",
      include: "app.ts",
      caseSensitive: false,
    }),
  ).toMatchObject({
    matches: [
      expect.objectContaining({ relative: "app.ts", line: 1, column: 1 }),
    ],
  });
  expect(
    (
      await searchHostContent(root, {
        query: "after",
        exclude: "app.ts",
      })
    ).matches,
  ).toEqual([]);
  expect(
    (
      await searchHostContent(root, {
        query: "AFTER",
        caseSensitive: true,
      })
    ).matches,
  ).toEqual([]);
  expect(
    (
      await searchHostContent(root, {
        query: "aft",
        wholeWord: true,
      })
    ).matches,
  ).toEqual([]);
  expect(
    (
      await searchHostContent(root, {
        query: "aft.r",
        regex: true,
      })
    ).matches,
  ).toEqual([expect.objectContaining({ relative: "app.ts", line: 1 })]);
  expect(index.files).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        relative: "app.ts",
        status: "modified",
        unstaged: true,
      }),
      expect.objectContaining({
        relative: "new.ts",
        status: "untracked",
        unstaged: true,
      }),
    ]),
  );
  expect(await hostFileDiff(root, "app.ts", false)).toMatchObject({
    original: "before\n",
    current: "after\n",
  });
  await expect(hostGitAction(root, "stage", "../outside")).rejects.toThrow(
    "outside",
  );
  await hostGitAction(root, "stageAll");
  expect((await hostGitIndex(root)).files.every((file) => file.staged)).toBe(
    true,
  );
  expect(await hostFileDiff(root, "app.ts", true)).toMatchObject({
    original: "before\n",
    current: "after\n",
  });
  await hostGitAction(root, "commit", undefined, "remote commit");
  expect((await hostGitIndex(root)).files).toEqual([]);
  const remote = realpathSync.native(
    mkdtempSync(join(tmpdir(), "monocode-workspace-remote-")),
  );
  roots.push(remote);
  execFileSync("git", ["init", "--bare", "-q"], { cwd: remote });
  git("remote", "add", "origin", remote);
  git("push", "-u", "origin", "HEAD");
  writeFileSync(join(root, "app.ts"), "another change\n");
  git("add", "app.ts");
  git("commit", "-qm", "ahead");
  expect(await hostGitIndex(root)).toMatchObject({
    remote: "origin",
    ahead: 1,
    behind: 0,
  });
  writeFileSync(join(root, "app.ts"), "discard this\n");
  await hostGitAction(root, "discard", "app.ts");
  expect((await hostGitIndex(root)).files).toEqual([]);
});

it("stages and unstages a folder subtree without affecting other changes", async () => {
  const root = realpathSync.native(
    mkdtempSync(join(tmpdir(), "monocode-host-folder-")),
  );
  roots.push(root);
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root });
  git("init", "-q");
  git("config", "core.autocrlf", "false");
  git("config", "user.name", "Workspace Test");
  git("config", "user.email", "workspace@example.test");
  git("config", "commit.gpgsign", "false");
  mkdirSync(join(root, "src/nested"), { recursive: true });
  mkdirSync(join(root, "src-other"));
  writeFileSync(join(root, "src/app.ts"), "before\n");
  writeFileSync(join(root, "src/nested/deleted.ts"), "delete me\n");
  writeFileSync(join(root, "src-other/app.ts"), "before\n");
  writeFileSync(join(root, "ready.txt"), "before\n");
  writeFileSync(join(root, ".gitignore"), "src/ignored.txt\n");
  git("add", ".");
  git("commit", "-qm", "initial");
  writeFileSync(join(root, "src/app.ts"), "after\n");
  rmSync(join(root, "src/nested"), { recursive: true });
  mkdirSync(join(root, "src/added"));
  writeFileSync(join(root, "src/added/new.ts"), "new\n");
  writeFileSync(join(root, "src/ignored.txt"), "ignored\n");
  writeFileSync(join(root, "src-other/app.ts"), "outside\n");
  writeFileSync(join(root, "ready.txt"), "ready\n");
  await hostGitAction(root, "stage", "ready.txt");

  await hostGitAction(root, "stage", "src");
  let files = (await hostGitIndex(root)).files;
  expect(files).toHaveLength(5);
  for (const file of files) {
    expect(file.staged).toBe(
      file.relative.startsWith("src/") || file.relative === "ready.txt",
    );
    expect(file.unstaged).toBe(file.relative === "src-other/app.ts");
  }

  await hostGitAction(root, "unstage", "src");
  files = (await hostGitIndex(root)).files;
  expect(files).toHaveLength(5);
  for (const file of files) {
    expect(file.staged).toBe(file.relative === "ready.txt");
    expect(file.unstaged).toBe(file.relative !== "ready.txt");
  }
  expect(await readHostFile(root, "src/app.ts")).toBe("after\n");

  // A folder can still appear in the Changes tree after it was deleted on disk.
  await hostGitAction(root, "stage", "src/nested");
  expect(
    (await hostGitIndex(root)).files.find(
      (file) => file.relative === "src/nested/deleted.ts",
    ),
  ).toMatchObject({ staged: true, unstaged: false });
  await hostGitAction(root, "unstage", "src/nested");
  expect(
    (await hostGitIndex(root)).files.find(
      (file) => file.relative === "src/nested/deleted.ts",
    ),
  ).toMatchObject({ staged: false, unstaged: true });
});

it
  .runIf(process.platform !== "win32")
  .each(["*", "folder?", "[ab]", ":(glob)*"])(
  "stages and unstages the literal folder %s without touching siblings",
  async (folder) => {
    const root = realpathSync.native(
      mkdtempSync(join(tmpdir(), "monocode-host-literal-folder-")),
    );
    roots.push(root);
    const git = (...args: string[]) =>
      execFileSync("git", args, { cwd: root, encoding: "utf8" });
    git("init", "-q");
    git("config", "core.autocrlf", "false");
    git("config", "user.name", "Workspace Test");
    git("config", "user.email", "workspace@example.test");
    git("config", "commit.gpgsign", "false");
    const inside = `${folder}/inside.txt`;
    for (const directory of [folder, "a", "folderx"])
      mkdirSync(join(root, directory));
    const tracked = [inside, "a/other.txt", "folderx/other.txt", "ready.txt"];
    for (const path of tracked) writeFileSync(join(root, path), "before\n");
    git("add", ".");
    git("commit", "-qm", "initial");
    for (const path of tracked) writeFileSync(join(root, path), "after\n");
    writeFileSync(join(root, "private.txt"), "unrelated untracked data\n");
    const stagedPaths = () =>
      git("diff", "--cached", "--name-only", "-z").split("\0").filter(Boolean);

    await hostGitAction(root, "stage", "ready.txt");
    await hostGitAction(root, "stage", folder);
    expect(stagedPaths()).toEqual([inside, "ready.txt"].sort());

    await hostGitAction(root, "unstage", folder);
    expect(stagedPaths()).toEqual(["ready.txt"]);
    expect(await readHostFile(root, inside)).toBe("after\n");
  },
);

it("stages selected host diff content without replacing the working file", async () => {
  const root = realpathSync.native(
    mkdtempSync(join(tmpdir(), "monocode-workspace-hunk-")),
  );
  roots.push(root);
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8" });
  git("init", "-q");
  git("config", "core.autocrlf", "false");
  git("config", "user.name", "Workspace Test");
  git("config", "user.email", "workspace@example.test");
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src/app.ts"), "one\ntwo\nthree\n");
  git("add", "src/app.ts");
  git("commit", "-qm", "initial");
  writeFileSync(join(root, "src/app.ts"), "ONE\ntwo\nTHREE\n");
  await hostGitAction(
    root,
    "stageContents",
    "src/app.ts",
    undefined,
    "ONE\ntwo\nthree\n",
  );
  expect(git("show", ":src/app.ts")).toBe("ONE\ntwo\nthree\n");
  expect(await readHostFile(root, "src/app.ts")).toBe("ONE\ntwo\nTHREE\n");
  await hostGitAction(root, "discard", "src/app.ts");
  expect(await readHostFile(root, "src/app.ts")).toBe("ONE\ntwo\nthree\n");
  expect(git("ls-files").trim()).toBe("src/app.ts");
  await expect(
    hostGitAction(root, "stageContents", "../escape", undefined, "x"),
  ).rejects.toThrow("outside");
});
