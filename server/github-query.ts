import {
  githubDebugEnabled,
  recordCoreUsage,
  recordRefreshResponse,
} from './github-debug.ts';
import { reportCachePath, refreshCache } from './refresh-cache.ts';
import { createHash } from 'node:crypto';

export type QueryResponse = {
  body: unknown;
  next: boolean;
  link: string | null;
  etag: string | null;
  checkedAt: number;
};
type Usage = {
  requests: number;
  cacheHits: number;
  coalesced: number;
  notModified: number;
  pagination: number;
  statuses: Record<string, number>;
};

const cached = new Map<string, QueryResponse>();
const pending = new Map<string, Promise<QueryResponse>>();
const usage = new Map<string, Usage>();
const retention = 2 * 60 * 60_000;

export function observeGitHub(
  repo: string,
  endpoint: string,
  event: 'request' | 'hit' | 'coalesced' | 'response',
  status?: number,
  page = false,
) {
  if (!githubDebugEnabled()) return;
  const key = `${repo} ${endpoint}`;
  if (!usage.has(key) && usage.size >= 256)
    usage.delete(usage.keys().next().value!);
  const entry = usage.get(key) ?? {
    requests: 0,
    cacheHits: 0,
    coalesced: 0,
    notModified: 0,
    pagination: 0,
    statuses: {},
  };
  if (event === 'request') {
    entry.requests++;
    if (page) entry.pagination++;
  }
  if (event === 'hit') entry.cacheHits++;
  if (event === 'coalesced') entry.coalesced++;
  if (status !== undefined) {
    entry.statuses[status] = (entry.statuses[status] ?? 0) + 1;
    if (status === 304) entry.notModified++;
  }
  usage.set(key, entry);
  if (event !== 'request') {
    const lookups = entry.requests + entry.cacheHits + entry.coalesced;
    const cacheHitRate = lookups
      ? (entry.cacheHits + entry.coalesced + entry.notModified) / lookups
      : 0;
    console.debug(
      'agentopia.github',
      JSON.stringify({ repo, endpoint, event, status, ...entry, cacheHitRate }),
    );
  }
}

export function credentialScope(token?: string) {
  return token ? createHash('sha256').update(token).digest('hex') : 'public';
}

export async function githubGet(
  url: string,
  repo: string,
  token: string | undefined,
  headers: Record<string, string>,
  ttl: number,
  check: (response: Response) => Promise<void>,
  branchProbe = false,
) {
  const requestUrl = new URL(url);
  const endpoint =
    requestUrl.pathname
      .replace(/^\/repos\/[^/]+\/[^/]+/, '')
      .replace(/\/\d+(?=\/|$)/g, '/:id') || '/';
  const scope = credentialScope(token);
  const key = `${branchProbe ? 'branch-probe:' : ''}${scope}:${url}`;
  const now = Date.now();
  const session = token ? refreshCache.getStore() : undefined;
  const resource = session && reportCachePath(requestUrl, repo);
  const entry = resource
    ? session.previous[resource]
    : token
      ? undefined
      : cached.get(key);
  const previous =
    entry && now - entry.checkedAt < retention ? entry : undefined;
  if (previous && now - previous.checkedAt < ttl) {
    if (session && resource) session.next[resource] = previous;
    observeGitHub(repo, endpoint, 'hit');
    return previous;
  }

  const requests = session?.pending ?? pending;
  const inFlight = requests.get(key);
  if (inFlight) {
    observeGitHub(repo, endpoint, 'coalesced');
    return inFlight;
  }

  const load = async () => {
    if (previous?.etag && previous.etag.length <= 512)
      headers['If-None-Match'] = previous.etag;
    observeGitHub(
      repo,
      endpoint,
      'request',
      undefined,
      Number(requestUrl.searchParams.get('page')) > 1,
    );
    const send = async () => {
      const response = await fetch(url, {
        headers,
        redirect: branchProbe ? 'manual' : 'error',
        signal: AbortSignal.timeout(9000),
      }).catch((error) => {
        recordRefreshResponse(undefined, Boolean(token));
        throw error;
      });
      recordRefreshResponse(response, Boolean(token));
      recordCoreUsage(scope, response.headers);
      observeGitHub(repo, endpoint, 'response', response.status);
      return response;
    };
    let response = await send();
    if (response.status === 304 && !previous) {
      observeGitHub(repo, endpoint, 'request');
      response = await send();
    }
    let result: QueryResponse;
    if (response.status === 304 && previous) {
      result = { ...previous, checkedAt: Date.now() };
    } else {
      // GitHub returns 301 for the old name of a renamed branch.
      const missing =
        branchProbe && (response.status === 301 || response.status === 404);
      if (!missing) {
        try {
          await check(response);
        } catch (error) {
          if (
            session &&
            resource &&
            error instanceof Error &&
            (response.status === 401 ||
              (response.status === 403 &&
                !('rateLimited' in error && error.rateLimited)) ||
              (response.status === 404 && !/^\/issues\/\d/.test(resource)))
          )
            session.denied = error;
          throw error;
        }
      }
      result = {
        body: missing ? null : await response.json(),
        etag: missing ? null : response.headers.get('etag'),
        next: /rel="next"/.test(response.headers.get('link') ?? ''),
        link: response.headers.get('link'),
        checkedAt: Date.now(),
      };
    }
    if (session && resource && (result.etag || ttl > 0))
      session.next[resource] = result;
    if (!token) {
      if (!cached.has(key) && cached.size >= 512)
        cached.delete(cached.keys().next().value!);
      cached.set(key, result);
    }
    return result;
  };
  const work = load();
  requests.set(key, work);
  try {
    return await work;
  } finally {
    if (requests.get(key) === work) requests.delete(key);
  }
}
