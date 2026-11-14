import { fetchPages, fetchWorkers } from './cloudflare';
import { fetchRepos } from './github';
import type { Env, Snapshot } from './types';

const KEY = 'snapshot';

/**
 * Collect every source independently. A failing source becomes an entry in
 * `errors` instead of failing the whole snapshot.
 */
export async function collect(env: Env, fetcher: typeof fetch = fetch): Promise<Snapshot> {
  const snapshot: Snapshot = { generatedAt: new Date().toISOString(), repos: [], workers: [], pages: [], errors: [] };
  const run = async (label: string, task: () => Promise<void>) => {
    try {
      await task();
    } catch (err) {
      snapshot.errors.push(err instanceof Error ? err.message : `${label}: ${String(err)}`);
    }
  };

  const tasks: Promise<void>[] = [];
  const owners = env.GITHUB_OWNERS.split(',').map((o) => o.trim()).filter(Boolean);
  if (env.GITHUB_TOKEN) {
    const token = env.GITHUB_TOKEN;
    for (const owner of owners) {
      tasks.push(run(`GitHub ${owner}`, async () => void snapshot.repos.push(...(await fetchRepos(owner, token, fetcher)))));
    }
  } else {
    snapshot.errors.push('GitHub: GITHUB_TOKEN is not set');
  }

  if (env.CLOUDFLARE_API_TOKEN && env.CLOUDFLARE_ACCOUNT_ID) {
    const [id, token] = [env.CLOUDFLARE_ACCOUNT_ID, env.CLOUDFLARE_API_TOKEN];
    tasks.push(run('Cloudflare Workers', async () => void (snapshot.workers = await fetchWorkers(id, token, fetcher))));
    tasks.push(run('Cloudflare Pages', async () => void (snapshot.pages = await fetchPages(id, token, fetcher))));
  } else {
    snapshot.errors.push('Cloudflare: CLOUDFLARE_API_TOKEN or CLOUDFLARE_ACCOUNT_ID is not set');
  }

  await Promise.all(tasks);
  snapshot.repos.sort((a, b) => (b.pushedAt ?? '').localeCompare(a.pushedAt ?? ''));
  return snapshot;
}

export async function refresh(env: Env, fetcher: typeof fetch = fetch): Promise<Snapshot> {
  const snapshot = await collect(env, fetcher);
  await env.CACHE.put(KEY, JSON.stringify(snapshot));
  return snapshot;
}

export async function load(env: Env): Promise<Snapshot | null> {
  return env.CACHE.get<Snapshot>(KEY, 'json');
}
