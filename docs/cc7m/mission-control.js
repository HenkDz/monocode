/* Synthetic design fixture. No app stores, provider calls, persisted state or operational actions. */
const direction = document.body.dataset.direction;
const params = new URLSearchParams(location.search);
const view = { zero: params.get('goals') === 'zero', project: 'All projects', state: 'All states', density: direction === 'stream' ? 'compact' : 'comfortable', intent: 'Chat', override: 'Auto', tab: 'Overview', worktrees: 'Active', worktreePage: 0, attentionFilter: 'Open' };
document.documentElement.classList.toggle('theme-light', params.get('theme') === 'light');
document.body.dataset.density = view.density;
const directions = { cockpit: ['A', 'Cockpit', 'Your team, at a glance.'], board: ['B', 'Board', 'Keep the work moving.'], stream: ['C', 'Stream', 'One clear view of what matters.'] };
const agents = [
  { id: 'grand', name: 'Grand Orch', role: 'Organization lead', project: 'Organization', initials: 'GO', color: '', state: 'idle', label: 'Idle', activity: 'Ready for your next goal', elapsed: '—', scope: 'No current turn' },
  { id: 'mono-manager', name: 'Manager', role: 'Project lead', project: 'MonoCode', initials: 'MM', color: 'blue', state: 'waiting-on-member', label: 'Waiting · Reviewer blocked', activity: 'Review of mission control', elapsed: '1m 42s', scope: 'Observed turn time' },
  { id: 'builder', name: 'Builder', role: 'Engineering', project: 'MonoCode', initials: 'BU', color: 'green', state: 'running-tool', label: 'Running tool', activity: 'Checking keyboard navigation', elapsed: '6m 32s', scope: 'Current attempt elapsed' },
  { id: 'reviewer', name: 'Reviewer', role: 'Quality & safety', project: 'MonoCode', initials: 'RE', color: 'amber', state: 'blocked', label: 'Blocked · storage', activity: 'Review queued · storage conflict', elapsed: '—', scope: 'Queued review has not started' },
  { id: 'designer', name: 'Designer', role: 'Product design', project: 'MonoCode', initials: 'DE', color: '', state: 'idle', label: 'Idle', activity: 'Available for a new assignment', elapsed: '—', scope: 'No current turn' },
  { id: 'dz-manager', name: 'Manager', role: 'Project lead', project: 'DZDistro', initials: 'DM', color: 'blue', state: 'needs-you', label: 'Needs you · approval', activity: 'Approve the staging smoke check', elapsed: '2m 10s', scope: 'Observed turn time' },
  { id: 'backend', name: 'Backend', role: 'Engineering', project: 'DZDistro', initials: 'BE', color: 'blue', state: 'thinking', label: 'Thinking', activity: 'Tracing tenant calendar boundaries', elapsed: '4m 18s', scope: 'Current attempt elapsed' },
  { id: 'qa', name: 'QA', role: 'Verification', project: 'DZDistro', initials: 'QA', color: '', state: 'idle', label: 'Idle', activity: 'Available for a new assignment', elapsed: '—', scope: 'No current turn' },
];
const goals = [
  { id: 'mc', title: 'Make mission control useful at a glance', project: 'MonoCode', lane: 'Blocked', state: 'blocked', label: 'Reviewer blocked', elapsed: '24m', manager: 'mono-manager', workers: ['builder', 'reviewer'], note: 'Review is waiting for storage recovery. Implementation is retained.' },
  { id: 'calendar', title: 'Keep calendar dates consistent across tenants', project: 'DZDistro', lane: 'Working', state: 'thinking', label: 'Working', elapsed: '18m', manager: 'dz-manager', workers: ['backend', 'qa'], note: 'Backend is tracing date boundaries. A staging smoke check needs approval.' },
];
const history = { id: 'pricing', title: 'Correct Arabic pricing labels', project: 'DZDistro', lane: 'Done today', state: 'done', label: 'Merged · PR #1861', elapsed: '—' };
const worktrees = ['cc7m-mission-v2', 'tenant-calendar', 'arabic-pricing', 'routing-checks', 'release-notes', 'sidebar-polish'];
const icons = {
  logo: '<path d="M3 13V5h5v8h5V5h5v8"/>', grid: '<rect x="3" y="3" width="6" height="6" rx="1"/><rect x="13" y="3" width="6" height="6" rx="1"/><rect x="3" y="13" width="6" height="6" rx="1"/><rect x="13" y="13" width="6" height="6" rx="1"/>',
  inbox: '<path d="M4 4h14l2 11v4H2v-4L4 4Z"/><path d="M2 14h5l2 3h4l2-3h5"/>', team: '<circle cx="8" cy="7" r="3"/><path d="M2 19v-2a6 6 0 0 1 12 0v2M15 4a3 3 0 0 1 0 6M18 19v-2a6 6 0 0 0-3-5"/>',
  branch: '<circle cx="6" cy="4" r="2"/><circle cx="16" cy="6" r="2"/><circle cx="6" cy="18" r="2"/><path d="M6 6v10M16 8c0 5-10 3-10 7"/>', arrow: '<path d="M4 11h14M13 6l5 5-5 5"/>',
  close: '<path d="m5 5 12 12M17 5 5 17"/>', command: '<rect x="4" y="4" width="14" height="14" rx="3"/><path d="m8 8 3 3-3 3M13 14h2"/>', route: '<path d="M3 7h15M14 3l4 4-4 4M19 15H4M8 11l-4 4 4 4"/>',
  merge: '<circle cx="6" cy="4" r="2"/><circle cx="16" cy="4" r="2"/><circle cx="6" cy="18" r="2"/><path d="M6 6v10M16 6c0 6-10 3-10 8"/>', check: '<path d="m4 11 5 5 10-10"/>', sun: '<circle cx="11" cy="11" r="4"/><path d="M11 1v2M11 19v2M1 11h2M19 11h2M4 4l1 1M17 17l1 1M4 18l1-1M17 5l1-1"/>', density: '<path d="M4 5h14M4 11h14M4 17h14"/>', plus: '<path d="M11 4v14M4 11h14"/>',
};
const icon = name => `<svg viewBox="0 0 22 22" aria-hidden="true">${icons[name] || icons.grid}</svg>`;
const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const avatar = (agent, small = false) => `<span class="avatar ${agent.color} ${small ? 'small' : ''}" aria-hidden="true">${agent.initials}</span>`;
const state = agent => `<span class="state" data-state="${agent.state}" title="${escapeHtml(agent.label)}">${agent.state === 'done' ? '<span aria-hidden="true">✓</span>' : '<span class="dot" aria-hidden="true"></span>'}${agent.label}</span>`;
const byId = id => agents.find(agent => agent.id === id);
const visibleAgents = () => agents.filter(agent => (view.project === 'All projects' || agent.project === view.project) && (view.state === 'All states' || (view.state === 'Working' && ['thinking', 'running-tool'].includes(agent.state)) || (view.state === 'Needs attention' && ['blocked', 'needs-you'].includes(agent.state)) || (view.state === 'Idle' && agent.state === 'idle')));
const visibleGoals = () => (view.zero ? [] : goals).filter(goal => (view.project === 'All projects' || goal.project === view.project) && (view.state === 'All states' || (view.state === 'Working' && goal.lane === 'Working') || (view.state === 'Needs attention' && goal.lane === 'Blocked')));
const memberButton = (agent, kind = 'card') => {
  const activity = view.zero && agent.id === 'builder' ? 'Checking workspace health' : view.zero && agent.id === 'mono-manager' ? 'Waiting for queued project review' : agent.activity;
  if (kind === 'row') return `<button class="roster-row" data-action="member" data-id="${agent.id}" data-roving data-agent="${agent.id}" aria-label="${agent.project} ${agent.name}: ${agent.label}"><span class="inline">${avatar(agent, true)}<span class="agent-name">${agent.name}</span></span>${state(agent)}<span class="activity-text">${activity}</span><span class="elapsed" title="${agent.scope}">${agent.elapsed}</span></button>`;
  if (kind === 'rail') return `<button class="rail-agent" data-action="member" data-id="${agent.id}" data-roving data-agent="${agent.id}">${avatar(agent, true)}<span><span class="rail-name"><span class="agent-name">${agent.name}</span><span class="elapsed" title="${agent.scope}">${agent.elapsed}</span></span>${state(agent)}<span class="activity-text" title="${activity}">${activity}</span></span></button>`;
  return `<button class="agent-card" data-action="member" data-id="${agent.id}" data-roving data-agent="${agent.id}" data-state="${agent.state}"><span class="agent-top">${avatar(agent)}<span class="identity"><span class="agent-name">${agent.name}</span><span class="agent-role">${agent.role}</span></span></span><span class="activity-text">${activity}</span><span class="agent-bottom">${state(agent)}<span class="elapsed" title="${agent.scope}">${agent.elapsed}</span></span></button>`;
};
function sidebar() {
  const compactMembers = direction !== 'cockpit';
  return `<aside class="sidebar" aria-label="Workspace sidebar"><div class="brand"><span class="brand-mark">${icon('logo')}</span>MonoCode</div>
    <nav class="nav" aria-label="Main navigation"><button aria-current="page" data-action="home">${icon('grid')}<span>Mission control</span></button><button data-action="attention">${icon('inbox')}<span>Inbox</span><span class="count">2</span></button><button data-action="team">${icon('team')}<span>Team</span><span class="count">8</span></button></nav>
    <section><div class="side-heading">Projects <span>2</span></div>${['MonoCode', 'DZDistro'].map(project => `<button class="side-project" data-action="project" data-value="${project}"><span class="project-mark">${project === 'MonoCode' ? 'M' : 'D'}</span>${project}<span class="count">${project === 'MonoCode' ? '4' : '3'}</span></button>${compactMembers ? `<div class="idle-chips">${agents.filter(a => a.project === project).map(a => `<button data-action="member" data-id="${a.id}" title="${a.name} · ${a.label}" aria-label="${project} ${a.name}: ${a.label}">${avatar(a)}<span class="dot" data-state="${a.state}"></span></button>`).join('')}</div>` : `<div class="side-members">${agents.filter(a => a.project === project && a.state !== 'idle').map(a => `<button class="side-member" data-action="member" data-id="${a.id}" aria-label="${project} ${a.name}: ${a.label}" title="${a.label}">${avatar(a, true)}${a.name}<span class="dot" data-state="${a.state}" title="${a.label}"></span></button>`).join('')}</div>`}`).join('')}</section>
    <section><div class="side-heading">Available <span>3 idle</span></div><div class="idle-chips">${agents.filter(a => a.state === 'idle').map(a => `<button data-action="member" data-id="${a.id}" title="${a.name} · Idle">${avatar(a)}${a.name}</button>`).join('')}</div></section>
    <section><div class="side-heading">Worktrees <span>6</span></div><div class="segmented" aria-label="Worktree filter">${['Active', 'All'].map(value => `<button data-action="worktrees" data-value="${value}" aria-pressed="${view.worktrees === value}">${value}</button>`).join('')}</div><div class="worktrees">${(view.worktrees === 'Active' ? worktrees.slice(0, 2) : worktrees.slice(view.worktreePage * 3, view.worktreePage * 3 + 3)).map(name => `<button class="worktree" data-action="worktree" data-value="${name}">${icon('branch')}${name}</button>`).join('')}</div>${view.worktrees === 'All' ? `<div class="paging"><button data-action="page" data-value="-1" aria-label="Previous worktree page" ${view.worktreePage === 0 ? 'disabled' : ''}>←</button><span>${view.worktreePage + 1} / 2</span><button data-action="page" data-value="1" aria-label="Next worktree page" ${view.worktreePage === 1 ? 'disabled' : ''}>→</button></div>` : ''}</section>
    <div class="side-footer"><span class="avatar small">N</span><span>Nour<small>Local workspace</small></span></div></aside>`;
}
function command() {
  return `<form class="command" id="command-form"><div class="command-entry">${icon('command')}<input id="command-input" aria-label="Ask or assign work" placeholder="Ask a question, or assign a goal…" autocomplete="off"><kbd>/</kbd></div><div class="command-bottom"><div class="inline"><div class="segmented" aria-label="Command intent">${['Chat', 'New goal'].map(intent => `<button type="button" data-action="intent" data-value="${intent}" aria-pressed="${view.intent === intent}">${intent}</button>`).join('')}</div><div class="menu-wrap"><button type="button" class="route-button" data-action="menu" data-id="route-menu" aria-expanded="false">${icon('route')}<span id="route-label">Send to Grand Orch</span></button><div class="popover" id="route-menu" hidden>${['Auto', 'Grand Orch', 'MonoCode Manager', 'DZDistro Manager'].map(value => `<button type="button" data-action="route" data-value="${value}" aria-pressed="${view.override === value}">${value}</button>`).join('')}</div></div></div><button class="button primary" type="submit">Send ${icon('arrow')}</button></div></form>`;
}
function attention() {
  return `<section class="attention" aria-label="Organization attention"><div class="attention-title"><span class="dot" data-state="needs-you"></span>Needs attention <span class="count">2</span></div><button data-action="approval"><span><strong>Staging smoke check</strong><small>DZDistro Manager · waiting for you</small></span><span class="attention-kind">1 approval ${icon('arrow')}</span></button><button data-action="blocker"><span><strong>Reviewer can’t start</strong><small>MonoCode · storage conflict</small></span><span class="attention-kind">1 blocker ${icon('arrow')}</span></button></section>`;
}
function vitals() {
  return `<section class="vitals" aria-label="Organization vitals"><div class="vital"><strong>2 <small>/ 8 agents</small></strong><span>Active now</span></div><div class="vital"><strong>3</strong><span>Idle & available</span></div><div class="vital"><strong>${view.zero ? 0 : 2}</strong><span>Goals in flight</span></div><div class="vital" title="Requires captured dispatch-to-start boundaries; unknown values are not zero."><strong>—</strong><span>Avg. hand-off</span></div><div class="vital" title="Requires unique session/turn/day accounting. Goal totals can overlap."><strong>—</strong><span>Tokens today</span></div></section>`;
}
function toolbar() {
  return `<div class="toolbar"><div class="filters" aria-label="Project filter">${['All projects', 'MonoCode', 'DZDistro'].map(value => `<button class="filter-chip" data-action="project" data-value="${value}" aria-pressed="${view.project === value}">${value}</button>`).join('')}</div><div class="toolbar-tools"><div class="menu-wrap"><button class="button" data-action="menu" data-id="state-menu" aria-expanded="false">${view.state}</button><div class="popover" id="state-menu" hidden>${['All states', 'Working', 'Needs attention', 'Idle'].map(value => `<button data-action="state" data-value="${value}" aria-pressed="${view.state === value}">${value}</button>`).join('')}</div></div><button class="button" data-action="density" aria-label="Toggle density">${icon('density')}${view.density === 'comfortable' ? 'Comfortable' : 'Compact'}</button></div></div>`;
}
function feed() {
  return `<section class="feed"><div class="section-heading"><h2>Recent activity</h2><span>Today</span></div><button class="feed-item" data-action="merge"> <span class="feed-icon">${icon('merge')}</span><span class="feed-copy">Arabic pricing labels merged <small>DZDistro · PR #1861 · approved by Nour</small></span><time>12 min ago</time></button><button class="feed-item" data-action="member" data-id="designer"><span class="feed-icon">${icon('check')}</span><span class="feed-copy">Designer finished the navigation audit<small>MonoCode · 3 recommendations shared</small></span><time>28 min ago</time></button></section>`;
}
function cockpit() {
  const list = visibleAgents();
  const grand = list.find(a => a.id === 'grand');
  return `${grand ? `<button class="org-lead" data-action="member" data-id="grand" data-roving data-agent="grand"><span class="inline">${avatar(grand)}<span><span class="agent-name">Grand Orch</span><span class="agent-role">Organization lead</span></span><span class="activity-text">Ready for your next goal</span></span>${state(grand)}</button>` : ''}${['MonoCode', 'DZDistro'].map(project => { const group = list.filter(a => a.project === project); return group.length ? `<section class="agent-group"><div class="section-heading"><h2>${project}<span class="sub">${group.length} members</span></h2><span>${project === 'MonoCode' ? '1 blocker' : '1 approval'}</span></div><div class="agent-grid">${group.map(a => memberButton(a)).join('')}</div></section>` : ''; }).join('')}${!list.length ? '<p class="filter-empty">No agents match these filters.</p>' : ''}<section class="flight-strip" aria-label="Goals in flight"><span class="flight-label">In flight · ${visibleGoals().length}</span>${visibleGoals().map(goal => `<button data-action="goal" data-id="${goal.id}" data-roving><strong>${goal.title}</strong>${state(goal)}</button>`).join('')}${!visibleGoals().length ? `<span class="empty-note">${view.zero ? 'No goals in flight. Your team is ready when you are.' : 'No goals match these filters.'}</span>` : ''}</section>${feed()}`;
}
function board() {
  const list = visibleAgents();
  const selected = visibleGoals();
  return `<div class="board-layout"><div>${view.zero ? `<section class="clear-board"><div class="eyebrow">Ready for what’s next</div><h2>The board is clear.</h2><p>Your people, approvals and recent work are still right here.</p><button class="button" data-action="focus-command">${icon('plus')}Assign a goal</button></section>` : ''}<section class="lanes" aria-label="Goal board">${['Planning', 'Working', 'In review', 'Blocked', 'Done today'].map(lane => { const cards = lane === 'Done today' ? (!view.zero && view.state === 'All states' && (view.project === 'All projects' || view.project === 'DZDistro') ? [history] : []) : selected.filter(goal => goal.lane === lane); return `<section class="lane"><h3 class="lane-title"><span class="inline"><span class="dot" data-state="${lane === 'Blocked' ? 'blocked' : lane === 'Working' ? 'thinking' : lane === 'Done today' ? 'done' : 'idle'}"></span>${lane}</span><span class="count">${cards.length}</span></h3>${cards.map(goal => `<button class="goal-card" data-action="${goal.id === 'pricing' ? 'merge' : 'goal'}" data-id="${goal.id}" data-roving><span class="project-tag">${goal.project}</span><strong>${goal.title}</strong>${state(goal)}<span class="goal-meta">${goal.id === 'pricing' ? `<span class="elapsed">12 min ago</span>` : `<span class="avatar-stack">${[byId(goal.manager), ...goal.workers.map(byId)].map(a => avatar(a, true)).join('')}</span><span class="elapsed" title="Goal wall elapsed">${goal.elapsed}</span>`}</span></button>`).join('')}${!cards.length ? `<p class="lane-empty">${view.zero ? 'Ready for new work' : 'No goals here'}</p>` : ''}</section>`; }).join('')}</section>${feed()}</div><aside class="org-rail" aria-label="Live organization"><div class="section-heading"><h2>Your people</h2><span>${list.length} agents</span></div><div class="org-rail-grid">${['Organization', 'MonoCode', 'DZDistro'].map(project => { const group = list.filter(a => a.project === project); return group.length ? `<section class="org-rail-group"><h3>${project}</h3>${group.map(a => memberButton(a, 'rail')).join('')}</section>` : ''; }).join('')}</div>${!list.length ? '<p class="filter-empty">No agents match.</p>' : ''}</aside></div>`;
}
function stream() {
  const list = visibleAgents();
  return `<div class="stream-tabs" aria-label="Stream view">${['Overview', 'Goals', 'Attention', 'Activity'].map(tab => `<button data-action="tab" data-value="${tab}" aria-pressed="${view.tab === tab}">${tab}${tab === 'Goals' ? `<span class="sub count"> ${view.zero ? 0 : 2}</span>` : ''}</button>`).join('')}</div>${!['Activity', 'Attention'].includes(view.tab) ? `<section class="stream-goals"><div class="section-heading"><h2>Live work<span class="sub">${visibleGoals().length} goals</span></h2><button class="filter-chip" data-action="goals">View history →</button></div>${visibleGoals().map(goal => `<button class="goal-row" data-action="goal" data-id="${goal.id}" data-roving><span class="goal-symbol" data-state="${goal.state}">${goal.state === 'blocked' ? '!' : '·'}</span><span><strong>${goal.title}</strong><small>${goal.project} · ${goal.id === 'mc' ? 'Review' : 'Implementation'}</small></span>${state(goal)}<span class="avatar-stack">${[byId(goal.manager), ...goal.workers.map(byId)].map(a => avatar(a, true)).join('')}</span><span class="elapsed" title="Goal wall elapsed">${goal.elapsed}</span></button>`).join('')}${!visibleGoals().length ? `<p class="filter-empty">${view.zero ? 'No live goals. Ask a question or assign the next one above.' : 'No goals match these filters.'}</p>` : ''}</section>` : ''}${view.tab === 'Overview' ? `<section class="stream-roster" aria-label="Live organization"><div class="section-heading"><h2>Live agents</h2><span>${list.length} agents · current turn / attempt time</span></div><div class="roster-header" aria-hidden="true"><span>Member</span><span>State</span><span class="activity-col">Current activity</span><span>Elapsed</span></div>${['Organization', 'MonoCode', 'DZDistro'].map(project => { const group = list.filter(a => a.project === project); return group.length ? `<div class="roster-project">${project}<small>${group.length} ${project === 'Organization' ? 'lead' : 'members'}</small></div>${group.map(a => memberButton(a, 'row')).join('')}` : ''; }).join('')}${!list.length ? '<p class="filter-empty">No agents match these filters.</p>' : ''}</section>` : ''}${view.tab === 'Attention' ? '<section class="stream-attention"><div class="section-heading"><h2>Needs attention</h2><span>2 open</span></div>' + attentionQueue() + '</section>' : view.tab !== 'Goals' ? feed() : ''}`;
}
function render() {
  const draft = document.querySelector('#command-input')?.value || '';
  const focused = document.activeElement;
  const focusAction = focused?.dataset.action;
  const focusValue = focused?.dataset.value;
  const focusId = focused?.dataset.id;
  const [letter, name, tagline] = directions[direction];
  document.querySelector('#app').innerHTML = `<a class="skip" href="#main">Skip to mission control</a><header class="preview-bar"><span class="preview-label">CC7M / DESIGN PREVIEW</span><nav class="preview-directions" aria-label="Design directions">${Object.entries(directions).map(([key, value]) => `<a href="${key}.html?${new URLSearchParams({ theme: document.documentElement.classList.contains('theme-light') ? 'light' : 'dark', goals: view.zero ? 'zero' : 'live' })}" ${key === direction ? 'aria-current="page"' : ''}>${value[0]} · ${value[1]}</a>`).join('')}</nav><div class="preview-controls"><button data-action="scenario" data-value="live" aria-pressed="${!view.zero}">Live goals</button><button data-action="scenario" data-value="zero" aria-pressed="${view.zero}">Zero goals</button><button data-action="theme" aria-label="Toggle light and dark theme">${document.documentElement.classList.contains('theme-light') ? 'Dark' : 'Light'} theme</button></div></header>
    <div class="shell">${sidebar()}<div class="workspace"><header class="topbar"><span class="breadcrumb">Workspace <span>/</span> <strong>Mission control</strong></span><span><span class="live-dot"></span>Updated just now</span></header><main id="main" tabindex="-1"><div class="page-heading"><div><div class="eyebrow">Command center / ${letter}</div><h1>Mission control</h1><p class="heading-note">${tagline}</p></div><button class="button" data-action="goals">Goals <span class="count">${view.zero ? 0 : 2}</span>${icon('arrow')}</button></div>${command()}${attention()}${vitals()}${toolbar()}<div id="direction-content">${({ cockpit, board, stream })[direction]()}</div><footer class="main-footer"><span>Synthetic workspace · ${name} direction</span><span class="keyboard-help"><span><kbd>j</kbd> <kbd>k</kbd> navigate</span><span><kbd>↵</kbd> open</span><span><kbd>esc</kbd> close</span></span></footer></main></div></div>`;
  document.querySelector('#command-input').value = draft;
  updateRoute();
  if (focusAction === 'state' || focusAction === 'route') document.querySelector(`[data-action=menu][data-id="${focusAction}-menu"]`).focus({ preventScroll: true });
  else if (focusAction) [...document.querySelectorAll('[data-action]')].find(el => el.dataset.action === focusAction && el.dataset.value === focusValue && el.dataset.id === focusId)?.focus({ preventScroll: true });
}
function routeTarget() {
  if (view.intent === 'Chat') return 'Grand Orch';
  const text = document.querySelector('#command-input').value.trim();
  if (!text || text.length > 8000) return 'Grand Orch';
  const mentions = ['MonoCode', 'DZDistro'].filter(project => new RegExp(`\\b${project}\\b`, 'i').test(text));
  // shortcut: only two synthetic project names, use the CC5C adapter for real names/paths in phase 2.
  if (mentions.length > 1 || /\b(compar\w*|across|cross[- ]project|versus|vs\.?|both projects)\b/i.test(text)) return 'Grand Orch';
  if (view.override === 'Grand Orch') return 'Grand Orch';
  const project = view.override !== 'Auto' ? view.override.replace(' Manager', '') : view.project !== 'All projects' ? view.project : mentions[0];
  if (mentions.length && project !== mentions[0]) return 'Grand Orch';
  return project ? `${project} Manager` : 'Grand Orch';
}
function updateRoute() {
  const target = routeTarget();
  const label = document.querySelector('#route-label');
  label.textContent = `Send to ${target}`;
  label.parentElement.title = view.intent === 'Chat' ? 'Chat stays with Grand Orch. Select New goal for project routing.' : target === 'Grand Orch' ? 'Grand handles unmatched or cross-project goals.' : `${view.override !== 'Auto' ? 'Explicit preview override' : view.project !== 'All projects' ? 'Selected project' : 'Exact project name'} · synthetic routing preview`;
}
let lastTrigger;
let currentGoal;
let timelineTab = 'Phases';
let ledgerPage = 0;
const phaseDetails = [
  ['Planning', '—', 'Grand Orch · planning boundaries unavailable.'],
  ['Working', '6m 32s', 'Builder · current attempt elapsed. Exact model and tool phases are unavailable.'],
  ['Review', 'Not started', 'Reviewer · queued dispatch review-02. No recorded execution.'],
  ['Waiting', '6m', 'Review outstanding since dispatch. May overlap other work; storage blocker onset is unknown.'],
  ['Compaction', '23s', 'Manager · one captured compaction interval, 09:46:10–09:46:33.'],
];
const ledger = [
  ['09:40', 'Goal assigned', 'Grand Orch', 'Point receipt · goal mc · user-message fixture-origin-01.'],
  ['09:46', 'Compaction', 'Manager', 'Captured start 09:46:10 · end 09:46:33 · duration 23s · turn manager-01.'],
  ['09:57', 'Attempt started', 'Builder', 'Dispatch build-01 · start 09:57:28 · snapshot 10:04:00 · current-attempt elapsed 6m 32s · turn phases unavailable.'],
  ['09:58', 'Review dispatched', 'Reviewer', 'Dispatch review-02 · reviews build-01 · start boundary unavailable · execution unavailable.'],
  ['10:04', 'Storage blocked', 'Reviewer', 'Current snapshot · request storage-01 · onset and duration unavailable.'],
];
const currentPhases = () => currentGoal === 'calendar' ? [
  ['Planning', '—', 'Grand Orch · planning boundaries unavailable.'],
  ['Working', '4m 18s', 'Backend · current attempt elapsed. Exact model and tool phases are unavailable.'],
  ['Review', 'Not started', 'QA · no review attempt dispatched yet.'],
  ['Waiting', '2m', 'Manager approval request age · may overlap Backend work.'],
  ['Compaction', '—', 'No captured compaction boundaries for this goal.'],
] : phaseDetails;
const currentLedger = () => currentGoal === 'calendar' ? [
  ['09:46', 'Goal assigned', 'Grand Orch', 'Point receipt · goal calendar · user-message fixture-origin-02.'],
  ['09:59', 'Attempt started', 'Backend', 'Dispatch calendar-01 · start 09:59:42 · elapsed 4m 18s · exact turn phases unavailable.'],
  ['10:01', 'Boundary traced', 'Backend', 'Recorded task update · dispatch calendar-01 · tenant timezone boundary identified.'],
  ['10:02', 'Approval requested', 'Manager', 'Request approval-01 · Manager conversation · awaits source acknowledgement.'],
  ['10:04', 'Current snapshot', 'Backend', 'Thinking · calendar-01 · no review start or compaction boundary captured.'],
] : ledger;
function timeline() {
  const phaseDetails = currentPhases();
  const ledger = currentLedger();
  return `<section class="timeline-slot" aria-label="Compact delegation timeline"><div class="timeline-heading"><span>Time & progress</span><div class="segmented" aria-label="Timeline view">${['Phases', 'Ledger'].map(value => `<button data-action="timeline-tab" data-value="${value}" aria-pressed="${timelineTab === value}">${value}</button>`).join('')}</div></div>${timelineTab === 'Phases' ? `<div class="phase-strip" aria-label="Phase categories, not additive durations">${phaseDetails.map(([name, time, detail], index) => `<button data-action="phase" data-value="${index}" aria-pressed="${index === 1}" title="${detail}"><span class="phase-line phase-${index}" aria-hidden="true"></span><span>${name}</span><small>${time}</small></button>`).join('')}</div><p class="phase-detail" id="phase-detail">${phaseDetails[1][2]}</p><div class="key-events"><span>Key events</span><button data-action="event" data-value="0" title="${ledger[0][3]}">${ledger[0][0]} Assigned</button><button data-action="event" data-value="3" title="${ledger[3][3]}">${ledger[3][0]} ${currentGoal === 'calendar' ? 'Approval requested' : 'Review queued'}</button></div>` : `<div class="event-ledger"><table><caption>Recorded events · exact actor and dispatch on selection</caption><thead><tr><th>Time</th><th>Event / actor</th></tr></thead><tbody>${ledger.slice(ledgerPage * 4, ledgerPage * 4 + 4).map(([time, name, actor, detail], index) => `<tr><td>${time}</td><td><button data-action="event" data-value="${ledgerPage * 4 + index}" title="${detail}">${name}<small>${actor}</small></button></td></tr>`).join('')}</tbody></table><p class="phase-detail" id="phase-detail">Select an event for its recorded evidence.</p><div class="paging"><button data-action="ledger-page" data-value="-1" aria-label="Previous ledger page" ${ledgerPage === 0 ? 'disabled' : ''}>←</button><span>${ledgerPage + 1} / 2</span><button data-action="ledger-page" data-value="1" aria-label="Next ledger page" ${ledgerPage === 1 ? 'disabled' : ''}>→</button></div></div>`}</section>`;
}
function attentionQueue() {
  const items = [
    { category: 'Blockers', title: 'Reviewer can’t start', project: 'MonoCode', detail: 'Storage conflict · 1 queued review retained', action: 'blocker', state: 'blocked', label: 'Blocked · storage', age: '—', button: 'Open recovery' },
    { category: 'Approvals', title: 'Staging smoke check', project: 'DZDistro', detail: 'Manager request · user-owned approval', action: 'approval', state: 'needs-you', label: 'Needs you · approval', age: '2m', button: 'Review request' },
  ];
  const filtered = items.filter(item => view.attentionFilter === 'Open' || item.category === view.attentionFilter);
  return `<div class="attention-filters" aria-label="Attention category">${['Open', 'Approvals', 'Decisions', 'Blockers', 'Failures', 'History'].map(filter => `<button data-action="attention-filter" data-value="${filter}" aria-pressed="${view.attentionFilter === filter}">${filter}<span class="count">${filter === 'Open' ? 2 : items.filter(i => i.category === filter).length}</span></button>`).join('')}</div><p class="attention-scope">All projects · loaded conversations · blockers first</p><div class="attention-queue queue-${direction}">${filtered.map(item => `<section class="attention-item"><div class="attention-item-heading"><span class="goal-symbol" data-state="${item.state}">!</span><h3>${item.title}</h3><span class="elapsed" title="Recorded request age; unknown stays unavailable">${item.age}</span></div><p>${item.project} · ${item.detail}</p><div class="attention-item-actions">${state(item)}<button class="button" data-action="${item.action}">${item.button} ${icon('arrow')}</button></div></section>`).join('')}${!filtered.length ? `<p class="filter-empty">${view.attentionFilter === 'History' ? 'No acknowledged resolutions in this fixture.' : `No ${view.attentionFilter.toLowerCase()} waiting.`}</p>` : ''}</div>`;
}
function attentionDrawer(trigger) { openDrawer('Organization / Attention', `<h2 id="drawer-title">Needs attention</h2>${attentionQueue()}`, trigger); }
const drawer = document.createElement('dialog');
drawer.id = 'detail-drawer';
drawer.setAttribute('aria-labelledby', 'drawer-title');
document.body.append(drawer);
drawer.addEventListener('close', () => { if (lastTrigger?.isConnected) lastTrigger.focus({ preventScroll: true }); });
drawer.addEventListener('click', event => { if (event.target === drawer && event.clientX < drawer.getBoundingClientRect().left) drawer.close(); });
function openDrawer(label, content, trigger) {
  if (!drawer.open) lastTrigger = trigger || document.activeElement;
  drawer.innerHTML = `<div class="drawer-header"><span>${label}</span><button data-action="close" aria-label="Close detail drawer">${icon('close')}</button></div><div class="drawer-content">${content}<p class="drawer-caption">Design preview · actions stay in this synthetic workspace.</p></div>`;
  if (!drawer.open) drawer.showModal();
  else drawer.querySelector('[data-action=close]').focus();
}
function goalDrawer(id, trigger) {
  const goal = goals.find(g => g.id === id);
  currentGoal = id;
  timelineTab = 'Phases';
  ledgerPage = 0;
  const chain = [byId('grand'), byId(goal.manager), ...goal.workers.map(byId)];
  openDrawer(`${goal.project} / Goal`, `<div class="eyebrow">${goal.project}</div><h2 id="drawer-title">${goal.title}</h2><div class="drawer-meta">${state(goal)}<span class="elapsed" title="Goal wall elapsed">${goal.elapsed} wall elapsed</span></div><p class="activity-text">${goal.note}</p><div class="drawer-subtitle"><span>Delegation chain</span><span>Current assignments</span></div><div class="chain">${chain.map((a, index) => `<button class="chain-node ${index > 1 ? 'worker' : ''}" data-action="member" data-id="${a.id}">${avatar(a)}<span class="node-copy"><span class="agent-name">${index === 1 ? `${a.project} Manager` : a.name}</span><small>${index === 0 ? 'Goal origin' : index === 1 ? 'Delegated by Grand Orch' : `Assigned by ${a.project} Manager`}</small>${state(a)}</span><span class="elapsed" title="${a.scope}">${a.elapsed}</span></button>`).join('')}</div><div class="drawer-subtitle"><span>Timeline preview</span><span>Observed evidence</span></div><div id="timeline-content">${timeline()}</div><div class="drawer-actions"><button class="button primary" data-action="member" data-id="${goal.manager}">Message Manager</button><button class="button" data-action="member" data-id="${goal.workers[0]}">Open member</button><button class="button" data-action="${goal.id === 'mc' ? 'blocker' : 'approval'}">Resolve ${goal.id === 'mc' ? 'blocker' : 'approval'}</button></div>`, trigger);
}
function memberDrawer(id, trigger) {
  const a = byId(id);
  openDrawer(`${a.project} / Member`, `<div class="inline">${avatar(a)}<div><div class="eyebrow">${a.project}</div><h2 id="drawer-title">${a.name}</h2></div></div><div class="drawer-meta">${state(a)}<span class="elapsed" title="${a.scope}">${a.elapsed} · ${a.scope.toLowerCase()}</span></div><p class="activity-text">${a.activity}</p>${a.id === 'reviewer' ? '<div class="drawer-callout"><h3>Storage needs recovery</h3><p>The review is retained in the queue. A retry alone does not repair storage.</p><button class="button" data-action="blocker">Open recovery context</button></div>' : ''}<form class="message-box" id="message-form"><label for="member-message">Message ${a.project === 'Organization' ? '' : a.project + ' '}${a.name}</label><textarea id="member-message" required placeholder="Add context or steer this assignment…"></textarea><button type="submit" class="button primary">Send message ${icon('arrow')}</button></form>${currentGoal && !view.zero ? `<div class="drawer-actions"><button class="button" data-action="goal" data-id="${currentGoal}">← Back to goal</button></div>` : ''}`, trigger);
}
function issueDrawer(kind, trigger) {
  const approval = kind === 'approval';
  openDrawer(approval ? 'DZDistro / Approval' : 'MonoCode / Recovery', `<div class="eyebrow">${approval ? 'Waiting for you' : 'Blocked · storage'}</div><h2 id="drawer-title">${approval ? 'Run the staging smoke check?' : 'Help Reviewer start'}</h2><div class="drawer-callout"><h3>${approval ? 'DZDistro Manager requests approval' : 'Queued review · storage conflict'}</h3><p class="attention-scope">${approval ? 'Request approval-01 · Manager conversation' : 'Account fixture-01 · dispatch review-02'}</p><p>${approval ? 'Use the isolated staging fixture to verify tenant calendar boundaries. No production changes or merge.' : 'The queued review and implementation are retained. Open the recovery flow to inspect the storage conflict before retrying.'}</p><div class="drawer-actions">${approval ? '<button class="button primary" data-action="preview" data-value="Approval response">Approve</button><button class="button" data-action="preview" data-value="Decline response">Decline</button>' : '<button class="button primary" data-action="preview" data-value="Storage recovery">Open recovery</button>'}<button class="button" data-action="member" data-id="${approval ? 'dz-manager' : 'reviewer'}">Open ${approval ? 'Manager' : 'Reviewer'}</button></div></div>`, trigger);
}
function goalsDrawer(trigger) {
  openDrawer('Organization / Goals', `<h2 id="drawer-title">Goals</h2><div class="drawer-subtitle"><span>In flight</span><span>${view.zero ? 0 : 2}</span></div>${(view.zero ? [] : goals).map(g => `<button class="goal-row" style="grid-template-columns:15px 1fr 52px" data-action="goal" data-id="${g.id}"><span class="goal-symbol" data-state="${g.state}">·</span><span><strong>${g.title}</strong><small>${g.project} · ${g.label}</small></span><span class="elapsed">${g.elapsed}</span></button>`).join('')}${view.zero ? '<p class="filter-empty">No goals in flight. The team is ready for your next assignment.</p>' : ''}<div class="drawer-subtitle"><span>Recent history</span><span>Page 1 / 1</span></div><button class="feed-item" data-action="merge"><span class="feed-icon">${icon('merge')}</span><span class="feed-copy">${history.title}<small>DZDistro · Merged PR #1861 · today</small></span></button>`, trigger);
}
function toast(message) {
  let element = document.querySelector('.toast');
  if (!element) { element = document.createElement('div'); element.className = 'toast'; element.setAttribute('role', 'status'); document.body.append(element); }
  element.textContent = message;
  clearTimeout(toast.timeout);
  toast.timeout = setTimeout(() => element.remove(), 4500);
}
document.addEventListener('input', event => { if (event.target.id === 'command-input') updateRoute(); });
document.addEventListener('submit', event => {
  event.preventDefault();
  if (event.target.id === 'command-form') {
    const input = document.querySelector('#command-input');
    if (!input.value.trim()) { input.focus(); return; }
    toast(`Preview: ${view.intent.toLowerCase()} addressed to ${routeTarget()}. Nothing sent.`);
  } else if (event.target.id === 'message-form') toast('Message preview ready. Nothing sent.');
});
document.addEventListener('click', event => {
  const button = event.target.closest('[data-action]');
  if (!button) { document.querySelectorAll('.popover').forEach(menu => menu.hidden = true); document.querySelectorAll('[aria-expanded]').forEach(el => el.setAttribute('aria-expanded', 'false')); return; }
  const { action, value, id } = button.dataset;
  if (action !== 'menu') { document.querySelectorAll('.popover').forEach(menu => menu.hidden = true); document.querySelectorAll('[aria-expanded]').forEach(el => el.setAttribute('aria-expanded', 'false')); }
  if (action === 'menu') { const menu = document.getElementById(id); const open = menu.hidden; document.querySelectorAll('.popover').forEach(el => el.hidden = true); document.querySelectorAll('[aria-expanded]').forEach(el => el.setAttribute('aria-expanded', 'false')); menu.hidden = !open; button.setAttribute('aria-expanded', String(open)); if (open) menu.querySelector('button').focus(); }
  else if (action === 'member') memberDrawer(id, button);
  else if (action === 'goal') goalDrawer(id, button);
  else if (action === 'goals') goalsDrawer(button);
  else if (action === 'approval' || action === 'blocker') issueDrawer(action, button);
  else if (action === 'close') drawer.close();
  else if (action === 'preview') toast(`${value} preview opened. Nothing sent or changed.`);
  else if (action === 'merge') openDrawer('DZDistro / Recent merge', `<div class="eyebrow">Verified synthetic outcome</div><h2 id="drawer-title">${history.title}</h2><div class="drawer-meta">${state(history)}</div><p class="activity-text">PR #1861 · Human approval recorded · Merged 12 minutes ago.</p><div class="drawer-actions"><button class="button" data-action="member" data-id="dz-manager">Open Manager</button></div>`, button);
  else if (action === 'worktree') openDrawer('Workspace / Worktree', `<div class="eyebrow">Synthetic worktree</div><h2 id="drawer-title">${value}</h2><p class="heading-note">${worktrees.indexOf(value) < 2 ? 'Active assignment' : 'Retained history'} · branch and sessions preserved</p><div class="drawer-actions"><button class="button" data-action="member" data-id="${value === 'tenant-calendar' ? 'dz-manager' : 'mono-manager'}">Open Manager</button></div>`, button);
  else if (action === 'team') openDrawer('Organization / Team', `<h2 id="drawer-title">Your people</h2><div class="drawer-subtitle"><span>All projects</span><span>8 agents</span></div><div>${agents.map(a => memberButton(a, 'rail')).join('')}</div>`, button);
  else if (action === 'attention') attentionDrawer(button);
  else if (action === 'attention-filter') { view.attentionFilter = value; if (drawer.open) attentionDrawer(); else render(); document.querySelector(`${drawer.open ? '#detail-drawer' : '#main'} [data-action=attention-filter][data-value="${value}"]`).focus(); }
  else if (action === 'timeline-tab' || action === 'ledger-page') { if (action === 'timeline-tab') timelineTab = value; else ledgerPage += Number(value); document.querySelector('#timeline-content').innerHTML = timeline(); document.querySelector(`[data-action=timeline-tab][data-value="${timelineTab}"]`).focus({ preventScroll: true }); }
  else if (action === 'phase' || action === 'event') { const ledger = currentLedger(); document.querySelector('#phase-detail').textContent = action === 'phase' ? currentPhases()[Number(value)][2] : `${ledger[Number(value)][2]} · ${ledger[Number(value)][3]}`; document.querySelectorAll('[data-action=phase]').forEach(el => el.setAttribute('aria-pressed', String(action === 'phase' && el === button))); }
  else if (action === 'focus-command') { view.intent = 'New goal'; render(); document.querySelector('#command-input').focus(); }
  else {
    if (action === 'project') view.project = value;
    if (action === 'state') view.state = value;
    if (action === 'intent') view.intent = value;
    if (action === 'route') view.override = value;
    if (action === 'tab') view.tab = value;
    if (action === 'density') { view.density = view.density === 'comfortable' ? 'compact' : 'comfortable'; document.body.dataset.density = view.density; }
    if (action === 'scenario') { view.zero = value === 'zero'; currentGoal = undefined; }
    if (action === 'worktrees') { view.worktrees = value; view.worktreePage = 0; }
    if (action === 'page') view.worktreePage += Number(value);
    if (action === 'theme') document.documentElement.classList.toggle('theme-light');
    if (action === 'home') { view.project = 'All projects'; view.state = 'All states'; view.tab = 'Overview'; }
    render();
  }
});
document.addEventListener('keydown', event => {
  const editing = event.target.matches('input, textarea, [contenteditable=true]');
  if (event.key === 'Escape') { const menu = document.querySelector('.popover:not([hidden])'); if (menu) { event.preventDefault(); const trigger = document.querySelector(`[data-action=menu][data-id="${menu.id}"]`); menu.hidden = true; trigger.setAttribute('aria-expanded', 'false'); trigger.focus(); } return; }
  if (drawer.open || editing || event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.key === '/') { event.preventDefault(); document.querySelector('#command-input').focus(); }
  if (event.key === 'j' || event.key === 'k') {
    event.preventDefault();
    const rows = [...document.querySelectorAll('#direction-content [data-roving]')];
    const index = rows.indexOf(document.activeElement);
    rows[(index + (event.key === 'j' ? 1 : -1) + rows.length) % rows.length]?.focus();
  }
});
render();
