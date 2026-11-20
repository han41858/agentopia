import { createHash } from 'node:crypto';

type QueryResponse = {
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
  if (process.env.AGENTOPIA_GITHUB_DEBUG !== '1') return;
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
) {
  const requestUrl = new URL(url);
  const endpoint =
    requestUrl.pathname
      .replace(/^\/repos\/[^/]+\/[^/]+/, '')
      .replace(/\/\d+(?=\/|$)/g, '/:id') || '/';
  const key = `${credentialScope(token)}:${url}`;
  const now = Date.now();
  const entry = token ? undefined : cached.get(key);
  const previous =
    entry && now - entry.checkedAt < retention ? entry : undefined;
  if (previous && now - previous.checkedAt < ttl) {
    observeGitHub(repo, endpoint, 'hit');
    return previous;
  }

  const inFlight = pending.get(key);
  if (inFlight) {
    observeGitHub(repo, endpoint, 'coalesced');
    return inFlight;
  }

  const load = async () => {
    if (previous?.etag) headers['If-None-Match'] = previous.etag;
    observeGitHub(
      repo,
      endpoint,
      'request',
      undefined,
      Number(requestUrl.searchParams.get('page')) > 1,
    );
    const response = await fetch(url, {
      headers,
      redirect: 'error',
      signal: AbortSignal.timeout(9000),
    });
    observeGitHub(repo, endpoint, 'response', response.status);
    let result: QueryResponse;
    if (response.status === 304 && previous) {
      result = { ...previous, checkedAt: Date.now() };
    } else {
      await check(response);
      result = {
        body: await response.json(),
        etag: response.headers.get('etag'),
        next: /rel="next"/.test(response.headers.get('link') ?? ''),
        link: response.headers.get('link'),
        checkedAt: Date.now(),
      };
    }
    if (!token) {
      if (!cached.has(key) && cached.size >= 512)
        cached.delete(cached.keys().next().value!);
      cached.set(key, result);
    }
    return result;
  };
  const work = load();
  pending.set(key, work);
  try {
    return await work;
  } finally {
    if (pending.get(key) === work) pending.delete(key);
  }
}
