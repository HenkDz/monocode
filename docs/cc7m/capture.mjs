// Run: $env:NODE_OPTIONS='--no-experimental-webstorage'; rtk proxy node docs/cc7m/capture.mjs --headed
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, basename, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';

assert.ok(process.env.NODE_OPTIONS?.includes('--no-experimental-webstorage'), 'Use the Node 26 webstorage flag');
const source = fileURLToPath(new URL('.', import.meta.url));
const evidence = resolve('C:/Users/nooro/AppData/Local/Temp/monocode-cc/cc7m/evidence/browser');
const scratch = await mkdtemp(resolve(tmpdir(), 'monocode-cc7m-'));
const originalCwd = process.cwd();
const executablePath = chromium.executablePath();
for (const key of Object.keys(process.env)) if (key === 'CODEX_HOME' || key.startsWith('ORCA_')) delete process.env[key];
const launch = resolve(scratch, 'launch');
await mkdir(launch);
await mkdir(resolve(scratch, 'home'));
for (const key of ['HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA']) process.env[key] = resolve(scratch, 'home');
process.env.MONOCODE_APP_IDENTIFIER = 'com.monocode.cc7m.design';
process.chdir(launch);
const assets = ['cockpit.html', 'board.html', 'stream.html', 'mission-control.css', 'mission-control.js'];
const inputs = [...assets, 'capture.mjs'];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const receipt = { startedAt: new Date().toISOString(), node: process.version, headed: process.argv.includes('--headed'), staticOnly: true, appIdentifier: process.env.MONOCODE_APP_IDENTIFIER, isolation: { launch, syntheticHome: resolve(scratch, 'home'), codexHomeUnset: !process.env.CODEX_HOME, orcaVariableCount: Object.keys(process.env).filter(k => k.startsWith('ORCA_')).length }, assetHashes: {}, checks: [], cases: [], screenshots: [], cleanup: {} };
const check = (name, pass, detail) => { receipt.checks.push({ name, passed: Boolean(pass), ...(detail === undefined ? {} : { detail }) }); };
for (const asset of inputs) receipt.assetHashes[asset] = hash(await readFile(resolve(source, asset)));
const server = createServer(async (request, response) => {
  try {
    const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (path === '/favicon.ico') { response.writeHead(204).end(); return; }
    const name = path.slice(1);
    if (!assets.includes(name) || basename(name) !== name) { response.writeHead(404).end(); return; }
    const type = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript' }[extname(name)];
    response.writeHead(200, { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-store' }).end(await readFile(resolve(source, name)));
  } catch { response.writeHead(400).end(); }
});
let context;
let fatal;
async function screenshot(page, name, fullPage = true) {
  const file = `${name}.png`;
  if (!fullPage) await page.evaluate(() => { window.scrollTo(0, 0); document.querySelector('dialog').scrollTop = 0; document.querySelector('.toast')?.remove(); });
  const bytes = await page.screenshot({ path: resolve(source, 'screenshots', file), fullPage });
  receipt.screenshots.push({ file, sha256: hash(bytes), viewport: page.viewportSize(), width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), fullPage });
}
try {
  await mkdir(evidence, { recursive: true });
  await mkdir(resolve(source, 'screenshots'), { recursive: true });
  await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  check('server rejects non-static files', (await fetch(`${origin}/capture.mjs`)).status === 404);
  context = await chromium.launchPersistentContext(resolve(scratch, 'browser-profile'), { executablePath, headless: !receipt.headed, env: { ...process.env }, viewport: { width: 1440, height: 1000 } });
  receipt.chromium = context.browser().version();
  for (const direction of ['cockpit', 'board', 'stream']) {
    for (const width of [1440, 1100, 900, 800]) {
      for (const theme of ['dark', 'light']) {
        for (const zero of [false, true]) {
          const page = await context.newPage();
          const key = `${direction}-${width}-${theme}-${zero ? 'zero' : 'live'}`;
          const errors = [];
          page.on('pageerror', error => errors.push(error.message));
          page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
          let external = 0;
          page.on('request', request => { if (!request.url().startsWith(origin)) external++; });
          await page.setViewportSize({ width, height: 1000 });
          await page.goto(`${origin}/${direction}.html?theme=${theme}&goals=${zero ? 'zero' : 'live'}`);
          await page.evaluate(() => document.fonts.ready);
          const structure = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: innerWidth, agents: [...document.querySelectorAll('#direction-content [data-agent]')].map(el => el.dataset.agent), h1: document.querySelectorAll('h1').length, main: document.querySelectorAll('main').length, disclosures: document.querySelectorAll('details,summary').length, triangles: /[▸▹▾▿▶▷▼▽]/.test(document.body.innerText), goals: document.querySelector('.vitals').innerText, attention: document.querySelector('.attention').innerText, command: Boolean(document.getElementById('command-input')), recent: document.querySelector('.feed').innerText }));
          receipt.cases.push({ key, structure, errors });
          check(`${key}: no horizontal overflow`, structure.width <= structure.viewport, { actual: structure.width, expected: width });
          check(`${key}: no accordions or triangles`, structure.disclosures === 0 && !structure.triangles);
          check(`${key}: all eight agents visible`, new Set(structure.agents).size === 8);
          check(`${key}: useful org home`, structure.h1 === 1 && structure.main === 1 && structure.command && structure.attention.includes('1 approval') && structure.attention.includes('1 blocker') && structure.recent.includes('merged') && structure.goals.includes(zero ? '0\nGoals in flight' : '2\nGoals in flight'));
          check(`${key}: no page errors or external requests`, errors.length === 0 && external === 0, errors);
          const contrasts = await page.evaluate(() => {
            const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            const rgba = color => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1); return [...ctx.getImageData(0, 0, 1, 1).data].map((value, i) => i === 3 ? value / 255 : value); };
            const mix = (fg, bg) => fg.slice(0, 3).map((value, i) => value * fg[3] + bg[i] * (1 - fg[3]));
            const luminance = rgb => rgb.map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
            return [...document.querySelectorAll('#direction-content .state,.attention-kind,.heading-note,.vital span,.preview-label,.activity-text,.elapsed')].filter(el => el.getClientRects().length).map(el => {
              let bg = [255, 255, 255]; const parents = []; for (let node = el; node; node = node.parentElement) parents.unshift(node);
              for (const node of parents) bg = mix(rgba(getComputedStyle(node).backgroundColor), bg);
              const fg = mix(rgba(getComputedStyle(el).color), bg);
              const values = [luminance(fg), luminance(bg)].sort((a, b) => a - b);
              return { text: el.textContent.trim(), ratio: (values[1] + .05) / (values[0] + .05) };
            });
          });
          const minimum = Math.min(...contrasts.map(item => item.ratio));
          receipt.cases.at(-1).minimumContrast = minimum;
          check(`${key}: sampled normal text >= 4.5:1`, minimum >= 4.5, contrasts.filter(item => item.ratio < 4.5));
          if (width === 1440 || width === 900 && theme === 'dark') await screenshot(page, key);
          await page.close();
        }
      }
    }
    const page = await context.newPage();
    await page.goto(`${origin}/${direction}.html`);
    await page.keyboard.press('Tab');
    check(`${direction}: first Tab reaches skip link`, await page.locator('.skip').evaluate(el => el === document.activeElement && el.getBoundingClientRect().top >= 0));
    await page.keyboard.press('Enter');
    check(`${direction}: skip reaches main`, await page.locator('#main').evaluate(el => el === document.activeElement));
    await page.keyboard.press('/');
    check(`${direction}: slash focuses command`, await page.locator('#command-input').evaluate(el => el === document.activeElement));
    await page.locator('#command-input').fill('Polish MonoCode navigation');
    check(`${direction}: Chat defaults to Grand`, (await page.locator('#route-label').textContent()) === 'Send to Grand Orch');
    await page.locator('[data-action=intent][data-value="New goal"]').click();
    check(`${direction}: exact project New goal routes to Manager`, (await page.locator('#route-label').textContent()) === 'Send to MonoCode Manager');
    await page.locator('#command-input').fill('Compare MonoCode and DZDistro');
    check(`${direction}: cross-project stays with Grand`, (await page.locator('#route-label').textContent()) === 'Send to Grand Orch');
    await page.locator('[data-action=menu][data-id=route-menu]').click();
    await page.locator('[data-action=route][data-value="DZDistro Manager"]').click();
    check(`${direction}: cross-project overrides stay with Grand`, (await page.locator('#route-label').textContent()) === 'Send to Grand Orch');
    check(`${direction}: route selection restores visible trigger`, await page.locator('[data-action=menu][data-id=route-menu]').evaluate(el => el === document.activeElement));
    await page.locator('#command-input').fill('Improve keyboard navigation');
    check(`${direction}: explicit override is visible`, (await page.locator('#route-label').textContent()) === 'Send to DZDistro Manager');
    let actionRequests = 0;
    page.on('request', () => actionRequests++);
    await page.locator('#command-form .primary').click();
    check(`${direction}: submission is local preview only`, actionRequests === 0 && (await page.locator('.toast').innerText()).includes('Nothing sent'));
    await page.locator('#command-input').fill('');
    await page.locator('[data-action=route][data-value=Auto]').evaluate(el => el.click());
    await page.locator('[data-action=project][data-value=MonoCode]').last().click();
    await page.locator('#command-input').fill('Fix DZDistro dates');
    check(`${direction}: selected project mismatch stays with Grand`, (await page.locator('#route-label').textContent()) === 'Send to Grand Orch');
    await page.locator('#command-input').fill('');
    await page.locator('[data-action=intent][data-value=Chat]').click();
    await page.locator('[data-action=project][data-value=MonoCode]').last().click();
    check(`${direction}: project filter`, await page.locator('#direction-content [data-agent]').count() === 4);
    await page.locator('[data-action=project][data-value="All projects"]').click();
    await page.locator('[data-action=menu][data-id=state-menu]').click();
    await page.keyboard.press('Escape');
    check(`${direction}: Esc closes state popover and restores focus`, await page.locator('#state-menu').evaluate(el => el.hidden) && await page.locator('[data-action=menu][data-id=state-menu]').evaluate(el => el === document.activeElement));
    await page.locator('[data-action=menu][data-id=state-menu]').click();
    await page.locator('[data-action=state][data-value=Idle]').focus();
    await page.keyboard.press('Enter');
    check(`${direction}: state filter finds three idle`, await page.locator('#direction-content [data-agent]').count() === 3);
    check(`${direction}: Enter selection restores visible state trigger`, await page.locator('[data-action=menu][data-id=state-menu]').evaluate(el => el === document.activeElement));
    await page.locator('[data-action=home]').click();
    const initialDensity = await page.locator('body').getAttribute('data-density');
    await page.locator('[data-action=density]').click();
    check(`${direction}: density toggles`, await page.locator('body').getAttribute('data-density') !== initialDensity);
    await page.locator('[data-action=density]').click();
    await page.locator('#main').focus();
    await page.keyboard.press('j');
    check(`${direction}: j focuses first live item`, await page.evaluate(() => document.activeElement.hasAttribute('data-roving')));
    const firstId = await page.evaluate(() => document.activeElement.dataset.id);
    await page.keyboard.press('j');
    check(`${direction}: j advances`, await page.evaluate(id => document.activeElement.dataset.id !== id, firstId));
    await page.keyboard.press('k');
    check(`${direction}: k returns`, await page.evaluate(id => document.activeElement.dataset.id === id, firstId));
    await page.keyboard.press('Enter');
    check(`${direction}: Enter opens details`, await page.locator('#detail-drawer').evaluate(el => el.open));
    await page.keyboard.press('Escape');
    check(`${direction}: Esc closes details and restores focus`, await page.locator('#detail-drawer').evaluate(el => !el.open) && await page.evaluate(id => document.activeElement.dataset.id === id, firstId));
    await page.locator('#direction-content [data-action=goal][data-id=mc]').click();
    check(`${direction}: goal drawer has durable chain and steer slots`, await page.locator('.chain-node').count() === 4 && await page.locator('.timeline-slot').count() === 1 && await page.locator('.drawer-actions').innerText().then(text => text.includes('Message Manager') && text.includes('Open member') && text.includes('Resolve blocker')));
    check(`${direction}: time defaults to five phase categories, ledger hidden`, await page.locator('.phase-strip button').count() === 5 && await page.locator('.event-ledger').count() === 0 && await page.locator('.key-events button').count() === 2);
    await page.locator('[data-action=phase][data-value="4"]').click();
    check(`${direction}: selected phase detail`, (await page.locator('#phase-detail').innerText()).includes('captured compaction interval') && (await page.locator('#phase-detail').innerText()).includes('09:46:33'));
    await page.locator('[data-action=phase][data-value="1"]').click();
    check(`${direction}: hover detail available`, (await page.locator('[data-action=phase][data-value="0"]').getAttribute('title')).includes('boundaries unavailable'));
    await screenshot(page, `${direction}-1440-dark-goal-drawer`, false);
    await page.evaluate(() => document.documentElement.classList.add('theme-light'));
    await screenshot(page, `${direction}-1440-light-goal-drawer`, false);
    await page.evaluate(() => document.documentElement.classList.remove('theme-light'));
    await page.setViewportSize({ width: 900, height: 1000 });
    await screenshot(page, `${direction}-900-dark-goal-drawer`, false);
    check(`${direction}: narrow drawer no overflow`, await page.locator('#detail-drawer').evaluate(el => el.scrollWidth <= el.clientWidth));
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.locator('[data-action=timeline-tab][data-value=Ledger]').click();
    check(`${direction}: ledger only on demand`, await page.locator('.event-ledger tbody tr').count() === 4 && await page.locator('.phase-strip').count() === 0);
    await page.locator('.event-ledger [data-action=event][data-value="1"]').click();
    check(`${direction}: ledger retains precise evidence`, (await page.locator('#phase-detail').innerText()).includes('start 09:46:10') && (await page.locator('#phase-detail').innerText()).includes('duration 23s'));
    await page.setViewportSize({ width: 1440, height: 1150 });
    await screenshot(page, `${direction}-1440-dark-event-ledger`, false);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.locator('[aria-label="Next ledger page"]').click();
    check(`${direction}: ledger pages and retains unknown blocker duration`, await page.locator('.event-ledger tbody tr').count() === 1 && (await page.locator('.event-ledger').innerText()).includes('Storage blocked'));
    await page.locator('[data-action=timeline-tab][data-value=Phases]').click();
    await page.locator('.drawer-actions [data-action=member][data-id=mono-manager]').click();
    await page.locator('#member-message').fill('Keep the review scoped to this dispatch.');
    await page.locator('#message-form .primary').click();
    check(`${direction}: message preview preserves safety`, (await page.locator('.toast').innerText()).includes('Nothing sent') && actionRequests === 0);
    await page.keyboard.press('Escape');
    await page.locator('[data-action=approval]').first().click();
    check(`${direction}: approval targets user-owned Manager`, (await page.locator('#detail-drawer').innerText()).includes('DZDistro Manager requests approval'));
    await page.locator('[data-action=preview][data-value="Approval response"]').click();
    check(`${direction}: approval sends nothing`, (await page.locator('.toast').innerText()).includes('Nothing sent or changed') && actionRequests === 0);
    await page.keyboard.press('Escape');
    await page.locator('[data-action=blocker]').first().click();
    check(`${direction}: storage recovery preserves queue`, (await page.locator('#detail-drawer').innerText()).includes('retained'));
    await page.keyboard.press('Escape');
    await page.locator('#direction-content [data-action=goal][data-id=calendar]').click();
    check(`${direction}: second goal timeline uses its own actors`, (await page.locator('#phase-detail').innerText()).includes('Backend') && !(await page.locator('#phase-detail').innerText()).includes('Builder'));
    await page.keyboard.press('Escape');
    await page.locator('[data-action=attention]').click();
    check(`${direction}: full attention categories without accordions`, await page.locator('.attention-filters button').count() === 6 && await page.locator('.attention-item').count() === 2 && await page.locator('#detail-drawer details, #detail-drawer summary').count() === 0);
    check(`${direction}: blockers lead and unknown ages stay unknown`, (await page.locator('.attention-item').first().innerText()).includes('Reviewer can’t start') && (await page.locator('.attention-item .elapsed').first().innerText()) === '—');
    await screenshot(page, `${direction}-1440-dark-attention`, false);
    await page.evaluate(() => document.documentElement.classList.add('theme-light'));
    await screenshot(page, `${direction}-1440-light-attention`, false);
    await page.evaluate(() => document.documentElement.classList.remove('theme-light'));
    await page.setViewportSize({ width: 900, height: 1000 });
    await screenshot(page, `${direction}-900-dark-attention`, false);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.locator('[data-action=attention-filter][data-value=Approvals]').click();
    check(`${direction}: attention category filter`, await page.locator('.attention-item').count() === 1 && (await page.locator('.attention-item').innerText()).includes('user-owned'));
    await page.locator('[data-action=attention-filter][data-value=History]').click();
    check(`${direction}: no fabricated resolution history`, (await page.locator('#detail-drawer').innerText()).includes('No acknowledged resolutions'));
    await page.keyboard.press('Escape');
    await page.locator('[data-action=worktrees][data-value=All]').click();
    check(`${direction}: All worktrees pages rather than disclosure`, await page.locator('.worktree').count() === 3 && (await page.locator('.paging').innerText()).includes('1 / 2'));
    await page.locator('[aria-label="Next worktree page"]').click();
    check(`${direction}: history paging`, (await page.locator('.paging').innerText()).includes('2 / 2') && (await page.locator('.worktrees').innerText()).includes('routing-checks'));
    await page.locator('[data-action=scenario][data-value=zero]').click();
    check(`${direction}: zero goals is still useful`, await page.locator('#direction-content [data-agent]').count() === 8 && (await page.locator('.vitals').innerText()).includes('0\nGoals in flight'));
    await page.locator('[data-action=goals]').first().click();
    check(`${direction}: zero goals drawer retains history`, (await page.locator('#detail-drawer').innerText()).includes('No goals in flight') && (await page.locator('#detail-drawer').innerText()).includes('PR #1861'));
    await page.keyboard.press('Escape');
    await page.locator('[data-action=theme]').click();
    check(`${direction}: theme toggle`, await page.locator('html').evaluate(el => el.classList.contains('theme-light')));
    if (direction === 'stream') {
      await page.locator('[data-action=tab][data-value=Activity]').click();
      check('stream: Activity tab', await page.locator('.feed').count() === 1 && await page.locator('.stream-roster').count() === 0);
      await page.locator('[data-action=tab][data-value=Overview]').click();
      check('stream: Overview restores full org', await page.locator('#direction-content [data-agent]').count() === 8);
      await page.locator('[data-action=tab][data-value=Attention]').click();
      await page.locator('[data-action=attention-filter][data-value=Open]').click();
      check('stream: attention also available inline', await page.locator('.stream-attention .attention-item').count() === 2);
    }
    await page.close();
    const offline = await context.newPage();
    await offline.goto(pathToFileURL(resolve(source, `${direction}.html`)).href);
    check(`${direction}: directly openable local HTML`, await offline.locator('#direction-content [data-agent]').count() === 8);
    await offline.close();
  }
  for (const asset of inputs) check(`${asset}: bytes stable during capture`, hash(await readFile(resolve(source, asset))) === receipt.assetHashes[asset]);
} catch (error) { fatal = error; receipt.fatal = error.stack; }
finally {
  if (context) { await context.close(); receipt.cleanup.browserClosed = true; }
  await new Promise(done => server.close(done));
  receipt.cleanup.serverClosed = !server.listening;
  process.chdir(originalCwd);
  try { await rm(scratch, { recursive: true, force: true, maxRetries: 6, retryDelay: 200 }); receipt.cleanup.scratchRemoved = true; }
  catch (error) { receipt.cleanup.scratchRemoved = false; receipt.cleanup.error = error.message; }
  check('browser and server stopped', receipt.cleanup.browserClosed && receipt.cleanup.serverClosed);
  check('synthetic profile removed', receipt.cleanup.scratchRemoved);
  receipt.finishedAt = new Date().toISOString();
  receipt.totals = { passed: receipt.checks.filter(c => c.passed).length, failed: receipt.checks.filter(c => !c.passed).length, cases: receipt.cases.length, screenshots: receipt.screenshots.length };
  await mkdir(evidence, { recursive: true });
  await writeFile(resolve(evidence, 'verification.json'), JSON.stringify(receipt, null, 2) + '\n');
  const index = '# CC7M screenshots\n\nReal Chromium captures of synthetic, clickable static HTML. Home captures include the full page; drawers use a viewport capture. All directions include live/zero goals in 1440 px dark/light and 900 px dark, plus compact time, attention and on-demand ledger views.\n\n| Screenshot | Size | SHA-256 |\n| --- | --- | --- |\n' + receipt.screenshots.map(item => `| [${item.file}](${item.file}) | ${item.width} × ${item.height} | \`${item.sha256}\` |`).join('\n') + '\n\nVerification: `C:/Users/nooro/AppData/Local/Temp/monocode-cc/cc7m/evidence/browser/verification.json`. These are design previews, not native/provider acceptance.\n';
  await writeFile(resolve(source, 'screenshots/index.md'), index);
  console.log(JSON.stringify({ ...receipt.totals, cleanup: receipt.cleanup, failures: receipt.checks.filter(c => !c.passed).map(c => c.name), fatal: receipt.fatal }));
}
if (fatal) throw fatal;
assert.equal(receipt.totals.failed, 0, 'Mockup browser checks failed');
