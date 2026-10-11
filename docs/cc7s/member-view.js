/* Synthetic design preview. No persistence, app imports, provider calls or operational actions. */
const direction = document.body.dataset.direction;
const params = new URLSearchParams(location.search);
const view = {
  member: ['reviewer', 'native', 'session'].includes(params.get('member')) ? params.get('member') : 'reviewer',
  scenario: ['zero', 'loading', 'error'].includes(params.get('state')) ? params.get('state') : 'live',
  tasks: 'Current', tab: 'Conversation', worktrees: 'Active', page: 0, earlier: false,
};
const drafts = new Map();
let renderedMember;
document.documentElement.classList.toggle('theme-light', params.get('theme') === 'light');
const members = {
  reviewer: { name: 'Reviewer', role: 'Quality & safety', initials: 'RE', color: 'amber', state: 'failed', label: 'Failed · review couldn’t start', metrics: 'Last conversation turn · 1m 37s · 326k in · 2.3k out', title: 'Review native window activation', note: 'Check the restore and focus changes against the acceptance brief.', branch: 'cc7-native-review', tokens: ['326,569', '289,408', '2,318'], elapsed: '1m 37s', scope: 'Last completed conversation turn. The new review did not start.' },
  native: { name: 'Native Core', role: 'Windows engineering', initials: 'NC', color: 'green', state: 'waiting-on-member', label: 'Waiting · Reviewer failed', metrics: 'Completed attempt · 12m 08s · 84k in · 3.8k out', title: 'Restore and focus the native window', note: 'Implementation is ready. Independent review is waiting on storage recovery.', branch: 'cc7-native-focus', tokens: ['84,210', '71,006', '3,812'], elapsed: '12m 08s', scope: 'Completed implementation attempt; excludes review wait. No current turn.' },
  session: { name: 'Window activation review', role: 'Saved session · Reviewer', initials: 'RE', color: 'amber', state: 'failed', label: 'Failed · conversation couldn’t launch', metrics: 'Last conversation turn · 1m 37s · 326k in · 2.3k out', title: 'Review native window activation', note: 'Check the restore and focus changes against the acceptance brief.', branch: 'cc7-native-review', tokens: ['326,569', '289,408', '2,318'], elapsed: '1m 37s', scope: 'Last completed conversation turn. The new review did not start.' },
};
const worktrees = [
  { title: 'Window activation', full: 'Review native window restoration, foreground focus and browser activation', member: 'Reviewer', state: 'failed', label: 'Launch failed', branch: 'cc7-native-review', active: true },
  { title: 'Native window focus', full: 'Restore and focus the native Windows window without changing browser routing', member: 'Native Core', state: 'waiting-on-member', label: 'Waiting for review', branch: 'cc7-native-focus', active: true },
  { title: 'Conversation cards', full: 'Render tool results as compact one-line cards in the conversation', member: 'Frontend', state: 'running-tool', label: 'Working', branch: 'cc7-tool-cards', active: true },
  { title: 'Sidebar layout', full: 'Keep task badges and member chips inside narrow sidebar rows', member: 'Frontend', state: 'done', label: 'Completed', branch: 'cc7-sidebar-layout', active: false },
  { title: 'Routing edge cases', full: 'Investigate cross-project routing ambiguity in saved conversations', member: 'Reviewer', state: 'done', label: 'Completed', branch: 'cc7-routing-review', active: false },
  { title: 'Alternate focus path', full: 'Explore an alternate Windows foreground activation path', member: 'Native Core', state: 'cancelled', label: 'Cancelled', branch: 'cc7-focus-exploration', active: false },
];
const icons = {
  logo: '<path d="M3 13V5h5v8h5V5h5v8"/>', grid: '<rect x="3" y="3" width="6" height="6" rx="1"/><rect x="13" y="3" width="6" height="6" rx="1"/><rect x="3" y="13" width="6" height="6" rx="1"/><rect x="13" y="13" width="6" height="6" rx="1"/>',
  team: '<circle cx="8" cy="7" r="3"/><path d="M2 19v-2a6 6 0 0 1 12 0v2M15 4a3 3 0 0 1 0 6M18 19v-2a6 6 0 0 0-3-5"/>',
  branch: '<circle cx="6" cy="4" r="2"/><circle cx="16" cy="6" r="2"/><circle cx="6" cy="18" r="2"/><path d="M6 6v10M16 8c0 5-10 3-10 7"/>',
  arrow: '<path d="M4 11h14M13 6l5 5-5 5"/>', close: '<path d="m5 5 12 12M17 5 5 17"/>',
  chat: '<path d="M4 4h14v11H9l-5 4V4Z"/><path d="M8 8h6M8 11h4"/>', check: '<path d="m4 11 5 5 10-10"/>',
  command: '<rect x="3" y="4" width="16" height="14" rx="3"/><path d="m7 8 3 3-3 3M13 14h2"/>',
};
const icon = name => `<svg viewBox="0 0 22 22" aria-hidden="true">${icons[name]}</svg>`;
const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const current = () => members[view.member];
const author = () => view.member === 'native' ? 'Native Core' : 'Reviewer';
const avatar = member => `<span class="avatar ${member.color || ''}" aria-hidden="true">${member.initials}</span>`;
const state = (kind, label) => `<span class="state" data-state="${kind}"><span class="dot" aria-hidden="true"></span>${label}</span>`;
const button = (action, label, className = 'button', extra = '') => `<button type="button" class="${className}" data-action="${action}" ${extra}>${label}</button>`;
const segments = (action, values, selected, label) => `<div class="segmented" role="group" aria-label="${label}">${values.map(value => button(action, value, '', `data-value="${value}" aria-pressed="${selected === value}"`)).join('')}</div>`;
const rawError = 'Codex launch failed: conversation store could not be opened.\nSQLite error: database is locked (SQLITE_BUSY).\nReview attempt: not started.';
const tasks = () => [
  { id: 'current', title: current().title, state: current().state, label: view.member === 'native' ? 'Waiting for review' : 'Launch failed', note: current().note, time: 'Today · 10:42', meta: view.member === 'native' ? 'Review pending' : 'Attempt not started', current: true },
  { id: 'history-done', title: 'Check worktree menu behavior', state: 'done', label: 'Completed', note: 'Review delivered. Keyboard and pointer behavior checked.', time: 'Today · 09:18', meta: 'Review delivered', current: false },
  { id: 'history-cancelled', title: 'Explore alternate focus routing', state: 'cancelled', label: 'Cancelled', note: 'Manager stopped this exploration before implementation.', time: 'Yesterday', meta: 'Stopped by Manager', current: false },
];
function previewBar() {
  const suffix = `?theme=${document.documentElement.classList.contains('theme-light') ? 'light' : 'dark'}&member=${view.member}&state=${view.scenario}`;
  return `<div class="preview-bar"><span class="preview-label">CC7S / SYNTHETIC DESIGN</span><nav class="preview-directions" aria-label="Design directions"><a href="workbench.html${suffix}" ${direction === 'workbench' ? 'aria-current="page"' : ''}>A · Workbench</a><a href="conversation.html${suffix}" ${direction === 'conversation' ? 'aria-current="page"' : ''}>B · Conversation</a></nav><div class="preview-controls"><label>View <select id="preview-member" aria-label="Preview member">${[['reviewer', 'Reviewer'], ['native', 'Native Core'], ['session', 'Session']].map(([value, label]) => `<option value="${value}" ${view.member === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label><label>State <select id="preview-state" aria-label="Preview state">${[['live', 'Populated'], ['zero', 'Zero'], ['loading', 'Loading'], ['error', 'Load error']].map(([value, label]) => `<option value="${value}" ${view.scenario === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label>${button('theme', document.documentElement.classList.contains('theme-light') ? 'Dark theme' : 'Light theme', '')}</div></div>`;
}
function sidebar() {
  const rows = view.scenario === 'zero' ? [] : worktrees.filter(row => view.worktrees === 'All' || row.active);
  const pages = Math.max(1, Math.ceil(rows.length / 3));
  view.page = Math.min(view.page, pages - 1);
  const populated = view.scenario === 'live';
  const grandContext = populated ? 'Grand Orch · Failed launch in browser-link-4 · 1 member working below' : view.scenario === 'zero' ? 'Grand Orch · Available' : 'Grand Orch · State unavailable';
  return `<aside class="sidebar" aria-label="Workspace navigation"><div class="brand"><span class="brand-mark">${icon('logo')}</span>MonoCode</div><nav class="nav" aria-label="Workspace">${button('mission', `${icon('grid')}Mission control`, '')}${button('team', `${icon('team')}Team <span class="count">6</span>`, '', 'aria-current="page"')}</nav><div class="grand-row" tabindex="0" aria-describedby="grand-context" data-context="${grandContext}"><span class="avatar">GO</span><div><span class="grand-name">GRAND ORCH</span>${state(populated ? 'failed' : 'idle', populated ? 'Failed launch' : view.scenario === 'zero' ? 'Available' : 'Unavailable')}</div><span class="grand-detail" id="grand-context" role="tooltip">${grandContext}</span></div><section><div class="side-heading"><span>Browser Link</span><span>3 members</span></div><div class="side-members">${[
    { id: 'manager', name: 'Manager', initials: 'BM', color: 'blue', state: 'waiting-on-member', reason: 'Waiting for review' },
    { id: 'native', ...members.native, reason: 'Waiting for review' },
    { id: 'reviewer', ...members.reviewer, reason: 'Failed launch' },
  ].map(member => button('member', `${avatar(member)}<span class="member-copy">${member.name}<small>${populated ? member.reason : view.scenario === 'zero' ? 'Available' : 'Unavailable'}</small></span><span class="dot" data-state="${populated ? member.state : 'idle'}" aria-hidden="true"></span>`, 'side-member', `data-value="${member.id}" ${view.member === member.id || view.member === 'session' && member.id === 'reviewer' ? 'aria-current="page"' : ''}`)).join('')}</div><div class="side-heading"><span>Available</span><span>2</span></div><div class="idle-chips">${button('available', '<span class="avatar">DE</span>Designer', '')}${button('available', '<span class="avatar">QA</span>QA', '')}</div></section><section aria-label="Task worktrees"><div class="side-heading"><span>Task worktrees</span><span>${view.scenario === 'zero' ? '0' : populated ? '3 active' : 'Unavailable'}</span></div>${segments('worktrees', ['Active', 'All'], view.worktrees, 'Worktree filter')}<div class="worktrees">${view.scenario === 'loading' ? '<div class="loading-work" role="status"><p>Loading worktrees…</p><div class="skeleton"></div><div class="skeleton short"></div></div>' : view.scenario === 'error' ? `<div class="empty-note">Worktrees unavailable.${button('retry', 'Retry', 'text-button')}</div>` : rows.length ? rows.slice(view.page * 3, view.page * 3 + 3).map(row => button('worktree-row', `<span class="dot" data-state="${row.state}" aria-hidden="true"></span><span><strong>${row.title}</strong><small><span class="member-chip">${row.member}</span>${row.label}</small></span>`, 'task-worktree', `data-value="${row.branch}" title="${row.full} · ${row.branch}" aria-label="${row.full}, ${row.member}, ${row.label}"`)).join('') : '<p class="empty-note">No task worktrees yet.</p>'}</div>${populated && rows.length ? `<div class="paging"><span>${view.page * 3 + 1}–${Math.min(rows.length, view.page * 3 + 3)} of ${rows.length}</span><span>${button('page', '←', '', `data-value="-1" aria-label="Previous worktree page" ${view.page === 0 ? 'disabled' : ''}`)}${button('page', '→', '', `data-value="1" aria-label="Next worktree page" ${view.page === pages - 1 ? 'disabled' : ''}`)}</span></div>` : ''}</section><div class="side-footer"><span class="avatar small">N</span><span>Nour<small>Local workspace</small></span></div></aside>`;
}
function priority() {
  if (view.member === 'native') return `<section class="priority" data-kind="waiting" aria-label="Review dependency"><div><span class="priority-label"><span class="dot"></span>Waiting for review</span><h2>Ready for a second pair of eyes</h2></div><p>The changes are saved. Reviewer’s storage error is holding the next step.</p><div class="priority-actions">${button('open-reviewer', 'Open Reviewer')}${button('details', 'View hand-off', 'text-button')}</div></section>`;
  return `<section class="priority" aria-label="Storage launch blocker"><div><span class="priority-label"><span class="dot" data-state="failed"></span>Needs attention · storage</span><h2>Reviewer couldn’t start</h2></div><p>Codex couldn’t open its conversation store. The review has not started; your messages are still here.</p><div class="priority-actions">${button('recovery', 'Resolve storage', 'button primary')}${button('error-details', 'Error details', 'text-button')}</div></section>`;
}
function workPanel() {
  const region = direction === 'workbench' ? 'role="region" tabindex="0"' : '';
  if (view.scenario === 'loading') return `<section class="work-panel" aria-label="Assignments" ${region}><div class="loading-work" role="status"><p>Loading assignments…</p><div class="skeleton"></div><div class="skeleton short"></div><div class="skeleton"></div></div></section>`;
  if (view.scenario === 'error') return `<section class="work-panel" aria-label="Assignments" ${region}><div class="empty-state" role="status">${icon('branch')}<h2>Work couldn’t be loaded</h2><p>Assignment status is unavailable. Try again to get the latest saved work.</p>${button('retry', 'Retry loading')}</div></section>`;
  const selected = view.scenario === 'zero' ? [] : tasks().filter(task => view.tasks === 'All' || task.current === (view.tasks === 'Current'));
  return `<section class="work-panel" aria-label="Assignments" ${region}><div class="work-caption"><span>Work</span><span>Browser Link</span></div>${view.scenario === 'zero' ? '' : priority()}<section class="task-section"><div class="section-heading"><h2>Assignments</h2><span>${view.scenario === 'zero' ? '0' : '1 current · 2 past'}</span></div>${segments('tasks', ['Current', 'History', 'All'], view.tasks, 'Assignment filter')}<div class="task-list">${selected.length ? selected.map(task => button('task', `<span class="task-label"><span>${task.current ? 'Current assignment' : task.time}</span>${state(task.state, task.label)}</span><strong>${task.title}</strong><p>${task.note}</p><span class="task-meta"><span>${task.meta}</span><span>Details →</span></span>`, 'task-card', `data-value="${task.id}"`)).join('') : `<div class="empty-state">${icon('branch')}<h2>No assignments yet</h2><p>This member is available. Send a message to get started.</p>${button('message', 'Message member')}</div>`}</div></section>${view.scenario === 'zero' ? '' : `<div class="handoff-note"><div class="inline">${icon('team')}From Manager</div><p>${view.member === 'native' ? 'Hold the current branch for review. No merge is scheduled.' : 'Review the saved change when storage is available. No merge or live run is requested.'}</p>${button('team-message', 'Read team message →', 'text-button')}</div>`}</section>`;
}
function message(kind, sender, time, copy) {
  return `<article class="message ${kind}"><div class="message-meta"><strong>${sender}</strong>${kind === 'team' ? '<span>Team message</span>' : ''}<time>${time}</time></div>${copy}</article>`;
}
function conversation() {
  if (view.scenario === 'zero') return `<div class="empty-state">${icon('chat')}<h2>A clear place to start</h2><p>Messages, tool results and team updates will appear here.</p>${button('message', 'Write a message')}</div>`;
  if (view.scenario === 'loading') return '<div role="status" aria-busy="true"><p class="heading-note">Loading conversation…</p><div class="skeleton short"></div><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton short"></div></div>';
  if (view.scenario === 'error') return `<div class="empty-state" role="status">${icon('chat')}<h2>Conversation unavailable</h2><p>We couldn’t read the saved messages. Your draft stays in the composer.</p>${button('retry', 'Retry loading')}</div>`;
  if (view.tab === 'Activity') return `<ol class="activity-list"><li><time>10:42</time><span>${view.member === 'native' ? 'Implementation handed to Reviewer' : 'Review launch failed'}<small>${view.member === 'native' ? 'Waiting on independent review; no merge implied.' : 'Storage could not be opened. Attempt did not start.'}</small></span></li><li><time>10:40</time><span>Manager sent review brief<small>Current assignment · Browser Link</small></span></li><li><time>10:38</time><span>Native Core completed implementation<small>Saved branch · cc7-native-focus</small></span></li><li><time>09:18</time><span>Previous review delivered<small>Check worktree menu behavior</small></span></li><li><time>Yesterday</time><span>Exploration cancelled<small>Stopped by Manager before implementation</small></span></li></ol>`;
  const previous = view.earlier ? Array.from({ length: 6 }, (_, index) => message('user', 'Nour', `09:${20 + index * 2}`, '<p>Keep the foreground activation behavior consistent with the selected browser and preserve the existing review boundary.</p>') + message('', author(), `09:${21 + index * 2}`, '<p>I’ve recorded the current behavior and the acceptance steps. The saved changes will be checked before any integration action.</p>')).join('') : button('earlier', 'Show 12 earlier messages', 'earlier');
  const native = view.member === 'native';
  return `${previous}<div class="date-divider">Today · ${native ? 'Implementation hand-off' : 'Review conversation'}</div>${message('user', 'Nour', '10:31', '<p>Check restore and foreground focus. Keep the review tied to the saved change, and show me what still needs a real Windows check.</p>')}${message('', author(), '10:32', '<p>I’ll check the window lifecycle, then follow the activation route into the selected browser. I’ll keep source evidence and live acceptance separate.</p>')}${button('tool', `${icon('check')}<span class="tool-summary"><strong>Read files</strong> · window lifecycle and routing · 3 files</span><time>0.8s</time>`, 'tool-card', 'data-value="read"')}${message('team', 'Manager', '10:40', `<p>${native ? 'Please hold cc7-native-focus for independent review. Reviewer’s launch is blocked by storage; your implementation is retained.' : 'Native Core is ready on cc7-native-focus. Review the saved changes after storage recovery. No merge or live model turn is requested.'}</p>`)}${button('tool', `${icon('check')}<span class="tool-summary"><strong>Run checks</strong> · ${native ? '18 native checks passed' : '24 routing checks passed'}</span><time>3.2s</time>`, 'tool-card', 'data-value="checks"')}${message('', author(), '10:41', `<p>${native ? 'The implementation checks pass. I’ve handed the change to Reviewer and am waiting for the independent verdict.' : 'The earlier conversation is saved. The new review attempt has not started because Codex couldn’t open storage.'}</p>`)}<div class="transcript-status" data-state="${current().state}"><span class="dot" aria-hidden="true"></span><span>${native ? 'Waiting for Reviewer · no turn running' : 'Launch failed · no turn running'}</span></div>`;
}
function composer() {
  const disabled = view.scenario === 'loading' || view.scenario === 'error';
  return `<form class="composer" id="composer"><label for="message-input">Message ${view.member === 'session' ? 'this session' : current().name}</label><textarea id="message-input" aria-label="Message draft" placeholder="Ask a question or guide the next step…"></textarea><div class="composer-footer"><div class="composer-controls"><select aria-label="Model" id="composer-model"><option>GPT-5.4</option><option>GPT-5.3 Codex</option></select><select aria-label="Reasoning effort" id="composer-effort"><option>High effort</option><option>Medium effort</option><option>Low effort</option></select><select aria-label="Access" id="composer-access"><option>Auto access</option><option>Read only</option><option>Full access</option></select></div><button class="button primary" type="submit" ${disabled ? 'disabled' : ''}>${view.scenario === 'live' && view.member !== 'native' ? 'Queue' : 'Send'} ${icon('arrow')}</button></div><p class="delivery-note">${disabled ? 'Delivery unavailable while saved state is unreadable. Your draft is kept.' : view.scenario === 'zero' || view.member === 'native' ? 'A message starts a new conversation turn. Model and access apply on the next turn.' : 'Queues until storage is resolved. Model and access apply on the next turn.'}</p></form>`;
}
function render() {
  const memberChanged = renderedMember !== view.member;
  if (renderedMember) drafts.set(renderedMember, document.getElementById('message-input')?.value || '');
  const draft = drafts.get(view.member) || '';
  renderedMember = view.member;
  const controls = ['composer-model', 'composer-effort', 'composer-access'].map(id => [id, document.getElementById(id)?.value]);
  const transcriptScroll = document.getElementById('transcript')?.scrollTop || 0;
  const member = current();
  const unknown = view.scenario === 'loading' || view.scenario === 'error';
  document.getElementById('app').innerHTML = `<a class="skip" href="#main">Skip to member view</a>${previewBar()}<div class="shell">${sidebar()}<div class="workspace"><div class="topbar"><div class="breadcrumb"><span>Browser Link</span><span>/</span><strong>${view.member === 'session' ? 'Session' : 'Member'}</strong></div><span>${view.scenario === 'loading' ? 'Loading saved state' : view.scenario === 'error' ? 'Saved state unavailable' : 'Synthetic workspace · saved just now'}</span></div><main id="main" tabindex="-1"><header class="member-header"><div class="member-identity">${avatar(member)}<div><h1>${member.name}<span class="member-role">${member.role}</span></h1>${state(unknown ? 'idle' : view.scenario === 'zero' ? 'idle' : member.state, unknown ? 'State unavailable' : view.scenario === 'zero' ? 'Available · no assignment' : member.label)}<p class="member-metrics">${unknown ? 'Timing and tokens unavailable' : view.scenario === 'zero' ? 'No conversation turn recorded' : member.metrics}</p></div></div><div class="header-actions">${button('message', `${icon('chat')}Message`)}${button('steer', 'Steer')}${button('worktree', `${icon('branch')}Open worktree`)}${button('details', 'Details', 'text-button')}</div></header><div class="member-body">${workPanel()}<section class="conversation-panel" aria-label="Member conversation"><div class="conversation-head"><div class="conversation-tabs" role="group" aria-label="Conversation view">${['Conversation', 'Activity'].map(tab => button('tab', tab, '', `data-value="${tab}" aria-pressed="${view.tab === tab}"`)).join('')}</div>${button('session', 'Session details', 'text-button')}</div><div class="transcript" id="transcript" tabindex="0" role="region" aria-label="${view.tab}">${conversation()}</div>${composer()}</section></div></main></div></div><dialog id="detail-drawer" aria-labelledby="drawer-title"><div class="drawer-header"><span id="drawer-kind">Details</span>${button('close', icon('close'), '', 'aria-label="Close details"')}</div><div class="drawer-content" id="drawer-content"></div></dialog><div id="toast" class="toast" role="status" hidden></div>`;
  document.querySelector('[data-action=steer]').disabled = view.scenario !== 'live';
  document.querySelector('[data-action=worktree]').disabled = view.scenario !== 'live';
  document.getElementById('message-input').value = draft;
  for (const [id, value] of controls) if (value) document.getElementById(id).value = value;
  const transcript = document.getElementById('transcript');
  transcript.scrollTop = memberChanged ? transcript.scrollHeight : transcriptScroll;
}
let opener;
function openDrawer(kind, title, content) {
  opener = document.activeElement;
  document.getElementById('drawer-kind').textContent = kind;
  document.getElementById('drawer-content').innerHTML = `<h2 id="drawer-title">${title}</h2>${content}<p class="drawer-caption">Synthetic design preview. Actions stay local; nothing is sent or changed.</p>`;
  document.getElementById('detail-drawer').showModal();
}
function facts(rows) { return `<dl class="facts">${rows.map(([key, value]) => `<div><dt>${key}</dt><dd>${value}</dd></div>`).join('')}</dl>`; }
function toast(copy) { const el = document.getElementById('toast'); el.textContent = copy; el.hidden = false; }
function details() {
  const member = current();
  const hasSample = view.scenario === 'live';
  openDrawer('Member / session details', member.name, `<p>${hasSample ? member.scope : 'No metric sample available for this preview state.'}</p>${facts([['State', hasSample ? member.label : view.scenario === 'zero' ? 'Available' : 'Unavailable'], ['Timing scope', hasSample ? member.elapsed : 'Not recorded'], ['Input tokens', hasSample ? member.tokens[0] : 'Unavailable'], ['Cached input · included above', hasSample ? member.tokens[1] : 'Unavailable'], ['Output tokens', hasSample ? member.tokens[2] : 'Unavailable']])}<h3>Working copy</h3><pre>${member.branch}\nC:/Synthetic/BrowserLink/${member.branch}</pre><p>Review status is separate from implementation completion. A completed check does not prove native focus or browser activation.</p>`);
}
document.addEventListener('click', event => {
  const target = event.target.closest('[data-action]');
  if (!target) return;
  target.focus();
  const action = target.dataset.action;
  const value = target.dataset.value;
  if (action === 'close') { document.getElementById('detail-drawer').close(); return; }
  if (action === 'message') { document.getElementById('message-input').focus(); return; }
  if (action === 'details' || action === 'session') { details(); return; }
  if (action === 'error-details' || action === 'recovery') {
    openDrawer('Storage recovery', 'Get Reviewer running again', `<p>Codex couldn’t open its conversation store. The new review never started. Saved messages and the implementation branch are retained.</p><h3>Saved launch error</h3><pre>${escapeHtml(rawError)}</pre><p>Check storage and compare the saved copies before retrying this review.</p><div class="drawer-actions">${button('check-storage', 'Check storage', 'button primary')}${button('compare', 'Compare saved copies')}</div><p id="recovery-result" role="status"></p>`); return;
  }
  if (action === 'check-storage' || action === 'compare') { document.getElementById('recovery-result').textContent = action === 'check-storage' ? 'Preview only: storage checks would appear here. Recovery has not run.' : 'Preview only: saved-copy comparison would appear here. No copy is selected or overwritten.'; return; }
  if (action === 'steer') { openDrawer('Steer member', 'Guide the next step', `<p>Send a note for the next turn. This does not approve a merge or cancel the current assignment.</p><form id="steer-form" class="message-box"><label for="steer-input">Steering note</label><textarea id="steer-input" required placeholder="Keep the review focused on restore and foreground activation…"></textarea><button type="submit" class="button primary">Stage note ${icon('arrow')}</button></form>`); return; }
  if (action === 'worktree' || action === 'worktree-row') {
    const row = worktrees.find(row => row.branch === value);
    const branch = row?.branch || current().branch;
    openDrawer('Task worktree', row?.full || current().title, `<p>${row ? `${row.member} · ${row.label}` : current().label}</p><h3>Working copy</h3><pre>${branch}\nC:/Synthetic/BrowserLink/${branch}</pre><div class="drawer-actions">${button('preview-open', 'Open folder')}${button('preview-open', 'Open session')}</div>`); return;
  }
  if (action === 'task') {
    const task = tasks().find(task => task.id === value);
    openDrawer('Assignment', task.title, `<div class="drawer-meta">${state(task.state, task.label)}</div><p>${task.note}</p>${facts([['Recorded', task.time], ['Outcome', task.meta], ['Owner', author()]])}<h3>Brief</h3><p>Inspect the saved behavior, retain validation and approvals, and report the remaining acceptance steps. No merge or deployment is requested.</p>`); return;
  }
  if (action === 'team-message') { openDrawer('Team message', 'From Manager', view.member === 'native' ? '<p>Please hold cc7-native-focus for independent review. Reviewer’s launch failed because of storage; your implementation is retained. No merge is scheduled.</p>' : '<p>Native Core is ready on cc7-native-focus. Review the saved change after storage recovery. Keep the current branch. No merge or live model turn is requested.</p>'); return; }
  if (action === 'tool') { openDrawer('Tool result', value === 'read' ? 'Read files' : 'Run checks', `<pre>${value === 'read' ? 'Read: window lifecycle, foreground routing, acceptance brief\n3 files read · 0.8s' : view.member === 'native' ? 'cargo test window_activation\n18 passed · 0 failed · 3.2s' : 'vitest run routing\n24 passed · 0 failed · 3.2s'}</pre><p>Saved synthetic output. Check source and native acceptance separately.</p>`); return; }
  if (action === 'theme') document.documentElement.classList.toggle('theme-light');
  else if (action === 'tasks') view.tasks = value;
  else if (action === 'tab') view.tab = value;
  else if (action === 'worktrees') { view.worktrees = value; view.page = 0; }
  else if (action === 'page') view.page += Number(value);
  else if (action === 'earlier') view.earlier = true;
  else if (action === 'open-reviewer' || action === 'member' && value === 'reviewer') { view.member = 'reviewer'; view.scenario = 'live'; }
  else if (action === 'member' && value === 'native') { view.member = 'native'; view.scenario = 'live'; }
  else if (action === 'retry') view.scenario = 'live';
  else { toast('Preview only · this action stays local.'); return; }
  render();
  const replacement = [...document.querySelectorAll('[data-action]')].find(el => el.dataset.action === action && el.dataset.value === value);
  replacement?.focus();
  if (action === 'earlier') document.getElementById('transcript').scrollTop = 0;
});
document.addEventListener('change', event => {
  if (event.target.id === 'preview-member') { view.member = event.target.value; view.earlier = false; }
  else if (event.target.id === 'preview-state') view.scenario = event.target.value;
  else return;
  const id = event.target.id;
  render();
  document.getElementById(id).focus();
});
document.addEventListener('submit', event => {
  event.preventDefault();
  if (event.target.id === 'steer-form') { document.getElementById('detail-drawer').close(); toast('Preview only · steering note staged. Nothing sent.'); }
  if (event.target.id === 'composer') toast(document.getElementById('message-input').value.trim() ? 'Preview only · message staged. Nothing sent.' : 'Write a message first.');
});
document.addEventListener('keydown', event => {
  if (event.key === '/' && !document.getElementById('detail-drawer').open && !event.target.closest('input, textarea, select')) { event.preventDefault(); document.getElementById('message-input').focus(); }
});
document.addEventListener('close', event => { if (event.target.id === 'detail-drawer') opener?.focus(); }, true);
render();
