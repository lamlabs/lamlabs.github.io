import { describe, expect, it } from 'vitest';
import { isAuthorized } from '../src/access';
import worker from '../src/index';
import { render } from '../src/render';
import { collect } from '../src/snapshot';
import type { Env, Snapshot } from '../src/types';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function fakeKv(): KVNamespace {
  const store = new Map<string, string>();
  return {
    get: async (key: string, type?: string) => {
      const v = store.get(key);
      return v == null ? null : type === 'json' ? JSON.parse(v) : v;
    },
    put: async (key: string, value: string) => void store.set(key, value),
  } as unknown as KVNamespace;
}

const env = (over: Partial<Env> = {}): Env => ({
  CACHE: fakeKv(),
  GITHUB_OWNERS: 'acme',
  ACCESS_TEAM_DOMAIN: '',
  ACCESS_AUD: '',
  ...over,
});

const repoNode = (name: string, state: string | null, pushedAt: string) => ({
  name,
  url: `https://github.com/acme/${name}`,
  isPrivate: false,
  pushedAt,
  pullRequests: { totalCount: 2 },
  issues: { totalCount: 1 },
  defaultBranchRef: { target: { statusCheckRollup: state ? { state } : null } },
});

const upstream: typeof fetch = async (input) => {
  const url = String(input);
  if (url.includes('api.github.com')) {
    return json({
      data: {
        repositoryOwner: {
          repositories: { nodes: [repoNode('old', 'SUCCESS', '2026-01-01T00:00:00Z'), repoNode('new', 'FAILURE', '2026-06-01T00:00:00Z')] },
        },
      },
    });
  }
  if (url.endsWith('/workers/scripts')) return json({ success: true, result: [{ id: 'api', modified_on: '2026-05-01T00:00:00Z' }] });
  return json({ success: false, errors: [{ message: 'Authentication error' }] }, 403);
};

describe('collect', () => {
  it('merges sources, sorts repos by last push, and isolates a failing source', async () => {
    const s = await collect(env({ GITHUB_TOKEN: 't', CLOUDFLARE_API_TOKEN: 't', CLOUDFLARE_ACCOUNT_ID: 'a' }), upstream);
    expect(s.repos.map((r) => r.name)).toEqual(['new', 'old']);
    expect(s.repos[0]).toMatchObject({ owner: 'acme', ci: 'FAILURE', openPrs: 2, openIssues: 1 });
    expect(s.workers).toEqual([{ name: 'api', modifiedOn: '2026-05-01T00:00:00Z' }]);
    expect(s.pages).toEqual([]);
    expect(s.errors).toEqual(['Cloudflare /pages/projects: Authentication error']);
  });

  it('reports missing credentials instead of calling upstream', async () => {
    const s = await collect(env(), async () => {
      throw new Error('should not fetch');
    });
    expect(s.errors).toHaveLength(2);
  });
});

describe('render', () => {
  it('escapes upstream text and refuses non-https links', () => {
    const s: Snapshot = {
      generatedAt: '2026-06-01T00:00:00Z',
      repos: [{ owner: 'a', name: '<script>x</script>', url: 'javascript:alert(1)', isPrivate: true, pushedAt: null, openPrs: 0, openIssues: 0, ci: null }],
      workers: [],
      pages: [],
      errors: ['<b>boom</b>'],
    };
    const html = render(s);
    expect(html).not.toContain('<script>x</script>');
    expect(html).not.toContain('javascript:alert');
    expect(html).toContain('&lt;b&gt;boom&lt;/b&gt;');
  });
});

describe('access', () => {
  const b64url = (data: ArrayBuffer | string) =>
    btoa(typeof data === 'string' ? data : String.fromCharCode(...new Uint8Array(data)))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

  async function setup(team: string) {
    const pair = (await crypto.subtle.generateKey(
      { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
      true,
      ['sign', 'verify'],
    )) as CryptoKeyPair;
    const jwk = { ...((await crypto.subtle.exportKey('jwk', pair.publicKey)) as JsonWebKey), kid: 'k1' };
    const certs: typeof fetch = async () => json({ keys: [jwk] });
    const sign = async (claims: object) => {
      const body = `${b64url(JSON.stringify({ alg: 'RS256', kid: 'k1' }))}.${b64url(JSON.stringify(claims))}`;
      const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(body));
      return `${body}.${b64url(sig)}`;
    };
    const check = (token: string | null, aud = 'aud1') =>
      isAuthorized(
        new Request('https://x.test/', { headers: token ? { 'cf-access-jwt-assertion': token } : {} }),
        env({ ACCESS_TEAM_DOMAIN: team, ACCESS_AUD: aud }),
        certs,
      );
    return { sign, check };
  }

  const future = () => Math.floor(Date.now() / 1000) + 600;

  it('accepts a valid token and rejects wrong audience, expiry, tampering, and absence', async () => {
    const team = 'team.cloudflareaccess.com';
    const { sign, check } = await setup(team);
    const good = { aud: ['aud1'], iss: `https://${team}`, exp: future() };

    expect(await check(await sign(good))).toBe(true);
    expect(await check(await sign(good), 'other')).toBe(false);
    expect(await check(await sign({ ...good, exp: 1 }))).toBe(false);
    expect(await check(await sign({ ...good, iss: 'https://evil.example' }))).toBe(false);
    const [h, , s] = (await sign(good)).split('.');
    expect(await check(`${h}.${b64url(JSON.stringify({ ...good, aud: ['aud1'], sub: 'x' }))}.${s}`)).toBe(false);
    expect(await check(null)).toBe(false);
  });

  it('fails closed when Access is not configured', async () => {
    expect(await isAuthorized(new Request('https://x.test/'), env())).toBe(false);
    const res = await worker.fetch(new Request("https://x.test/") as never, env());
    expect(res.status).toBe(403);
  });
});
