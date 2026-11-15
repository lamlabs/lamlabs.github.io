// Live session state, fed by Claude Code hooks. No I/O: the server passes events in
// and turns the returned promise into the hook's HTTP response.
import { randomUUID } from 'node:crypto';

/** Status after each hook event. Events not listed leave the status unchanged. */
const NEXT_STATUS = {
  SessionStart: 'idle',
  UserPromptSubmit: 'running',
  PreToolUse: 'running',
  PostToolUse: 'running',
  PostToolUseFailure: 'running',
  PermissionRequest: 'needs-you',
  Stop: 'idle',
  StopFailure: 'failed',
  SessionEnd: 'ended',
};

/** Events after which a pending permission request can no longer be waiting. */
const SETTLES = new Set(['PostToolUse', 'PostToolUseFailure', 'Stop', 'StopFailure', 'SessionEnd', 'UserPromptSubmit']);

const sameInput = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export class Hub {
  /** @param {{ holdMs?: number, now?: () => number }} opts holdMs must stay below the hook timeout. */
  constructor({ holdMs = 590_000, now = Date.now } = {}) {
    this.holdMs = holdMs;
    this.now = now;
    this.sessions = new Map(); // session_id -> { id, cwd, transcriptPath, status, lastTool, at }
    this.pending = new Map(); // request id -> { id, sessionId, tool, input, at, resolve, timer }
  }

  /**
   * Record one hook event. Resolves with the JSON body to send back to Claude Code.
   * A PermissionRequest stays open until decide() is called, the user answers in the
   * terminal (a settling event arrives), or holdMs passes. An empty body leaves the
   * decision to Claude Code's own dialog.
   */
  handle(event, { pane = null } = {}) {
    const id = event?.session_id;
    const name = event?.hook_event_name;
    if (!id || !name) return Promise.resolve({});

    const prev = this.sessions.get(id);
    const s = prev ?? { id, cwd: null, transcriptPath: null, pane: null, status: 'idle', lastTool: null, at: null };
    if (pane) s.pane = pane;
    s.cwd = event.cwd ?? s.cwd;
    s.transcriptPath = event.transcript_path ?? s.transcriptPath;
    s.at = this.now();
    if (event.tool_name) s.lastTool = event.tool_name;
    this.sessions.set(id, s);

    if (SETTLES.has(name)) this.#settle(id, name === 'PostToolUse' || name === 'PostToolUseFailure' ? event : null);
    if (NEXT_STATUS[name]) s.status = NEXT_STATUS[name];
    // A tool finishing while another request is still open keeps the session waiting.
    if (s.status !== 'ended' && this.#pendingFor(id).length) s.status = 'needs-you';

    if (name !== 'PermissionRequest') return Promise.resolve({});
    let req;
    const promise = new Promise((resolve) => {
      req = { id: randomUUID(), sessionId: id, tool: event.tool_name ?? null, input: event.tool_input ?? null, at: this.now(), resolve: null, timer: null };
      req.resolve = (body) => {
        clearTimeout(req.timer);
        this.pending.delete(req.id);
        const sess = this.sessions.get(id);
        if (sess?.status === 'needs-you' && !this.#pendingFor(id).length) sess.status = 'running';
        resolve(body);
      };
      req.timer = setTimeout(() => req.resolve({}), this.holdMs);
      this.pending.set(req.id, req);
    });
    promise.cancel = () => this.pending.has(req.id) && req.resolve({});
    return promise;
  }

  /** The newest session seen in a tmux pane, e.g. "%3". */
  byPane(pane) {
    let best = null;
    for (const s of this.sessions.values()) if (s.pane === pane && (!best || s.at > best.at)) best = s;
    return best;
  }

  /** Answer a pending request from the dashboard. Returns false if it is already gone. */
  decide(requestId, behavior, message) {
    const req = this.pending.get(requestId);
    if (!req) return false;
    if (behavior !== 'allow' && behavior !== 'deny') throw new Error('behavior must be allow or deny');
    const decision = behavior === 'allow' ? { behavior } : { behavior, message: message || 'Denied from Workbench' };
    req.resolve({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision } });
    return true;
  }

  /** Pending requests, oldest first, without internals. */
  inbox() {
    return [...this.pending.values()]
      .sort((a, b) => a.at - b.at)
      .map(({ id, sessionId, tool, input, at }) => ({ id, sessionId, tool, input, at: new Date(at).toISOString() }));
  }

  session(id) {
    return this.sessions.get(id) ?? null;
  }

  #pendingFor(sessionId) {
    return [...this.pending.values()].filter((r) => r.sessionId === sessionId);
  }

  /** Close requests the terminal already answered: the matching one for a tool event, all of them otherwise. */
  #settle(sessionId, toolEvent) {
    const reqs = this.#pendingFor(sessionId);
    const done = toolEvent
      ? reqs.filter((r) => r.tool === toolEvent.tool_name && sameInput(r.input, toolEvent.tool_input)).slice(0, 1)
      : reqs;
    for (const r of done) r.resolve({});
  }
}
