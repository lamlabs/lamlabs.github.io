// Routes: #/p/<project>[/files|/changes], #/s/<session>
const $ = (sel) => document.querySelector(sel);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const enc = encodeURIComponent;

async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: opts.body ? { 'content-type': 'application/json' } : {},
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? res.statusText);
  return data;
}

function ago(iso) {
  if (!iso) return '';
  const s = (Date.now() - new Date(iso)) / 1000;
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

const STATUS_LABEL = { working: 'working', 'needs-you': 'needs you', idle: 'idle', exited: 'exited' };
let projects = [];
let sessions = [];
let timer = null;

// ---------- sidebar ----------

async function refreshSidebar() {
  [projects, sessions] = await Promise.all([
    api('/api/projects').catch(() => projects),
    api('/api/sessions').catch(() => sessions),
  ]);
  const here = location.hash;
  $('#sessions').innerHTML = sessions.length
    ? sessions
        .map(
          (s) => `<li><a href="#/s/${enc(s.name)}" class="${here === `#/s/${enc(s.name)}` ? 'active' : ''}">
            <span class="dot ${s.status}" title="${STATUS_LABEL[s.status]}"></span>${esc(s.name.slice(3))}
            <span class="meta">${esc(s.project)}</span></a></li>`,
        )
        .join('')
    : '<li class="empty">No sessions</li>';
  $('#projects').innerHTML = projects.length
    ? projects
        .map(
          (p) => `<li><a href="#/p/${enc(p.name)}" class="${here.startsWith(`#/p/${enc(p.name)}`) ? 'active' : ''}">
            ${esc(p.name)}<span class="meta">${p.changed ? `${p.changed}●` : ''} ${esc(ago(p.lastCommitAt))}</span></a></li>`,
        )
        .join('')
    : '<li class="empty">No git projects found</li>';
}

// ---------- project views ----------

function projectHead(p, tab) {
  const t = (id, label) => `<a href="#/p/${enc(p.name)}${id ? `/${id}` : ''}" class="${tab === id ? 'active' : ''}">${label}</a>`;
  return `<div class="head">
    <h1>${esc(p.name)} <span class="badge">${esc(p.branch ?? 'no branch')}</span>
      ${p.github ? `<a href="https://github.com/${esc(p.github)}" target="_blank" rel="noopener" style="font-size:13px;font-weight:400">${esc(p.github)}</a>` : ''}</h1>
    <div class="dim">${esc(p.lastCommit ?? '')}</div>
    <nav class="tabs">${t('', 'Overview')}${t('files', 'Files')}${t('changes', `Changes${p.changed ? ` (${p.changed})` : ''}`)}</nav>
  </div>`;
}

async function showProject(name, tab) {
  const p = projects.find((x) => x.name === name);
  if (!p) return ($('#main').innerHTML = '<p class="pad dim">Project not found.</p>');
  $('#main').innerHTML = `${projectHead(p, tab)}<div class="body" id="body"><p class="dim">Loading…</p></div>`;
  if (tab === 'files') return showFiles(p);
  if (tab === 'changes') return showChanges(p);
  return showOverview(p);
}

async function showOverview(p) {
  const mine = sessions.filter((s) => s.project === p.name);
  const cards = [
    ['Uncommitted files', p.changed],
    ['Ahead / behind', `${p.ahead} / ${p.behind}`],
    ['Sessions', mine.length],
  ];
  const body = $('#body');
  body.innerHTML = `<div class="cards">${cards.map(([l, v]) => `<div class="card"><b>${esc(v)}</b>${esc(l)}</div>`).join('')}</div>
    <div class="row"><button class="primary" id="start-here">New session here</button></div>
    <div id="gh"><p class="dim">Loading GitHub…</p></div>`;
  $('#start-here').onclick = () => openNewSession(p.name);

  const gh = await api(`/api/projects/${enc(p.name)}/github`).catch((e) => ({ available: false, reason: e.message }));
  if (!$('#gh')) return;
  if (!gh.available) return ($('#gh').innerHTML = `<p class="dim">GitHub: ${esc(gh.reason)}</p>`);
  const ci = (r) => r.conclusion || r.status;
  $('#gh').innerHTML = `
    <h2>Open pull requests</h2>
    ${gh.prs.length ? `<table class="table"><tbody>${gh.prs
      .map((pr) => `<tr><td><a href="${esc(pr.url)}" target="_blank" rel="noopener">#${pr.number} ${esc(pr.title)}</a>${pr.isDraft ? ' <span class="dim">draft</span>' : ''}</td>
        <td class="dim">${esc(pr.author)}</td><td class="dim">${ago(pr.updatedAt)}</td></tr>`)
      .join('')}</tbody></table>` : '<p class="dim">None.</p>'}
    <h2>Recent CI runs</h2>
    ${gh.runs.length ? `<table class="table"><tbody>${gh.runs
      .map((r) => `<tr><td><span class="badge ${esc(ci(r))}">${esc(ci(r))}</span></td>
        <td><a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.workflow)}</a> <span class="dim">${esc(r.title)}</span></td>
        <td class="dim mono">${esc(r.branch)}</td><td class="dim">${ago(r.createdAt)}</td></tr>`)
      .join('')}</tbody></table>` : '<p class="dim">No runs.</p>'}`;
}

async function showFiles(p) {
  const files = await api(`/api/projects/${enc(p.name)}/files`);
  const body = $('#body');
  body.style.overflow = 'hidden';
  body.innerHTML = `<div class="files"><div class="tree"><input id="filter" placeholder="Filter ${files.length} files"><div id="tree"></div></div>
    <div class="viewer" id="viewer"><p class="pad dim">Pick a file.</p></div></div>`;
  const draw = (q = '') => {
    const shown = files.filter((f) => f.toLowerCase().includes(q.toLowerCase())).slice(0, 1500);
    $('#tree').innerHTML = shown.map((f) => `<a href="#" data-path="${esc(f)}" title="${esc(f)}">${esc(f)}</a>`).join('');
  };
  draw();
  $('#filter').oninput = (e) => draw(e.target.value);
  $('#tree').onclick = async (e) => {
    const a = e.target.closest('a[data-path]');
    if (!a) return;
    e.preventDefault();
    document.querySelectorAll('#tree a.active').forEach((x) => x.classList.remove('active'));
    a.classList.add('active');
    const f = await api(`/api/projects/${enc(p.name)}/file?path=${enc(a.dataset.path)}`).catch((err) => ({ note: err.message }));
    $('#viewer').innerHTML = f.text == null
      ? `<p class="pad dim">${esc(f.note)}</p>`
      : `<pre>${f.text.split('\n').map((l) => `<span class="ln">${esc(l)}</span>`).join('')}</pre>`;
  };
}

async function showChanges(p) {
  const { diff, untracked } = await api(`/api/projects/${enc(p.name)}/diff`);
  const cls = (l) => (l.startsWith('diff --git') ? 'file' : l.startsWith('@@') ? 'hunk' : l.startsWith('+') && !l.startsWith('+++') ? 'add' : l.startsWith('-') && !l.startsWith('---') ? 'del' : '');
  $('#body').innerHTML = `
    ${untracked.length ? `<h2 style="margin-top:0">New files</h2><pre class="mono">${untracked.map(esc).join('\n')}</pre>` : ''}
    ${diff ? `<div class="viewer diff"><pre>${diff.split('\n').map((l) => `<span class="${cls(l)}">${esc(l) || ' '}</span>`).join('\n')}</pre></div>`
      : untracked.length ? '' : '<p class="dim">No changes.</p>'}`;
}

// ---------- session view ----------

async function showSession(name) {
  $('#main').innerHTML = `<div class="head"><h1 id="s-title">${esc(name.slice(3))}</h1>
      <div class="row" style="padding-bottom:10px">
        <span id="s-meta" class="dim"></span>
        <label class="row dim" style="margin-left:auto;gap:4px"><input type="checkbox" id="s-term" style="width:auto"> Terminal</label>
        <button id="s-kill" class="ghost">Stop session</button>
      </div></div>
    <div class="chat" id="chat"></div>
    <pre class="screen" id="screen" hidden></pre>
    <form class="compose" id="compose">
      <textarea id="msg" placeholder="Message Claude…  (⌘/Ctrl+Enter to send)"></textarea>
      <div class="row">
        <span class="dim">Keys:</span>
        ${['1', '2', '3', 'Enter', 'Escape', 'Up', 'Down'].map((k) => `<button type="button" data-key="${k}">${k === 'Escape' ? 'Esc' : k}</button>`).join('')}
        <span class="error" id="s-error"></span>
        <button class="primary" style="margin-left:auto">Send</button>
      </div>
    </form>`;

  let lastCount = -1;
  const draw = async () => {
    const s = await api(`/api/sessions/${enc(name)}`).catch((e) => ({ error: e.message }));
    if (!$('#chat')) return;
    if (s.error) return ($('#s-error').textContent = s.error);
    $('#s-title').innerHTML = `${esc(name.slice(3))} <span class="badge ${s.status}">${STATUS_LABEL[s.status]}</span>`;
    $('#s-meta').innerHTML = `<a href="#/p/${enc(s.project)}">${esc(s.project)}</a> · started ${ago(s.createdAt) === 'now' ? 'just now' : `${ago(s.createdAt)} ago`}`;
    $('#screen').textContent = s.screen;
    if (s.messages.length !== lastCount) {
      const chat = $('#chat');
      const atBottom = chat.scrollHeight - chat.scrollTop - chat.clientHeight < 80;
      chat.innerHTML = s.messages.length
        ? s.messages.map((m) => `<div class="msg ${m.role}">${esc(m.text)}</div>`).join('')
        : '<p class="dim">No messages yet. Turn on Terminal to see the raw screen.</p>';
      if (atBottom || lastCount === -1) chat.scrollTop = chat.scrollHeight;
      lastCount = s.messages.length;
    }
  };
  $('#s-term').onchange = (e) => ($('#screen').hidden = !e.target.checked);
  $('#s-kill').onclick = async () => {
    if (!confirm(`Stop ${name}? Claude Code in it will be closed.`)) return;
    await api(`/api/sessions/${enc(name)}`, { method: 'DELETE' });
    location.hash = '';
  };
  document.querySelectorAll('[data-key]').forEach((b) => {
    b.onclick = () => api(`/api/sessions/${enc(name)}/key`, { method: 'POST', body: { key: b.dataset.key } }).then(draw);
  });
  const sendMsg = async () => {
    const text = $('#msg').value;
    if (!text.trim()) return;
    $('#s-error').textContent = '';
    try {
      await api(`/api/sessions/${enc(name)}/send`, { method: 'POST', body: { text } });
      $('#msg').value = '';
      setTimeout(draw, 500);
    } catch (e) {
      $('#s-error').textContent = e.message;
    }
  };
  $('#compose').onsubmit = (e) => (e.preventDefault(), sendMsg());
  $('#msg').onkeydown = (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) (e.preventDefault(), sendMsg());
  };
  // Handlers first, so typing during the first load is not lost.
  timer = setInterval(draw, 2000);
  await draw();
}

// ---------- new session ----------

function openNewSession(project) {
  const form = $('#new-form');
  form.project.innerHTML = projects.map((p) => `<option ${p.name === project ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
  $('#new-error').textContent = '';
  $('#new-dialog').showModal();
}
$('#new-session').onclick = () => openNewSession();
$('#new-form').addEventListener('submit', async (e) => {
  if (e.submitter?.value !== 'start') return;
  e.preventDefault();
  const f = e.target;
  try {
    const s = await api('/api/sessions', { method: 'POST', body: { project: f.project.value, name: f.name.value, prompt: f.prompt.value } });
    $('#new-dialog').close();
    f.reset();
    await refreshSidebar();
    location.hash = `#/s/${enc(s.name)}`;
  } catch (err) {
    $('#new-error').textContent = err.message;
  }
});

// ---------- router ----------

async function route() {
  clearInterval(timer);
  await refreshSidebar();
  const [, kind, name, tab] = location.hash.split('/').map(decodeURIComponent);
  if (kind === 's' && name) return showSession(name);
  if (kind === 'p' && name) return showProject(name, tab ?? '');
  $('#main').innerHTML = '<p class="pad dim">Pick a project or a session.</p>';
}
window.addEventListener('hashchange', route);
setInterval(refreshSidebar, 5000);
route();
