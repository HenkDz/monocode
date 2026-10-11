// Run: $env:NODE_OPTIONS='--no-experimental-webstorage'; rtk proxy node docs/cc3/capture.mjs
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { access, mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

assert.ok(process.env.NODE_OPTIONS?.includes('--no-experimental-webstorage'), 'Use the documented NODE_OPTIONS flag on Node 26');
const source = fileURLToPath(new URL('.', import.meta.url));
const output = resolve(source, 'screenshots');
const originalCwd = process.cwd();
const tempRoot = await realpath(tmpdir());
const scratch = await mkdtemp(resolve(tempRoot, 'monocode-cc3-'));
const appIdentifier = 'com.monocode.cc3.mockups';
const scrubbed = Object.keys(process.env).filter(key => key === 'CODEX_HOME' || key.startsWith('ORCA_'));
for (const key of scrubbed) delete process.env[key];
process.env.MONOCODE_APP_IDENTIFIER = appIdentifier;
process.chdir(scratch);

const pages = ['mission-control', 'attention', 'timeline', 'member', 'steering'];
const cases = pages.flatMap(name => ['dark', 'light'].map(theme => ({ name, theme, viewport: { width: 1440, height: 1100 } })));
cases.push(...['mission-control', 'member', 'steering'].map(name => ({ name, theme: 'dark', viewport: { width: 390, height: 1000 } })));
cases.push({ name: 'mission-control', theme: 'dark', viewport: { width: 900, height: 1000 } });
const receipt = {
  appIdentifier, staticOnly: true, nativeAppLaunched: false,
  startedAt: new Date().toISOString(), node: process.version,
  isolation: { emptyTemporaryCwd: true, isolatedBrowserProfile: true, codexHomeUnset: !process.env.CODEX_HOME, orcaEnvironmentCount: Object.keys(process.env).filter(key => key.startsWith('ORCA_')).length, scrubbedVariableCount: scrubbed.length },
  assetHashes: {}, cases: [], serverChecks: [], cleanup: {},
  limits: [
    'Synthetic static HTML only; no native MonoCode, provider, app database or operational backend was exercised.',
    'Keyboard checks cover native focus, outline, skip link and details; static palette rows do not implement arrow-key selection, Enter actions, Esc dismissal or a dialog focus trap.',
    'Contrast samples cover attention status text with composited solid ancestor backgrounds; this is not a complete WCAG audit or screen-reader acceptance test.',
    'Timeline ranges are synthetic fixture labels; accurate production call, compaction, cost and goal attribution depend on later data work.',
  ],
};
const check = (list, name, passed, detail) => list.push({ name, passed: Boolean(passed), ...(detail === undefined ? {} : { detail }) });
const contained = path => {
  const rel = relative(source, path);
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
};
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const target = resolve(source, `.${pathname === '/' ? '/mission-control.html' : pathname}`);
    if (!contained(target)) { response.writeHead(403).end(); return; }
    if (pathname === '/favicon.ico') { response.writeHead(204).end(); return; }
    if (!['.html', '.css'].includes(extname(target))) { response.writeHead(404).end(); return; }
    const body = await readFile(target);
    response.writeHead(200, { 'Content-Type': extname(target) === '.html' ? 'text/html; charset=utf-8' : 'text/css; charset=utf-8', 'Cache-Control': 'no-store' }).end(body);
  } catch (error) { response.writeHead(error instanceof URIError ? 400 : 404).end(); }
});
let context;
let fatal;
try {
  await mkdir(output, { recursive: true });
  for (const asset of [...pages.map(name => `${name}.html`), 'monocode.css']) receipt.assetHashes[asset] = createHash('sha256').update(await readFile(resolve(source, asset))).digest('hex');
  await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  check(receipt.serverChecks, 'encoded parent traversal rejected', (await fetch(`${origin}/%2e%2e%2fcapture.mjs`)).status === 403);
  check(receipt.serverChecks, 'malformed URL rejected', (await fetch(`${origin}/%zz`)).status === 400);
  check(receipt.serverChecks, 'non-static file denied', (await fetch(`${origin}/capture.mjs`)).status === 404);
  context = await chromium.launchPersistentContext(resolve(scratch, 'browser-profile'), { headless: true, env: { ...process.env }, viewport: { width: 1440, height: 1100 } });
  receipt.chromium = context.browser().version();
  for (const scenario of cases) {
    const page = await context.newPage();
    const result = { ...scenario, checks: [], errors: [], focusable: {}, statusContrast: [] };
    receipt.cases.push(result);
    page.on('pageerror', error => result.errors.push(`page: ${error.message}`));
    page.on('console', message => { if (message.type() === 'error') result.errors.push(`console: ${message.text()}`); });
    page.on('requestfailed', request => result.errors.push(`request: ${request.url()} ${request.failure()?.errorText}`));
    page.on('response', response => { if (response.status() >= 400) result.errors.push(`HTTP ${response.status()}: ${response.url()}`); });
    try {
      await page.setViewportSize(scenario.viewport);
      await page.emulateMedia({ colorScheme: scenario.theme, reducedMotion: 'no-preference' });
      const response = await page.goto(`${origin}/${scenario.name}.html`, { waitUntil: 'networkidle' });
      await page.evaluate(theme => document.documentElement.classList.toggle('theme-light', theme === 'light'), scenario.theme);
      await page.evaluate(() => document.fonts.ready);
      check(result.checks, 'page served successfully', response.status() === 200);
      const structure = await page.evaluate(() => ({ title: document.title, h1: document.querySelectorAll('h1').length, main: document.querySelectorAll('main').length, width: document.documentElement.scrollWidth, viewport: innerWidth, scripts: document.scripts.length, inlineEvents: document.querySelectorAll('[onclick],[onkeydown],[onload],[onchange]').length, forms: document.forms.length }));
      result.structure = structure;
      check(result.checks, 'one h1 and main', structure.h1 === 1 && structure.main === 1);
      check(result.checks, 'descriptive document title', structure.title.includes('MonoCode CC3') && structure.title.length > 19, structure.title);
      check(result.checks, 'no horizontal overflow', structure.width <= structure.viewport, { width: structure.width, viewport: structure.viewport });
      check(result.checks, 'no script, inline event or submission hooks', structure.scripts === 0 && structure.inlineEvents === 0 && structure.forms === 0);
      const resources = await page.evaluate(() => [...document.querySelectorAll('[href],[src]')].map(node => ({ url: new URL(node.getAttribute('href') || node.getAttribute('src'), location.href).href, hashExists: !(node.getAttribute('href') || '').startsWith('#') || Boolean(document.getElementById(node.getAttribute('href').slice(1))) })));
      const resourcePaths = [...new Set(resources.map(item => item.url.split('#')[0]))];
      const resourceResponses = await Promise.all(resourcePaths.map(async url => ({ url: new URL(url).pathname, status: (await page.request.get(url)).status() })));
      result.localResources = resourceResponses;
      check(result.checks, 'local hrefs and assets valid', resources.every(item => item.url.startsWith(`${origin}/`) && item.hashExists) && resourceResponses.every(item => item.status === 200));
      await page.keyboard.press('Tab');
      const skip = await page.evaluate(() => ({ isSkip: document.activeElement.classList.contains('skip'), href: document.activeElement.getAttribute('href'), top: document.activeElement.getBoundingClientRect().top, outline: getComputedStyle(document.activeElement).outlineWidth }));
      check(result.checks, 'first Tab shows skip link with focus outline', skip.isSkip && skip.href === '#main' && skip.top >= 0 && Number.parseFloat(skip.outline) >= 2, skip);
      await page.keyboard.press('Enter');
      check(result.checks, 'skip link reaches main anchor', new URL(page.url()).hash === '#main');
      await page.goto(`${origin}/${scenario.name}.html`, { waitUntil: 'networkidle' });
      await page.evaluate(theme => document.documentElement.classList.toggle('theme-light', theme === 'light'), scenario.theme);
      const focusTargets = await page.evaluate(() => [...document.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),summary')].filter(element => getComputedStyle(element).visibility !== 'hidden' && element.getClientRects().length > 0).map((element, index) => { element.dataset.captureFocus = String(index); return { index, tag: element.tagName.toLowerCase(), label: element.getAttribute('aria-label') || element.textContent.trim() || element.getAttribute('placeholder') || element.id }; }));
      const reached = new Set();
      let outlined = true;
      let detailsToggled = false;
      for (let step = 0; step < focusTargets.length; step++) {
        await page.keyboard.press('Tab');
        const focus = await page.evaluate(() => { const element = document.activeElement; const style = getComputedStyle(element); return { index: element.dataset.captureFocus, tag: element.tagName.toLowerCase(), outline: Number.parseFloat(style.outlineWidth), outlineStyle: style.outlineStyle, isSummary: element.tagName === 'SUMMARY' }; });
        reached.add(focus.index);
        outlined &&= focus.outline >= 2 && focus.outlineStyle !== 'none';
        result.focusable[focus.tag] = (result.focusable[focus.tag] ?? 0) + 1;
        if (focus.isSummary && !detailsToggled) {
          const before = await page.evaluate(() => document.activeElement.parentElement.open);
          await page.keyboard.press('Enter');
          detailsToggled = await page.evaluate(previous => document.activeElement.parentElement.open !== previous, before);
          await page.keyboard.press('Enter');
        }
      }
      check(result.checks, 'Tab reaches all visible native controls', reached.size === focusTargets.length && focusTargets.every(target => reached.has(String(target.index))), { expected: focusTargets.length, reached: reached.size, counts: result.focusable });
      check(result.checks, 'native control focus has visible outline', outlined);
      check(result.checks, 'native details toggle with Enter', !focusTargets.some(target => target.tag === 'summary') || detailsToggled);
      const beforeButtons = await page.evaluate(() => ({ html: document.body.innerHTML, url: location.href }));
      let operationalRequests = 0;
      const requestCounter = () => { operationalRequests++; };
      page.on('request', requestCounter);
      for (const button of await page.locator('button').all()) await button.evaluate(element => element.click());
      await page.waitForTimeout(50);
      page.off('request', requestCounter);
      const afterButtons = await page.evaluate(() => ({ html: document.body.innerHTML, url: location.href }));
      check(result.checks, 'operational buttons are inert static previews', beforeButtons.html === afterButtons.html && beforeButtons.url === afterButtons.url && operationalRequests === 0, { buttons: await page.locator('button').count(), requests: operationalRequests });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const reduced = await page.evaluate(() => ({ preference: matchMedia('(prefers-reduced-motion: reduce)').matches, moving: [...document.querySelectorAll('*')].some(element => ['','::before','::after'].some(pseudo => { const style = getComputedStyle(element, pseudo || null); return style.animationName !== 'none' || style.transitionDuration.split(',').some(value => Number.parseFloat(value) > 0); })) }));
      check(result.checks, 'reduced motion disables animations and transitions', reduced.preference && !reduced.moving);
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      result.statusContrast = await page.evaluate(() => {
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        const rgba = color => { context.clearRect(0,0,1,1); context.fillStyle = color; context.fillRect(0,0,1,1); return [...context.getImageData(0,0,1,1).data].map((value,index) => index === 3 ? value/255 : value); };
        const blend = (foreground, background) => foreground.slice(0,3).map((value,index) => value*foreground[3]+background[index]*(1-foreground[3]));
        const luminance = color => color.map(value => value/255).map(value => value <= 0.04045 ? value/12.92 : ((value+0.055)/1.055)**2.4).reduce((sum,value,index) => sum+value*[0.2126,0.7152,0.0722][index],0);
        return [...document.querySelectorAll('.state.attention,.attention-strip strong,.side-status.hot,.count.hot')].filter(element => element.getClientRects().length).map(element => {
          const ancestors = []; for (let node=element;node;node=node.parentElement) ancestors.unshift(node);
          let background = [255,255,255]; for (const ancestor of ancestors) background = blend(rgba(getComputedStyle(ancestor).backgroundColor), background);
          const foreground = blend(rgba(getComputedStyle(element).color), background);
          const a = luminance(foreground), b = luminance(background);
          return { text: element.textContent.trim(), ratio: Number(((Math.max(a,b)+0.05)/(Math.min(a,b)+0.05)).toFixed(2)), foreground, background: background.map(Math.round) };
        });
      });
      check(result.checks, 'sampled attention text contrast meets 4.5:1', result.statusContrast.every(sample => sample.ratio >= 4.5), { samples: result.statusContrast.length, minimum: Math.min(...result.statusContrast.map(sample => sample.ratio)) });
      await page.evaluate(() => { document.activeElement.blur(); scrollTo(0,0); });
      result.screenshot = `screenshots/${scenario.name}-${scenario.theme}-${scenario.viewport.width}.png`;
      await page.screenshot({ path: resolve(source, result.screenshot), fullPage: true });
      result.screenshotSha256 = createHash('sha256').update(await readFile(resolve(source, result.screenshot))).digest('hex');
      check(result.checks, 'no browser console page or resource errors', result.errors.length === 0, result.errors);
    } catch (error) { check(result.checks, 'case execution', false, String(error.stack ?? error)); }
    finally { await page.close(); }
    console.log(`${scenario.name} ${scenario.theme} ${scenario.viewport.width}: ${result.checks.filter(item => item.passed).length}/${result.checks.length} checks`);
  }
  for (const [asset, hash] of Object.entries(receipt.assetHashes)) check(receipt.serverChecks, `asset stable during capture: ${asset}`, createHash('sha256').update(await readFile(resolve(source, asset))).digest('hex') === hash);
} catch (error) { fatal = error; receipt.fatal = String(error.stack ?? error); }
finally {
  try { if (context) await context.close(); receipt.cleanup.browserClosed = true; } catch (error) { receipt.cleanup.browserError = String(error); }
  try { if (server.listening) await new Promise((done, reject) => server.close(error => error ? reject(error) : done())); receipt.cleanup.serverClosed = !server.listening; } catch (error) { receipt.cleanup.serverError = String(error); }
  process.chdir(originalCwd);
  assert.equal(dirname(resolve(scratch)), tempRoot, 'Cleanup must remain under the resolved temporary root');
  assert.ok(resolve(scratch).startsWith(resolve(tempRoot, 'monocode-cc3-')), 'Cleanup may remove only this owned temporary directory');
  try {
    await rm(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    await assert.rejects(() => access(scratch), { code: 'ENOENT' });
    receipt.cleanup.temporaryProfileRemoved = true;
  } catch (error) { receipt.cleanup.temporaryProfileError = String(error); }
  receipt.finishedAt = new Date().toISOString();
  const checks = [...receipt.serverChecks, ...receipt.cases.flatMap(result => result.checks)];
  receipt.summary = { cases: receipt.cases.length, screenshots: receipt.cases.filter(result => result.screenshotSha256).length, checks: checks.length, passed: checks.filter(item => item.passed).length, failed: checks.filter(item => !item.passed).length };
  receipt.status = !fatal && receipt.summary.failed === 0 && receipt.summary.screenshots === cases.length && receipt.cleanup.browserClosed && receipt.cleanup.serverClosed && receipt.cleanup.temporaryProfileRemoved ? 'PASS' : 'FAIL';
  await writeFile(resolve(source, 'browser-verification.json'), `${JSON.stringify(receipt,null,2)}\n`);
}
console.log(JSON.stringify(receipt.summary));
assert.equal(receipt.status, 'PASS', `Browser verification failed; inspect docs/cc3/browser-verification.json${fatal ? `: ${fatal.message}` : ''}`);
