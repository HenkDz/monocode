const { test, expect } = require('@playwright/test');
const evidence = process.env.CCFB3_EVIDENCE;

test.beforeEach(async ({page}) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'platform', {value: 'Win32'}));
});

// Replays the review's assertions. Only module/evidence locations and the no-reload wait changed.
test('startup recovery keyboard tab sequence reaches Retry and opaque continuation with underlying controls excluded', async ({page}, info) => {
  await page.goto('/?boot=never');
  await expect(page.getByRole('alert')).toContainText('longer than expected', {timeout:15000});
  await expect(page.getByRole('button', {name:'Check workspace'})).toHaveCount(0);
  const reached = [];
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press('Tab');
    reached.push(await page.evaluate(() => (document.activeElement.getAttribute('aria-label') || document.activeElement.textContent).trim()));
  }
  expect(reached).toEqual(['Minimize window','Maximize window','Close window','Retry','Continue without transparency']);
  await page.screenshot({path: evidence ? `${evidence}/fix-keyboard-watchdog.png` : info.outputPath('keyboard.png')});
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', {name:'Check workspace'})).toBeVisible();
  await info.attach('tab-order.json', {body:JSON.stringify(reached), contentType:'application/json'});
});

test('startup timeout Retry must preserve a newly edited workspace until discard is confirmed', async ({page}, info) => {
  await page.goto('/?boot=never');
  await expect(page.getByRole('heading', {name:'Synthetic workspace ready'})).toBeVisible();
  await page.evaluate(() => {
    const input = document.createElement('textarea');
    input.setAttribute('aria-label', 'Unsaved draft');
    document.querySelector('main').append(input);
  });
  await page.getByRole('textbox', {name:'Unsaved draft'}).fill('Unsaved edit before the renderer watchdog');
  await expect(page.getByRole('textbox', {name:'Unsaved draft'})).toHaveValue('Unsaved edit before the renderer watchdog');
  await expect(page.getByRole('alert')).toContainText('longer than expected', {timeout:15000});
  const observations = {before: await page.evaluate(() => sessionStorage.getItem('ccfb3-attempts')), dialogs: []};
  page.on('dialog', async dialog => { observations.dialogs.push(dialog.message()); await dialog.dismiss(); });
  // Cancel must produce no load event; wait for the actual source-bound confirmation instead.
  await page.getByRole('button', {name:'Retry', exact:true}).click();
  await expect.poll(() => observations.dialogs.length).toBe(1);
  await expect(page.getByRole('button', {name:'Retry', exact:true})).toBeEnabled();
  observations.after = await page.evaluate(() => sessionStorage.getItem('ccfb3-attempts'));
  observations.draftPresent = await page.locator('textarea[aria-label="Unsaved draft"]').count();
  await info.attach('retry-observation.json', {body:JSON.stringify(observations), contentType:'application/json'});
  expect(observations.after, 'Retry must not discard user work without confirmation').toBe(observations.before);
  expect(observations.dialogs).toEqual(['Reload MonoCode and discard unsaved changes?']);
  await expect(page.locator('textarea[aria-label="Unsaved draft"]')).toHaveValue('Unsaved edit before the renderer watchdog');
  await page.screenshot({path: evidence ? `${evidence}/fix-dirty-retry.png` : info.outputPath('dirty.png')});
  await page.getByRole('button', {name:'Continue without transparency'}).click();
  await expect(page.getByRole('textbox', {name:'Unsaved draft'})).toBeFocused();
});

test('startup watchdog must exclude an existing body-portal Modal from keyboard and accessibility', async ({page}, info) => {
  await page.goto('/?boot=never');
  await expect(page.getByRole('heading', {name:'Synthetic workspace ready'})).toBeVisible();
  await page.evaluate(async () => {
    const {default: React} = await import('/node_modules/.vite/deps/react.js');
    const {default: {createRoot}} = await import('/node_modules/.vite/deps/react-dom_client.js');
    const {Modal} = await import('/src/shared/ui/Modal.tsx');
    const host = document.createElement('div');
    document.getElementById('root').append(host);
    const root = createRoot(host);
    root.render(React.createElement(Modal, {title:'Existing workspace dialog', onClose:() => root.unmount()},
      React.createElement('input', {'aria-label':'Existing modal input'})));
  });
  await expect(page.getByRole('dialog', {name:'Existing workspace dialog'})).toBeVisible();
  await page.getByRole('textbox', {name:'Existing modal input'}).fill('Unsaved modal input');
  await expect(page.getByRole('alert')).toContainText('longer than expected', {timeout:15000});
  const reached=[];
  for(let i=0;i<6;i++) {
    await page.keyboard.press('Tab');
    reached.push(await page.evaluate(() => document.activeElement.getAttribute('aria-label') || document.activeElement.textContent));
  }
  await info.attach('portal-focus.json',{body:JSON.stringify({reached,dialogRoleCount:await page.getByRole('dialog').count()}),contentType:'application/json'});
  await page.screenshot({path:evidence ? `${evidence}/fix-portal-watchdog.png` : info.outputPath('portal.png')});
  expect(reached, 'Recovery actions must be reachable instead of trapping focus in an occluded dialog').toContain('Retry');
  await expect(page.getByRole('dialog', {name:'Existing workspace dialog'})).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.getByRole('button', {name:'Continue without transparency'}).click();
  await expect(page.getByRole('textbox', {name:'Existing modal input'})).toBeFocused();
  await expect(page.getByRole('textbox', {name:'Existing modal input'})).toHaveValue('Unsaved modal input');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', {name:'Existing workspace dialog'})).toHaveCount(0);
});
