import { expect, test, type Page, type TestInfo } from "@playwright/test";

type Fixture = {
  events: { action: string; args?: { account?: { provider: string; id: string }; args?: string[]; cwd?: string } }[];
  raw: string; original: string; current(): string;
  finishLogin(success: boolean): void; repeat(): void; pulse(up?: boolean): void;
};
declare global { interface Window { ccauthFixture: Fixture; copiedDiagnostics: string } }
async function capture(page: Page, info: TestInfo, name: string) {
  const path = info.outputPath(`${name}.png`);
  await page.screenshot({ path });
  await info.attach(name, { path, contentType: "image/png" });
}
async function open(page: Page, query: string) {
  await page.goto(`/tests/browser/ccauth-feedback.html?${query}`, { waitUntil: "commit" });
}

for (const [theme,width] of [["dark",1100],["light",390]] as const) {
  test(`one SessionPane auth card survives repeat/reload and targets a synthetic account by pointer and keyboard (${theme} ${width})`, async ({ page },info) => {
    await page.setViewportSize({ width, height: 900 });
    await open(page, `theme=${theme}`);
    const card = page.locator('[data-provider-auth="codex"]');
    await expect(card).toHaveCount(1);
    await expect(card).toBeVisible();
    await expect(page.locator("body")).not.toContainText(/401|cf-ray|Missing bearer|Provider sign-in required|Manager needs your decision/);
    await expect(page.getByRole("button",{ name: "Continue",exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => window.ccauthFixture.events)).toEqual([]);
    await card.getByRole("button",{ name: "Copy diagnostics",exact: true }).click();
    expect(await page.evaluate(() => window.copiedDiagnostics)).toBe(await page.evaluate(() => `${window.ccauthFixture.raw}\n\n${window.ccauthFixture.raw}`));
    await page.evaluate(() => window.ccauthFixture.repeat());
    await expect(card).toHaveCount(1);
    await page.reload({ waitUntil: "commit" });
    await expect(card).toHaveCount(1);
    const signIn = card.getByRole("button",{ name: "Sign in to Codex",exact: true });
    if (width === 390) { await signIn.focus(); await page.keyboard.press("Enter"); } else await signIn.click();
    await expect(card.getByRole("button",{ name: "Waiting for browser…",exact: true })).toBeDisabled();
    await expect.poll(() => page.evaluate(() => window.ccauthFixture.events.filter(event => event.action === "login").length)).toBe(1);
    const login = await page.evaluate(() => window.ccauthFixture.events[0]);
    expect(login.args?.account).toEqual({ provider: "codex", id: "synthetic-work" });
    expect(login.args?.args).toEqual(["login"]);
    expect(login.args?.cwd).toBe("C:/synthetic/ccauth-home");
    await page.evaluate(() => window.ccauthFixture.finishLogin(false));
    await expect(card).toContainText("Sign-in could not finish");
    await expect(page.locator("body")).not.toContainText(/401|cf-ray/);
    await capture(page, info, `auth-${theme}-${width}-failure`);
    await signIn.click();
    await expect.poll(() => page.evaluate(() => window.ccauthFixture.events.filter(event => event.action === "login").length)).toBe(2);
    await page.evaluate(() => window.ccauthFixture.finishLogin(true));
    await expect(card).toContainText("Your request is still stopped");
    expect(await page.evaluate(() => window.ccauthFixture.events.filter(event => ["submit","continue","resume"].includes(event.action)))).toEqual([]);
    expect(await page.evaluate(() => window.ccauthFixture.current())).toBe(await page.evaluate(() => window.ccauthFixture.original));
    const box = await card.boundingBox(); expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(width);
  });
}
for (const error of ["Missing bearer token","unauthenticated","Session has expired","Codex login has expired"]) {
  test(`auth variant ${error} is one quiet actionable card`, async ({ page }) => {
    await open(page, `error=${encodeURIComponent(error)}`);
    await expect(page.locator("[data-provider-auth]")).toHaveCount(1);
    await expect(page.getByRole("button",{ name: "Sign in to Codex",exact: true })).toBeEnabled();
    await expect(page.locator("[data-transcript-error]")).toHaveCount(0);
  });
}
test("busy sign-in refuses clicks; real Manager decisions stay actionable; other providers keep their identity", async ({ page }) => {
  await open(page, "scenario=busy");
  const signIn = page.getByRole("button",{ name: "Sign in to Codex",exact: true });
  await expect(signIn).toBeDisabled();
  expect(await page.evaluate(() => window.ccauthFixture.events)).toEqual([]);
  await open(page, "scenario=decision");
  await expect(page.locator("[data-provider-auth]")).toHaveCount(0);
  await page.getByRole("button",{ name: "Continue",exact: true }).click();
  expect(await page.evaluate(() => window.ccauthFixture.events.map(event => event.action))).toEqual(["continue"]);
  for (const provider of ["claude","pi"]) {
    await open(page, `provider=${provider}`);
    await expect(page.locator(`[data-provider-auth="${provider}"]`)).toHaveCount(1);
    await expect(page.locator("body")).not.toContainText("Codex");
    await expect(page.locator("[data-transcript-error]")).toHaveCount(0);
    if (provider === "pi") await expect(page.locator("[data-provider-auth]")).toContainText("provider controls");
    else await expect(page.getByRole("button",{ name: "Sign in to Claude Code",exact: true })).toBeEnabled();
  }
});

for (const members of [0,1,4,6,10]) {
  test(`tree retains ${members} members in readable two-card rows and every full active connector`, async ({ page },info) => {
    const theme = members === 10 ? "light" : "dark";
    await page.setViewportSize({ width: 1100, height: 1000 });
    await open(page, `mode=tree&members=${members}&theme=${theme}`);
    const tree = page.locator(".tree-map");
    await expect(tree).toHaveAttribute("data-layout","tree");
    await expect(page.locator('.team-map-node[data-role="member"]')).toHaveCount(members);
    const geometry = await page.locator(".team-map-node").evaluateAll(nodes => nodes.map(node => ({ id: node.getAttribute("data-id"),role: node.getAttribute("data-role"), x: (node as HTMLElement).offsetLeft, y: (node as HTMLElement).offsetTop, w: (node as HTMLElement).offsetWidth, h: (node as HTMLElement).offsetHeight })));
    const workers = geometry.filter(node => node.role === "member"), manager = geometry.find(node => node.role === "manager")!;
    expect(new Set(workers.map(node => node.y)).size).toBe(Math.ceil(members/2));
    expect(new Set(workers.map(node => node.x)).size).toBe(Math.min(2,members));
    for (const worker of workers) expect(worker.y).toBeGreaterThan(manager.y + manager.h);
    for (const node of geometry) for (const other of geometry.filter(other => other.id !== node.id)) expect(node.x < other.x+other.w && node.x+node.w > other.x && node.y < other.y+other.h && node.y+node.h > other.y).toBe(false);
    const paths = await page.locator(".team-map-edge[data-flow]").evaluateAll(edges => edges.map(edge => ({ route: edge.querySelector(".team-map-edge-route")?.getAttribute("d"),flow: edge.querySelector(".team-map-edge-flow")?.getAttribute("d"),direction: edge.getAttribute("data-flow"),animationDirection: getComputedStyle(edge.querySelector(".team-map-edge-flow")!).animationDirection })));
    expect(paths.length).toBe(members ? members+1 : 0);
    for (const path of paths) { expect(path.flow).toBe(path.route); expect(path.direction).toBe("up"); expect(path.animationDirection).toBe("reverse"); }
    expect(await page.locator('[draggable="true"],.tree-project-grip').count()).toBe(0);
    expect(await page.locator(".tree-project-header").evaluate(node => getComputedStyle(node).cursor)).toBe("pointer");
    await page.getByRole("button",{ name: "Fit to view",exact: true }).click();
    const zoom = await page.locator(".team-map-zoom span").innerText(); expect(parseInt(zoom)).toBeGreaterThanOrEqual(80);
    if (members === 4 || members === 10) await capture(page,info,`tree-${members}-${theme}`);
  });
}
test("multiple projects preserve focus, keyboard, collapse, filter, bounded ordering and panning", async ({ page }) => {
  await page.setViewportSize({ width: 1800,height: 1100 });
  await open(page,"mode=tree&projects=2&members=4&mixed=yes");
  await expect(page.locator(".tree-map")).toHaveAttribute("data-layout","tree");
  await expect(page.locator('.team-map-edge[data-flow="down"]')).toHaveCount(2);
  await expect(page.locator('.team-map-edge:not([data-flow])')).toHaveCount(4);
  const header = page.getByRole("button",{name: "Focus project-1 team",exact: true});
  const before = await page.locator(".team-map-canvas").getAttribute("style");
  await header.click();
  await expect(page.locator(".team-map-canvas")).not.toHaveAttribute("style",before!);
  await header.press("Alt+ArrowRight");
  expect(await page.locator(".tree-project-header strong").allTextContents()).toEqual(["project-2","project-1"]);
  await page.getByRole("button",{ name: "Undo reorder",exact:true }).click();
  await page.getByRole("button",{ name: "Move project right",exact:true }).click();
  expect(await page.locator(".tree-project-header strong").allTextContents()).toEqual(["project-2","project-1"]);
  await page.getByRole("button",{ name: "Undo reorder",exact:true }).click();
  await page.getByRole("button",{ name: "Collapse Project 1 Manager’s team",exact:true }).click();
  await expect(page.locator('.team-map-node[data-role="member"]')).toHaveCount(4);
  await page.getByRole("button",{ name: "Expand Project 1 Manager’s team",exact:true }).click();
  await page.getByLabel("Project",{ exact:true }).selectOption("/project-1");
  await expect(page.locator('.team-map-node[data-role="member"]')).toHaveCount(4);
  const manager = page.locator('[data-id="manager-0"] .team-map-node-open');
  await manager.focus(); await manager.press("ArrowDown");
  await expect(page.locator('.team-map-node[data-role="member"] .team-map-node-open').first()).toBeFocused();
  await page.getByRole("button",{name:"Zoom in",exact:true}).click();
  const zoomed = await page.locator(".team-map-canvas").getAttribute("style");
  const viewport = await page.locator(".team-map-viewport").boundingBox();
  await page.mouse.move(viewport!.x+20,viewport!.y+20); await page.mouse.down(); await page.mouse.move(viewport!.x+70,viewport!.y+50); await page.mouse.up();
  await expect(page.locator(".team-map-canvas")).not.toHaveAttribute("style",zoomed!);
  expect(await page.evaluate(() => window.ccauthFixture.events.filter(event => event.action === "open"))).toEqual([]);
});
for (const panel of [false,true]) {
  test(`narrow/open-panel fallback keeps names readable and scroll accessible (${panel})`,async ({ page },info) => {
    const width = panel ? 900 : 390;
    await page.setViewportSize({ width,height: 900 });
    await open(page,`mode=tree&members=6&mixed=yes${panel ? "&panel=yes" : ""}`);
    await expect(page.locator(".tree-map")).toHaveAttribute("data-layout","list");
    await expect(page.locator('.team-map-node[data-role="member"]')).toHaveCount(6);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    expect(overflow).toBe(false);
    const textSize = await page.locator('.team-map-identity strong').first().evaluate(node => getComputedStyle(node).fontSize);
    expect(parseFloat(textSize)).toBeGreaterThanOrEqual(14);
    await page.locator('.team-map-node[data-role="member"] .team-map-node-open').last().scrollIntoViewIfNeeded();
    await expect(page.locator('.team-map-node[data-role="member"] .team-map-node-open').last()).toBeInViewport();
    await capture(page,info,panel ? "tree-open-panel" : "tree-narrow");
  });
}
test("active work and event pulses travel trunk and bends at several animation times; idle has no flow", async ({ page },info) => {
  await page.setViewportSize({ width:1100,height:1000 });
  await open(page,"mode=tree&members=4");
  const svg = page.locator(".team-map-edges");
  await expect(svg).toBeVisible();
  const initialOffset = await page.locator('.team-map-edge-flow').last().evaluate(node => getComputedStyle(node).strokeDashoffset);
  await expect.poll(() => page.locator('.team-map-edge-flow').last().evaluate(node => getComputedStyle(node).strokeDashoffset)).not.toBe(initialOffset);
  const start = await svg.evaluate(node => { const element = node as SVGSVGElement; element.pauseAnimations(); return element.getCurrentTime(); });
  await page.evaluate(() => window.ccauthFixture.pulse());
  const pulse = page.locator(".team-map-pulse circle");
  await expect(pulse).toHaveCount(1);
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await svg.evaluate((node,time) => (node as SVGSVGElement).setCurrentTime(time),start+0.001);
  await expect.poll(() => pulse.evaluate(node => getComputedStyle(node).opacity)).toBe("1");
  const positions: {x:number;y:number}[] = [];
  for (const seconds of [0.2,0.7,1.2]) {
    await svg.evaluate((node,time) => (node as SVGSVGElement).setCurrentTime(time),start+seconds);
    const sample = await pulse.evaluate((node,progress) => {
      const circle = node as SVGCircleElement;
      const motion = circle.querySelector("animateMotion")!;
      const route = document.createElementNS("http://www.w3.org/2000/svg","path"); route.setAttribute("d",motion.getAttribute("path")!);
      const expected = route.getPointAtLength(route.getTotalLength()*progress);
      const parent = circle.parentElement! as unknown as SVGGElement;
      const point = new DOMPoint(0,0).matrixTransform(circle.getCTM()!).matrixTransform(parent.getCTM()!.inverse());
      return { x:point.x,y:point.y,expectedX:expected.x,expectedY:expected.y };
    },seconds/1.5);
    expect(sample.x).toBeCloseTo(sample.expectedX,0); expect(sample.y).toBeCloseTo(sample.expectedY,0);
    positions.push(sample); await capture(page,info,`pulse-${seconds}`);
  }
  expect(new Set(positions.map(point => Math.round(point.x))).size).toBeGreaterThan(1);
  expect(new Set(positions.map(point => Math.round(point.y))).size).toBeGreaterThan(1);
  await svg.evaluate(node => (node as SVGSVGElement).unpauseAnimations());
  await open(page,"mode=tree&members=4");
  await expect(page.locator('.team-map-node[data-role="member"]')).toHaveCount(4);
  await page.evaluate(() => window.ccauthFixture.pulse(true));
  await expect(page.locator(".team-map-pulse animateMotion")).toHaveCount(2);
  const reversed = await page.locator(".team-map-pulse").evaluateAll(groups => groups.map(group => {
    const route = group.querySelector("path") as SVGPathElement;
    const motion = document.createElementNS("http://www.w3.org/2000/svg","path"); motion.setAttribute("d",group.querySelector("animateMotion")!.getAttribute("path")!);
    const start = motion.getPointAtLength(0), end = route.getPointAtLength(route.getTotalLength());
    return { x:start.x,y:start.y,endX:end.x,endY:end.y };
  }));
  for (const path of reversed) { expect(path.x).toBe(path.endX); expect(path.y).toBe(path.endY); }
  await open(page,"mode=tree&members=4&idle=yes");
  await expect(page.locator('.team-map-edge-flow')).toHaveCount(0);
});
test("reduced motion uses static honest work and report cues without ongoing animation",async ({ page }) => {
  await page.emulateMedia({ reducedMotion:"reduce" });
  await open(page,"mode=tree&members=4");
  await expect(page.locator('.team-map-edge[data-reduced-motion="true"][data-flow="up"]')).toHaveCount(5);
  const paths = await page.locator('.team-map-edge-flow').evaluateAll(nodes => nodes.map(node => getComputedStyle(node).animationName));
  expect(paths.every(name => name === "none")).toBe(true);
  await page.evaluate(() => window.ccauthFixture.pulse(true));
  await expect(page.locator(".team-map-pulse circle")).toHaveCount(2);
  await expect(page.locator("animateMotion")).toHaveCount(0);
});
