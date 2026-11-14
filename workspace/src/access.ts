import type { Env } from './types';

type AccessJwk = JsonWebKey & { kid: string };
const keyCache = new Map<string, { keys: AccessJwk[]; fetchedAt: number }>();

const decode = (part: string) => Uint8Array.from(atob(part.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const parse = (part: string) => JSON.parse(new TextDecoder().decode(decode(part))) as Record<string, unknown>;

async function accessKeys(teamDomain: string, fetcher: typeof fetch): Promise<AccessJwk[]> {
  const cached = keyCache.get(teamDomain);
  if (cached && Date.now() - cached.fetchedAt < 3_600_000) return cached.keys;
  const res = await fetcher(`https://${teamDomain}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error(`Access certs: HTTP ${res.status}`);
  const { keys } = (await res.json()) as { keys: AccessJwk[] };
  keyCache.set(teamDomain, { keys, fetchedAt: Date.now() });
  return keys;
}

/**
 * True only when the request carries a valid Cloudflare Access JWT for this
 * application. Fails closed: with Access unconfigured nothing is served, unless
 * ALLOW_UNAUTHENTICATED=true (local development only).
 */
export async function isAuthorized(request: Request, env: Env, fetcher: typeof fetch = fetch): Promise<boolean> {
  if (env.ALLOW_UNAUTHENTICATED === 'true') return true;
  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) return false;
  const token = request.headers.get('cf-access-jwt-assertion');
  if (!token) return false;
  try {
    const [h, p, s] = token.split('.');
    if (!h || !p || !s) return false;
    const header = parse(h);
    const payload = parse(p);
    if (header.alg !== 'RS256') return false;
    const jwk = (await accessKeys(env.ACCESS_TEAM_DOMAIN, fetcher)).find((k) => k.kid === header.kid);
    if (!jwk) return false;
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, decode(s), new TextEncoder().encode(`${h}.${p}`));
    if (!valid) return false;
    const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    return (
      aud.includes(env.ACCESS_AUD) &&
      payload.iss === `https://${env.ACCESS_TEAM_DOMAIN}` &&
      typeof payload.exp === 'number' &&
      payload.exp * 1000 > Date.now()
    );
  } catch {
    return false;
  }
}
