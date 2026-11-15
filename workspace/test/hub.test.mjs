import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Hub } from '../hub.mjs';

const ev = (name, extra = {}) => ({ session_id: 's1', hook_event_name: name, cwd: '/p', transcript_path: '/t.jsonl', ...extra });
const bash = (cmd) => ({ tool_name: 'Bash', tool_input: { command: cmd } });
const tick = () => new Promise((r) => setImmediate(r));

test('status follows the hook events', async () => {
  const hub = new Hub();
  await hub.handle(ev('SessionStart'), { pane: '%3' });
  assert.equal(hub.session('s1').status, 'idle');
  assert.equal(hub.byPane('%3').id, 's1');
  await hub.handle(ev('UserPromptSubmit'));
  assert.equal(hub.session('s1').status, 'running');
  await hub.handle(ev('Stop'));
  assert.equal(hub.session('s1').status, 'idle');
  await hub.handle(ev('SessionEnd'));
  assert.equal(hub.session('s1').status, 'ended');
});

test('a permission request waits for the dashboard decision', async () => {
  const hub = new Hub();
  const answer = hub.handle(ev('PermissionRequest', bash('npm test')));
  assert.equal(hub.session('s1').status, 'needs-you');
  const [item] = hub.inbox();
  assert.deepEqual([item.tool, item.input], ['Bash', { command: 'npm test' }]);
  assert.equal(hub.decide(item.id, 'allow'), true);
  assert.deepEqual(await answer, { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } } });
  assert.equal(hub.inbox().length, 0);
  assert.equal(hub.session('s1').status, 'running');
  assert.equal(hub.decide(item.id, 'allow'), false);
});

test('deny carries a message', async () => {
  const hub = new Hub();
  const answer = hub.handle(ev('PermissionRequest', bash('rm -rf x')));
  hub.decide(hub.inbox()[0].id, 'deny');
  assert.equal((await answer).hookSpecificOutput.decision.behavior, 'deny');
  assert.ok((await answer).hookSpecificOutput.decision.message);
});

test('answering in the terminal clears only the matching item', async () => {
  const hub = new Hub();
  const a = hub.handle(ev('PermissionRequest', bash('npm test')));
  hub.handle(ev('PermissionRequest', bash('npm run lint')));
  await hub.handle(ev('PostToolUse', bash('npm test')));
  assert.deepEqual(await a, {});
  assert.deepEqual(hub.inbox().map((i) => i.input.command), ['npm run lint']);
  assert.equal(hub.session('s1').status, 'needs-you');
  await hub.handle(ev('Stop'));
  assert.equal(hub.inbox().length, 0);
  assert.equal(hub.session('s1').status, 'idle');
});

test('a closed hook connection or the hold timeout clears the item', async () => {
  const hub = new Hub({ holdMs: 20 });
  const a = hub.handle(ev('PermissionRequest', bash('x')));
  a.cancel();
  assert.deepEqual(await a, {});
  const b = hub.handle(ev('PermissionRequest', bash('y')));
  await tick();
  assert.equal(hub.inbox().length, 1);
  assert.deepEqual(await b, {});
  assert.equal(hub.inbox().length, 0);
});

test('events without a session are ignored', async () => {
  const hub = new Hub();
  assert.deepEqual(await hub.handle({ hook_event_name: 'Stop' }), {});
  assert.equal(hub.sessions.size, 0);
});

test('activity and last message come from the hooks', async () => {
  let t = 1000;
  const hub = new Hub({ now: () => t });
  await hub.handle(ev('UserPromptSubmit'));
  assert.equal(hub.session('s1').activity, 'Thinking');
  await hub.handle(ev('PreToolUse', bash('npm test\nsecond line')));
  assert.equal(hub.session('s1').activity, 'Bash npm test');
  t = 2000;
  await hub.handle(ev('Stop', { last_assistant_message: 'Fixed the null check.\nMore detail.' }));
  assert.deepEqual([hub.session('s1').activity, hub.session('s1').lastMessage, hub.session('s1').stoppedAt], [null, 'Fixed the null check.', 2000]);
});
