import type { Snapshot } from './types';

const esc = (v: unknown) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const link = (href: string | null, text: string) =>
  href && /^https:\/\//.test(href) ? `<a href="${esc(href)}">${esc(text)}</a>` : esc(text);

/** ISO timestamp as a <time> the page script rewrites to "3 days ago". */
const when = (iso: string | null) => (iso ? `<time datetime="${esc(iso)}">${esc(iso.slice(0, 10))}</time>` : '—');

const badge = (state: string | null) => {
  if (!state) return '<span class="badge none">none</span>';
  const s = state.toLowerCase();
  const kind = s === 'success' ? 'ok' : s === 'failure' || s === 'error' ? 'bad' : 'wait';
  return `<span class="badge ${kind}">${esc(s)}</span>`;
};

const table = (head: string[], rows: string[][], empty: string) =>
  rows.length === 0
    ? `<p class="empty">${esc(empty)}</p>`
    : `<div class="scroll"><table><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows
        .map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`)
        .join('')}</tbody></table></div>`;

export function render(s: Snapshot): string {
  const failing = s.repos.filter((r) => r.ci === 'FAILURE' || r.ci === 'ERROR').length;
  const prs = s.repos.reduce((n, r) => n + r.openPrs, 0);
  const tiles = [
    ['Repos', s.repos.length],
    ['Open PRs', prs],
    ['Failing CI', failing],
    ['Workers', s.workers.length],
    ['Pages', s.pages.length],
  ];

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Workspace</title>
<style>
  :root { color-scheme: light dark; --bg:#fafafa; --fg:#18181b; --dim:#6b7280; --line:#e4e4e7; --card:#fff; --ok:#15803d; --bad:#b91c1c; --wait:#a16207; }
  @media (prefers-color-scheme: dark) { :root { --bg:#0f0f11; --fg:#f4f4f5; --dim:#9ca3af; --line:#27272a; --card:#18181b; --ok:#4ade80; --bad:#f87171; --wait:#facc15; } }
  * { box-sizing: border-box; }
  body { margin:0; padding:24px 16px 48px; background:var(--bg); color:var(--fg); font:15px/1.5 system-ui, sans-serif; }
  main { max-width:1000px; margin:0 auto; }
  h1 { font-size:22px; margin:0; }
  h2 { font-size:15px; margin:32px 0 8px; }
  header { display:flex; flex-wrap:wrap; gap:8px 16px; align-items:baseline; justify-content:space-between; }
  .dim, .empty { color:var(--dim); }
  .tiles { display:grid; grid-template-columns:repeat(auto-fit, minmax(120px, 1fr)); gap:12px; margin-top:20px; }
  .tile { background:var(--card); border:1px solid var(--line); border-radius:8px; padding:12px; }
  .tile b { display:block; font-size:24px; font-variant-numeric:tabular-nums; }
  .scroll { overflow-x:auto; background:var(--card); border:1px solid var(--line); border-radius:8px; }
  table { border-collapse:collapse; width:100%; white-space:nowrap; }
  th, td { text-align:left; padding:8px 12px; border-bottom:1px solid var(--line); }
  th { font-size:12px; color:var(--dim); font-weight:600; }
  tr:last-child td { border-bottom:0; }
  td.num { font-variant-numeric:tabular-nums; }
  a { color:inherit; }
  .badge { font-size:12px; padding:1px 8px; border-radius:999px; border:1px solid currentColor; }
  .ok { color:var(--ok); } .bad { color:var(--bad); } .wait { color:var(--wait); } .none { color:var(--dim); }
  .errors { border:1px solid var(--bad); border-radius:8px; padding:8px 12px; margin-top:20px; }
  .errors ul { margin:4px 0 0; padding-left:20px; }
</style>
</head>
<body>
<main>
<header>
  <h1>Workspace</h1>
  <span class="dim">Updated ${when(s.generatedAt)}</span>
</header>
${
  s.errors.length
    ? `<div class="errors"><strong>Some sources failed to load</strong><ul>${s.errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></div>`
    : ''
}
<div class="tiles">${tiles.map(([label, n]) => `<div class="tile"><b>${esc(n)}</b>${esc(label)}</div>`).join('')}</div>

<h2>GitHub repositories</h2>
${table(
  ['Repository', 'CI', 'Open PRs', 'Open issues', 'Last push'],
  s.repos.map((r) => [
    `${link(r.url, `${r.owner}/${r.name}`)}${r.isPrivate ? ' <span class="dim">private</span>' : ''}`,
    badge(r.ci),
    String(r.openPrs),
    String(r.openIssues),
    when(r.pushedAt),
  ]),
  'No repositories loaded.',
)}

<h2>Cloudflare Workers</h2>
${table(['Worker', 'Last deployed'], s.workers.map((w) => [esc(w.name), when(w.modifiedOn)]), 'No Workers loaded.')}

<h2>Cloudflare Pages</h2>
${table(
  ['Project', 'Status', 'Last deployed'],
  s.pages.map((p) => [link(p.url, p.name), badge(p.status), when(p.deployedAt)]),
  'No Pages projects loaded.',
)}
</main>
<script>
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  for (const el of document.querySelectorAll('time')) {
    const mins = Math.round((new Date(el.dateTime) - Date.now()) / 60000);
    el.title = new Date(el.dateTime).toLocaleString();
    el.textContent = Math.abs(mins) < 60 ? rtf.format(mins, 'minute')
      : Math.abs(mins) < 1440 ? rtf.format(Math.round(mins / 60), 'hour')
      : rtf.format(Math.round(mins / 1440), 'day');
  }
</script>
</body>
</html>`;
}
