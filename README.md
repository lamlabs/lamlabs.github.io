# lamlabs.github.io

Organization site for [Lam Labs](https://github.com/lamlabs). Served at
<https://lamlabs.github.io>.

Built with [Astro](https://astro.build). The repo name matches the organization
name, which is what makes GitHub Pages serve it from the domain root.

## Local development

```bash
npm install
npm run dev      # http://localhost:4321
npm run build    # output in dist/
npm run preview  # serve the built output
```

## Deployment

Pushing to `main` triggers `.github/workflows/deploy.yml`, which builds the site
and publishes it with GitHub Actions. Nothing is committed to a build branch —
the output artifact is what goes live.

One-time repository setup, after the first push:

1. Settings → Pages → Build and deployment → Source: **GitHub Actions**.
2. Push to `main`, or run the workflow manually from the Actions tab.

If the deploy step fails with an OIDC or permissions error, check that the
workflow still declares `pages: write` and `id-token: write`.

## Editing content

- `src/pages/index.astro` — the landing page. Each file here becomes a route.
- `public/` — static assets copied as-is. `public/favicon.svg` is the tab icon.
- `astro.config.mjs` — sets `site` to `https://lamlabs.github.io`.

## Adding a custom domain

1. Set `site` in `astro.config.mjs` to the new domain.
2. Add `public/CNAME` containing just the bare domain, e.g. `lamlabs.dev`.
3. Point DNS at GitHub Pages, then set the domain in Settings → Pages.

## Requirements

Node 22.12 or newer — that is the floor Astro 7.3.8 declares in its `engines`
field. The workflow uses Node 24, the default in `withastro/action`.
