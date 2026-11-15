# Workbench

Local dashboard for Claude Code sessions in tmux. Plain Node, no dependencies.

## Commands
- `npm start` — server on http://127.0.0.1:4747
- `npm test` — must pass before every commit

## Layout
- `server.mjs` — HTTP routes; shells out to git, tmux, claude, gh
- `hub.mjs` — live session state from hooks; holds permission requests for the inbox
- `lib.mjs` — pure parsing helpers; unit-tested in `test/`
- `public/` — the UI (plain HTML, CSS, JS)

## Rules
1. Listen on 127.0.0.1 only. Never add a route that runs a command from request input without validating it.
2. No runtime dependencies.
3. New parsing logic goes in `lib.mjs` with a test.
4. Session status comes from Claude Code hooks; the screen is only a fallback (`mergeStatus`).
5. Never send text into a pane that shows a dialog.

## Roadmap
- v1 (done): sessions grouped by task, hook-fed status, "needs you" inbox, chat
- v1.1: PR/CI link per session, optional worktree per session
- v2: a task lead session that spawns workers in worktrees
- v3: a primary orchestrator over tasks
