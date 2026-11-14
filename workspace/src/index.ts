import { isAuthorized } from './access';
import { render } from './render';
import { load, refresh } from './snapshot';
import type { Env } from './types';

export default {
  async fetch(request, env): Promise<Response> {
    if (!(await isAuthorized(request, env))) return new Response('Forbidden', { status: 403 });

    const { pathname } = new URL(request.url);
    if (pathname === '/api/refresh' && request.method === 'POST') {
      return Response.json(await refresh(env));
    }
    if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 });

    // First visit after a deploy: nothing cached yet, so collect once inline.
    const snapshot = (await load(env)) ?? (await refresh(env));
    if (pathname === '/api/snapshot') return Response.json(snapshot);
    if (pathname === '/') {
      return new Response(render(snapshot), {
        headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
      });
    }
    return new Response('Not found', { status: 404 });
  },

  async scheduled(_controller, env): Promise<void> {
    await refresh(env);
  },
} satisfies ExportedHandler<Env>;
