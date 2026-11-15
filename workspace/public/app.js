// Workbench UI: polls the local server and renders inbox, tasks and chat.
const TOKEN = document.querySelector('meta[name="workbench-token"]').content;
const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const STATUS_LABEL = { running: 'working', 'needs-you': 'needs you', 'needs-trust': 'trust folder?', review: 'to review', idle: 'idle', ended: 'ended', failed: 'failed' };
// The list is ordered by what you have to do next.
const SECTIONS = [
  { key: 'needs', title: 'Needs you', has: (st) => st === 'needs-you' || st === 'needs-trust' || st === 'failed' },
  { key: 'review', title: 'To review', has: (st) => st === 'review' },
  { key: 'working', title: 'Working', has: (st) => st === 'running' },
  { key: 'idle', title: 'Idle', has: (st) => st === 'idle', collapsed: true },
  { key: 'ended', title: 'Ended', has: (st) => st === 'ended', collapsed: true },
];
const ATTENTION = new Set(['needs-you', 'needs-trust', 'failed', 'review']);

const ui = { state: { sessions: [], inbox: [] }, selected: null, open: new Set(), detail: null, sending: false, prev: new Map(), order: [] };

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api/${path}`, {
    method,
    headers: { 'x-workbench-token': TOKEN, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

const status = (st) => `<span class="st ${esc(st)}">${esc(STATUS_LABEL[st] ?? st)}</span>`;
const ago = (iso) => {
  const s = Math.max(0, (Date.now() - new Date(iso)) / 1000);
  return s < 60 ? `${Math.round(s)}s` : s < 3600 ? `${Math.round(s / 60)}m` : s < 86400 ? `${Math.round(s / 3600)}h` : `${Math.round(s / 86400)}d`;
};
const describe = (tool, input) => {
  if (!input) return tool ?? '';
  if (tool === 'Bash') return input.command ?? '';
  return input.file_path ?? input.path ?? input.url ?? input.pattern ?? JSON.stringify(input, null, 2);
};

// ---------- render ----------

function renderCounts() {
  const s = ui.state.sessions;
  const n = (f) => s.filter((x) => f(x.status)).length;
  const need = ui.state.inbox.length + n((st) => st === 'needs-trust' || st === 'failed');
  const review = n((st) => st === 'review');
  $('counts').innerHTML = [
    need ? `<span class="st needs-you">${need} need you</span>` : '',
    review ? `<span class="st review">${review} to review</span>` : '',
    `<span class="st running">${n((st) => st === 'running')} working</span>`,
  ].join('');
  document.title = need + review ? `(${need + review}) Workbench` : 'Workbench';
}

/** The prompt(s) a session is waiting on, shown under its row in "Needs you". */
function promptBlock(s) {
  if (s.status === 'needs-trust') {
    return `<div class="req"><div class="dim">Claude Code asks to trust this folder before it starts.</div>
      <div class="acts"><button class="primary" data-trust="${esc(s.name)}" type="button">Trust folder</button></div></div>`;
  }
  return ui.state.inbox.filter((r) => r.session === s.name).map((r) => `<div class="req">
    <div class="dim">Wants to use ${esc(r.tool)} · ${ago(r.at)}</div><pre>${esc(describe(r.tool, r.input))}</pre>
    <div class="acts"><button data-deny="${esc(r.id)}" type="button">Deny <kbd>D</kbd></button><button class="primary" data-allow="${esc(r.id)}" type="button">Allow <kbd>A</kbd></button></div></div>`).join('');
}

function renderList() {
  const all = ui.state.sessions;
  if (!all.length) return void ($('list').innerHTML = '<p class="dim">No Claude Code sessions in tmux yet. Start one with “+ New session”.</p>');
  ui.order = [];
  $('list').innerHTML = SECTIONS.map((sec) => {
    const rows = all.filter((s) => sec.has(s.status)).sort((a, b) => b.activeAt.localeCompare(a.activeAt));
    if (!rows.length) return '';
    ui.order.push(...rows.map((s) => s.name));
    const holdsSelected = rows.some((s) => s.name === ui.selected);
    const open = !sec.collapsed || ui.open.has(sec.key) || holdsSelected ? ' open' : '';
    return `<details class="sec ${sec.key}" data-sec="${sec.key}"${open}><summary><h2>${esc(sec.title)}</h2><span class="num">${rows.length}</span></summary>
      ${rows.map((s) => {
        const line = s.status === 'running' ? (s.activity ? `▸ ${s.activity}` : '') : s.lastMessage ?? '';
        return `<div class="sess${s.name === ui.selected ? ' sel' : ''}${ATTENTION.has(s.status) ? ' unread' : ''}" data-sel="${esc(s.name)}" tabindex="0">
          ${status(s.status)}<span class="n"><span class="dim">${esc(s.task)} ›</span> ${esc(s.name.replace(/^cc-/, ''))}</span>
          <span class="line">${esc(line)}</span><span class="num">${ago(s.activeAt)}</span></div>${sec.key === 'needs' ? promptBlock(s) : ''}`;
      }).join('')}</details>`;
  }).join('');
}

function renderChat() {
  const s = ui.state.sessions.find((x) => x.name === ui.selected);
  if (!s) return void ($('chat').innerHTML = '<p class="dim pad">Pick a session on the left.</p>');
  const d = ui.detail?.name === s.name ? ui.detail : null;
  const blocked = s.status === 'needs-you' || s.status === 'needs-trust';
  const ended = s.status === 'ended';
  const draft = $('msg')?.value ?? '';
  const log = $('log');
  const atBottom = !log || log.scrollHeight - log.scrollTop - log.clientHeight < 40;
  $('chat').innerHTML = `
    <div class="chat-head"><button class="ghost back" data-back type="button">←</button>
      <span class="title">${esc(s.task)} › ${esc(s.name)}</span>${status(s.status)}
      <span class="tools"><button data-key="Escape" type="button" ${ended ? 'disabled' : ''}>Esc</button><button data-kill type="button">Close</button></span></div>
    <div class="log" id="log">${d ? (d.messages.length ? d.messages.map((m) => `<div class="msg ${esc(m.role)}">${esc(m.text)}</div>`).join('') : '<p class="dim">No messages yet.</p>') : '<p class="dim">Loading…</p>'}</div>
    ${blocked ? `<div class="notice">${s.status === 'needs-trust' ? 'Claude Code is asking to trust this folder.' : 'A permission prompt is waiting. Answer it in the inbox.'}</div>` : ''}
    <form class="send" id="send"><textarea id="msg" rows="2" placeholder="${ended ? 'Session ended' : blocked ? 'Answer the prompt first' : 'Message to the session (⌘↩ to send)'}" ${blocked || ended ? 'disabled' : ''}></textarea>
      <button class="primary" type="submit" ${blocked || ended || ui.sending ? 'disabled' : ''}>Send</button></form>
    <p class="error pad" id="chat-error" hidden></p>`;
  $('msg').value = draft;
  if (atBottom) $('log').scrollTop = $('log').scrollHeight;
}

function render() {
  renderCounts();
  renderList();
  renderChat();
  document.querySelector('.app').classList.toggle('chatting', !!ui.selected);
}

// ---------- data ----------

function notifyChanges() {
  for (const s of ui.state.sessions) {
    const before = ui.prev.get(s.name);
    if (before && before !== s.status && ATTENTION.has(s.status) && !ATTENTION.has(before)) {
      const what = s.status === 'review' ? 'finished' : s.status === 'failed' ? 'failed' : 'needs you';
      if (document.hidden && window.Notification?.permission === 'granted') {
        const n = new Notification(`${s.task} › ${s.name.replace(/^cc-/, '')} ${what}`, { body: s.activity ?? s.lastMessage ?? '', tag: s.name });
        n.onclick = () => { window.focus(); ui.selected = s.name; refresh(); };
      }
    }
    ui.prev.set(s.name, s.status);
  }
}

async function refresh() {
  try {
    ui.state = await api('state');
    notifyChanges();
    // Looking at a finished session counts as reviewing it.
    const sel = ui.state.sessions.find((s) => s.name === ui.selected);
    if (sel?.status === 'review' && !document.hidden) api(`sessions/${encodeURIComponent(sel.name)}/reviewed`, { method: 'POST', body: {} }).catch(() => {});
    if (ui.selected) ui.detail = await api(`sessions/${encodeURIComponent(ui.selected)}`).catch(() => null);
    $('conn').textContent = '';
  } catch (err) {
    $('conn').textContent = `Server unreachable: ${err.message}`;
  }
  // Keep focus and typing in the message box across re-renders.
  const focused = document.activeElement?.id === 'msg';
  const sel = focused && [$('msg').selectionStart, $('msg').selectionEnd];
  render();
  if (focused && !$('msg').disabled) { $('msg').focus(); $('msg').setSelectionRange(...sel); }
}

async function act(fn) {
  try { await fn(); } catch (err) { const e = $('chat-error'); if (e) { e.textContent = err.message; e.hidden = false; } else $('conn').textContent = err.message; }
  refresh();
}

// ---------- events ----------

document.addEventListener('click', (e) => {
  const t = e.target.closest('button, .sess');
  if (!t) return;
  if (t.dataset.sel) { ui.selected = t.dataset.sel; ui.detail = null; refresh(); }
  else if (t.dataset.allow) act(() => api(`inbox/${t.dataset.allow}`, { method: 'POST', body: { behavior: 'allow' } }));
  else if (t.dataset.deny) act(() => api(`inbox/${t.dataset.deny}`, { method: 'POST', body: { behavior: 'deny' } }));
  else if (t.dataset.trust) act(() => api(`sessions/${encodeURIComponent(t.dataset.trust)}/trust`, { method: 'POST', body: {} }));
  else if (t.dataset.key) act(() => api(`sessions/${encodeURIComponent(ui.selected)}/key`, { method: 'POST', body: { key: t.dataset.key } }));
  else if (t.hasAttribute('data-kill')) act(async () => { await api(`sessions/${encodeURIComponent(ui.selected)}`, { method: 'DELETE' }); ui.selected = null; });
  else if (t.hasAttribute('data-back')) { ui.selected = null; render(); }
});

// Ask once for notification permission, on the first click (browsers require a gesture).
document.addEventListener('click', () => {
  if (window.Notification?.permission === 'default') Notification.requestPermission().catch(() => {});
}, { once: true });

document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.classList?.contains('sess')) e.target.click();
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || $('new-dialog').open;
  if (!typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
    const first = ui.state.inbox[0];
    if (e.key === 'j' || e.key === 'k') {
      const i = ui.order.indexOf(ui.selected);
      const next = ui.order[Math.max(0, Math.min(ui.order.length - 1, i < 0 ? 0 : i + (e.key === 'j' ? 1 : -1)))];
      if (next) { ui.selected = next; ui.detail = null; refresh(); }
    } else if ((e.key === 'a' || e.key === 'd') && first) {
      act(() => api(`inbox/${first.id}`, { method: 'POST', body: { behavior: e.key === 'a' ? 'allow' : 'deny' } }));
    } else if (e.key === 'n') { e.preventDefault(); $('new-session').click(); }
    else if (e.key === '/' && $('msg') && !$('msg').disabled) { e.preventDefault(); $('msg').focus(); }
  }
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && e.target.id === 'msg') $('send').requestSubmit();
});

document.addEventListener('toggle', (e) => {
  const key = e.target.dataset?.sec;
  if (key) e.target.open ? ui.open.add(key) : ui.open.delete(key);
}, true);

document.addEventListener('submit', (e) => {
  if (e.target.id !== 'send') return;
  e.preventDefault();
  const text = $('msg').value;
  if (!text.trim() || ui.sending) return;
  ui.sending = true;
  act(async () => {
    try {
      await api(`sessions/${encodeURIComponent(ui.selected)}/send`, { method: 'POST', body: { text } });
      $('msg').value = '';
    } finally { ui.sending = false; }
  });
});

$('new-session').addEventListener('click', async () => {
  $('new-error').textContent = '';
  const projects = await api('projects').catch(() => []);
  $('f-project').innerHTML = projects.map((p) => `<option>${esc(p.name)}</option>`).join('') || '<option value="">No git projects found</option>';
  $('task-list').innerHTML = [...new Set(ui.state.sessions.map((s) => s.task))].map((t) => `<option value="${esc(t)}">`).join('');
  $('new-dialog').showModal();
});

$('new-form').addEventListener('submit', async (e) => {
  if (e.submitter?.value !== 'start') return;
  e.preventDefault();
  const f = new FormData(e.target);
  try {
    const s = await api('sessions', { method: 'POST', body: Object.fromEntries(f) });
    $('new-dialog').close();
    e.target.reset();
    ui.selected = s.name;
    refresh();
  } catch (err) {
    $('new-error').textContent = err.message;
  }
});

refresh();
setInterval(refresh, 1500);
