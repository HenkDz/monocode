const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const workspace = path.resolve(__dirname, '..');
const esbuild = require(path.join(workspace, 'node_modules/esbuild'));
(async () => {
  const source = execFileSync('rtk', ['proxy', 'git', 'show', '0995ea2:host/workspace-commands.ts'], { cwd: workspace, encoding: 'utf8' });
  const output = path.join(os.tmpdir(), `r24-host-baseline-0995ea2-${process.pid}.mjs`);
  await esbuild.build({ stdin: { contents: source, resolveDir: path.join(workspace, 'host'), sourcefile: 'workspace-commands.ts', loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', outfile: output, logLevel: 'silent' });
  const { WorkspaceCommands } = await import(pathToFileURL(output).href);
  fs.unlinkSync(output);
  const commands = new WorkspaceCommands({}, async (_id, action) => action());
  const counts = {};
  let consumer = '';
  const all = Array.from({ length: 75 }, (_, i) => i + 1);
  const makePr = number => ({ number, title: `PR ${number}`, url: `https://github.com/owner/repo/pull/${number}`, state: number <= 60 ? 'MERGED' : 'OPEN', headRefName: `tree-${(number - 1) % 4}-${Math.floor((number - 1) / 4) % 21}`, headRepositoryOwner: { login: 'owner' }, headRefOid: 'a'.repeat(40), statusCheckRollup: [] });
  commands.ghCommand = async (_cwd, args) => {
    counts[consumer] = (counts[consumer] || 0) + 1;
    if (args[0] === 'repo') return JSON.stringify({ url: 'https://github.com/owner/repo', parent: null });
    if (args[1] === 'list') return JSON.stringify(all.map(makePr).filter(pr => pr.headRefName === args[args.indexOf('--head') + 1]));
    if (args[1] === 'view') return JSON.stringify(makePr(Number(args[2]) || 75));
    throw new Error(`Unexpected mocked gh command: ${args.join(' ')}`);
  };
  commands.gitCommand = async (cwd, args) => {
    const tree = Number(cwd.split('-').at(-1));
    if (args[0] === 'symbolic-ref') return `tree-${tree}-0`;
    if (args[0] === 'reflog') return Array.from({ length: 20 }, (_, i) => `checkout: moving from tree-${tree}-${i + 1} to tree-${tree}-0`).join('\n');
    throw new Error(`Unexpected mocked git command: ${args.join(' ')}`);
  };
  for (let cycle = 0; cycle < 20; cycle++) {
    consumer = 'session';
    for (const number of all) await commands.run('git_pr_status_by_url', { cwd: `/worktree-${(number - 1) % 4}`, url: `https://github.com/owner/repo/pull/${number}` });
    consumer = 'list';
    for (let tree = 0; tree < 4; tree++) await commands.run('git_pr_list', { cwd: `/worktree-${tree}` });
    consumer = 'delivery';
    await commands.run('git_pr_status', { cwd: '/worktree-2' });
  }
  assert.deepEqual(counts, { session: 3000, list: 1760, delivery: 20 });
  assert.equal(Object.values(counts).reduce((sum, value) => sum + value, 0), 4780);
  process.stdout.write(JSON.stringify({ base: '0995ea2', actualImmutableHostCommands: counts, actualHostTotal: 4780, modeledInbox: 10, modeledChecksPane: 20, modeledDeliveryChecks: 20, completeFixtureTotal: 4830, liveCalls: 0 }) + '\n');
})().catch(error => { process.stderr.write(String(error)); process.exitCode = 1; });


