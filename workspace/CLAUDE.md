# Workspace

A Cloudflare Worker that shows the state of our GitHub repos and Cloudflare
deployments on one page. It is also the reference project: new projects copy
its layout, scripts, workflows, and the rules below.

## Commands

- `npm run verify` — type check, tests, dry-run bundle. Must pass before every commit; CI runs the same command.
- `npm run dev` — local Worker on http://localhost:8787 (copy `.dev.vars.example` to `.dev.vars` first).
- `npm run deploy` — manual deploy. Normally `main` deploys itself through `.github/workflows/deploy.yml`.

## Layout

- `src/index.ts` — routes and the cron handler. No logic beyond dispatch.
- `src/github.ts`, `src/cloudflare.ts` — one file per upstream. Each exports plain functions that take credentials and a `fetch`, and return our own types.
- `src/snapshot.ts` — collects all sources into one `Snapshot` and stores it in KV.
- `src/access.ts` — Cloudflare Access JWT check.
- `src/render.ts` — the HTML page, a pure function of `Snapshot`.
- `src/types.ts` — `Env` and the snapshot shape. Change the shape here first.

## Rules

1. **Fail closed.** Without valid Cloudflare Access configuration the Worker returns 403. Never add a route in front of the `isAuthorized` check.
2. **Secrets are never in the repo.** Tokens are Worker secrets (`wrangler secret put`) or GitHub Actions secrets. `wrangler.jsonc` holds only non-secret `vars` and no account-specific IDs.
3. **Requests read, the cron writes.** Page views read the KV snapshot. Only the scheduled handler and `POST /api/refresh` call upstream APIs.
4. **One source failing never blanks the page.** Each source is collected independently; a failure is recorded in `snapshot.errors` and shown on the page.
5. **Escape everything from upstream.** All rendered text goes through `esc()`, and links must be `https://`.
6. **Upstream calls take an injectable `fetch`.** Tests pass a fake; no test touches the network.
7. **No runtime dependencies** unless the platform cannot do it. Dev dependencies are fine.
8. **`main` is always deployable.** Work on a branch, open a pull request, merge only when CI is green.

## Adding a data source

1. Add its type to `Snapshot` in `src/types.ts`.
2. Add `src/<source>.ts` with a fetch function that takes credentials and `fetcher`.
3. Register it in `collect()` in `src/snapshot.ts` through `run()`.
4. Add a section in `src/render.ts`.
5. Add a test in `test/` covering success and failure of the source.
