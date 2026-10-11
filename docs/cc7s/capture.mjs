// Run with NODE_OPTIONS=--no-experimental-webstorage: rtk proxy node docs/cc7s/capture.mjs
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';

assert.ok(process.env.NODE_OPTIONS?.includes('--no-experimental-webstorage'), 'Use the Node 26 webstorage flag');
const source = fileURLToPath(new URL('.', import.meta.url));
const evidence = resolve(process.env.CC7S_EVIDENCE || 'C:/Users/nooro/AppData/Local/Temp/monocode-cc/cc7s/evidence/browser');
const scratch = await mkdtemp(resolve(tmpdir(), 'monocode-cc7s-'));
const launch = resolve(scratch, 'launch');
const syntheticHome = resolve(scratch, 'home');
const executablePath = chromium.executablePath();
const browserEnv = { ...process.env, HOME: syntheticHome, USERPROFILE: syntheticHome, APPDATA: syntheticHome, LOCALAPPDATA: syntheticHome, MONOCODE_APP_IDENTIFIER: 'com.monocode.cc7s.design' };
for (const key of Object.keys(browserEnv)) if (key === 'CODEX_HOME' || key.startsWith('ORCA_')) delete browserEnv[key];
const originalCwd = process.cwd();
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const assets = new Map(['workbench.html', 'conversation.html', 'member-view.css', 'member-view.js'].map(name => [`/cc7s/${name}`, resolve(source, name)]));
assets.set('/cc7m/mission-control.css', resolve(source, '../cc7m/mission-control.css'));
const receipt = { startedAt: new Date().toISOString(), node: process.version, staticOnly: true, isolation: { launch, syntheticHome, appIdentifier: browserEnv.MONOCODE_APP_IDENTIFIER, codexHomeUnset: !browserEnv.CODEX_HOME, orcaVariables: Object.keys(browserEnv).filter(key => key.startsWith('ORCA_')) }, hashes: {}, checks: [], cases: [], screenshots: [], cleanup: {} };
const check = (name, passed, detail) => receipt.checks.push({ name, passed: Boolean(passed), ...(detail === undefined ? {} : { detail }) });
const server = createServer(async (request, response) => {
  const path = new URL(request.url, 'http://localhost').pathname;
  if (path === '/favicon.ico') { response.writeHead(204).end(); return; }
  if (!assets.has(path)) { response.writeHead(404).end(); return; }
  try {
    const type = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript' }[extname(path)];
    response.writeHead(200, { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-store' }).end(await readFile(assets.get(path)));
  } catch { response.writeHead(500).end(); }
});
let context;
let fatal;
async function screenshot(page, name) {
  await page.locator('#toast').evaluate(el => { el.hidden = true; });
  const file = `${name}.png`;
  const bytes = await page.screenshot({ path: resolve(source, 'screenshots', file) });
  receipt.screenshots.push({ file, width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), sha256: hash(bytes) });
}
async function layout(page, key) {
  const result = await page.evaluate(() => {
    const box = el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
    const composer = box(document.getElementById('composer'));
    const conversation = box(document.querySelector('.conversation-panel'));
    const transcript = box(document.getElementById('transcript'));
    const header = box(document.querySelector('.member-header'));
    const body = box(document.querySelector('.member-body'));
    const rows = [...document.querySelectorAll('.task-worktree')].map(el => ({ box: box(el), chip: box(el.querySelector('.member-chip')), title: el.title }));
    return { pageWidth: document.documentElement.scrollWidth, viewport: innerWidth, height: innerHeight, composer, conversation, transcript, header, body, rows, disclosures: document.querySelectorAll('details, summary').length, grand: { box: box(document.querySelector('.grand-name')), scrollWidth: document.querySelector('.grand-name').scrollWidth, title: document.querySelector('.grand-row').dataset.context } };
  });
  receipt.cases.push({ key, layout: result });
  check(`${key}: no page overflow`, result.pageWidth === result.viewport);
  check(`${key}: composer is visible`, result.composer.bottom <= result.height && result.composer.height >= 120);
  check(`${key}: transcript and composer do not overlap`, result.transcript.bottom <= result.composer.y + 1 && result.transcript.height > 40);
  check(`${key}: header and work do not overlap`, result.header.bottom <= result.body.y);
  check(`${key}: one consistent conversation width`, result.transcript.x >= result.conversation.x && result.composer.x >= result.conversation.x && result.composer.right <= result.conversation.right);
  check(`${key}: no disclosures`, result.disclosures === 0);
  check(`${key}: grand status fits and has context`, result.grand.scrollWidth <= result.grand.box.width + 1 && result.grand.title.length > 20);
  check(`${key}: worktree chips fit`, result.rows.every(row => row.chip.right <= row.box.right && row.title.length > 40));
  const contrasts = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const rgba = color => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1); return [...ctx.getImageData(0, 0, 1, 1).data].map((value, i) => i === 3 ? value / 255 : value); };
    const mix = (fg, bg) => fg.slice(0, 3).map((value, i) => value * fg[3] + bg[i] * (1 - fg[3]));
    const luminance = rgb => rgb.map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
    return [...document.querySelectorAll('.member-role, .member-metrics, .state, .priority p, .task-meta, .message-meta, .delivery-note, .task-worktree small, .preview-label')].filter(el => el.getClientRects().length).map(el => {
      let bg = [255, 255, 255]; const parents = []; for (let node = el; node; node = node.parentElement) parents.unshift(node);
      for (const node of parents) bg = mix(rgba(getComputedStyle(node).backgroundColor), bg);
      const fg = mix(rgba(getComputedStyle(el).color), bg);
      const values = [luminance(fg), luminance(bg)].sort((a, b) => a - b);
      return { text: el.textContent.trim(), ratio: (values[1] + .05) / (values[0] + .05) };
    });
  });
  receipt.cases.at(-1).minimumContrast = Math.min(...contrasts.map(item => item.ratio));
  check(`${key}: sampled text contrast >= 4.5`, contrasts.every(item => item.ratio >= 4.5), contrasts.filter(item => item.ratio < 4.5));
}
try {
  await mkdir(launch); await mkdir(syntheticHome);
  await mkdir(evidence, { recursive: true });
  await mkdir(resolve(source, 'screenshots'), { recursive: true });
  for (const [name, path] of assets) receipt.hashes[name] = hash(await readFile(path));
  receipt.hashes['capture.mjs'] = hash(await readFile(fileURLToPath(import.meta.url)));
  process.chdir(launch);
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const origin = `http://127.0.0.1:${server.address().port}`;
  check('server exposes only static allowlist', (await fetch(`${origin}/cc7s/capture.mjs`)).status === 404 && (await fetch(`${origin}/src/app/App.tsx`)).status === 404);
  context = await chromium.launchPersistentContext(resolve(scratch, 'browser-profile'), { executablePath, headless: !process.argv.includes('--headed'), env: browserEnv, viewport: { width: 1440, height: 1000 } });
  receipt.chromium = context.browser().version();
  for (const direction of ['workbench', 'conversation']) {
    for (const width of [1440, 1100]) for (const theme of ['dark', 'light']) {
      for (const sample of ['reviewer', 'native', 'all', 'zero', 'loading', 'error']) {
        const page = await context.newPage();
        const errors = []; let external = 0;
        page.on('pageerror', error => errors.push(error.message));
        page.on('request', request => { if (!request.url().startsWith(origin)) external++; });
        await page.setViewportSize({ width, height: 1000 });
        await page.goto(`${origin}/cc7s/${direction}.html?theme=${theme}&member=${sample === 'native' ? 'native' : 'reviewer'}&state=${['zero', 'loading', 'error'].includes(sample) ? sample : 'live'}`);
        if (sample === 'all') await page.locator('[data-action=tasks][data-value=All]').click();
        const key = `${direction}-${width}-${theme}-${sample}`;
        await layout(page, key);
        check(`${key}: clean local render`, errors.length === 0 && external === 0, errors);
        check(`${key}: three tasks with honest history`, sample !== 'all' || await page.locator('.task-card').count() === 3 && (await page.locator('.task-list').innerText()).includes('Cancelled'));
        check(`${key}: current work or unavailable state is clear`, sample === 'native' ? (await page.locator('.priority').innerText()).includes('Reviewer’s storage error') : ['reviewer', 'all'].includes(sample) ? (await page.locator('.priority').innerText()).includes('has not started') : (await page.locator('.work-panel').innerText()).includes(sample === 'zero' ? 'No assignments yet' : sample === 'loading' ? 'Loading assignments' : 'Work couldn’t be loaded'));
        await screenshot(page, key);
        await page.close();
      }
    }
    const page = await context.newPage();
    await page.goto(`${origin}/cc7s/${direction}.html`);
    await page.keyboard.press('Tab');
    check(`${direction}: skip link first`, await page.locator('.skip').evaluate(el => el === document.activeElement));
    await page.keyboard.press('Enter');
    check(`${direction}: skip link reaches main`, await page.locator('#main').evaluate(el => el === document.activeElement));
    await page.locator('[data-action=message]').first().click();
    check(`${direction}: Message focuses draft`, await page.locator('#message-input').evaluate(el => el === document.activeElement));
    await page.locator('#message-input').fill('Please preserve the saved review boundary.');
    await page.locator('#composer-effort').selectOption({ label: 'Medium effort' });
    await page.locator('[data-action=tab][data-value=Activity]').click();
    check(`${direction}: Activity keeps draft and controls`, await page.locator('#message-input').inputValue() === 'Please preserve the saved review boundary.' && await page.locator('#composer-effort').inputValue() === 'Medium effort' && await page.locator('.activity-list').count() === 1);
    await page.locator('[data-action=theme]').click();
    await screenshot(page, `${direction}-1440-light-activity`);
    await page.locator('[data-action=tab][data-value=Conversation]').click();
    await page.locator('[data-action=theme]').click();
    await page.locator('[data-action=tasks][data-value=History]').click();
    check(`${direction}: History is direct and isolated`, await page.locator('.task-card').count() === 2 && !(await page.locator('.task-list').innerText()).includes('Launch failed'));
    await page.locator('[data-action=tasks][data-value=All]').click();
    if (direction === 'workbench') {
      await page.locator('.work-panel').focus();
      await page.keyboard.press('End');
      await page.waitForTimeout(200);
      check('workbench: keyboard reaches the end of history', await page.locator('.work-panel').evaluate(el => el.scrollTop > 0 && el.scrollHeight - el.clientHeight - el.scrollTop < 2));
      await screenshot(page, 'workbench-1440-dark-history-keyboard');
    }
    await page.locator('[data-action=task][data-value=history-done]').click();
    check(`${direction}: history reader uses saved outcome`, (await page.locator('#detail-drawer').innerText()).includes('Review delivered'));
    await page.keyboard.press('Escape');
    check(`${direction}: reader restores focus after re-render`, await page.locator('[data-action=task][data-value=history-done]').evaluate(el => el === document.activeElement));
    await page.locator('[data-action=tasks][data-value=Current]').click();
    await page.locator('[data-action=recovery]').click();
    await page.locator('[data-action=check-storage]').click();
    check(`${direction}: recovery never fabricates success`, (await page.locator('#recovery-result').innerText()).includes('Recovery has not run'));
    await screenshot(page, `${direction}-1440-dark-storage-drawer`);
    await page.keyboard.press('Escape');
    check(`${direction}: storage drawer restores focus`, await page.locator('[data-action=recovery]').evaluate(el => el === document.activeElement));
    await page.locator('[data-action=tool][data-value=checks]').click();
    check(`${direction}: one-line tool opens saved output`, (await page.locator('#detail-drawer').innerText()).includes('24 passed'));
    await screenshot(page, `${direction}-1440-dark-tool-drawer`);
    await page.keyboard.press('Escape');
    await page.locator('[data-action=worktrees][data-value=All]').click();
    await page.locator('[aria-label="Next worktree page"]').click();
    check(`${direction}: flat sidebar pages history`, await page.locator('.task-worktree').count() === 3 && (await page.locator('.paging').innerText()).includes('4–6 of 6') && (await page.locator('.worktrees').innerText()).includes('Cancelled'));
    await page.locator('[data-action=worktree-row]').first().click();
    check(`${direction}: exact worktree identity`, (await page.locator('#detail-drawer').innerText()).includes('cc7-sidebar-layout'));
    await page.keyboard.press('Escape');
    await page.locator('[data-action=steer]').click();
    await page.locator('#steer-input').fill('Keep the scope to foreground activation.');
    let actionRequests = 0;
    page.on('request', () => actionRequests++);
    await page.locator('#steer-form button').click();
    await page.locator('#composer button[type=submit]').click();
    check(`${direction}: sends and steer stay local`, actionRequests === 0 && (await page.locator('#toast').innerText()).includes('Nothing sent'));
    await page.locator('#preview-member').selectOption('native');
    check(`${direction}: member drafts do not leak`, await page.locator('#message-input').inputValue() === '');
    if (direction === 'workbench') {
      await page.locator('[data-action=team-message]').click();
      check('workbench: native hand-off message matches its recipient', (await page.locator('#detail-drawer').innerText()).includes('Please hold cc7-native-focus'));
      await page.keyboard.press('Escape');
    }
    await page.locator('#preview-member').selectOption('reviewer');
    check(`${direction}: draft returns to its member`, await page.locator('#message-input').inputValue() === 'Please preserve the saved review boundary.');
    await page.locator('#preview-state').selectOption('error');
    check(`${direction}: load error retains draft and disables delivery`, await page.locator('#message-input').inputValue() === 'Please preserve the saved review boundary.' && await page.locator('#composer button[type=submit]').isDisabled() && await page.locator('[data-action=steer]').isDisabled());
    await page.locator('.work-panel [data-action=retry]').click();
    check(`${direction}: retry restores fixture without losing draft`, await page.locator('.priority').count() === 1 && await page.locator('#message-input').inputValue() === 'Please preserve the saved review boundary.');
    await page.locator('[data-action=worktrees][data-value=Active]').click();
    await page.locator('[data-action=team]').focus();
    await page.keyboard.press('Tab');
    check(`${direction}: grand context is visible on focus`, await page.locator('#grand-context').isVisible() && (await page.locator('#grand-context').innerText()).includes('1 member working below'));
    await page.keyboard.press('Tab');
    check(`${direction}: grand context clears on blur`, !(await page.locator('#grand-context').isVisible()));
    await page.locator('[data-action=earlier]').click();
    check(`${direction}: long conversation uses one scroll owner`, await page.locator('.message').count() === 16 && await page.locator('#transcript').evaluate(el => el.scrollHeight > el.clientHeight));
    for (const width of [1440, 1100]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.locator('#transcript').evaluate(el => { el.scrollTop = el.scrollHeight; });
      await screenshot(page, `${direction}-${width}-dark-long-conversation`);
    }
    await page.setViewportSize({ width: 1100, height: 800 });
    await layout(page, `${direction}-1100-dark-short`);
    await page.locator('#preview-member').selectOption('session');
    for (const theme of ['dark', 'light']) {
      await page.setViewportSize({ width: 1440, height: 1000 });
      if (theme === 'light') await page.locator('[data-action=theme]').click();
      check(`${direction}: saved session retains context and author`, (await page.locator('h1').innerText()).includes('Window activation review') && (await page.locator('.member-role').innerText()).includes('Saved session') && (await page.locator('.message-meta strong').allTextContents()).includes('Reviewer') && !(await page.locator('.message-meta strong').allTextContents()).includes('Window activation review'));
      await screenshot(page, `${direction}-1440-${theme}-session`);
    }
    await page.close();
    const offline = await context.newPage();
    await offline.goto(pathToFileURL(resolve(source, `${direction}.html`)).href);
    check(`${direction}: opens directly as local HTML`, await offline.locator('.priority').count() === 1 && await offline.locator('.tool-card').count() === 2);
    await offline.close();
  }
  for (const [name, path] of assets) check(`${name}: captured bytes stable`, hash(await readFile(path)) === receipt.hashes[name]);
} catch (error) { fatal = error; receipt.fatal = error.stack; }
finally {
  if (context) { await context.close(); receipt.cleanup.browserClosed = true; }
  await new Promise(done => server.close(done));
  receipt.cleanup.serverClosed = !server.listening;
  process.chdir(originalCwd);
  const resolvedScratch = resolve(scratch);
  assert.ok(resolvedScratch.startsWith(resolve(tmpdir(), 'monocode-cc7s-')) && resolvedScratch !== resolve(tmpdir()));
  try { await rm(resolvedScratch, { recursive: true, force: true, maxRetries: 4, retryDelay: 200 }); receipt.cleanup.scratchRemoved = true; }
  catch (error) { receipt.cleanup.scratchRemoved = false; receipt.cleanup.error = error.message; }
  check('owned preview browser and server stopped', receipt.cleanup.browserClosed && receipt.cleanup.serverClosed);
  receipt.finishedAt = new Date().toISOString();
  receipt.totals = { passed: receipt.checks.filter(item => item.passed).length, failed: receipt.checks.filter(item => !item.passed).length, cases: receipt.cases.length, screenshots: receipt.screenshots.length };
  await mkdir(evidence, { recursive: true });
  await writeFile(resolve(evidence, 'verification.json'), JSON.stringify(receipt, null, 2) + '\n');
  await writeFile(resolve(source, 'screenshots/index.md'), '# CC7S screenshots\n\nChromium captures of synthetic, clickable static HTML at 1440 and 1100 px, dark and light. Each base viewport is 1000 px tall. These show design behavior, not native or provider acceptance.\n\n| Screenshot | Size | SHA-256 |\n| --- | --- | --- |\n' + receipt.screenshots.map(item => `| [${item.file}](${item.file}) | ${item.width} × ${item.height} | \`${item.sha256}\` |`).join('\n') + '\n');
  console.log(JSON.stringify({ ...receipt.totals, minimumContrast: Math.min(...receipt.cases.map(item => item.minimumContrast)), cleanup: receipt.cleanup, failures: receipt.checks.filter(item => !item.passed).map(item => item.name), fatal: receipt.fatal }));
}
if (fatal) throw fatal;
assert.equal(receipt.totals.failed, 0, 'CC7S mockup checks failed');
