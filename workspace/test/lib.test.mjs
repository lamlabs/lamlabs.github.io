import assert from 'node:assert/strict';
import { test } from 'node:test';
import { githubSlug, mergeStatus, parseGitStatus, parseTranscript, safeJoin, screenStatus, slug } from '../lib.mjs';

test('safeJoin keeps paths inside the root', () => {
  assert.equal(safeJoin('/p', 'src/a.ts'), '/p/src/a.ts');
  assert.equal(safeJoin('/p', '../etc/passwd'), null);
  assert.equal(safeJoin('/p', '/etc/passwd'), null);
  assert.equal(safeJoin('/p', '../p2/x'), null);
});

test('slug makes tmux-safe names', () => {
  assert.equal(slug('My Project: fix #12'), 'my-project-fix-12');
});

test('parseTranscript keeps chat and tool lines, drops the rest', () => {
  const lines = [
    { type: 'user', message: { content: 'hello' }, timestamp: 't1' },
    { type: 'assistant', message: { content: [{ type: 'thinking', thinking: 'x' }] } },
    { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'npm test\nmore' } }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', content: 'ok' }] } },
    { type: 'user', isMeta: true, message: { content: 'meta' } },
    { type: 'attachment' },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'Done.' }] } },
  ];
  const text = lines.map((l) => JSON.stringify(l)).join('\n') + '\n{"type":"assistant","mess';
  assert.deepEqual(
    parseTranscript(text).map(({ role, text }) => [role, text]),
    [['user', 'hello'], ['tool', 'Bash: npm test'], ['assistant', 'Done.']],
  );
});

test('screenStatus reads the Claude Code screen', () => {
  assert.equal(screenStatus('…\n✻ Thinking… (esc to interrupt)', false), 'working');
  assert.equal(screenStatus('Do you want to proceed?\n❯ 1. Yes\n  2. No', false), 'needs-you');
  assert.equal(screenStatus('Do you want to proceed?\n❯ 1. Yes' + '\n'.repeat(40), false), 'needs-you');
  assert.equal(screenStatus('> ', false), 'idle');
  assert.equal(screenStatus('anything', true), 'ended');
  assert.equal(screenStatus(' Quick safety check: Is this a project you created or one you trust?', false), 'needs-trust');
});

test('parseGitStatus counts changes and ahead/behind', () => {
  const s = parseGitStatus('# branch.oid abc\n# branch.head main\n# branch.ab +2 -1\n1 .M N... a\n? b\n');
  assert.deepEqual(s, { branch: 'main', ahead: 2, behind: 1, changed: 2 });
});

test('githubSlug reads https and ssh remotes', () => {
  assert.equal(githubSlug('https://github.com/acme/app.git\n'), 'acme/app');
  assert.equal(githubSlug('git@github.com:acme/app.git'), 'acme/app');
  assert.equal(githubSlug('https://gitlab.com/acme/app'), null);
});

test('mergeStatus prefers hooks but trusts a visible prompt or a quiet screen', () => {
  const now = 100_000;
  assert.equal(mergeStatus(null, 'working', now), 'running');
  assert.equal(mergeStatus(null, 'idle', now), 'idle');
  assert.equal(mergeStatus({ status: 'running', at: now - 1000 }, 'idle', now), 'running');
  assert.equal(mergeStatus({ status: 'running', at: now - 20_000 }, 'idle', now), 'idle');
  assert.equal(mergeStatus({ status: 'running', at: now }, 'needs-you', now), 'needs-you');
  assert.equal(mergeStatus({ status: 'idle', at: now }, 'needs-trust', now), 'needs-trust');
  assert.equal(mergeStatus({ status: 'running', at: now }, 'ended', now), 'ended');
});
