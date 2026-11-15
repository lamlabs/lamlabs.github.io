// Workbench UI: polls the local server and renders inbox, tasks and chat.
const TOKEN = document.querySelector('meta[name="workbench-token"]').content;
const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const STATUS_LABEL = { running: 'running', 'needs-you': 'needs you', 'needs-trust': 'trust folder?', idle: 'idle', ended: 'ended', failed: 'failed' };
const RANK = { 'needs-trust': 0, 'needs-you': 0, failed: 1, running: 2, idle: 3, ended: 4 };
const FILTERS = {
  all: () => true,
  active: (st) => st === 'running' || st === 'needs-you' || st === 'needs-trust',
  needs: (st) => st === 'needs-you' || st === 'needs-trust' || st === 'failed',
  done: (st) => st === 'idle' || st === 'ended',
};

const ui = { state: { sessions: [], inbox: [] }, selected: null, filter: 'all', open: new Set(), detail: null, sending: false };

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
  const need = ui.state.inbox.length + n((st) => st === 'needs-trust');
  $('counts').innerHTML = [
    need ? `<span class="st needs-you">${need} need you</span>` : '',
    `<span class="st running">${n((st) => st === 'running')} running</span>`,
    n((st) => st === 'failed') ? `<span class="st failed">${n((st) => st === 'failed')} failed</span>` : '',
  ].join('');
  document.title = need ? `(${need}) Workbench` : 'Workbench';
}

function renderInbox() {
  const items = ui.state.inbox;
  const trust = ui.state.sessions.filter((s) => s.status === 'needs-trust');
  if (!items.length && !trust.length) return void ($('inbox').innerHTML = '');
  $('inbox').innerHTML = `<div class="inbox"><h2>Needs you</h2>
    ${trust.map((s) => `<div class="req"><div><span class="who">${esc(s.name)}</span> <span class="dim">asks to trust its folder</span></div>
      <div class="acts"><button data-trust="${esc(s.name)}" type="button">Trust folder</button></div></div>`).join('')}
    ${items.map((r) => `<div class="req"><div><span class="who">${esc(r.session ?? r.sessionId.slice(0, 8))}</span> <span class="dim">wants to use ${esc(r.tool)} · ${ago(r.at)}</span></div>
      <pre>${esc(describe(r.tool, r.input))}</pre>
      <div class="acts"><button data-deny="${esc(r.id)}" type="button">Deny</button><button class="primary" data-allow="${esc(r.id)}" type="button">Allow</button></div></div>`).join('')}
  </div>`;
}

function renderTasks() {
  const groups = new Map();
  for (const s of ui.state.sessions) {
    if (!groups.has(s.task)) groups.set(s.task, []);
    groups.get(s.task).push(s);
  }
  const tasks = [...groups].map(([name, sessions]) => {
    sessions.sort((a, b) => RANK[a.status] - RANK[b.status] || a.name.localeCompare(b.name));
    return { name, sessions, status: sessions[0].status, project: sessions[0].project };
  });
  tasks.sort((a, b) => RANK[a.status] - RANK[b.status] || a.name.localeCompare(b.name));
  const shown = tasks.filter((t) => t.sessions.some((s) => FILTERS[ui.filter](s.status)));
  if (!ui.state.sessions.length) return void ($('tasks').innerHTML = '<p class="dim">No Claude Code sessions in tmux yet. Start one with “+ New session”.</p>');
  if (!shown.length) return void ($('tasks').innerHTML = '<p class="dim">Nothing matches this filter.</p>');
  $('tasks').innerHTML = shown.map((t) => {
    const done = t.sessions.filter((s) => s.status === 'idle' || s.status === 'ended').length;
    const open = ui.open.has(t.name) || t.status !== 'ended' ? ' open' : '';
    return `<details class="task" data-task="${esc(t.name)}"${open}>
      <summary><span class="name">${esc(t.name)}</span><span class="num">${esc(t.project ?? '')}</span>${status(t.status)}<span class="num">${done}/${t.sessions.length}</span></summary>
      ${t.sessions.map((s) => `<div class="sess${s.name === ui.selected ? ' sel' : ''}" data-sel="${esc(s.name)}" tabindex="0">
        <span></span><span class="n">${esc(s.name)}</span>${status(s.status)}<span class="num">${ago(s.activeAt)}</span></div>`).join('')}
    </details>`;
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
  renderInbox();
  renderTasks();
  renderChat();
  document.querySelector('.app').classList.toggle('chatting', !!ui.selected);
}

// ---------- data ----------

async function refresh() {
  try {
    ui.state = await api('state');
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
  else if (t.dataset.f) {
    ui.filter = t.dataset.f;
    document.querySelectorAll('#filters button').forEach((b) => b.classList.toggle('on', b === t));
    renderTasks();
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.classList?.contains('sess')) e.target.click();
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && e.target.id === 'msg') $('send').requestSubmit();
});

document.addEventListener('toggle', (e) => {
  const name = e.target.dataset?.task;
  if (name) e.target.open ? ui.open.add(name) : ui.open.delete(name);
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
