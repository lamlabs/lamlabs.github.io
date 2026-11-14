#!/usr/bin/env node
// Workspace: a small local dashboard for Claude Code sessions on this machine.
// No dependencies. Uses git, tmux, claude and (optionally) gh from your PATH.
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile, readdir, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PREFIX, githubSlug, parseGitStatus, parseTranscript, safeJoin, screenStatus, slug } from './lib.mjs';

const PORT = Number(process.env.PORT ?? 4747);
const ROOT = path.resolve(process.env.PROJECTS_ROOT ?? path.join(os.homedir(), 'code'));
const CLAUDE = process.env.CLAUDE_BIN ?? 'claude';
const CLAUDE_HOME = process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), '.claude');
const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const MAX_FILE = 512 * 1024;

const run = (cmd, args, opts = {}) =>
  new Promise((resolve, reject) =>
    execFile(cmd, args, { maxBuffer: 16 * 1024 * 1024, timeout: 20_000, ...opts }, (err, stdout, stderr) =>
      err ? reject(new Error((stderr || err.message).trim())) : resolve(stdout),
    ),
  );
const tryRun = (cmd, args, opts) => run(cmd, args, opts).catch(() => null);

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// ---------- projects ----------

async function listProjects() {
  const entries = await readdir(ROOT, { withFileTypes: true }).catch(() => []);
  const dirs = entries.filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name);
  const projects = await Promise.all(
    dirs.map(async (name) => {
      const dir = path.join(ROOT, name);
      const status = await tryRun('git', ['status', '--porcelain=v2', '--branch'], { cwd: dir });
      if (status === null) return null; // not a git repository
      const remote = await tryRun('git', ['remote', 'get-url', 'origin'], { cwd: dir });
      const last = await tryRun('git', ['log', '-1', '--format=%cI%x09%s'], { cwd: dir });
      const [lastCommitAt, lastCommit] = (last ?? '').trim().split('\t');
      return { name, ...parseGitStatus(status), github: githubSlug(remote ?? ''), lastCommitAt: lastCommitAt || null, lastCommit: lastCommit ?? null };
    }),
  );
  return projects.filter(Boolean).sort((a, b) => (b.lastCommitAt ?? '').localeCompare(a.lastCommitAt ?? ''));
}

function projectDir(name) {
  const dir = safeJoin(ROOT, name);
  if (!dir || name.includes('/')) throw new HttpError(400, 'Bad project name');
  return dir;
}

async function listFiles(name) {
  const out = await run('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: projectDir(name) });
  return out.split('\n').filter(Boolean).slice(0, 10_000);
}

async function readProjectFile(name, rel) {
  const full = safeJoin(projectDir(name), rel ?? '');
  if (!full) throw new HttpError(400, 'Path outside the project');
  const info = await stat(full).catch(() => null);
  if (!info?.isFile()) throw new HttpError(404, 'No such file');
  if (info.size > MAX_FILE) return { path: rel, text: null, note: `Too large to show (${Math.round(info.size / 1024)} KB)` };
  const buf = await readFile(full);
  if (buf.includes(0)) return { path: rel, text: null, note: 'Binary file' };
  return { path: rel, text: buf.toString('utf8') };
}

async function projectDiff(name) {
  const dir = projectDir(name);
  const diff = await run('git', ['diff', 'HEAD', '--no-color'], { cwd: dir }).catch(() => '');
  const untracked = await run('git', ['ls-files', '--others', '--exclude-standard'], { cwd: dir }).catch(() => '');
  return { diff, untracked: untracked.split('\n').filter(Boolean) };
}

/** Pull requests and recent CI runs through the gh CLI, if it is installed and logged in. */
async function projectGithub(name) {
  const p = (await listProjects()).find((x) => x.name === name);
  if (!p?.github) return { available: false, reason: 'No GitHub remote' };
  // REST through `gh api`, so it works wherever gh is logged in.
  const [prs, runs] = await Promise.all([
    run('gh', ['api', `repos/${p.github}/pulls?state=open&per_page=20`]),
    run('gh', ['api', `repos/${p.github}/actions/runs?per_page=8`]),
  ]).catch((err) => [null, err]);
  if (prs === null) return { available: false, reason: `gh: ${runs.message.split('\n')[0]}` };
  return {
    available: true,
    repo: p.github,
    prs: JSON.parse(prs).map((x) => ({ number: x.number, title: x.title, url: x.html_url, author: x.user?.login, isDraft: x.draft, updatedAt: x.updated_at })),
    runs: JSON.parse(runs).workflow_runs.map((r) => ({
      title: r.display_title, status: r.status, conclusion: r.conclusion, url: r.html_url, workflow: r.name, branch: r.head_branch, createdAt: r.created_at,
    })),
  };
}

// ---------- sessions (tmux + claude) ----------

const tmux = (...args) => run('tmux', args);
/** Exact-match target for a session's active pane ("=name" alone fails for pane targets). */
const target = (name) => `=${name}:`;

async function listSessions() {
  // tmux turns tabs in format output into "_", so use a printable separator.
  const SEP = '|~|';
  const fmt = ['#{session_name}', '#{session_created}', '#{session_activity}', '#{@cc_id}', '#{@cc_project}', '#{pane_dead}'].join(SEP);
  const out = await tryRun('tmux', ['list-panes', '-a', '-F', fmt]);
  if (!out) return [];
  const seen = new Set();
  const rows = out
    .split('\n')
    .filter((l) => l.startsWith(PREFIX))
    .map((l) => l.split(SEP))
    .filter(([name]) => !seen.has(name) && seen.add(name));
  return Promise.all(
    rows.map(async ([name, created, activity, id, project, dead]) => {
      const screen = (await tryRun('tmux', ['capture-pane', '-p', '-t', target(name)])) ?? '';
      return {
        name,
        project,
        claudeId: id || null,
        status: screenStatus(screen, dead === '1'),
        createdAt: new Date(Number(created) * 1000).toISOString(),
        activeAt: new Date(Number(activity) * 1000).toISOString(),
      };
    }),
  );
}

async function createSession({ project, name, prompt }) {
  const dir = projectDir(project);
  const sessionName = PREFIX + slug(name || project);
  if ((await listSessions()).some((s) => s.name === sessionName)) throw new HttpError(409, `${sessionName} already exists`);
  const id = randomUUID();
  const args = ['--session-id', id];
  if (prompt?.trim()) args.push(prompt);
  // One tmux call, so the options exist before claude can exit. remain-on-exit keeps
  // the pane after claude quits, so its last screen stays readable. A lone ";"
  // argument would split the tmux command, so the prompt never is one.
  const t = target(sessionName);
  await tmux(
    'new-session', '-d', '-s', sessionName, '-c', dir, '-x', '200', '-y', '50', CLAUDE, ...args.map((a) => (a === ';' ? ' ;' : a)),
    ';', 'set-option', '-t', t, '@cc_id', id,
    ';', 'set-option', '-t', t, '@cc_project', project,
    ';', 'set-option', '-t', t, 'remain-on-exit', 'on',
  );
  return { name: sessionName, claudeId: id };
}

async function findSession(name) {
  const s = (await listSessions()).find((x) => x.name === name);
  if (!s) throw new HttpError(404, 'No such session');
  return s;
}

async function transcriptPath(claudeId) {
  const base = path.join(CLAUDE_HOME, 'projects');
  for (const dir of await readdir(base).catch(() => [])) {
    const file = path.join(base, dir, `${claudeId}.jsonl`);
    if (await stat(file).catch(() => null)) return file;
  }
  return null;
}

async function sessionDetail(name) {
  const s = await findSession(name);
  const screen = (await tryRun('tmux', ['capture-pane', '-p', '-t', target(name)])) ?? '';
  const file = s.claudeId ? await transcriptPath(s.claudeId) : null;
  const messages = file ? parseTranscript(await readFile(file, 'utf8')).slice(-300) : [];
  return { ...s, screen, messages };
}

async function sendText(name, text) {
  await findSession(name);
  if (!text?.trim()) throw new HttpError(400, 'Empty message');
  // Paste as one bracketed paste so newlines do not submit early, then press Enter.
  const buffer = `cc-${randomUUID()}`;
  await tmux('set-buffer', '-b', buffer, text);
  await tmux('paste-buffer', '-p', '-d', '-b', buffer, '-t', target(name));
  await new Promise((r) => setTimeout(r, 150));
  await tmux('send-keys', '-t', target(name), 'Enter');
}

const KEYS = new Set(['Enter', 'Escape', 'Up', 'Down', 'Tab', 'BTab', '1', '2', '3']);
async function sendKey(name, key) {
  await findSession(name);
  if (!KEYS.has(key)) throw new HttpError(400, 'Key not allowed');
  await tmux('send-keys', '-t', target(name), key);
}

async function killSession(name) {
  await findSession(name);
  await tmux('kill-session', '-t', `=${name}`);
}

// ---------- http ----------

const routes = [
  ['GET', /^\/api\/projects$/, () => listProjects()],
  ['GET', /^\/api\/projects\/([^/]+)\/files$/, (m) => listFiles(m[1])],
  ['GET', /^\/api\/projects\/([^/]+)\/file$/, (m, url) => readProjectFile(m[1], url.searchParams.get('path'))],
  ['GET', /^\/api\/projects\/([^/]+)\/diff$/, (m) => projectDiff(m[1])],
  ['GET', /^\/api\/projects\/([^/]+)\/github$/, (m) => projectGithub(m[1])],
  ['GET', /^\/api\/sessions$/, () => listSessions()],
  ['POST', /^\/api\/sessions$/, (m, url, body) => createSession(body)],
  ['GET', /^\/api\/sessions\/([^/]+)$/, (m) => sessionDetail(m[1])],
  ['POST', /^\/api\/sessions\/([^/]+)\/send$/, (m, url, body) => sendText(m[1], body.text)],
  ['POST', /^\/api\/sessions\/([^/]+)\/key$/, (m, url, body) => sendKey(m[1], body.key)],
  ['DELETE', /^\/api\/sessions\/([^/]+)$/, (m) => killSession(m[1])],
];

const LOCAL_HOSTS = new Set([`localhost:${PORT}`, `127.0.0.1:${PORT}`]);

async function readBody(req) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > 1_000_000) throw new HttpError(413, 'Body too large');
    chunks.push(c);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
}

export const server = createServer(async (req, res) => {
  const send = (status, body, type = 'application/json') => {
    res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    res.end(type === 'application/json' ? JSON.stringify(body) : body);
  };
  try {
    // Only this machine, and only pages served from here: blocks DNS rebinding and
    // other websites posting to the API from your browser.
    if (!LOCAL_HOSTS.has(req.headers.host ?? '')) throw new HttpError(403, 'Forbidden host');
    if (req.method !== 'GET') {
      const origin = req.headers.origin;
      if (origin && !LOCAL_HOSTS.has(origin.replace(/^https?:\/\//, ''))) throw new HttpError(403, 'Forbidden origin');
      if (!String(req.headers['content-type'] ?? '').startsWith('application/json') && req.method === 'POST')
        throw new HttpError(415, 'JSON only');
    }

    const url = new URL(req.url, `http://${req.headers.host}`);
    if (!url.pathname.startsWith('/api/')) {
      const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
      const full = safeJoin(PUBLIC, file);
      const body = full && (await readFile(full).catch(() => null));
      if (!body) throw new HttpError(404, 'Not found');
      const type = full.endsWith('.html') ? 'text/html; charset=utf-8' : full.endsWith('.js') ? 'text/javascript' : 'text/css';
      return send(200, body, type);
    }

    for (const [method, pattern, handler] of routes) {
      const m = url.pathname.match(pattern);
      if (!m || method !== req.method) continue;
      const params = m.map((v, i) => (i ? decodeURIComponent(v) : v));
      const body = req.method === 'POST' ? await readBody(req) : {};
      const result = await handler(params, url, body);
      return send(200, result ?? { ok: true });
    }
    throw new HttpError(404, 'Not found');
  } catch (err) {
    send(err.status ?? 500, { error: err.message });
  }
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`Workspace on http://localhost:${PORT}  (projects in ${ROOT})`);
  });
}
