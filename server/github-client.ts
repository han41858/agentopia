import { credentialScope, githubGet, observeGitHub } from './github-query.ts';
import type { Region } from './model.ts';

export const publicReportTtl = 60_000;

// Shared with the public report cache; held in an object so that both modules
// read and update the same value.
export const publicRateLimit: {
  current?: { until: number; error: GitHubError };
} = {};

export class GitHubError extends Error {
  status: number;
  readonly rateLimited: boolean;

  constructor(status: number, rateLimited = status === 429) {
    super(`GitHub API · HTTP ${status}`);
    this.status = status;
    this.rateLimited = rateLimited;
  }
}

export function client(
  region?: Region,
  token?: string,
  force = false,
  scope = region?.slug ?? '(account)',
) {
  const root = region
    ? `https://api.github.com/repos/${region.slug}`
    : 'https://api.github.com';
  return async function get<T>(
    path: string,
    pagination?: (hasNext: boolean, link: string | null) => void,
    ttl = 0,
    mode?: 'branch-probe',
  ): Promise<T> {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'Agentopia/0.1',
    };
    if (token) headers.Authorization = token;
    const result = await githubGet(
      root + path,
      scope,
      token,
      headers,
      force ? 0 : ttl,
      async (response) => {
        if (response.ok) return;
        const retryAfter = Number(response.headers.get('retry-after'));
        const exhausted = response.headers.get('x-ratelimit-remaining') === '0';
        let rateLimited = response.status === 429;
        if (response.status === 403) {
          const payload = (await response.json().catch(() => undefined)) as
            { message?: string } | undefined;
          rateLimited =
            exhausted ||
            retryAfter > 0 ||
            /rate limit/i.test(payload?.message ?? '');
        }
        const error = new GitHubError(response.status, rateLimited);
        if (
          !token &&
          rateLimited &&
          !path.startsWith('/search/') &&
          (response.headers.get('x-ratelimit-resource') ?? 'core') === 'core'
        ) {
          const reset = exhausted
            ? Number(response.headers.get('x-ratelimit-reset')) * 1000
            : 0;
          const now = Date.now();
          const until = Math.max(
            reset,
            now + (retryAfter > 0 ? retryAfter * 1000 : publicReportTtl),
          );
          if (until > (publicRateLimit.current?.until ?? 0))
            publicRateLimit.current = { until, error };
        }
        throw error;
      },
      mode === 'branch-probe',
    );
    pagination?.(result.next, result.link);
    return result.body as T;
  };
}

export const pendingGraphql = new Map<string, Promise<unknown>>();

export async function githubGraphql<T>(
  query: string,
  variables: Record<string, string | null>,
  token: string,
  operation = variables.name ? 'pull-activity' : 'repositories',
) {
  const repo =
    variables.owner && variables.name
      ? `${variables.owner}/${variables.name}`
      : '(account)';
  const endpoint = `graphql/${operation}`;
  const key = JSON.stringify([credentialScope(token), query, variables]);
  const pending = pendingGraphql.get(key);
  if (pending) {
    observeGitHub(repo, endpoint, 'coalesced');
    return pending as Promise<T>;
  }
  const work = fetchGraphql<T>(query, variables, token, repo, endpoint);
  pendingGraphql.set(key, work);
  try {
    return await work;
  } finally {
    if (pendingGraphql.get(key) === work) pendingGraphql.delete(key);
  }
}

export async function fetchGraphql<T>(
  query: string,
  variables: Record<string, string | null>,
  token: string,
  repo: string,
  endpoint: string,
) {
  observeGitHub(
    repo,
    endpoint,
    'request',
    undefined,
    Boolean(variables.cursor),
  );
  const response = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      Authorization: token,
      'Content-Type': 'application/json',
      'User-Agent': 'Agentopia/0.1',
    },
    body: JSON.stringify({ query, variables }),
    redirect: 'error',
    signal: AbortSignal.timeout(9000),
  });
  observeGitHub(repo, endpoint, 'response', response.status);
  if (!response.ok) throw new GitHubError(response.status);
  const body = (await response.json()) as {
    errors?: { type?: string }[];
    data?: T;
  };
  if (body.errors?.length)
    throw new GitHubError(
      body.errors.some(({ type }) => type === 'NOT_FOUND') ? 404 : 403,
      body.errors.some(({ type }) => type === 'RATE_LIMITED'),
    );
  if (!body.data) throw new GitHubError(502);
  return body.data;
}
