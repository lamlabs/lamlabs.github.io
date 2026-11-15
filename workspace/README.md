# Workbench

A local, desktop-first dashboard for Claude Code sessions running in tmux on
this Mac: sessions grouped by task, a "needs you" inbox, and chat with any
session. GitHub holds code, issues and CI; Cloudflare holds deployments.

```bash
npm start   # http://127.0.0.1:4747
npm test
```

No dependencies. Needs `node` 22+, `git`, `tmux` and `claude` (tested with Claude Code 2.1.325).
Projects are the git repos under `~/code` (set `PROJECTS_ROOT` to change it).

## How it works

```
Claude Code ──http hooks──▶ Workbench (127.0.0.1:4747) ◀── browser
     ▲                         │ PermissionRequest is held until you click Allow or Deny
     └──── tmux paste/keys ────┘
```

- **Status** comes from Claude Code hooks, with the tmux screen as a fallback after a restart or an Esc.
- **Needs you** lists every waiting permission prompt. Answering in the terminal also works and clears the item.
- **Chat** reads the session transcript and types into the tmux pane. Sending is blocked while a prompt is open, so Enter can't pick a dialog option by accident.
- **List order** follows what you have to do: Needs you, To review (finished since you last looked), Working, then Idle and Ended.
- **Keyboard**: `J`/`K` move between sessions, `A`/`D` allow or deny the oldest prompt, `/` focuses the message box, `N` starts a session, `⌘↩` sends.
- **Notifications**: the browser notifies you when a session needs you or finishes while the tab is in the background.
- **Security**: the server listens on 127.0.0.1 only, checks the Host and Origin headers, and requires a token that the page gets at load.

If Workbench is not running, Claude Code works as usual; it only prints a short "hook error" line.

## Claude Code setup

| Level | File | In git |
| --- | --- | --- |
| Global (you, every repo) | `~/.claude/CLAUDE.md`, `~/.claude/settings.json` | No. Templates in `setup/global/` |
| Project (everyone, this repo) | `CLAUDE.md`, `.claude/settings.json` | Yes |
| Local (you, this repo) | `.claude/settings.local.json` | No |

The hooks that feed Workbench live in the global settings, so every Claude Code
session on the Mac reports to it. `setup/hooks.json` holds the same hooks on their own,
for `claude --settings setup/hooks.json` if you prefer not to install them globally.

Install the global templates once:

```bash
mkdir -p ~/.claude && cp -n setup/global/CLAUDE.md setup/global/settings.json ~/.claude/
```

`-n` never overwrites files you already have; merge by hand if they exist.
