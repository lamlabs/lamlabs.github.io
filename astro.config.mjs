// @ts-check
import { defineConfig } from 'astro/config';

// This is an organization site repo (<org>.github.io), so it is served from the
// domain root. If a custom domain is added later, update `site` to that domain
// and add a `public/CNAME` file with the bare domain name.
export default defineConfig({
  site: 'https://lamlabs.github.io',
  base: '/',
});
