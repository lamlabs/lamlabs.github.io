// Pure helpers: no processes, no I/O. Everything here is unit-tested.
import path from 'node:path';

/** Resolve `rel` inside `root`, or return null if it would escape it. */
export function safeJoin(root, rel) {
  const full = path.resolve(root, rel);
  return full === root || full.startsWith(root + path.sep) ? full : null;
}

/** tmux session names we own: "cc-" plus a slug. */
export const PREFIX = 'cc-';
export function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
}

/** One short line describing a tool call, e.g. "Bash: npm test". */
function describeTool(block) {
  const i = block.input ?? {};
  const detail = i.command ?? i.file_path ?? i.path ?? i.pattern ?? i.url ?? i.description ?? '';
  return `${block.name}${detail ? `: ${String(detail).split('\n')[0].slice(0, 160)}` : ''}`;
}

/**
 * Turn a Claude Code transcript (.jsonl text) into chat messages:
 * { role: 'user' | 'assistant' | 'tool', text, at }.
 * Tool results, thinking and bookkeeping entries are left out.
 */
export function parseTranscript(jsonl) {
  const out = [];
  for (const line of jsonl.split('\n')) {
    if (!line.trim()) continue;
    let d;
    try {
      d = JSON.parse(line);
    } catch {
      continue; // a half-written last line while Claude is still writing
    }
    if ((d.type !== 'user' && d.type !== 'assistant') || d.isMeta || d.isSidechain) continue;
    const content = d.message?.content;
    const at = d.timestamp ?? null;
    if (typeof content === 'string') {
      if (content.trim()) out.push({ role: d.type, text: content, at });
      continue;
    }
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block.type === 'text' && block.text?.trim()) out.push({ role: d.type, text: block.text, at });
      else if (block.type === 'tool_use') out.push({ role: 'tool', text: describeTool(block), at });
    }
  }
  return out;
}

/**
 * What a Claude Code session is doing, read from its terminal screen.
 * This is a heuristic on the text Claude Code prints; adjust the patterns
 * here if a Claude Code update changes them.
 */
export function screenStatus(screen, paneDead) {
  if (paneDead) return 'exited';
  // capture-pane pads the screen with blank lines, so trim before taking the bottom.
  const tail = screen.trimEnd().split('\n').slice(-25).join('\n');
  if (/Do you want to|Would you like to|❯ 1\. Yes/i.test(tail)) return 'needs-you';
  if (/esc to interrupt/i.test(tail)) return 'working';
  return 'idle';
}

/** Parse `git status --porcelain=v2 --branch` into a small summary. */
export function parseGitStatus(text) {
  const s = { branch: null, ahead: 0, behind: 0, changed: 0 };
  for (const line of text.split('\n')) {
    if (line.startsWith('# branch.head ')) s.branch = line.slice(14);
    else if (line.startsWith('# branch.ab ')) {
      const m = line.match(/\+(\d+) -(\d+)/);
      if (m) [s.ahead, s.behind] = [Number(m[1]), Number(m[2])];
    } else if (line && !line.startsWith('#')) s.changed++;
  }
  return s;
}

/** "owner/repo" from a GitHub remote URL, or null. */
export function githubSlug(remote) {
  const m = String(remote).trim().match(/github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/);
  return m ? m[1] : null;
}
