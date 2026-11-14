# Workspace

One page showing the state of our projects: GitHub repositories (CI status,
open pull requests and issues, last push) and Cloudflare Workers and Pages
(last deploy). It runs as a single Cloudflare Worker behind Cloudflare Access.

This folder is also the reference project. `CLAUDE.md` holds the rules that
Claude Code and people follow here, and that new projects copy.

> It currently lives in a subfolder of `lamlabs.github.io`. The workflows in
> `.github/workflows/` only run once this folder is the root of its own
> repository.

## How it works

```
cron (every 15 min) ──> GitHub GraphQL API ─┐
                        Cloudflare REST API ─┴─> snapshot ──> KV
browser ──> Cloudflare Access ──> Worker ──> reads KV ──> HTML
```

| Route | Purpose |
| --- | --- |
| `GET /` | The dashboard page |
| `GET /api/snapshot` | The same data as JSON |
| `POST /api/refresh` | Collect now instead of waiting for the cron |

## Local development

```bash
npm install
cp .dev.vars.example .dev.vars   # fill in the tokens
npm run dev
```

`npm run verify` runs the type check, the tests, and a dry-run bundle.

## First deploy

1. **Tokens.**
   - GitHub: a fine-grained personal access token with read access to
     Metadata, Pull requests, Issues, and Commit statuses on the repos to track.
   - Cloudflare: an API token with `Workers Scripts: Read` and
     `Cloudflare Pages: Read` on the account.
2. **Deploy.** `npx wrangler deploy` creates the Worker and its KV namespace.
3. **Secrets.**
   ```bash
   npx wrangler secret put GITHUB_TOKEN
   npx wrangler secret put CLOUDFLARE_API_TOKEN
   npx wrangler secret put CLOUDFLARE_ACCOUNT_ID
   ```
4. **Access.** In Cloudflare Zero Trust, add a self-hosted Access application
   for the Worker's hostname with a policy that allows only you. Put the team
   domain and the application's AUD tag into `ACCESS_TEAM_DOMAIN` and
   `ACCESS_AUD` in `wrangler.jsonc`, then deploy again. Until both are set the
   Worker answers 403 to everything.
5. **Automatic deploys.** Add `CLOUDFLARE_API_TOKEN` (with `Workers Scripts:
   Edit` and `Workers KV Storage: Edit`) and `CLOUDFLARE_ACCOUNT_ID` as GitHub
   Actions secrets. Every push to `main` then deploys.

## Configuration

| Name | Where | Meaning |
| --- | --- | --- |
| `GITHUB_OWNERS` | `wrangler.jsonc` vars | Comma-separated users or organizations to track |
| `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD` | `wrangler.jsonc` vars | Cloudflare Access application to trust |
| `GITHUB_TOKEN`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | Worker secrets | Read credentials for the two APIs |
| `ALLOW_UNAUTHENTICATED` | `.dev.vars` only | `true` skips the Access check locally |
