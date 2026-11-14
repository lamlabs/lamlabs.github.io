import type { PagesProject, WorkerScript } from './types';

async function cf<T>(path: string, accountId: string, token: string, fetcher: typeof fetch): Promise<T> {
  const res = await fetcher(`https://api.cloudflare.com/client/v4/accounts/${accountId}${path}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const body = (await res.json().catch(() => null)) as {
    success?: boolean;
    result?: T;
    errors?: { message: string }[];
  } | null;
  if (!res.ok || !body?.success || body.result == null) {
    throw new Error(`Cloudflare ${path}: ${body?.errors?.[0]?.message ?? `HTTP ${res.status}`}`);
  }
  return body.result;
}

export async function fetchWorkers(accountId: string, token: string, fetcher: typeof fetch = fetch): Promise<WorkerScript[]> {
  const scripts = await cf<{ id: string; modified_on?: string }[]>('/workers/scripts', accountId, token, fetcher);
  return scripts.map((s) => ({ name: s.id, modifiedOn: s.modified_on ?? null }));
}

export async function fetchPages(accountId: string, token: string, fetcher: typeof fetch = fetch): Promise<PagesProject[]> {
  const projects = await cf<
    {
      name: string;
      subdomain?: string;
      latest_deployment?: { created_on?: string; latest_stage?: { status?: string } } | null;
    }[]
  >('/pages/projects', accountId, token, fetcher);
  return projects.map((p) => ({
    name: p.name,
    url: p.subdomain ? `https://${p.subdomain}` : null,
    deployedAt: p.latest_deployment?.created_on ?? null,
    status: p.latest_deployment?.latest_stage?.status ?? null,
  }));
}
